import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EntiteBadge } from "@/components/EntiteBadge";
import { StatutBadge } from "@/components/StatutBadge";
import { ActionsFacture } from "@/components/factures/ActionsFacture";
import { ApercuPdf } from "@/components/factures/ApercuPdf";
import { EditeurLignes } from "@/components/factures/EditeurLignes";
import type { PrestationFormulaire } from "@/components/factures/FormulaireNouvelleFacture";
import {
  IconeAlerte,
  IconeAnnuler,
  IconeExterne,
  IconeHorloge,
  IconeRetour,
  IconeTelecharger,
  IconeValide,
} from "@/components/factures/Icones";
import { InfosBrouillon, NotesInternes } from "@/components/factures/InfosBrouillon";
import { LignesLectureSeule, type Totaux } from "@/components/factures/LignesFacture";
import { libelleNumero, nomClientFacture } from "@/components/factures/outils";
import { exigerUtilisateur } from "@/lib/auth";
import { emailConfigure } from "@/lib/email";
import { chargerFactureComplete, destinatairesFacture } from "@/lib/facturation/service";
import {
  aujourdhuiParis,
  formatDate,
  formatDateHeure,
  formatDateLongue,
  formatEuros,
  formatPeriode,
  nomClient,
} from "@/lib/format";
import type { EnvoiEmail, FactureComplete, FactureVue } from "@/lib/types";

/** L'envoi d'une facture (PDF + SMTP) peut prendre quelques secondes. */
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Titre de l'onglet : numéro (ou « Brouillon ») et client. */
export async function generateMetadata(props: PageProps<"/factures/[id]">): Promise<Metadata> {
  const { supabase } = await exigerUtilisateur();
  const { id } = await props.params;
  if (!UUID.test(id)) return { title: "Facture introuvable" };
  const { data } = await supabase
    .from("factures_vue")
    .select("numero, client_type, client_nom, client_prenom, client_raison_sociale")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { title: "Facture" };
  const f = data as Pick<FactureVue, "numero" | "client_type" | "client_nom" | "client_prenom" | "client_raison_sociale">;
  return { title: `${libelleNumero(f.numero)} – ${nomClientFacture(f)}` };
}

