import "server-only";
import type { AcademieMenu } from "@/components/coquille/donnees";
import { chargerParametres, genererFacturesAnnuelles, periodeAFacturer } from "@/lib/facturation/service";
import { aujourdhuiParis, datesGeneration, premierDuMois } from "@/lib/format";
import type { ClientSupabase } from "@/lib/supabase/server";
import { saisonEnCours } from "@/lib/tarifs";
import type { Client, EcheanceVue, Facture, FactureVue } from "@/lib/types";

/** Colonnes de factures_vue utiles aux tableaux du tableau de bord. */
export type FactureResumee = Pick<
  FactureVue,
  | "id"
  | "numero"
  | "statut"
  | "en_retard"
  | "academie_id"
  | "academie_nom"
  | "academie_couleur"
  | "client_type"
  | "client_nom"
  | "client_prenom"
  | "client_raison_sociale"
  | "objet"
  | "date_emission"
  | "date_echeance"
  | "total_ttc_centimes"
  | "created_at"
>;

const COLONNES_RESUME =
  "id, numero, statut, en_retard, academie_id, academie_nom, academie_couleur, client_type, client_nom, client_prenom, " +
  "client_raison_sociale, objet, date_emission, date_echeance, total_ttc_centimes, created_at";

export interface Cumul {
  nombre: number;
  centimes: number;
}

export interface Indicateurs {
  /**
   * Avis d'échéance exigibles non payés (avis envoyé, ou mois de l'échéance commencé) et
   * factures ponctuelles émises ou envoyées (retards compris). Les factures annuelles ne comptent
   * pas elles-mêmes : leurs échéances les représentent.
   */
  aEncaisser: Cumul;
  /** Dont avis d'échéance. */
  aEncaisserAvis: Cumul;
  /** Échéances échues non payées et factures ponctuelles échues. */
  enRetard: Cumul;
  /** Échéances payées et factures ponctuelles payées dont la date de paiement tombe dans le mois courant (Paris). */
  encaisseMois: Cumul;
  brouillons: number;
  clientsActifs: number;
}

/** Échéance résumée (tableau des retards). */
export type EcheanceResumee = Pick<
  EcheanceVue,
  | "id"
  | "facture_id"
  | "client_id"
  | "numero_avis"
  | "periode"
  | "date_echeance"
  | "montant_centimes"
  | "statut"
  | "en_retard"
  | "academie_id"
  | "academie_nom"
  | "academie_couleur"
  | "client_type"
  | "client_nom"
  | "client_prenom"
  | "client_raison_sociale"
  | "client_reference"
>;

const COLONNES_ECHEANCE_RESUME =
  "id, facture_id, client_id, numero_avis, periode, date_echeance, montant_centimes, statut, en_retard, academie_id, " +
  "academie_nom, academie_couleur, client_type, client_nom, client_prenom, client_raison_sociale, client_reference";

/** Calendrier de l'année scolaire (réglages de `parametres`) et avancement des factures annuelles. */
export interface EtatAnnee {
  jourGeneration: number;
  /** Clients actifs en envoi automatique (toutes académies) : leur avis part le jour d'envoi. */
  nbClientsEnvoiAuto: number;
  /** Prochaine date d'envoi des avis (strictement après aujourd'hui), "AAAA-MM-JJ". */
  prochaineDate: string;
  /** Mois des avis envoyés à cette date, "AAAA-MM-01" (juillet/août : aucun avis). */
  prochainePeriode: string;
  /** Saison en cours (2026 = 2026-2027). */
  saison: number;
  /**
   * Factures annuelles de la saison dans le périmètre affiché : élèves à facturer (tarifs
   * récurrents), factures préparées (brouillons compris) et émises. null si l'aperçu a échoué.
   */
  avancement: { aFacturer: number; preparees: number; emises: number } | null;
}

export interface DonneesTableauDeBord {
  aujourdhui: string;
  /** Premier jour du mois courant, "AAAA-MM-01". */
  moisCourant: string;
  indicateurs: Indicateurs;
  /** Même calcul par académie active (affiché quand « Toutes » est sélectionné). */
  parAcademie: { academie: AcademieMenu; indicateurs: Indicateurs }[];
  /** Les 10 factures ponctuelles en retard dont l'échéance est la plus ancienne. */
  retards: FactureResumee[];
  /** Les 10 avis d'échéance en retard dont la date limite est la plus ancienne. */
  retardsAvis: EcheanceResumee[];
  /** Les 10 factures créées le plus récemment (brouillons compris). */
  dernieres: FactureResumee[];
  annee: EtatAnnee;
  /** L'IBAN de l'association n'est pas renseigné (il est imprimé sur les factures). */
  ibanManquant: boolean;
  /** Compteurs pour l'accompagnement du premier démarrage (catalogue commun, le reste filtré). */
  premiersPas: { prestations: number; clients: number; tarifs: number; factures: number };
}

