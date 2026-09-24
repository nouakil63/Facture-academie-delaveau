import "server-only";
import type { ClientSupabase } from "@/lib/supabase/server";
import type { Entite } from "@/lib/types";

/** Ce dont la coquille et le tableau de bord ont besoin pour une entité. */
export type EntiteMenu = Pick<Entite, "id" | "nom" | "prefixe_facture" | "couleur_primaire">;

/** Entités actives, dans l'ordre d'affichage. Liste vide en cas d'erreur (journalisée). */
export async function chargerEntitesActives(supabase: ClientSupabase): Promise<EntiteMenu[]> {
  const { data, error } = await supabase
    .from("entites")
    .select("id, nom, prefixe_facture, couleur_primaire")
    .eq("actif", true)
    .order("ordre")
    .order("nom");
  if (error) {
    console.error("Chargement des entités impossible :", error.message);
    return [];
  }
  return (data ?? []) as EntiteMenu[];
}

/**
 * - « autorise » : l'e-mail de l'utilisateur figure dans la table `membres` ;
 * - « non_membre » : connecté, mais la RLS ne lui renvoie aucune ligne ;
 * - « erreur » : la base n'a pas répondu (migrations non appliquées, réseau…).
 */
export type EtatAcces = "autorise" | "non_membre" | "erreur";

export async function verifierAcces(supabase: ClientSupabase): Promise<EtatAcces> {
  const { data, error } = await supabase.from("membres").select("email").limit(1);
  if (error) {
    console.error("Vérification de l'accès impossible :", error.message);
    return "erreur";
  }
  return data && data.length > 0 ? "autorise" : "non_membre";
}

/**
 * Entité réellement filtrée : l'identifiant mémorisé dans le cookie s'il correspond
 * à une entité active, sinon null (« Toutes »).
 */
export function entiteFiltree(idCookie: string | null, entites: EntiteMenu[]): string | null {
  return idCookie && entites.some((e) => e.id === idCookie) ? idCookie : null;
}
