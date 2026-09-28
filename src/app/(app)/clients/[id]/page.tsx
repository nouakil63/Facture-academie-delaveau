import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AcademieBadge } from "@/components/AcademieBadge";
import { ActionsClient } from "@/components/clients/ActionsClient";
import { AnneeClient, type FactureAnnuelleClient } from "@/components/clients/AnneeClient";
import { ReferenceBadge } from "@/components/annee/StatutEcheanceBadge";
import { COLONNES_ECHEANCE, type EcheanceLigne } from "@/components/annee/TableauEcheances";
import { FacturesClient, type FactureDuClient } from "@/components/clients/FacturesClient";
import { FormulaireClient } from "@/components/clients/FormulaireClient";
import { IconeAlerte, IconeInfo, IconeRetour } from "@/components/Icones";
import { TarifsClient } from "@/components/clients/TarifsClient";
import { exigerUtilisateur } from "@/lib/auth";
import { emailConfigure } from "@/lib/email";
import { chargerAcademies, chargerParametres } from "@/lib/facturation/service";
import { aujourdhuiParis, destinatairesFacture, formatEuros, jourDuMois, nomClient, premierDuMois } from "@/lib/format";
import {
  annuelEstime,
  echeancierAnnuel,
  libelleSaison,
  saisonEnCours,
  type PrestationDuTarif,
  type TarifAvecPrestation,
} from "@/lib/tarifs";
import type { Academie, Client, EcheanceVue } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAMPS_PRESTATION = "id, libelle, description, prix_unitaire_centimes, unite, recurrente, actif";

/** Titre de l'onglet : nom du client. */
export async function generateMetadata(props: PageProps<"/clients/[id]">): Promise<Metadata> {
  const { supabase } = await exigerUtilisateur();
  const { id } = await props.params;
  if (!UUID.test(id)) return { title: "Client introuvable" };
  const { data } = await supabase.from("clients").select("type, nom, prenom, raison_sociale").eq("id", id).maybeSingle();
  return { title: data ? nomClient(data as Pick<Client, "type" | "nom" | "prenom" | "raison_sociale">) : "Fiche client" };
}