type Reponse<T> = { data: T | null; error: { message: string } | null };
type ReponseCompte = { count: number | null; error: { message: string } | null };

function lignes<T>(reponse: Reponse<unknown>, contexte: string): T[] {
  if (reponse.error) throw new Error(`Tableau de bord (${contexte}) : ${reponse.error.message}`);
  return (reponse.data ?? []) as T[];
}

function compte(reponse: ReponseCompte, contexte: string): number {
  if (reponse.error) throw new Error(`Tableau de bord (${contexte}) : ${reponse.error.message}`);
  return reponse.count ?? 0;
}

function cumuler(montants: number[]): Cumul {
  return { nombre: montants.length, centimes: montants.reduce((total, m) => total + m, 0) };
}

function additionner(a: Cumul, b: Cumul): Cumul {
  return { nombre: a.nombre + b.nombre, centimes: a.centimes + b.centimes };
}

/** Avancement des factures annuelles d'une saison. null en cas d'échec : l'encart reste affiché sans. */
async function avancementAnnee(
  supabase: ClientSupabase,
  saison: number,
  academieId: string | null,
): Promise<EtatAnnee["avancement"]> {
  try {
    let requete = supabase
      .from("factures")
      .select("statut, academie_id")
      .eq("type_facture", "annuelle")
      .eq("saison", saison)
      .neq("statut", "annulee");
    if (academieId) requete = requete.eq("academie_id", academieId);
    const [apercu, factures] = await Promise.all([
      genererFacturesAnnuelles(supabase, saison, { academieId, apercu: true }),
      requete,
    ]);
    if (factures.error) throw new Error(factures.error.message);
    const liste = (factures.data ?? []) as Pick<Facture, "statut">[];
    return {
      aFacturer: new Set([...apercu.map((r) => r.client_id)]).size,
      preparees: liste.length,
      emises: liste.filter((f) => f.statut !== "brouillon").length,
    };
  } catch (e) {
    console.error("Tableau de bord (avancement de l'année) :", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Charge les indicateurs et les listes du tableau de bord, filtrés sur `academieId`
 * (null = toutes les académies ; le catalogue de prestations est commun). Lève une
 * Error si une requête échoue.
 */
export async function chargerTableauDeBord(
  supabase: ClientSupabase,
  academieId: string | null,
  academies: AcademieMenu[],
): Promise<DonneesTableauDeBord> {
  const aujourdhui = aujourdhuiParis();
  const moisCourant = premierDuMois(aujourdhui);
  const moisSuivant = premierDuMois(aujourdhui, 1);

  /** Requête sur une table ou vue ayant une colonne `academie_id`, restreinte à l'académie sélectionnée. */
  const depuis = (table: "factures_vue" | "factures" | "clients", colonnes: string, options?: { count: "exact"; head: true }) => {
    const requete = supabase.from(table).select(colonnes, options);
    return academieId ? requete.eq("academie_id", academieId) : requete;
  };

  // Tarifs actifs du périmètre : l'académie est portée par le client.
  const requeteTarifs = academieId
    ? supabase
        .from("tarifs_clients")
        .select("id, clients!inner(academie_id)", { count: "exact", head: true })
        .eq("actif", true)
        .eq("clients.academie_id", academieId)
    : supabase.from("tarifs_clients").select("id", { count: "exact", head: true }).eq("actif", true);

  // Réglages de l'association, puis avancement de l'année (qui en dépend).
  const saison = saisonEnCours(aujourdhui);
  const calendrier = chargerParametres(supabase).then(async (parametres) => {
    const { prochaine } = datesGeneration(parametres.jour_generation, aujourdhui);
    const avancement = await avancementAnnee(supabase, saison, academieId);
    return { parametres, prochaine, avancement };
  });

  /** Échéances (vue echeances_vue, académie figée sur la facture annuelle) du périmètre. */
  const echeances = (colonnes: string) => {
    const requete = supabase.from("echeances_vue").select(colonnes);
    return academieId ? requete.eq("academie_id", academieId) : requete;
  };

  const [
    { parametres, prochaine, avancement },
    ouvertes,
    payees,
    avisOuverts,
    avisPayes,
    brouillons,
    clientsActifs,
    dernieres,
    nbPrestations,
    nbClients,
    nbTarifs,
    nbFactures,
    nbEnvoiAuto,
  ] = await Promise.all([
    calendrier,
    depuis("factures_vue", COLONNES_RESUME)
      .eq("type_facture", "ponctuelle")
      .in("statut", ["emise", "envoyee"])
      .order("date_echeance", { ascending: true })
      .order("numero", { ascending: true }),
    depuis("factures_vue", "academie_id, total_ttc_centimes")
      .eq("type_facture", "ponctuelle")
      .eq("statut", "payee")
      .gte("payee_le", moisCourant)
      .lt("payee_le", moisSuivant),
    echeances(COLONNES_ECHEANCE_RESUME)
      .in("statut", ["a_venir", "envoyee"])
      .order("date_echeance", { ascending: true })
      .order("numero_avis", { ascending: true }),
    echeances("academie_id, montant_centimes").eq("statut", "payee").gte("payee_le", moisCourant).lt("payee_le", moisSuivant),
    depuis("factures_vue", "academie_id").eq("statut", "brouillon"),
    depuis("clients", "academie_id").eq("actif", true),
    depuis("factures_vue", COLONNES_RESUME).order("created_at", { ascending: false }).limit(10),
    // Catalogue commun aux deux académies : jamais filtré.
    supabase.from("prestations").select("id", { count: "exact", head: true }),
    depuis("clients", "id", { count: "exact", head: true }),
    requeteTarifs,
    depuis("factures", "id", { count: "exact", head: true }),
    supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("actif", true)
      .eq("envoi_auto", true),
  ]);

  const facturesOuvertes = lignes<FactureResumee>(ouvertes, "factures à encaisser");
  const facturesPayees = lignes<Pick<Facture, "academie_id" | "total_ttc_centimes">>(payees, "encaissements");
  // Avis exigibles : envoyés, ou dont le mois est commencé.
  const echeancesOuvertes = lignes<EcheanceResumee>(avisOuverts, "avis à encaisser").filter(
    (e) => e.statut === "envoyee" || e.periode <= moisCourant,
  );
  const echeancesPayees = lignes<Pick<EcheanceVue, "academie_id" | "montant_centimes">>(avisPayes, "avis encaissés");
  const facturesBrouillons = lignes<Pick<Facture, "academie_id">>(brouillons, "brouillons");
  const clients = lignes<Pick<Client, "academie_id">>(clientsActifs, "clients actifs");

  const calculer = (garder: (academie: string) => boolean): Indicateurs => {
    const ouvertesRetenues = facturesOuvertes.filter((f) => garder(f.academie_id));
    const avisRetenus = echeancesOuvertes.filter((e) => garder(e.academie_id));
    const aEncaisserAvis = cumuler(avisRetenus.map((e) => e.montant_centimes));
    const aEncaisserFactures = cumuler(ouvertesRetenues.map((f) => f.total_ttc_centimes));
    const retardAvis = cumuler(avisRetenus.filter((e) => e.en_retard).map((e) => e.montant_centimes));
    const retardFactures = cumuler(ouvertesRetenues.filter((f) => f.en_retard).map((f) => f.total_ttc_centimes));
    const payeFactures = cumuler(facturesPayees.filter((f) => garder(f.academie_id)).map((f) => f.total_ttc_centimes));
    const payeAvis = cumuler(echeancesPayees.filter((e) => garder(e.academie_id)).map((e) => e.montant_centimes));
    return {
      aEncaisser: additionner(aEncaisserAvis, aEncaisserFactures),
      aEncaisserAvis,
      enRetard: additionner(retardAvis, retardFactures),
      encaisseMois: additionner(payeFactures, payeAvis),
      brouillons: facturesBrouillons.filter((f) => garder(f.academie_id)).length,
      clientsActifs: clients.filter((c) => garder(c.academie_id)).length,
    };
  };

  return {
    aujourdhui,
    moisCourant,
    indicateurs: calculer(() => true),
    parAcademie: academieId
      ? []
      : academies.map((academie) => ({ academie, indicateurs: calculer((id) => id === academie.id) })),
    // Factures et avis ouverts déjà triés par échéance croissante.
    retards: facturesOuvertes.filter((f) => f.en_retard).slice(0, 10),
    retardsAvis: echeancesOuvertes.filter((e) => e.en_retard).slice(0, 10),
    dernieres: lignes<FactureResumee>(dernieres, "dernières factures"),
    annee: {
      jourGeneration: parametres.jour_generation,
      nbClientsEnvoiAuto: compte(nbEnvoiAuto, "clients en envoi automatique"),
      prochaineDate: prochaine,
      prochainePeriode: periodeAFacturer(parametres, prochaine),
      saison,
      avancement,
    },
    ibanManquant: !parametres.iban?.trim(),
    premiersPas: {
      prestations: compte(nbPrestations, "prestations"),
      clients: compte(nbClients, "clients"),
      tarifs: compte(nbTarifs, "tarifs"),
      factures: compte(nbFactures, "factures"),
    },
  };
}
