import "server-only";
import type { AcademieMenu } from "@/components/coquille/donnees";
import { chargerParametres, genererBrouillonsMensuels, periodeAFacturer } from "@/lib/facturation/service";
import { aujourdhuiParis, premierDuMois } from "@/lib/format";
import type { ClientSupabase } from "@/lib/supabase/server";
import type { Client, Facture, FactureVue } from "@/lib/types";
import { datesGeneration } from "./outils";

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
  /** Factures émises ou envoyées (retards compris). */
  aEncaisser: Cumul;
  enRetard: Cumul;
  /** Factures payées dont la date de paiement tombe dans le mois courant (Paris). */
  encaisseMois: Cumul;
  brouillons: number;
  clientsActifs: number;
}

/** Calendrier de la facturation mensuelle (réglages de `parametres`). */
export interface EtatFacturationMensuelle {
  jourGeneration: number;
  generationAuto: boolean;
  envoiAuto: boolean;
  /** Prochaine date de génération (strictement après aujourd'hui), "AAAA-MM-JJ". */
  prochaineDate: string;
  /** Mois facturé à cette date, "AAAA-MM-01". */
  prochainePeriode: string;
  /** Mois facturé à la dernière date de génération (aujourd'hui compris) : la facturation en cours. */
  periodeEnCours: string;
  /**
   * Aperçu de la facturation en cours (dans le périmètre affiché) : clients ayant des tarifs
   * mensuels pour ce mois, et combien ont déjà leur facture. null si l'aperçu a échoué.
   */
  apercu: { aFacturer: number; dejaFactures: number } | null;
}

export interface DonneesTableauDeBord {
  aujourdhui: string;
  /** Premier jour du mois courant, "AAAA-MM-01". */
  moisCourant: string;
  indicateurs: Indicateurs;
  /** Même calcul par académie active (affiché quand « Toutes » est sélectionné). */
  parAcademie: { academie: AcademieMenu; indicateurs: Indicateurs }[];
  /** Les 10 factures en retard dont l'échéance est la plus ancienne. */
  retards: FactureResumee[];
  /** Les 10 factures créées le plus récemment (brouillons compris). */
  dernieres: FactureResumee[];
  facturation: EtatFacturationMensuelle;
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

/** Aperçu (sans rien créer) de la facturation d'un mois. null en cas d'échec : l'encart reste affiché sans. */
async function apercuFacturation(
  supabase: ClientSupabase,
  periode: string,
  academieId: string | null,
): Promise<EtatFacturationMensuelle["apercu"]> {
  try {
    const resultat = await genererBrouillonsMensuels(supabase, periode, { academieId, apercu: true });
    return { aFacturer: resultat.length, dejaFactures: resultat.filter((r) => r.deja_existante).length };
  } catch (e) {
    console.error("Tableau de bord (aperçu de la facturation) :", e instanceof Error ? e.message : e);
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

  // Réglages de l'association, puis aperçu de la facturation en cours (qui en dépend).
  const calendrier = chargerParametres(supabase).then(async (parametres) => {
    const { derniere, prochaine } = datesGeneration(parametres.jour_generation, aujourdhui);
    const periodeEnCours = periodeAFacturer(parametres, derniere);
    const apercu = await apercuFacturation(supabase, periodeEnCours, academieId);
    return { parametres, prochaine, periodeEnCours, apercu };
  });

  const [
    { parametres, prochaine, periodeEnCours, apercu },
    ouvertes,
    payees,
    brouillons,
    clientsActifs,
    dernieres,
    nbPrestations,
    nbClients,
    nbTarifs,
    nbFactures,
  ] = await Promise.all([
    calendrier,
    depuis("factures_vue", COLONNES_RESUME)
      .in("statut", ["emise", "envoyee"])
      .order("date_echeance", { ascending: true })
      .order("numero", { ascending: true }),
    depuis("factures_vue", "academie_id, total_ttc_centimes")
      .eq("statut", "payee")
      .gte("payee_le", moisCourant)
      .lt("payee_le", moisSuivant),
    depuis("factures_vue", "academie_id").eq("statut", "brouillon"),
    depuis("clients", "academie_id").eq("actif", true),
    depuis("factures_vue", COLONNES_RESUME).order("created_at", { ascending: false }).limit(10),
    // Catalogue commun aux deux académies : jamais filtré.
    supabase.from("prestations").select("id", { count: "exact", head: true }),
    depuis("clients", "id", { count: "exact", head: true }),
    requeteTarifs,
    depuis("factures", "id", { count: "exact", head: true }),
  ]);

  const facturesOuvertes = lignes<FactureResumee>(ouvertes, "factures à encaisser");
  const facturesPayees = lignes<Pick<Facture, "academie_id" | "total_ttc_centimes">>(payees, "encaissements");
  const facturesBrouillons = lignes<Pick<Facture, "academie_id">>(brouillons, "brouillons");
  const clients = lignes<Pick<Client, "academie_id">>(clientsActifs, "clients actifs");

  const calculer = (garder: (academie: string) => boolean): Indicateurs => {
    const ouvertesRetenues = facturesOuvertes.filter((f) => garder(f.academie_id));
    return {
      aEncaisser: cumuler(ouvertesRetenues.map((f) => f.total_ttc_centimes)),
      enRetard: cumuler(ouvertesRetenues.filter((f) => f.en_retard).map((f) => f.total_ttc_centimes)),
      encaisseMois: cumuler(facturesPayees.filter((f) => garder(f.academie_id)).map((f) => f.total_ttc_centimes)),
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
    // Les factures ouvertes sont déjà triées par échéance croissante.
    retards: facturesOuvertes.filter((f) => f.en_retard).slice(0, 10),
    dernieres: lignes<FactureResumee>(dernieres, "dernières factures"),
    facturation: {
      jourGeneration: parametres.jour_generation,
      generationAuto: parametres.generation_auto,
      envoiAuto: parametres.envoi_auto,
      prochaineDate: prochaine,
      prochainePeriode: periodeAFacturer(parametres, prochaine),
      periodeEnCours,
      apercu,
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
