import "server-only";
import { chargerAcademies } from "@/lib/facturation/service";
import type { ClientSupabase } from "@/lib/supabase/server";
import type { Academie } from "@/lib/types";

/** Ce dont la coquille et le tableau de bord ont besoin pour une académie. */
export type AcademieMenu = Pick<Academie, "id" | "nom" | "couleur">;

/**
 * Académies actives (Académie Delaveau, Académie Espoir), dans l'ordre d'affichage.
 * Liste vide en cas d'erreur (journalisée) : la coquille reste utilisable et le
 * bandeau d'accès explique le problème.
 */
export async function chargerAcademiesActives(supabase: ClientSupabase): Promise<AcademieMenu[]> {
  try {
    const academies = await chargerAcademies(supabase, true);
    return academies.map(({ id, nom, couleur }) => ({ id, nom, couleur }));
  } catch (e) {
    console.error("Chargement des académies impossible :", e instanceof Error ? e.message : e);
    return [];
  }
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
 * Académie réellement filtrée : l'identifiant mémorisé dans le cookie s'il correspond
 * à une académie active, sinon null (« Toutes »). Un cookie périmé (académie
 * supprimée ou désactivée) retombe donc sur « Toutes ».
 */
export function academieFiltree(idCookie: string | null, academies: Pick<AcademieMenu, "id">[]): string | null {
  return idCookie && academies.some((a) => a.id === idCookie) ? idCookie : null;
}