export default async function PageClient(props: PageProps<"/clients/[id]">) {
  const { supabase } = await exigerUtilisateur();
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const resClient = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  if (resClient.error) return <ErreurChargement message={resClient.error.message} />;
  if (!resClient.data) notFound();
  const client = resClient.data as Client;

  const aujourdhui = aujourdhuiParis();
  const saison = saisonEnCours(aujourdhui);
  const [resAcademies, resParametres, resTarifs, resPrestations, resFactures, resEcheances] = await Promise.all([
    chargerAcademies(supabase).then(
      (data) => ({ data, error: null }),
      (e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }),
    ),
    chargerParametres(supabase).then(
      (data) => ({ data, error: null }),
      (e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }),
    ),
    supabase
      .from("tarifs_clients")
      .select(`*, prestation:prestations(${CHAMPS_PRESTATION})`)
      .eq("client_id", id)
      .order("ordre")
      .order("created_at"),
    // Catalogue commun aux deux académies : toutes les prestations actives.
    supabase
      .from("prestations")
      .select(CHAMPS_PRESTATION)
      .eq("actif", true)
      .order("ordre")
      .order("libelle"),
    supabase
      .from("factures_vue")
      .select(
        "id, numero, statut, objet, periode, date_emission, date_echeance, total_ttc_centimes, en_retard, created_at, academie_id, academie_nom, academie_couleur, type_facture, saison, generation_auto, echeances_actives, echeances_payees, echeances_reste_centimes",
      )
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
    // Échéances de la saison (factures annuelles du client).
    supabase.from("echeances_vue").select(COLONNES_ECHEANCE).eq("client_id", id).eq("saison", saison).order("rang"),
  ]);
  const erreur =
    resAcademies.error ??
    resParametres.error ??
    resTarifs.error ??
    resPrestations.error ??
    resFactures.error ??
    resEcheances.error;
  if (erreur || !resParametres.data) return <ErreurChargement message={erreur?.message ?? "paramètres absents"} />;

  const academies = resAcademies.data as Academie[];
  const jourGeneration = resParametres.data.jour_generation;
  const tarifs = (resTarifs.data as TarifAvecPrestation[]).map((t) => ({ ...t, quantite: Number(t.quantite) }));
  const prestations = resPrestations.data as PrestationDuTarif[];
  const factures = resFactures.data as (FactureDuClient &
    Pick<FactureAnnuelleClient, "echeances_actives" | "echeances_payees" | "echeances_reste_centimes"> & {
      type_facture: "annuelle" | "ponctuelle";
      saison: number | null;
      generation_auto: boolean;
    })[];

  const academie = academies.find((a) => a.id === client.academie_id);
  const nom = nomClient(client);
  const periode = premierDuMois(aujourdhui);
  const annuel = annuelEstime(tarifs, saison);
  const echeancier = echeancierAnnuel(annuel, client, saison);
  const avecArrhes = client.arrhes_reglees && (client.arrhes_centimes ?? 0) > 0;

  // Année en cours : facture annuelle non annulée de la saison, ses échéances.
  const factureAnnuelle = factures.find((f) => f.type_facture === "annuelle" && f.saison === saison && f.statut !== "annulee") ?? null;
  const destinataires = destinatairesFacture(client);
  const echeances: EcheanceLigne[] = factureAnnuelle
    ? (resEcheances.data as unknown as EcheanceVue[])
        .filter((e) => e.facture_id === factureAnnuelle.id)
        .map((e) => ({ ...e, destinataires }))
    : [];
  const nbAnciensBrouillons = factures.filter(
    (f) =>
      f.statut === "brouillon" &&
      f.generation_auto &&
      f.type_facture === "ponctuelle" &&
      f.periode !== null &&
      f.periode >= `${saison}-09-01` &&
      f.periode <= `${saison + 1}-06-01`,
  ).length;

  // Reste à encaisser : factures ponctuelles émises/envoyées + échéances non réglées.
  const ponctuellesOuvertes = factures.filter(
    (f) => f.type_facture !== "annuelle" && (f.statut === "emise" || f.statut === "envoyee"),
  );
  const echeancesOuvertes = (resEcheances.data as unknown as EcheanceVue[]).filter(
    (e) => e.statut === "a_venir" || e.statut === "envoyee",
  );
  const aEncaisser =
    ponctuellesOuvertes.reduce((s, f) => s + f.total_ttc_centimes, 0) +
    echeancesOuvertes.reduce((s, e) => s + e.montant_centimes, 0);
  const nbEnRetard = ponctuellesOuvertes.filter((f) => f.en_retard).length + echeancesOuvertes.filter((e) => e.en_retard).length;
  // Académies proposées : les actives, plus l'actuelle du client si elle a été désactivée.
  const academiesProposees = academies.filter((a) => a.actif || a.id === client.academie_id);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link href="/clients" className="btn-lien text-muted hover:text-brand">
            <IconeRetour />
            Clients
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ReferenceBadge reference={client.reference} />
            <h1 className="titre-page break-words">{nom}</h1>
            {academie && <AcademieBadge nom={academie.nom} couleur={academie.couleur} />}
            {client.type === "professionnel" && <span className="badge bg-slate-100 text-slate-700">Professionnel</span>}
            {!client.actif && <span className="badge bg-zinc-200 text-zinc-600">Archivé</span>}
            {client.envoi_auto && (
              <span
                className="badge bg-brand-light text-brand-dark"
                title={`Avis d'échéance envoyé automatiquement le ${jourDuMois(jourGeneration)} de chaque mois, sans relecture`}
              >
                Envoi auto
              </span>
            )}
            {avecArrhes && (
              <span
                className="badge bg-emerald-100 text-emerald-800"
                title={`Arrhes réglées (saison ${client.arrhes_saison != null ? libelleSaison(client.arrhes_saison) : "non renseignée"}) : déduites de la facture annuelle`}
              >
                Arrhes
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">
            {client.cavaliers ? <>Cavalier(s) : {client.cavaliers}</> : "Aucun cavalier renseigné"}
            {client.type === "professionnel" && (client.prenom || client.nom) && (
              <> · Contact : {[client.civilite, client.prenom, client.nom].filter(Boolean).join(" ")}</>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          {client.actif ? (
            <Link href={`/factures/nouvelle?client=${client.id}`} className="btn-primaire">
              Nouvelle facture
            </Link>
          ) : (
            <button type="button" className="btn-primaire" disabled title="Réactiver le client pour le facturer">
              Nouvelle facture
            </button>
          )}
          <ActionsClient clientId={client.id} nom={nom} actif={client.actif} nbFactures={factures.length} />
        </div>
      </div>

      {!client.actif && (
        <p className="avertissement">
          Client archivé : plus de facture annuelle ni d&apos;avis automatique. Le réactiver pour reprendre la facturation.
        </p>
      )}
      {client.envoi_auto && client.actif && (
        <p className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
          <IconeInfo className="size-4 shrink-0 text-brand" />
          <span>
            Envoi automatique : avis d&apos;échéance du mois envoyé le{" "}
            <strong className="text-ink">{jourDuMois(jourGeneration)}</strong> de chaque mois (septembre à juin), sans
            relecture.{" "}
            <a href="#fiche" className="btn-lien text-sm">
              Modifier
            </a>
          </span>
        </p>
      )}
      {destinatairesFacture(client).length === 0 && (
        <p className="avertissement flex items-center gap-2">
          <IconeAlerte className="size-4 text-amber-600" />
          {client.envoi_auto && client.actif
            ? "Aucune adresse e-mail : l'envoi automatique échouera. "
            : "Aucune adresse e-mail : envoi des factures par e-mail impossible. "}
          <a href="#email" className="font-medium underline">
            Compléter
          </a>
        </p>
      )}

      <dl className="grid gap-3 sm:grid-cols-3">
        <Indicateur
          libelle={`Facture annuelle ${libelleSaison(saison)}`}
          valeur={factureAnnuelle ? formatEuros(factureAnnuelle.total_ttc_centimes) : client.actif ? formatEuros(annuel) : "—"}
        >
          {factureAnnuelle
            ? factureAnnuelle.echeances_actives > 0
              ? `${factureAnnuelle.echeances_payees}/${factureAnnuelle.echeances_actives} échéances payées`
              : factureAnnuelle.statut === "brouillon"
                ? "Brouillon à émettre"
                : "TTC"
            : !client.actif
              ? "Client archivé : non facturé"
              : echeancier.arrhes > 0 && echeancier.montants.length > 0
                ? `Estimée HT ; arrhes −${formatEuros(echeancier.arrhes)} : 10 × ${formatEuros(echeancier.montants[0])}`
                : "Estimée d'après les tarifs, hors taxes"}
        </Indicateur>
        <Indicateur libelle="Reste à encaisser" valeur={formatEuros(aEncaisser)} alerte={nbEnRetard > 0}>
          {nbEnRetard > 0
            ? `${nbEnRetard} facture${nbEnRetard > 1 ? "s" : ""} en retard`
            : "Échéances non réglées et factures ponctuelles en attente"}
        </Indicateur>
        <Indicateur libelle="Factures" valeur={String(factures.length)}>
          {factures.length === 0
            ? "Aucune facture"
            : `Dernière : ${factures[0].numero ?? "brouillon"}`}
        </Indicateur>
      </dl>

      <TarifsClient
        clientId={client.id}
        clientActif={client.actif}
        tarifs={tarifs}
        prestations={prestations}
        periode={periode}
        saison={saison}
        arrhes={{
          arrhes_reglees: client.arrhes_reglees,
          arrhes_centimes: client.arrhes_centimes,
          arrhes_saison: client.arrhes_saison,
        }}
      />

      <AnneeClient
        clientActif={client.actif}
        clientId={client.id}
        academieId={client.academie_id}
        saison={saison}
        facture={factureAnnuelle}
        echeances={echeances}
        annuelEstime={annuel}
        nbAnciensBrouillons={nbAnciensBrouillons}
        emailConfigure={emailConfigure()}
        aujourdhui={aujourdhui}
      />

      <FacturesClient
        clientId={client.id}
        academieId={client.academie_id}
        clientActif={client.actif}
        factures={factures}
      />

      <section className="carte" aria-labelledby="titre-fiche" id="fiche">
        <div className="border-b border-line px-5 py-4">
          <h2 id="titre-fiche" className="titre-section">
            Coordonnées
          </h2>
          <p className="text-sm text-muted">
            Elles figurent sur ses prochaines factures. Celles déjà émises gardent les coordonnées d&apos;origine.
          </p>
        </div>
        <div className="carte-corps sm:p-6">
          <FormulaireClient
            client={client}
            academies={academiesProposees}
            jourGeneration={jourGeneration}
            saisonParDefaut={saisonEnCours()}
          />
        </div>
      </section>
    </div>
  );
}

function Indicateur({
  libelle,
  valeur,
  alerte = false,
  children,
}: {
  libelle: string;
  valeur: string;
  alerte?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="carte px-5 py-4">
      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">{libelle}</dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${alerte ? "text-red-700" : "text-ink"}`}>{valeur}</dd>
      <dd className={`mt-0.5 text-xs ${alerte ? "font-medium text-red-700" : "text-muted"}`}>{children}</dd>
    </div>
  );
}

function ErreurChargement({ message }: { message: string }) {
  return (
    <div className="space-y-4">
      <Link href="/clients" className="btn-lien text-muted hover:text-brand">
        <IconeRetour />
        Clients
      </Link>
      <p role="alert" className="erreur">
        Impossible de charger la fiche client : {message}
      </p>
    </div>
  );
}
