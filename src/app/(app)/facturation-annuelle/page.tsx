import type { Metadata } from "next";
import Link from "next/link";
import { AcademieBadge } from "@/components/AcademieBadge";
import { StatutBadge } from "@/components/StatutBadge";
import {
  BoutonPreparer,
  EnvoiAvisMois,
  EnvoiFacturesAnnuelles,
  SupprimerAnciensBrouillons,
} from "@/components/annee/ActionsAnnuelles";
import { ACADEMIE_TOUTES } from "@/components/annee/outils";
import { SelecteurAnnee } from "@/components/annee/SelecteurAnnee";
import { ReferenceBadge } from "@/components/annee/StatutEcheanceBadge";
import { COLONNES_ECHEANCE, TableauEcheances, type EcheanceLigne } from "@/components/annee/TableauEcheances";
import { libelleNumero, nomClientFacture } from "@/components/factures/outils";
import { IconeAlerte, IconeCalendrier, IconeParametres } from "@/components/Icones";
import { academieSelectionnee, resoudreAcademie } from "@/lib/academie-selectionnee";
import { exigerUtilisateur } from "@/lib/auth";
import { emailConfigure } from "@/lib/email";
import { chargerAcademies, chargerParametres, destinatairesFacture, genererFacturesAnnuelles } from "@/lib/facturation/service";
import {
  aujourdhuiParis,
  avecArticle,
  formatEuros,
  formatPeriode,
  jourDuMois,
  nomClient,
  nomCourtAcademie,
  pluriel,
} from "@/lib/format";
import { arrhesSurSaison, libelleSaison, moisSaison, saisonEnCours } from "@/lib/tarifs";
import type { Academie, Client, EcheanceVue, FactureVue, Parametres, ResultatGeneration } from "@/lib/types";

export const metadata: Metadata = { title: "Facturation de l'année" };

/** L'envoi groupé (Server Action de cette page) peut prendre plusieurs minutes. */
export const maxDuration = 300;

type ClientAnnee = Pick<
  Client,
  | "id"
  | "academie_id"
  | "reference"
  | "type"
  | "nom"
  | "prenom"
  | "raison_sociale"
  | "email"
  | "emails_cc"
  | "cavaliers"
  | "envoi_auto"
  | "arrhes_reglees"
  | "arrhes_centimes"
  | "arrhes_saison"
>;
type FactureAnnee = Pick<
  FactureVue,
  | "id"
  | "numero"
  | "statut"
  | "total_ttc_centimes"
  | "en_retard"
  | "client_id"
  | "client_type"
  | "client_nom"
  | "client_prenom"
  | "client_raison_sociale"
  | "client_reference"
  | "client_email"
  | "client_emails_cc"
  | "academie_id"
  | "academie_nom"
  | "academie_couleur"
  | "echeances_actives"
  | "echeances_payees"
  | "echeances_reste_centimes"
>;
type AncienBrouillon = Pick<FactureVue, "id" | "client_id" | "periode" | "total_ttc_centimes">;

const ORDRE_STATUT = { brouillon: 0, emise: 1, envoyee: 2, payee: 3, annulee: 4 } as const;

/** Mois des avis par défaut : le mois en cours s'il appartient à la saison, sinon septembre (avant) ou juin (après). */
function moisParDefaut(saison: number, aujourdhui: string): string {
  const mois = moisSaison(saison).map((p) => p.slice(0, 7));
  const courant = aujourdhui.slice(0, 7);
  if (mois.includes(courant)) return courant;
  return courant < mois[0] ? mois[0] : mois[mois.length - 1];
}