export default async function PageFacture(props: PageProps<"/factures/[id]">) {
  const { supabase } = await exigerUtilisateur();
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  let complete: FactureComplete | null;
  try {
    complete = await chargerFactureComplete(supabase, id);
  } catch (e) {
    return <ErreurChargement message={e instanceof Error ? e.message : "erreur inconnue"} />;
  }
  // Facture supprimée (brouillon) ou inexistante : message dans la page plutôt qu'une 404 brute
  // (c'est aussi ce qui s'affiche un instant après la suppression d'un brouillon).
  if (!complete) return <FactureIntrouvable />;
  const { facture, lignes, client, entite } = complete;
  const brouillon = facture.statut === "brouillon";

  const [resVue, resEnvois, resPrestations] = await Promise.all([
    supabase.from("factures_vue").select("en_retard").eq("id", id).maybeSingle(),
    supabase.from("envois_email").select("*").eq("facture_id", id).order("created_at", { ascending: false }),
    brouillon
      ? supabase
          .from("prestations")
          .select("id, libelle, description, prix_unitaire_centimes, unite")
          .eq("entite_id", facture.entite_id)
          .eq("actif", true)
          .order("ordre")
          .order("libelle")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const erreur = resVue.error ?? resEnvois.error ?? resPrestations.error;
  if (erreur) return <ErreurChargement message={erreur.message} />;

  const enRetard = Boolean((resVue.data as Pick<FactureVue, "en_retard"> | null)?.en_retard);
  const envois = resEnvois.data as EnvoiEmail[];
  const catalogue = resPrestations.data as PrestationFormulaire[];

  const nom = nomClient(client);
  const destinataires = destinatairesFacture(client);
  const aujourdhui = aujourdhuiParis();
  const totaux: Totaux = {
    ht: facture.total_ht_centimes,
    tva: facture.total_tva_centimes,
    ttc: facture.total_ttc_centimes,
    taux: Number(facture.taux_tva),
    mentionTva: entite.mention_tva,
  };
  const urlPdf = `/api/factures/${facture.id}/pdf`;
  const adresse = [
    client.adresse_ligne1,
    client.adresse_ligne2,
    [client.code_postal, client.ville].filter(Boolean).join(" "),
    client.pays && client.pays !== "France" ? client.pays : null,
  ].filter((l): l is string => Boolean(l && l.trim()));

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <Link href="/factures" className="btn-lien">
          <IconeRetour className="size-4" />
          Factures
        </Link>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={`titre-page ${brouillon ? "text-muted italic" : ""}`}>{libelleNumero(facture.numero)}</h1>
              <StatutBadge statut={facture.statut} enRetard={enRetard} />
              <EntiteBadge nom={entite.nom} couleur={entite.couleur_primaire} />
            </div>
            <p className="mt-1 text-sm text-muted">
              <Link href={`/clients/${facture.client_id}`} className="font-medium text-ink hover:text-brand">
                {nom}
              </Link>
              {facture.objet ? ` · ${facture.objet}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
            <p
              className={`font-display text-3xl font-medium tabular-nums ${
                facture.statut === "annulee" ? "text-muted line-through" : "text-ink"
              }`}
            >
              {formatEuros(facture.total_ttc_centimes)}
              <span className="ml-1 text-sm font-normal text-muted">TTC</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={urlPdf} target="_blank" rel="noopener" className="btn-secondaire btn-petit">
                <IconeExterne className="size-3.5" />
                Aperçu PDF
              </a>
              <a href={`${urlPdf}?telecharger=1`} className="btn-secondaire btn-petit" download>
                <IconeTelecharger className="size-3.5" />
                Télécharger
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Bandeaux d'état */}
      {brouillon && (
        <p className="rounded-lg border border-brand/20 bg-brand-light px-3 py-2 text-sm text-brand-dark">
          <strong>Brouillon</strong> : pas encore de numéro. Relisez les lignes et les informations, puis émettez la facture.
          {facture.generation_auto && " Brouillon préparé par la facturation mensuelle."}
        </p>
      )}
      {enRetard && (
        <p className="erreur flex items-start gap-2">
          <IconeHorloge className="mt-0.5 size-4" />
          <span>
            Échéance dépassée depuis le {formatDateLongue(facture.date_echeance)} : pensez à relancer le client, puis
            enregistrez le paiement à réception.
          </span>
        </p>
      )}
      {facture.statut === "payee" && (
        <p className="succes flex items-start gap-2">
          <IconeValide className="mt-0.5 size-4 text-emerald-600" />
          <span>
            Payée le {formatDateLongue(facture.payee_le)}
            {facture.mode_paiement ? ` par ${facture.mode_paiement.toLowerCase()}` : ""}
            {facture.reference_paiement ? ` (réf. ${facture.reference_paiement})` : ""}.
          </span>
        </p>
      )}
      {facture.statut === "annulee" && (
        <p className="flex items-start gap-2 rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
          <IconeAnnuler className="mt-0.5 size-4" />
          <span>
            Facture annulée le {formatDateHeure(facture.annulee_le)}
            {facture.motif_annulation ? ` — motif : ${facture.motif_annulation}` : ""}. Elle reste dans la numérotation
            et ne peut plus être modifiée ni envoyée.
          </span>
        </p>
      )}
      {facture.statut !== "annulee" && destinataires.length === 0 && (
        <p className="avertissement flex items-start gap-2">
          <IconeAlerte className="mt-0.5 size-4 text-amber-600" />
          <span>
            {brouillon ? "Ce client n'a pas d'adresse e-mail" : "Aucune adresse e-mail n'était renseignée à l'émission"} :
            la facture ne peut pas être envoyée par e-mail.{" "}
            <Link href={`/clients/${facture.client_id}`} className="font-medium underline">
              Voir la fiche client
            </Link>
          </span>
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <ActionsFacture
            factureId={facture.id}
            statut={facture.statut}
            numero={facture.numero}
            totalTtc={facture.total_ttc_centimes}
            nbLignes={lignes.length}
            destinataires={destinataires}
            emailConfigure={emailConfigure()}
            envoyeeLe={facture.envoyee_le}
            aujourdhui={aujourdhui}
            nomClient={nom}
            clientId={facture.client_id}
            prefixe={entite.prefixe_facture}
          />

          <section className="carte overflow-hidden" aria-labelledby="titre-lignes">
            <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-4">
              <h2 id="titre-lignes" className="titre-section">
                Lignes
              </h2>
              <span className="text-xs text-muted">
                {brouillon ? "Modifiables tant que la facture est un brouillon" : "Figées depuis l'émission"}
              </span>
            </div>
            {brouillon ? (
              <EditeurLignes
                factureId={facture.id}
                lignes={lignes}
                catalogue={catalogue}
                totaux={totaux}
                nomEntite={entite.nom}
              />
            ) : (
              <LignesLectureSeule lignes={lignes} totaux={totaux} />
            )}
          </section>

          <section className="carte carte-corps" aria-labelledby="titre-infos">
            <h2 id="titre-infos" className="titre-section mb-4">
              Informations
            </h2>
            {brouillon ? (
              <InfosBrouillon
                factureId={facture.id}
                objet={facture.objet}
                periode={facture.periode}
                notes={facture.notes}
              />
            ) : (
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Info libelle="Objet">{facture.objet ?? "—"}</Info>
                <Info libelle="Mois facturé">{formatPeriode(facture.periode)}</Info>
                <Info libelle="Émise le">{formatDateLongue(facture.date_emission)}</Info>
                <Info libelle="Échéance">
                  <span className={enRetard ? "font-medium text-red-700" : ""}>
                    {formatDateLongue(facture.date_echeance)}
                  </span>
                </Info>
                <div className="sm:col-span-2">
                  <Info libelle="Notes imprimées">
                    <span className="whitespace-pre-line">{facture.notes ?? "—"}</span>
                  </Info>
                </div>
              </dl>
            )}
          </section>

          <ApercuPdf factureId={facture.id} version={facture.updated_at} brouillon={brouillon} />
        </div>

        <aside className="min-w-0 space-y-6">
          {/* Client */}
          <section className="carte carte-corps" aria-labelledby="titre-client">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 id="titre-client" className="titre-section">
                Client
              </h2>
              <Link href={`/clients/${facture.client_id}`} className="btn-lien text-xs">
                Fiche client
              </Link>
            </div>
            <div className="space-y-2 text-sm">
              <p className="font-medium text-ink">{nom}</p>
              {client.type === "professionnel" && (client.prenom || client.nom) && (
                <p className="text-muted">
                  Contact : {[client.civilite, client.prenom, client.nom].filter(Boolean).join(" ")}
                </p>
              )}
              {client.cavaliers && <p className="text-muted">Cavalier(s) : {client.cavaliers}</p>}
              {adresse.length > 0 && (
                <address className="text-muted not-italic">
                  {adresse.map((l, i) => (
                    <span key={i} className="block">
                      {l}
                    </span>
                  ))}
                </address>
              )}
              {destinataires.length > 0 ? (
                <ul className="space-y-0.5">
                  {destinataires.map((d, i) => (
                    <li key={d} className="truncate">
                      <a href={`mailto:${d}`} className="text-brand hover:underline">
                        {d}
                      </a>
                      {i > 0 && <span className="text-xs text-muted"> (copie)</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-1 text-xs font-medium text-amber-700">
                  <IconeAlerte className="size-3.5" />
                  Aucune adresse e-mail
                </p>
              )}
              {client.telephone && <p className="text-muted">{client.telephone}</p>}
              {!brouillon && (
                <p className="aide">Coordonnées figées à l&apos;émission, telles qu&apos;imprimées sur la facture.</p>
              )}
            </div>
          </section>

          {/* Historique */}
          <section className="carte carte-corps" aria-labelledby="titre-historique">
            <h2 id="titre-historique" className="titre-section mb-3">
              Historique
            </h2>
            <ol className="space-y-2.5 border-l border-line pl-4 text-sm">
              <Etape date={formatDateHeure(facture.created_at)}>
                Brouillon créé{facture.generation_auto ? " (facturation mensuelle)" : ""}
              </Etape>
              {facture.date_emission && (
                <Etape date={formatDate(facture.date_emission)}>
                  Émise sous le n° <strong>{facture.numero}</strong>
                </Etape>
              )}
              {facture.date_echeance && (
                <Etape date={formatDate(facture.date_echeance)} ton={enRetard ? "alerte" : "neutre"}>
                  Échéance de paiement{enRetard ? " dépassée" : ""}
                </Etape>
              )}
              {facture.envoyee_le && <Etape date={formatDateHeure(facture.envoyee_le)}>Envoyée par e-mail</Etape>}
              {facture.payee_le && (
                <Etape date={formatDate(facture.payee_le)} ton="succes">
                  Payée{facture.mode_paiement ? ` · ${facture.mode_paiement}` : ""}
                  {facture.reference_paiement ? ` · réf. ${facture.reference_paiement}` : ""}
                </Etape>
              )}
              {facture.annulee_le && (
                <Etape date={formatDateHeure(facture.annulee_le)} ton="alerte">
                  Annulée{facture.motif_annulation ? ` : ${facture.motif_annulation}` : ""}
                </Etape>
              )}
            </ol>

            <h3 className="mt-5 mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Envois par e-mail</h3>
            {envois.length === 0 ? (
              <p className="text-sm text-muted">Aucun envoi pour l&apos;instant.</p>
            ) : (
              <ul className="space-y-2">
                {envois.map((e) => (
                  <li
                    key={e.id}
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      e.succes ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-medium ${e.succes ? "text-emerald-800" : "text-red-800"}`}>
                        {e.succes ? "Envoyé" : "Échec"}
                      </span>
                      <span className="text-muted tabular-nums">{formatDateHeure(e.created_at)}</span>
                    </div>
                    <p className="mt-1 break-all text-ink">{e.destinataires.join(", ")}</p>
                    {!e.succes && e.erreur && <p className="mt-1 text-red-700">{e.erreur}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Notes internes */}
          <section className="carte carte-corps" aria-labelledby="titre-notes-internes">
            <h2 id="titre-notes-internes" className="titre-section">
              Notes internes
            </h2>
            <p className="aide mb-3">Visibles uniquement dans l&apos;application.</p>
            <NotesInternes factureId={facture.id} notes={facture.notes_internes} />
          </section>
        </aside>
      </div>
    </div>
  );
}

function Info({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{libelle}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

function Etape({
  date,
  ton = "neutre",
  children,
}: {
  date: string;
  ton?: "neutre" | "succes" | "alerte";
  children: React.ReactNode;
}) {
  const puce = ton === "succes" ? "bg-emerald-500" : ton === "alerte" ? "bg-red-500" : "bg-brand";
  return (
    <li className="relative">
      <span className={`absolute top-1.5 -left-[21px] size-2 rounded-full ring-2 ring-surface ${puce}`} aria-hidden="true" />
      <p className="text-ink">{children}</p>
      <p className="text-xs text-muted tabular-nums">{date}</p>
    </li>
  );
}

function FactureIntrouvable() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="carte carte-corps text-center sm:p-8">
        <h1 className="titre-section">Facture introuvable</h1>
        <p className="mt-2 text-sm text-muted">
          Cette facture n&apos;existe pas ou n&apos;existe plus (un brouillon supprimé, par exemple).
        </p>
        <Link href="/factures" className="btn-primaire mt-5">
          Retour aux factures
        </Link>
      </div>
    </div>
  );
}

function ErreurChargement({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <Link href="/factures" className="btn-lien">
        <IconeRetour className="size-4" />
        Factures
      </Link>
      <p role="alert" className="erreur">
        Impossible de charger la facture : {message}
      </p>
    </div>
  );
}
