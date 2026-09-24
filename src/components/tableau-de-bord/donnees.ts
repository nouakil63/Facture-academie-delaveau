import "server-only";
import type { EntiteMenu } from "@/components/coquille/donnees";
import { aujourdhuiParis, premierDuMois } from "@/lib/format";
import type { ClientSupabase } from "@/lib/supabase/server";
import type { Facture, FactureVue } from "@/lib/types";

/** Colonnes de factures_vue utiles aux tableaux du tableau de bord. */
export type FactureResumee = Pick<
  FactureVue,
  | "id"
  | "numero"
  | "statut"
  | "en_retard"
  | "entite_id"
  | "entite_nom"
  | "entite_couleur"
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
  "id, numero, statut, en_retard, entite_id, entite_nom, entite_couleur, client_type, client_nom, client_prenom, " +
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
}

export interface DonneesTableauDeBord {
  aujourdhui: string;
  /** Premier jour du mois courant, "AAAA-MM-01". */
  moisCourant: string;
  indicateurs: Indicateurs;
  /** Même calcul par entité active (utile quand « Toutes » est sélectionné). */
  parEntite: { entite: EntiteMenu; indicateurs: Indicateurs }[];
  /** Les 10 factures en retard dont l'échéance est la plus ancienne. */
  retards: FactureResumee[];
  /** Les 10 factures créées le plus récemment (brouillons compris). */
  dernieres: FactureResumee[];
  /** Compteurs pour l'accompagnement du premier démarrage. */
  premiersPas: { prestations: number; clients: number; factures: number };
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

/**
 * Charge les indicateurs et les listes du tableau de bord, filtrés sur `entiteId`
 * (null = toutes les entités). Lève une Error si une requête échoue.
 */
export async function chargerTableauDeBord(
  supabase: ClientSupabase,
  entiteId: string | null,
  entites: EntiteMenu[],
): Promise<DonneesTableauDeBord> {
  const aujourdhui = aujourdhuiParis();
  const moisCourant = premierDuMois(aujourdhui);
  const moisSuivant = premierDuMois(aujourdhui, 1);

  /** Requête sur `table`, restreinte à l'entité sélectionnée s'il y en a une. */
  const depuis = (table: string, colonnes: string, options?: { count: "exact"; head: true }) => {
    const requete = supabase.from(table).select(colonnes, options);
    return entiteId ? requete.eq("entite_id", entiteId) : requete;
  };

  const [ouvertes, payees, brouillons, dernieres, nbPrestations, nbClients, nbFactures] = await Promise.all([
    depuis("factures_vue", COLONNES_RESUME)
      .in("statut", ["emise", "envoyee"])
      .order("date_echeance", { ascending: true })
      .order("numero", { ascending: true }),
    depuis("factures_vue", "entite_id, total_ttc_centimes")
      .eq("statut", "payee")
      .gte("payee_le", moisCourant)
      .lt("payee_le", moisSuivant),
    depuis("factures_vue", "entite_id").eq("statut", "brouillon"),
    depuis("factures_vue", COLONNES_RESUME).order("created_at", { ascending: false }).limit(10),
    depuis("prestations", "id", { count: "exact", head: true }),
    depuis("clients", "id", { count: "exact", head: true }),
    depuis("factures", "id", { count: "exact", head: true }),
  ]);

  const facturesOuvertes = lignes<FactureResumee>(ouvertes, "factures à encaisser");
  const facturesPayees = lignes<Pick<Facture, "entite_id" | "total_ttc_centimes">>(payees, "encaissements");
  const facturesBrouillons = lignes<Pick<Facture, "entite_id">>(brouillons, "brouillons");

  const calculer = (garder: (entite: string) => boolean): Indicateurs => {
    const ouvertesRetenues = facturesOuvertes.filter((f) => garder(f.entite_id));
    return {
      aEncaisser: cumuler(ouvertesRetenues.map((f) => f.total_ttc_centimes)),
      enRetard: cumuler(ouvertesRetenues.filter((f) => f.en_retard).map((f) => f.total_ttc_centimes)),
      encaisseMois: cumuler(facturesPayees.filter((f) => garder(f.entite_id)).map((f) => f.total_ttc_centimes)),
      brouillons: facturesBrouillons.filter((f) => garder(f.entite_id)).length,
    };
  };

  return {
    aujourdhui,
    moisCourant,
    indicateurs: calculer(() => true),
    parEntite: entiteId ? [] : entites.map((entite) => ({ entite, indicateurs: calculer((id) => id === entite.id) })),
    // Les factures ouvertes sont déjà triées par échéance croissante.
    retards: facturesOuvertes.filter((f) => f.en_retard).slice(0, 10),
    dernieres: lignes<FactureResumee>(dernieres, "dernières factures"),
    premiersPas: {
      prestations: compte(nbPrestations, "prestations"),
      clients: compte(nbClients, "clients"),
      factures: compte(nbFactures, "factures"),
    },
  };
}