export default async function PageFacturationAnnuelle(props: PageProps<"/facturation-annuelle">) {
  const { supabase } = await exigerUtilisateur();
  const url = await props.searchParams;
  const texte = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");
  const aujourdhui = aujourdhuiParis();
  const enCours = saisonEnCours(aujourdhui);

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

  // Académie : celle de l'URL (« toutes » ou un identifiant), sinon le filtre de la barre latérale.
  const academieDemandee = texte(url.academie);
  const idAcademie =
    academieDemandee === ACADEMIE_TOUTES ? null : academieDemandee !== "" ? academieDemandee : idCookie;
  const academie = resoudreAcademie(idAcademie, academies);
  const academieId = academie?.id ?? null;
  const actives = academies.filter((a) => a.actif);
  const academiesParId = new Map(academies.map((a) => [a.id, a]));
  const afficherAcademie = !academie && academies.length > 1;

  const saisonDemandee = Number(texte(url.saison));
  const saison = Number.isInteger(saisonDemandee) && saisonDemandee >= 2000 && saisonDemandee <= 2098 ? saisonDemandee : enCours;
  const moisDemande = texte(url.mois);
  const mois = moisSaison(saison)
    .map((p) => p.slice(0, 7))
    .includes(moisDemande)
    ? moisDemande
    : moisParDefaut(saison, aujourdhui);
  const periode = `${mois}-01`;
  const annee = libelleSaison(saison);
  const libelleCible = academies.length > 1 ? `${annee} (${academie ? nomCourtAcademie(academie.nom) : "toutes académies"})` : annee;

  let requeteClients = supabase
    .from("clients")
    .select(
      "id, academie_id, reference, type, nom, prenom, raison_sociale, email, emails_cc, cavaliers, envoi_auto, arrhes_reglees, arrhes_centimes, arrhes_saison",
    )
    .eq("actif", true);
  let requeteFactures = supabase
    .from("factures_vue")
    .select(
      "id, numero, statut, total_ttc_centimes, en_retard, client_id, client_type, client_nom, client_prenom, client_raison_sociale, client_reference, client_email, client_emails_cc, academie_id, academie_nom, academie_couleur, echeances_actives, echeances_payees, echeances_reste_centimes",
    )
    .eq("type_facture", "annuelle")
    .eq("saison", saison);
  // Anciens brouillons mensuels de la saison (avant le passage à la facture annuelle).
  let requeteAnciens = supabase
    .from("factures_vue")
    .select("id, client_id, periode, total_ttc_centimes")
    .eq("statut", "brouillon")
    .eq("generation_auto", true)
    .eq("type_facture", "ponctuelle")
    .gte("periode", `${saison}-09-01`)
    .lte("periode", `${saison + 1}-06-01`);
  let requeteAvis = supabase.from("echeances_vue").select(COLONNES_ECHEANCE).eq("periode", periode);
  if (academieId) {
    requeteClients = requeteClients.eq("academie_id", academieId);
    requeteFactures = requeteFactures.eq("academie_id", academieId);
    requeteAnciens = requeteAnciens.eq("academie_id", academieId);
    requeteAvis = requeteAvis.eq("academie_id", academieId);
  }

  const [apercu, resClients, resFactures, resAnciens, resAvis, resEnvoiAuto] = await Promise.all([
    genererFacturesAnnuelles(supabase, saison, { academieId, apercu: true }).then(
      (r): { ok: true; donnees: ResultatGeneration[] } => ({ ok: true, donnees: r }),
      (e: unknown): { ok: false; erreur: string } => ({ ok: false, erreur: e instanceof Error ? e.message : "erreur inconnue" }),
    ),
    requeteClients,
    requeteFactures,
    requeteAnciens,
    requeteAvis,
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("actif", true).eq("envoi_auto", true),
  ]);
  const erreur = resClients.error ?? resFactures.error ?? resAnciens.error ?? resAvis.error ?? resEnvoiAuto.error;
  if (erreur) return <ErreurChargement message={erreur.message} />;

  const clients = new Map((resClients.data as ClientAnnee[]).map((c) => [c.id, c]));
  const nbEnvoiAuto = resEnvoiAuto.count ?? 0;
  const smtpOk = emailConfigure();
  const trier = <T,>(liste: T[], cle: (x: T) => string) =>
    [...liste].sort((a, b) => cle(a).localeCompare(cle(b), "fr", { sensitivity: "base" }));

  // --- Étape 1 : aperçu
  const facturesAnnee = (resFactures.data as FactureAnnee[]).filter((f) => f.statut !== "annulee");
  const factureDuClient = new Map(facturesAnnee.map((f) => [f.client_id, f]));
  const lignesApercu = apercu.ok
    ? trier(
        apercu.donnees.map((r) => {
          const c = clients.get(r.client_id);
          return {
            ...r,
            nom: c ? nomClient(c) : "Client",
            reference: c?.reference ?? "—",
            academie: c ? (academiesParId.get(c.academie_id) ?? null) : null,
            arrhes: c ? arrhesSurSaison(c, saison) : 0,
            sansEmail: c ? destinatairesFacture(c).length === 0 : false,
            facture: factureDuClient.get(r.client_id) ?? null,
          };
        }),
        (l) => l.nom,
      )
    : [];
  const aPreparer = lignesApercu.filter((l) => !l.deja_existante);
  const totalAPreparer = aPreparer.reduce((s, l) => s + l.total_ht_centimes, 0);
  const idsApercu = new Set(lignesApercu.map((l) => l.client_id));
  const nonFactures = trier(
    [...clients.values()].filter((c) => !idsApercu.has(c.id) && !factureDuClient.has(c.id)),
    nomClient,
  );

  // Anciens brouillons mensuels, par client.
  const anciens = resAnciens.data as AncienBrouillon[];
  const anciensParClient = new Map<string, AncienBrouillon[]>();
  for (const b of anciens) anciensParClient.set(b.client_id, [...(anciensParClient.get(b.client_id) ?? []), b]);
  const clientsAnciens = trier(
    [...anciensParClient.entries()].map(([id, liste]) => {
      const c = clients.get(id);
      return { id, nom: c ? nomClient(c) : "Client (archivé)", nombre: liste.length };
    }),
    (x) => x.nom,
  );

  // --- Étape 2 : factures annuelles de la saison
  const factures = [...facturesAnnee].sort(
    (a, b) => ORDRE_STATUT[a.statut] - ORDRE_STATUT[b.statut] || nomClientFacture(a).localeCompare(nomClientFacture(b), "fr"),
  );
  const brouillons = factures.filter((f) => f.statut === "brouillon");
  const aDesDestinataires = (f: FactureAnnee) =>
    destinatairesFacture(clients.get(f.client_id) ?? { email: f.client_email, emails_cc: f.client_emails_cc }).length > 0;
  const brouillonsEnvoyables = brouillons.filter(aDesDestinataires);
  const nbEmises = factures.length - brouillons.length;

  // --- Étape 3 : avis du mois
  const avis: EcheanceLigne[] = trier(
    (resAvis.data as unknown as EcheanceVue[]).map((e) => ({
      ...e,
      client: nomClient({ type: e.client_type, nom: e.client_nom, prenom: e.client_prenom, raison_sociale: e.client_raison_sociale }),
      destinataires: destinatairesFacture({ email: e.client_email, emails_cc: e.client_emails_cc }),
    })),
    (e) => e.client ?? "",
  );
  const avisActifs = avis.filter((e) => e.statut !== "annulee");
  const aEnvoyer = avisActifs.filter((e) => e.statut === "a_venir");
  const aEnvoyerAvecEmail = aEnvoyer.filter((e) => e.destinataires.length > 0);
  const compteurs = {
    aEnvoyer: aEnvoyer.length,
    envoyes: avisActifs.filter((e) => e.statut === "envoyee").length,
    payes: avisActifs.filter((e) => e.statut === "payee").length,
    enRetard: avisActifs.filter((e) => e.en_retard).length,
  };
  const resteMois = avisActifs.filter((e) => e.statut !== "payee").reduce((s, e) => s + e.montant_centimes, 0);
  const libelleMois = formatPeriode(periode);
  const moisFacture = parametres.mois_facture === "precedent" ? "du mois précédent" : "du mois en cours";

  return (
    <div className="space-y-6">
      <EnTete />

      <section className="carte carte-corps space-y-4" aria-label="Académie, année et mois">
        <SelecteurAnnee
          academies={actives.map((a) => ({ id: a.id, nom: a.nom, couleur: a.couleur }))}
          academieId={academieId}
          saison={saison}
          saisonEnCours={enCours}
          mois={mois}
        />
        <div className="flex flex-col gap-2 rounded-lg bg-page px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-muted">
            <IconeParametres className="mt-0.5 size-4 shrink-0 text-brand" />
            <p>
              <span className="font-medium text-ink">Automatisation</span> : factures annuelles émises à la main (rentrée).{" "}
              {nbEnvoiAuto > 0 ? (
                <>
                  Avis {moisFacture} envoyés automatiquement le{" "}
                  <strong className="text-ink">{jourDuMois(parametres.jour_generation)}</strong> de chaque mois (septembre à
                  juin) pour{" "}
                  <Link href="/clients" className="btn-lien">
                    {pluriel(nbEnvoiAuto, "client", "clients")} en envoi automatique
                  </Link>
                  .
                </>
              ) : (
                <>Aucun client en envoi automatique : avis à envoyer depuis cette page.</>
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
            Envoi d&apos;e-mails non configuré (serveur SMTP) : préparation possible, envoi impossible. Réglage dans les{" "}
            <Link href="/parametres#envoi-emails" className="font-medium underline">
              Paramètres
            </Link>
            .
          </span>
        </p>
      )}

      {/* 1. Préparer les factures annuelles */}
      <section className="carte overflow-hidden" aria-labelledby="etape-1">
        <EnTeteEtape numero={1} id="etape-1" titre={`Factures annuelles ${annee} : aperçu`} academie={academie} plusieurs={academies.length > 1}>
          Une facture par élève (client actif ayant des tarifs récurrents sur la saison) : prix mensuel × 10 (ou × nombre de
          mois de validité), arrhes déduites de l&apos;échéancier. Objet : « {parametres.objet_facture_mensuelle} – saison{" "}
          {annee} ».
        </EnTeteEtape>

        {clientsAnciens.length > 0 && (
          <div role="alert" className="avertissement mx-5 mt-4">
            <p className="font-medium">
              Anciens brouillons mensuels {annee} :{" "}
              {pluriel(anciens.length, "brouillon", "brouillons")} pour {pluriel(clientsAnciens.length, "client", "clients")}. À
              supprimer avant d&apos;émettre les factures annuelles (double facturation).
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {clientsAnciens.map((c) => (
                <li key={c.id}>
                  <Link href={`/clients/${c.id}`} className="underline">
                    {c.nom}
                  </Link>{" "}
                  <span className="text-xs opacity-80">({pluriel(c.nombre, "brouillon", "brouillons")})</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <SupprimerAnciensBrouillons
                key={`${academieId ?? ACADEMIE_TOUTES}-${saison}`}
                saison={saison}
                academieId={academieId}
                nombre={anciens.length}
                libelle={`de ${pluriel(clientsAnciens.length, "client", "clients")}`}
              />
              <Link href="/factures?statut=brouillon" className="btn-lien text-xs">
                Voir les brouillons
              </Link>
            </div>
          </div>
        )}

        {!apercu.ok ? (
          <p role="alert" className="erreur m-5">
            Impossible de calculer l&apos;aperçu : {apercu.erreur}
          </p>
        ) : lignesApercu.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="font-medium text-ink">Aucun élève à facturer pour {annee}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              Ajouter des tarifs récurrents sur les fiches clients{academie ? ` de ${avecArticle(academie.nom)}` : ""} : ils
              apparaîtront ici.
            </p>
            <Link href="/clients" className="btn-secondaire mt-5">
              Voir les clients
            </Link>
          </div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Élève / client</th>
                  {afficherAcademie && <th className="hidden md:table-cell">Académie</th>}
                  <th className="hidden text-right sm:table-cell">Lignes</th>
                  <th className="text-right">Total annuel HT</th>
                  <th className="hidden text-right md:table-cell">Arrhes</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {lignesApercu.map((l) => (
                  <tr key={l.client_id}>
                    <td className="max-w-60">
                      <Link href={`/clients/${l.client_id}`} className="block truncate font-medium text-brand hover:underline">
                        {l.nom}
                      </Link>
                      <span className="mt-0.5 inline-flex flex-wrap items-center gap-1.5">
                        <ReferenceBadge reference={l.reference} />
                        {l.sansEmail && <SansEmail />}
                        {anciensParClient.has(l.client_id) && (
                          <span className="text-xs font-medium text-amber-700">Anciens brouillons mensuels</span>
                        )}
                      </span>
                    </td>
                    {afficherAcademie && (
                      <td className="hidden md:table-cell">
                        {l.academie && <AcademieBadge nom={l.academie.nom} couleur={l.academie.couleur} />}
                      </td>
                    )}
                    <td className="hidden text-right tabular-nums sm:table-cell">{l.nb_lignes}</td>
                    <td className="text-right font-medium whitespace-nowrap tabular-nums">{formatEuros(l.total_ht_centimes)}</td>
                    <td className="hidden text-right whitespace-nowrap text-muted tabular-nums md:table-cell">
                      {l.arrhes > 0 ? `−${formatEuros(l.arrhes)}` : "—"}
                    </td>
                    <td>
                      {l.facture ? (
                        <Link href={`/factures/${l.facture.id}`} className="inline-flex items-center gap-1.5">
                          <StatutBadge statut={l.facture.statut} enRetard={l.facture.en_retard} />
                        </Link>
                      ) : (
                        <span className="badge bg-brand-light text-brand">À préparer</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-page/60">
                  <td colSpan={afficherAcademie ? 3 : 2} className="px-4 py-3 text-sm text-muted">
                    {pluriel(aPreparer.length, "facture", "factures")} à préparer sur {pluriel(lignesApercu.length, "élève", "élèves")}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold whitespace-nowrap text-brand tabular-nums">
                    {formatEuros(totalAPreparer)}
                  </td>
                  <td colSpan={2} className="hidden md:table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {apercu.ok && nonFactures.length > 0 && (
          <div className="border-t border-line px-5 py-4">
            <details className="avertissement">
              <summary className="cursor-pointer font-medium">
                {nonFactures.length === 1
                  ? "1 client actif sans tarif récurrent sur la saison : pas de facture annuelle."
                  : `${nonFactures.length} clients actifs sans tarif récurrent sur la saison : pas de facture annuelle.`}
              </summary>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {nonFactures.map((c) => (
                  <li key={c.id}>
                    <Link href={`/clients/${c.id}`} className="underline">
                      {nomClient(c)}
                    </Link>{" "}
                    <span className="text-xs opacity-80">({c.reference})</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs">Ajouter un tarif récurrent, ou créer une facture ponctuelle depuis la fiche client.</p>
            </details>
          </div>
        )}

        {apercu.ok && lignesApercu.length > 0 && (
          <div className="border-t border-line bg-page/40 px-5 py-4">
            <BoutonPreparer
              key={`${academieId ?? ACADEMIE_TOUTES}-${saison}`}
              academieId={academieId}
              saison={saison}
              nombre={aPreparer.length}
              libelle={libelleCible}
            />
          </div>
        )}
      </section>

      {/* 2. Émettre et envoyer */}
      <section className="carte overflow-hidden" aria-labelledby="etape-2">
        <EnTeteEtape numero={2} id="etape-2" titre={`Émission et envoi — ${annee}`} academie={academie} plusieurs={false}>
          {factures.length === 0
            ? "Factures préparées à l'étape 1, à relire puis émettre : chaque facture émise reçoit ses 10 échéances."
            : `${pluriel(brouillons.length, "brouillon", "brouillons")} · ${pluriel(nbEmises, "facture émise", "factures émises")}`}
        </EnTeteEtape>
        {factures.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-light text-brand">
              <IconeCalendrier className="size-6" />
            </span>
            <p className="mt-4 font-medium text-ink">Aucune facture annuelle pour {annee}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Élève / client</th>
                  {afficherAcademie && <th className="hidden md:table-cell">Académie</th>}
                  <th>N°</th>
                  <th className="text-right">Total TTC</th>
                  <th className="hidden sm:table-cell">Échéances</th>
                  <th>Statut</th>
                  <th className="text-right">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {factures.map((f) => (
                  <tr key={f.id}>
                    <td className="max-w-60">
                      <span className="block truncate font-medium">{nomClientFacture(f)}</span>
                      <span className="mt-0.5 inline-flex items-center gap-1.5">
                        <ReferenceBadge reference={f.client_reference} />
                        {f.statut === "brouillon" && !aDesDestinataires(f) && <SansEmail />}
                      </span>
                    </td>
                    {afficherAcademie && (
                      <td className="hidden md:table-cell">
                        <AcademieBadge nom={f.academie_nom} couleur={f.academie_couleur} />
                      </td>
                    )}
                    <td className={f.numero ? "whitespace-nowrap" : "text-muted italic"}>{libelleNumero(f.numero)}</td>
                    <td className="text-right font-medium whitespace-nowrap tabular-nums">{formatEuros(f.total_ttc_centimes)}</td>
                    <td className="hidden text-sm whitespace-nowrap sm:table-cell">
                      {f.echeances_actives > 0 ? (
                        <>
                          <span className="tabular-nums">
                            {f.echeances_payees}/{f.echeances_actives}
                          </span>{" "}
                          <span className="text-muted">payées</span>
                        </>
                      ) : (
                        <span className="text-muted">{f.statut === "brouillon" ? "à l'émission" : "—"}</span>
                      )}
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
        )}
        {brouillons.length > 0 && (
          <div className="border-t border-line bg-page/40 px-5 py-4">
            {clientsAnciens.length > 0 && (
              <p className="avertissement mb-4 flex items-start gap-2">
                <IconeAlerte className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <span>Anciens brouillons mensuels encore présents (étape 1) : les supprimer avant l&apos;émission.</span>
              </p>
            )}
            {smtpOk ? (
              <EnvoiFacturesAnnuelles
                key={`${academieId ?? ACADEMIE_TOUTES}-${saison}`}
                academieId={academieId}
                saison={saison}
                libelle={libelleCible}
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
                Configurer l&apos;envoi d&apos;e-mails pour envoyer les factures en une fois, ou les émettre une par une depuis
                leur fiche.
              </p>
            )}
          </div>
        )}
      </section>

      {/* 3. Avis d'échéance du mois */}
      <section className="carte overflow-hidden" aria-labelledby="etape-3" id="avis">
        <EnTeteEtape numero={3} id="etape-3" titre={`Avis d'échéance — ${libelleMois}`} academie={academie} plusieurs={false}>
          {avisActifs.length === 0
            ? "Un avis par facture annuelle émise, chaque mois de septembre à juin (document non fiscal, sans numéro de facture)."
            : [
                pluriel(compteurs.aEnvoyer, "à envoyer", "à envoyer"),
                pluriel(compteurs.envoyes, "envoyé", "envoyés"),
                pluriel(compteurs.payes, "payé", "payés"),
                compteurs.enRetard > 0 ? pluriel(compteurs.enRetard, "en retard", "en retard") : null,
                `reste à encaisser : ${formatEuros(resteMois)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
        </EnTeteEtape>
        {avis.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="font-medium text-ink">Aucun avis pour {libelleMois}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              Les avis existent dès l&apos;émission des factures annuelles (étape 2).
            </p>
          </div>
        ) : (
          <TableauEcheances
            echeances={avis}
            variante="mois"
            afficherAcademie={afficherAcademie}
            emailConfigure={smtpOk}
            aujourdhui={aujourdhui}
          />
        )}
        {aEnvoyer.length > 0 && (
          <div className="border-t border-line bg-page/40 px-5 py-4">
            {smtpOk ? (
              <EnvoiAvisMois
                key={`${academieId ?? ACADEMIE_TOUTES}-${mois}`}
                avis={aEnvoyerAvecEmail.map((e) => ({
                  id: e.id,
                  client: e.client ?? "Client",
                  numero: e.numero_avis,
                  montant: e.montant_centimes,
                }))}
                libelleMois={libelleMois}
                nbSansEmail={aEnvoyer.length - aEnvoyerAvecEmail.length}
              />
            ) : (
              <p className="text-sm text-muted">
                Configurer l&apos;envoi d&apos;e-mails pour envoyer les avis, ou télécharger leur PDF (bouton « PDF »).
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
      <h1 className="titre-page">Facturation de l&apos;année</h1>
      <p className="mt-1 text-sm text-muted">
        À la rentrée : préparer puis émettre une facture annuelle par élève. Ensuite, chaque mois : envoyer les avis
        d&apos;échéance et enregistrer les paiements.
      </p>
    </div>
  );
}

function EnTeteEtape({
  numero,
  id,
  titre,
  academie,
  plusieurs,
  children,
}: {
  numero: number;
  id: string;
  titre: string;
  academie: Academie | null;
  plusieurs: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-line px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={id} className="titre-section">
          <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-brand text-xs text-white">
            {numero}
          </span>
          {titre}
        </h2>
        {academie ? (
          <AcademieBadge nom={academie.nom} couleur={academie.couleur} />
        ) : (
          plusieurs && <span className="badge bg-page text-muted">Toutes les académies</span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{children}</p>
    </div>
  );
}

function SansEmail() {
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-amber-700" title="Pas d'adresse e-mail : envoi impossible">
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
        Impossible de charger la facturation de l&apos;année : {message}
      </p>
    </div>
  );
}
