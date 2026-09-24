import type { Metadata } from "next";
import Link from "next/link";
import { AcademieBadge } from "@/components/AcademieBadge";
import { StatutBadge } from "@/components/StatutBadge";
import { BoutonGenerer, EnvoiBrouillons } from "@/components/factures/ActionsMensuelles";
import { IconeAlerte, IconeCalendrier, IconeParametres } from "@/components/Icones";
import {
  ACADEMIE_TOUTES,
  libelleNumero,
  moisVersPeriode,
  nomClientFacture,
  periodeVersMois,
  pluriel,
} from "@/components/factures/outils";
import { SelecteurMensuel } from "@/components/factures/SelecteurMensuel";
import { academieSelectionnee } from "@/lib/academie-selectionnee";
import { exigerUtilisateur } from "@/lib/auth";
import { emailConfigure } from "@/lib/email";
import {
  chargerAcademies,
  chargerParametres,
  destinatairesFacture,
  genererBrouillonsMensuels,
  periodeAFacturer,
} from "@/lib/facturation/service";
import { avecArticle, formatEuros, formatPeriode, nomClient, nomCourtAcademie, LIBELLES_STATUT } from "@/lib/format";
import type { Academie, Client, FactureVue, Parametres, ResultatGeneration, StatutFacture } from "@/lib/types";

export const metadata: Metadata = { title: "Facturation mensuelle" };

/** L'envoi groupé (Server Action de cette page) peut prendre plusieurs minutes. */
export const maxDuration = 300;

type ClientMensuel = Pick<
  Client,
  "id" | "academie_id" | "type" | "nom" | "prenom" | "raison_sociale" | "email" | "emails_cc" | "cavaliers"
>;
type FactureMensuelle = Pick<
  FactureVue,
  | "id"
  | "numero"
  | "statut"
  | "total_ht_centimes"
  | "total_ttc_centimes"
  | "en_retard"
  | "client_id"
  | "client_type"
  | "client_nom"
  | "client_prenom"
  | "client_raison_sociale"
  | "client_email"
  | "academie_id"
  | "academie_nom"
  | "academie_couleur"
>;

const ORDRE_STATUT: Record<StatutFacture, number> = { brouillon: 0, emise: 1, envoyee: 2, payee: 3, annulee: 4 };

