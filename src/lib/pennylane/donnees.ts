import "server-only";
import type { ClientSupabase } from "@/lib/supabase/server";
import type { Academie, Client, Facture, LigneFacture, Parametres, Prestation, TarifClient } from "@/lib/types";

export type LigneArchive = Record<string, unknown>;

export interface DonneesPennylane {
  date_export: string;
  parametres: Parametres[];
  academies: Academie[];
  clients: Client[];
  prestations: Prestation[];
  tarifs_clients: TarifClient[];
  factures: Facture[];
  lignes_facture: LigneFacture[];
  echeances: LigneArchive[];
  extras_clients: LigneArchive[];
  envois_email: LigneArchive[];
  compteurs_factures: LigneArchive[];
}

/** Pagination explicite : aucun filtre d'académie, d'activité, de date ou de statut. */
export async function chargerTable<T>(supabase: ClientSupabase, table: string, cle = "id"): Promise<T[]> {
  const lignes: T[] = [];
  let total: number | null = null;
  do {
    const { data, error, count } = await supabase.from(table).select("*", { count: "exact" })
      .order(cle).range(lignes.length, lignes.length + 499);
    if (error) throw new Error(`Lecture de ${table} impossible : ${error.message}`);
    if (count === null || (total !== null && count !== total)) {
      throw new Error(`Les données de ${table} ont changé pendant l'export. Relancer hors saisie.`);
    }
    total = count;
    if (!data?.length && lignes.length < total) throw new Error(`Export incomplet de ${table}.`);
    lignes.push(...((data ?? []) as T[]));
  } while (lignes.length < total);
  return lignes;
}

/** Utilise exclusivement la session du membre connecté et ses droits RLS. */
export async function chargerDonneesPennylane(supabase: ClientSupabase): Promise<DonneesPennylane> {
  const date_export = new Date().toISOString();
  const [parametres, academies, clients, prestations, tarifs_clients, factures, lignes_facture,
    echeances, extras_clients, envois_email, compteurs_factures] = await Promise.all([
    chargerTable<Parametres>(supabase, "parametres"),
    chargerTable<Academie>(supabase, "academies"),
    chargerTable<Client>(supabase, "clients"),
    chargerTable<Prestation>(supabase, "prestations"),
    chargerTable<TarifClient>(supabase, "tarifs_clients"),
    chargerTable<Facture>(supabase, "factures"),
    chargerTable<LigneFacture>(supabase, "lignes_facture"),
    chargerTable<LigneArchive>(supabase, "echeances"),
    chargerTable<LigneArchive>(supabase, "extras_clients"),
    chargerTable<LigneArchive>(supabase, "envois_email"),
    chargerTable<LigneArchive>(supabase, "compteurs_factures", "annee"),
  ]);
  if (parametres.length !== 1) throw new Error("Paramètres de facturation absents ou inaccessibles.");
  return { date_export, parametres, academies, clients, prestations, tarifs_clients, factures,
    lignes_facture, echeances, extras_clients, envois_email, compteurs_factures };
}
