import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { premierDuMois } from "@/lib/format";
import type { Client, Entite, Facture, FactureComplete, LigneFacture, ResultatGeneration } from "@/lib/types";

/**
 * Opérations métier sur les factures, partagées par les pages, les Server Actions
 * et la tâche planifiée. Chaque fonction reçoit le client Supabase à utiliser
 * (utilisateur connecté → RLS, ou client admin pour le cron).
 */

/** Charge une facture, ses lignes, son client et son entité. null si introuvable. */
export async function chargerFactureComplete(supabase: SupabaseClient, factureId: string): Promise<FactureComplete | null> {
  const { data: facture, error } = await supabase.from("factures").select("*").eq("id", factureId).maybeSingle<Facture>();
  if (error) throw new Error(error.message);
  if (!facture) return null;

  const [lignes, client, entite] = await Promise.all([
    supabase.from("lignes_facture").select("*").eq("facture_id", factureId).order("ordre").order("created_at"),
    supabase.from("clients").select("*").eq("id", facture.client_id).single<Client>(),
    supabase.from("entites").select("*").eq("id", facture.entite_id).single<Entite>(),
  ]);
  if (lignes.error) throw new Error(lignes.error.message);
  if (client.error) throw new Error(client.error.message);
  if (entite.error) throw new Error(entite.error.message);

  // Une facture émise s'imprime avec les coordonnées figées au moment de l'émission.
  const emise = facture.statut !== "brouillon";
  return {
    facture,
    lignes: (lignes.data as LigneFacture[]).map((l) => ({ ...l, quantite: Number(l.quantite) })),
    client: emise && facture.client_snapshot ? { ...client.data, ...facture.client_snapshot } : client.data,
    entite: emise && facture.entite_snapshot ? { ...entite.data, ...facture.entite_snapshot } : entite.data,
  };
}

/** Émet un brouillon : numéro définitif, dates, coordonnées figées. Lève une Error lisible. */
export async function emettreFacture(supabase: SupabaseClient, factureId: string): Promise<Facture> {
  const { data, error } = await supabase.rpc("emettre_facture", { p_facture_id: factureId }).single<Facture>();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Crée (ou prévisualise avec `apercu = true`) les brouillons mensuels d'une entité.
 * `periode` : n'importe quel jour du mois à facturer ("AAAA-MM-JJ").
 * Idempotent : un client déjà facturé pour ce mois est renvoyé avec `deja_existante = true`.
 */
export async function genererBrouillonsMensuels(
  supabase: SupabaseClient,
  entiteId: string,
  periode: string,
  apercu = false,
): Promise<ResultatGeneration[]> {
  const { data, error } = await supabase.rpc("generer_brouillons_mensuels", {
    p_entite_id: entiteId,
    p_periode: periode,
    p_dry_run: apercu,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ResultatGeneration[];
}

/** Mois à facturer pour une entité à une date donnée, selon son réglage (mois courant ou précédent). */
export function periodeAFacturer(entite: Pick<Entite, "mois_facture">, date?: string): string {
  return premierDuMois(date, entite.mois_facture === "precedent" ? -1 : 0);
}

/** Destinataires d'une facture : e-mail principal + copies. */
export function destinatairesFacture(client: Pick<Client, "email" | "emails_cc">): string[] {
  return [client.email, ...(client.emails_cc ?? [])]
    .map((e) => (e ?? "").trim())
    .filter((e, i, tous) => e !== "" && tous.indexOf(e) === i);
}