export default async function PageFacturationMensuelle(props: PageProps<"/facturation-mensuelle">) {
  const { supabase } = await exigerUtilisateur();
  const parametresUrl = await props.searchParams;
  const academieDemandee = typeof parametresUrl.academie === "string" ? parametresUrl.academie : "";
  const moisDemande = typeof parametresUrl.mois === "string" ? parametresUrl.mois : "";

  let parametres: Parametres;
  let academies: Academie[];
  let idCookie: string | null;
  try {
    [parametres, academies, idCookie] = await Promise.all([
      chargerParametres(supabase),
      chargerAcademies(supabase),
      academieSelectionnee(),
    ]);
  } catch (e) {
    return <ErreurChargement message={e instanceof Error ? e.message : String(e)} />;
  }

  // Académie : celle de l'URL (« toutes » ou un identifiant), sinon celle du filtre de la
  // barre latérale, sinon toutes. Une académie inconnue ou désactivée retombe sur « toutes ».
  const actives = academies.filter((a) => a.actif);
  const idAcademie =
    academieDemandee === ACADEMIE_TOUTES ? null : academieDemandee !== "" ? academieDemandee : idCookie;
  const academie = actives.find((a) => a.id === idAcademie) ?? null;
  const academieId = academie?.id ?? null;
  // Toutes les académies (même désactivées) pour les pastilles des clients.
  const academiesParId = new Map(academies.map((a) => [a.id, a]));
  const afficherAcademie = !academie && academies.length > 1;

  const periodeDefaut = periodeAFacturer(parametres);
  const periode = moisVersPeriode(moisDemande) ?? periodeDefaut;
  const libelleMois = formatPeriode(periode);
  const mois = periodeVersMois(periode);

  let requeteClients = supabase
    .from("clients")
    .select("id, academie_id, type, nom, prenom, raison_sociale, email, emails_cc, cavaliers")
    .eq("actif", true);
  if (academieId) requeteClients = requeteClients.eq("academie_id", academieId);

  let requeteFactures = supabase
    .from("factures_vue")
    .select(
      "id, numero, statut, total_ht_centimes, total_ttc_centimes, en_retard, client_id, client_type, client_nom, client_prenom, client_raison_sociale, client_email, academie_id, academie_nom, academie_couleur",
    )
    .eq("periode", periode)
    .eq("generation_auto", true);
  if (academieId) requeteFactures = requeteFactures.eq("academie_id", academieId);

  const [apercu, resClients, resFactures] = await Promise.all([
    genererBrouillonsMensuels(supabase, periode, { academieId, apercu: true }).then(
      (r): { ok: true; donnees: ResultatGeneration[] } => ({ ok: true, donnees: r }),
      (e: unknown): { ok: false; erreur: string } => ({
        ok: false,
        erreur: e instanceof Error ? e.message : "erreur inconnue",
      }),
    ),
    requeteClients,
    requeteFactures,
  ]);
  if (resClients.error) return <ErreurChargement message={resClients.error.message} />;
  if (resFactures.error) return <ErreurChargement message={resFactures.error.message} />;

  const clients = new Map((resClients.data as ClientMensuel[]).map((c) => [c.id, c]));
  const trierParNom = <T,>(liste: T[], nom: (x: T) => string) =>
    [...liste].sort((a, b) => nom(a).localeCompare(nom(b), "fr", { sensitivity: "base" }));

  // Étape 1 : aperçu.
  const lignesApercu = apercu.ok
    ? trierParNom(
        apercu.donnees.map((r) => {
          const c = clients.get(r.client_id);
          return {
            ...r,
            nom: c ? nomClient(c) : "Client",
            cavaliers: c?.cavaliers ?? null,
            academie: c ? (academiesParId.get(c.academie_id) ?? null) : null,
            sansEmail: c ? destinatairesFacture(c).length === 0 : false,
          };
        }),
        (l) => l.nom,
      )
    : [];
  const aGenerer = lignesApercu.filter((l) => !l.deja_existante);
  const totalAGenerer = aGenerer.reduce((s, l) => s + (l.total_ht_centimes ?? 0), 0);
  const idsApercu = new Set(lignesApercu.map((l) => l.client_id));
  // Clients actifs sans tarif récurrent valide sur le mois : ils ne seront pas facturés.
  const nonFactures = trierParNom(
    [...clients.values()].filter((c) => !idsApercu.has(c.id)),
    nomClient,
  );
  const sansEmail = lignesApercu.filter((l) => l.sansEmail);
  // Répartition des brouillons à générer par académie (vue « Toutes »).
  const repartition = afficherAcademie
    ? academies
        .map((a) => ({ academie: a, nombre: aGenerer.filter((l) => l.academie?.id === a.id).length }))
        .filter((r) => r.nombre > 0)
    : [];

  // Étape 2 : factures générées pour ce mois.
  const factures = (resFactures.data as FactureMensuelle[]).sort(
    (a, b) =>
      ORDRE_STATUT[a.statut] - ORDRE_STATUT[b.statut] ||
      nomClientFacture(a).localeCompare(nomClientFacture(b), "fr", { sensitivity: "base" }),
  );
  const aDesDestinataires = (f: FactureMensuelle) => {
    const c = clients.get(f.client_id);
    return c ? destinatairesFacture(c).length > 0 : Boolean(f.client_email);
  };
  const brouillons = factures.filter((f) => f.statut === "brouillon");
  const brouillonsEnvoyables = brouillons.filter(aDesDestinataires);
  const compteurs = factures.reduce<Partial<Record<StatutFacture, number>>>((acc, f) => {
    acc[f.statut] = (acc[f.statut] ?? 0) + 1;
    return acc;
  }, {});
  const smtpOk = emailConfigure();

  const moisFacture = parametres.mois_facture === "precedent" ? "du mois précédent" : "du mois en cours";
  // « octobre 2026 (Delaveau) » / « octobre 2026 (toutes académies) » dès qu'il y a plusieurs académies.
  const libelleCible =
    academies.length > 1
      ? `${libelleMois} (${academie ? nomCourtAcademie(academie.nom) : "toutes académies"})`
      : libelleMois;
  const detailRepartition =
    repartition.length > 1
      ? `dont ${repartition.map((r) => `${nomCourtAcademie(r.academie.nom)} : ${r.nombre}`).join(" · ")}`
      : null;

  return (
    <div className="space-y-6">
      <EnTete />

      {/* Choix de l'académie et du mois */}
      <section className="carte carte-corps space-y-4" aria-label="Académie et mois">
        <SelecteurMensuel
          academies={actives.map((a) => ({ id: a.id, nom: a.nom, couleur: a.couleur }))}
          academieId={academieId}
          mois={mois}
          moisParDefaut={periodeVersMois(periodeDefaut)}
        />
        <div className="flex flex-col gap-2 rounded-lg bg-page px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-muted">
            <IconeParametres className="mt-0.5 size-4 shrink-0 text-brand" />
            <p>
              <span className="font-medium text-ink">Automatisation</span> (toutes académies) :{" "}
              {parametres.generation_auto ? (
                <>
                  brouillons générés automatiquement le{" "}
                  <strong className="text-ink">{parametres.jour_generation}</strong> de chaque mois (factures{" "}
                  {moisFacture})
                  {parametres.envoi_auto ? (
                    <>
                      , puis <strong className="text-ink">émis et envoyés automatiquement</strong>.
                    </>
                  ) : (
                    <>, à relire et envoyer depuis cette page.</>
                  )}
                </>
              ) : (
                <>génération automatique désactivée : utilisez cette page chaque mois (factures {moisFacture}).</>
              )}
            </p>
          </div>
          <Link href="/parametres#mensuelle" className="btn-lien shrink-0 text-xs">
            Modifier l&apos;automatisation
          </Link>
        </div>
      </section>

      {!smtpOk && (
        <p className="avertissement flex items-start gap-2">
          <IconeAlerte className="mt-0.5 size-4 text-amber-600" />
          <span>
            L&apos;envoi d&apos;e-mails n&apos;est pas configuré (serveur SMTP) : les factures pourront être générées mais
            pas envoyées.{" "}
            <Link href="/parametres#envoi-emails" className="font-medium underline">
              Paramètres
            </Link>
          </span>
        </p>
      )}

      {/* Étape 1 */}
      <section className="carte overflow-hidden" aria-labelledby="etape-1">
        <div className="border-b border-line px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="etape-1" className="titre-section">
              <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-brand text-xs text-white">
                1
              </span>
              Aperçu — {libelleMois}
            </h2>
            {academie ? (
              <AcademieBadge nom={academie.nom} couleur={academie.couleur} />
            ) : (
              academies.length > 1 && <span className="badge bg-page text-muted">Toutes les académies</span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            Un brouillon par client actif ayant au moins un tarif mensuel valide sur le mois. Objet : «{" "}
            {parametres.objet_facture_mensuelle} – {libelleMois} ».
          </p>
        </div>

        {!apercu.ok ? (
          <p role="alert" className="erreur m-5">
            Impossible de calculer l&apos;aperçu : {apercu.erreur}
          </p>
        ) : lignesApercu.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="font-medium text-ink">Aucun client à facturer pour {libelleMois}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              Ajoutez des tarifs mensuels (récurrents) sur les fiches des clients
              {academie ? ` de ${avecArticle(academie.nom)}` : ""} : ils apparaîtront ici.
            </p>
            <Link href="/clients" className="btn-secondaire mt-5">
              Voir les clients
            </Link>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="tableau">
                <thead>
                  <tr>
                    <th>Client</th>
                    {afficherAcademie && <th>Académie</th>}
                    <th>Cavalier(s)</th>
                    <th className="text-right">Lignes</th>
                    <th className="text-right">Total HT</th>
                    <th>État</th>
                  </tr>
                </thead>
                <tbody>
                  {lignesApercu.map((l) => (
                    <tr key={l.client_id}>
                      <td>
                        <Link href={`/clients/${l.client_id}`} className="font-medium text-brand hover:underline">
                          {l.nom}
                        </Link>
                        {l.sansEmail && <SansEmail />}
                      </td>
                      {afficherAcademie && (
                        <td>{l.academie && <AcademieBadge nom={l.academie.nom} couleur={l.academie.couleur} />}</td>
                      )}
                      <td className="max-w-56">
                        <span className="line-clamp-1">{l.cavaliers ?? <span className="text-muted">—</span>}</span>
                      </td>
                      <td className="text-right tabular-nums">{l.nb_lignes}</td>
                      <td className="text-right font-medium whitespace-nowrap tabular-nums">
                        {formatEuros(l.total_ht_centimes ?? 0)}
                      </td>
                      <td>
                        {l.deja_existante && l.facture_id ? (
                          <Link href={`/factures/${l.facture_id}`} className="btn-lien text-xs">
                            Déjà générée
                          </Link>
                        ) : (
                          <span className="badge bg-brand-light text-brand">À générer</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line bg-page/60">
                    <td colSpan={afficherAcademie ? 4 : 3} className="px-4 py-3 text-sm text-muted">
                      {pluriel(aGenerer.length, "brouillon")} à générer sur {pluriel(lignesApercu.length, "client")}
                      {detailRepartition && <span className="ml-2 text-xs">({detailRepartition})</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap text-brand tabular-nums">
                      {formatEuros(totalAGenerer)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {lignesApercu.map((l) => (
                <li key={l.client_id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/clients/${l.client_id}`} className="font-medium text-brand">
                      {l.nom}
                    </Link>
                    <div className="text-xs text-muted">
                      {pluriel(l.nb_lignes, "ligne")}
                      {l.cavaliers ? ` · ${l.cavaliers}` : ""}
                    </div>
                    {afficherAcademie && l.academie && (
                      <div className="mt-1">
                        <AcademieBadge nom={l.academie.nom} couleur={l.academie.couleur} />
                      </div>
                    )}
                    {l.sansEmail && <SansEmail />}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium tabular-nums">{formatEuros(l.total_ht_centimes ?? 0)}</div>
                    {l.deja_existante && l.facture_id ? (
                      <Link href={`/factures/${l.facture_id}`} className="btn-lien text-xs">
                        Déjà générée
                      </Link>
                    ) : (
                      <span className="badge bg-brand-light text-brand">À générer</span>
                    )}
                  </div>
                </li>
              ))}
              <li className="flex justify-between gap-3 bg-page/60 px-5 py-3 text-sm">
                <span className="text-muted">
                  {pluriel(aGenerer.length, "brouillon")} à générer (HT)
                  {detailRepartition && <span className="block text-xs">{detailRepartition}</span>}
                </span>
                <span className="shrink-0 font-semibold text-brand tabular-nums">{formatEuros(totalAGenerer)}</span>
              </li>
            </ul>
          </>
        )}

        {apercu.ok && (nonFactures.length > 0 || sansEmail.length > 0) && (
          <div className="space-y-3 border-t border-line px-5 py-4">
            {nonFactures.length > 0 && (
              <details className="avertissement group">
                <summary className="cursor-pointer font-medium">
                  {nonFactures.length === 1
                    ? "1 client actif ne sera pas facturé : aucun tarif mensuel valide sur ce mois."
                    : `${nonFactures.length} clients actifs ne seront pas facturés : aucun tarif mensuel valide sur ce mois.`}
                </summary>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {nonFactures.map((c) => {
                    const academieClient = afficherAcademie ? academiesParId.get(c.academie_id) : undefined;
                    return (
                      <li key={c.id} className="flex items-center gap-1.5">
                        <Link href={`/clients/${c.id}`} className="underline">
                          {nomClient(c)}
                        </Link>
                        {academieClient && (
                          <span className="text-xs opacity-80">({nomCourtAcademie(academieClient.nom)})</span>
                        )}
                        {destinatairesFacture(c).length === 0 && (
                          <span className="text-xs opacity-80" title="Aucune adresse e-mail sur la fiche">
                            · sans e-mail
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-xs">
                  Ajoutez-leur un tarif récurrent, ou créez une facture ponctuelle depuis leur fiche.
                </p>
              </details>
            )}
            {sansEmail.length > 0 && (
              <p className="avertissement">
                {sansEmail.length === 1
                  ? `1 client facturé n'a pas d'adresse e-mail (${sansEmail[0].nom}) : sa facture ne pourra pas être envoyée par e-mail.`
                  : `${sansEmail.length} clients facturés n'ont pas d'adresse e-mail (${sansEmail
                      .map((l) => l.nom)
                      .join(", ")}) : leurs factures ne pourront pas être envoyées par e-mail.`}
              </p>
            )}
          </div>
        )}

        {apercu.ok && lignesApercu.length > 0 && (
          <div className="border-t border-line bg-page/40 px-5 py-4">
            <BoutonGenerer academieId={academieId} mois={mois} nombre={aGenerer.length} libelleMois={libelleCible} />
          </div>
        )}
      </section>

      {/* Étape 2 */}
      <section className="carte overflow-hidden" aria-labelledby="etape-2">
        <div className="flex flex-col gap-1 border-b border-line px-5 py-4 sm:flex-row sm:items-baseline sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="etape-2" className="titre-section">
              <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-brand text-xs text-white">
                2
              </span>
              Relecture et envoi — {libelleMois}
            </h2>
            {academie && <AcademieBadge nom={academie.nom} couleur={academie.couleur} />}
          </div>
          {factures.length > 0 && (
            <p className="text-xs text-muted">
              {(Object.keys(ORDRE_STATUT) as StatutFacture[])
                .filter((s) => compteurs[s])
                .map((s) => `${compteurs[s]} ${LIBELLES_STATUT[s].toLowerCase()}${(compteurs[s] ?? 0) > 1 ? "s" : ""}`)
                .join(" · ")}
            </p>
          )}
        </div>

        {factures.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-light text-brand">
              <IconeCalendrier className="size-6" />
            </span>
            <p className="mt-4 font-medium text-ink">Aucune facture générée pour {libelleMois}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              Générez les brouillons à l&apos;étape 1 : ils apparaîtront ici pour relecture avant l&apos;envoi.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="tableau">
                <thead>
                  <tr>
                    <th>Client</th>
                    {afficherAcademie && <th>Académie</th>}
                    <th>N°</th>
                    <th className="text-right">Montant TTC</th>
                    <th>Statut</th>
                    <th className="text-right">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {factures.map((f) => (
                    <tr key={f.id} className={f.statut === "annulee" ? "text-muted" : ""}>
                      <td>
                        <span className="font-medium">{nomClientFacture(f)}</span>
                        {f.statut === "brouillon" && !aDesDestinataires(f) && <SansEmail />}
                      </td>
                      {afficherAcademie && (
                        <td>
                          <AcademieBadge nom={f.academie_nom} couleur={f.academie_couleur} />
                        </td>
                      )}
                      <td className={f.numero ? "" : "text-muted italic"}>{libelleNumero(f.numero)}</td>
                      <td
                        className={`text-right font-medium whitespace-nowrap tabular-nums ${
                          f.statut === "annulee" ? "line-through" : ""
                        }`}
                      >
                        {formatEuros(f.total_ttc_centimes)}
                      </td>
                      <td>
                        <StatutBadge statut={f.statut} enRetard={f.en_retard} />
                      </td>
                      <td className="text-right">
                        <Link
                          href={`/factures/${f.id}`}
                          className={f.statut === "brouillon" ? "btn-secondaire btn-petit" : "btn-lien text-xs"}
                        >
                          {f.statut === "brouillon" ? "Relire" : "Voir"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {factures.map((f) => (
                <li key={f.id}>
                  <Link href={`/factures/${f.id}`} className="flex items-start justify-between gap-3 px-5 py-3 hover:bg-page">
                    <div className="min-w-0">
                      <div className={`font-medium ${f.statut === "annulee" ? "text-muted" : "text-ink"}`}>
                        {nomClientFacture(f)}
                      </div>
                      <div className="text-xs text-muted">{libelleNumero(f.numero)}</div>
                      {afficherAcademie && (
                        <div className="mt-1">
                          <AcademieBadge nom={f.academie_nom} couleur={f.academie_couleur} />
                        </div>
                      )}
                      {f.statut === "brouillon" && !aDesDestinataires(f) && <SansEmail />}
                    </div>
                    <div className="shrink-0 space-y-1 text-right">
                      <div className="text-sm font-medium tabular-nums">{formatEuros(f.total_ttc_centimes)}</div>
                      <StatutBadge statut={f.statut} enRetard={f.en_retard} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {brouillons.length > 0 && (
          <div className="border-t border-line bg-page/40 px-5 py-4">
            {smtpOk ? (
              <EnvoiBrouillons
                academieId={academieId}
                mois={mois}
                libelleMois={libelleCible}
                brouillons={brouillonsEnvoyables.map((f) => ({
                  id: f.id,
                  client: nomClientFacture(f),
                  academie: afficherAcademie ? nomCourtAcademie(f.academie_nom) : null,
                  totalTtc: f.total_ttc_centimes,
                }))}
                nbSansEmail={brouillons.length - brouillonsEnvoyables.length}
              />
            ) : (
              <p className="text-sm text-muted">
                Configurez l&apos;envoi d&apos;e-mails pour envoyer les brouillons en une fois, ou émettez-les un par un
                depuis leur fiche.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function EnTete() {
  return (
    <div>
      <h1 className="titre-page">Facturation mensuelle</h1>
      <p className="mt-1 text-sm text-muted">
        Préparez les factures du mois à partir des tarifs des clients, relisez-les, puis émettez-les et envoyez-les en une
        fois.
      </p>
    </div>
  );
}

/** « Académie Espoir » → « l'Académie Espoir » ; autre nom → « « Nom » ». */
function SansEmail() {
  return (
    <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-700" title="Facture non envoyable par e-mail">
      <IconeAlerte className="size-3.5" />
      Aucun e-mail
    </span>
  );
}

function ErreurChargement({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <EnTete />
      <p role="alert" className="erreur">
        Impossible de charger la facturation mensuelle : {message}
      </p>
    </div>
  );
}
