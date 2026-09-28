import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { premierDuMois } from "@/lib/format";
import type {
  Academie,
  AvisComplet,
  Client,
  Echeance,
  Facture,
  FactureComplete,
  LigneFacture,
  Parametres,
  ResultatGeneration,
} from "@/lib/types";

/**
 * Opérations métier sur les factures, partagées par les pages, les Server Actions
 * et la tâche planifiée. Chaque fonction reçoit le client Supabase à utiliser
 * (utilisateur connecté → RLS, ou client admin pour le cron).
 */

/** Paramètres de la structure émettrice (ligne unique). */
export async function chargerParametres(supabase: SupabaseClient): Promise<Parametres> {
  const { data, error } = await supabase.from("parametres").select("*").maybeSingle<Parametres>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Paramètres de facturation introuvables (migration non appliquée ou accès refusé).");
  return data;
}

/** Académies (Delaveau, Espoir), triées. `actives` = uniquement les actives. */
export async function chargerAcademies(supabase: SupabaseClient, actives = false): Promise<Academie[]> {
  let requete = supabase.from("academies").select("*").order("ordre").order("nom");
  if (actives) requete = requete.eq("actif", true);
  const { data, error } = await requete;
  if (error) throw new Error(error.message);
  return (data ?? []) as Academie[];
}

/** Charge une facture, ses lignes, son client, l'émetteur et l'académie. null si introuvable. */
export async function chargerFactureComplete(supabase: SupabaseClient, factureId: string): Promise<FactureComplete | null> {
  const { data: facture, error } = await supabase.from("factures").select("*").eq("id", factureId).maybeSingle<Facture>();
  if (error) throw new Error(error.message);
  if (!facture) return null;

  const [lignes, client, academie, parametres, echeances] = await Promise.all([
    supabase.from("lignes_facture").select("*").eq("facture_id", factureId).order("ordre").order("created_at"),
    supabase.from("clients").select("*").eq("id", facture.client_id).single<Client>(),
    supabase.from("academies").select("*").eq("id", facture.academie_id).single<Academie>(),
    chargerParametres(supabase),
    facture.type_facture === "annuelle" && facture.statut !== "brouillon"
      ? chargerEcheancesFacture(supabase, factureId)
      : Promise.resolve([] as Echeance[]),
  ]);
  if (lignes.error) throw new Error(lignes.error.message);
  if (client.error) throw new Error(client.error.message);
  if (academie.error) throw new Error(academie.error.message);

  // Une facture émise s'imprime avec les informations figées au moment de l'émission.
  // Exception : les adresses e-mail (non imprimées) restent celles de la fiche client, pour
  // qu'une adresse ajoutée ou corrigée après l'émission serve aux envois suivants.
  const emise = facture.statut !== "brouillon";
  return {
    facture,
    lignes: (lignes.data as LigneFacture[]).map((l) => ({ ...l, quantite: Number(l.quantite) })),
    client:
      emise && facture.client_snapshot
        ? { ...client.data, ...facture.client_snapshot, email: client.data.email, emails_cc: client.data.emails_cc }
        : client.data,
    emetteur: emise && facture.emetteur_snapshot ? { ...parametres, ...facture.emetteur_snapshot } : parametres,
    academie: emise && facture.academie_snapshot ? { ...academie.data, ...facture.academie_snapshot } : academie.data,
    echeances,
  };
}

/** Échéances d'une facture annuelle, par rang. */
export async function chargerEcheancesFacture(supabase: SupabaseClient, factureId: string): Promise<Echeance[]> {
  const { data, error } = await supabase.from("echeances").select("*").eq("facture_id", factureId).order("rang");
  if (error) throw new Error(error.message);
  return (data ?? []) as Echeance[];
}

/**
 * Charge un avis d'échéance : l'échéance, toutes celles de sa facture annuelle, la facture,
 * le client (coordonnées figées à l'émission, e-mails de la fiche actuelle), l'émetteur figé
 * et l'académie figée. null si introuvable.
 */
export async function chargerAvisComplet(supabase: SupabaseClient, echeanceId: string): Promise<AvisComplet | null> {
  const { data: echeance, error } = await supabase.from("echeances").select("*").eq("id", echeanceId).maybeSingle<Echeance>();
  if (error) throw new Error(error.message);
  if (!echeance) return null;
  const complete = await chargerFactureComplete(supabase, echeance.facture_id);
  if (!complete) return null;
  const echeances = complete.echeances && complete.echeances.length > 0 ? complete.echeances : [echeance];
  return {
    echeance: echeances.find((e) => e.id === echeance.id) ?? echeance,
    echeances,
    facture: complete.facture,
    client: complete.client,
    emetteur: complete.emetteur,
    academie: complete.academie,
  };
}

/** Émet un brouillon : numéro définitif, dates, coordonnées figées. Lève une Error lisible. */
export async function emettreFacture(supabase: SupabaseClient, factureId: string): Promise<Facture> {
  const { data, error } = await supabase.rpc("emettre_facture", { p_facture_id: factureId }).single<Facture>();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Ancien modèle (factures mensuelles), conservé mais plus utilisé par l'interface ni par la tâche
 * planifiée : voir genererFacturesAnnuelles.
 * Crée (ou prévisualise avec `apercu: true`) les brouillons mensuels.
 * `periode` : n'importe quel jour du mois à facturer ("AAAA-MM-JJ").
 * `academieId` : limiter à une académie (null/absent = toutes).
 * Idempotent : un client déjà facturé pour ce mois est renvoyé avec `deja_existante = true`.
 */
export async function genererBrouillonsMensuels(
  supabase: SupabaseClient,
  periode: string,
  options: { academieId?: string | null; apercu?: boolean } = {},
): Promise<ResultatGeneration[]> {
  const { data, error } = await supabase.rpc("generer_brouillons_mensuels", {
    p_periode: periode,
    p_academie_id: options.academieId ?? null,
    p_dry_run: options.apercu ?? false,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ResultatGeneration[];
}

/**
 * Crée (ou prévisualise avec `apercu: true`) les brouillons des factures annuelles d'une saison
 * (2026 = septembre 2026 → juin 2027). `academieId` : limiter à une académie (null/absent = toutes).
 * Idempotent : un client qui a déjà sa facture annuelle (non annulée) est renvoyé avec `deja_existante = true`.
 */
export async function genererFacturesAnnuelles(
  supabase: SupabaseClient,
  saison: number,
  options: { academieId?: string | null; apercu?: boolean } = {},
): Promise<ResultatGeneration[]> {
  const { data, error } = await supabase.rpc("generer_factures_annuelles", {
    p_saison: saison,
    p_academie_id: options.academieId ?? null,
    p_dry_run: options.apercu ?? false,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ResultatGeneration[];
}

/**
 * Mois à facturer à une date donnée, selon le réglage (mois courant ou précédent) : mois des
 * avis d'échéance envoyés ce jour-là par la tâche planifiée.
 */
export function periodeAFacturer(parametres: Pick<Parametres, "mois_facture">, date?: string): string {
  return premierDuMois(date, parametres.mois_facture === "precedent" ? -1 : 0);
}

/** Destinataires d'une facture : e-mail principal + copies (fonction pure, dans @/lib/format). */
export { destinatairesFacture } from "@/lib/format";
