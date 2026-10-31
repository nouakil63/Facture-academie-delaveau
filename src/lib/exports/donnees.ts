import "server-only";
import type { ClientSupabase } from "@/lib/supabase/server";
import type { Client } from "@/lib/types";

/** Parcours par identifiant : aucune limite liée aux listes affichées ou au plafond REST. */
export async function toutesLesPages<T extends { id: string }>(
  charger: (apres: string | null) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const lignes: T[] = [];
  let apres: string | null = null;
  for (;;) {
    const { data, error } = await charger(apres);
    if (error) throw new Error(error.message);
    if (!data?.length) return lignes;
    const dernier = data[data.length - 1].id;
    if (apres !== null && dernier <= apres) throw new Error("Pagination interrompue : ordre des identifiants invalide.");
    lignes.push(...data);
    apres = dernier;
  }
}

export type ClientExporte = Client & { academie: { nom: string } | null };

export function chargerTousLesClients(supabase: ClientSupabase) {
  const instant = new Date().toISOString();
  return toutesLesPages<ClientExporte>((apres) => {
    let requete = supabase.from("clients").select("*, academie:academies(nom)")
      .lte("created_at", instant).order("id").limit(500);
    if (apres) requete = requete.gt("id", apres);
    return requete;
  });
}

export function chargerToutesLesFactures(supabase: ClientSupabase) {
  const instant = new Date().toISOString();
  return toutesLesPages<{ id: string; numero: string | null; statut: string }>((apres) => {
    let requete = supabase.from("factures").select("id, numero, statut")
      .lte("created_at", instant).order("id").limit(500);
    if (apres) requete = requete.gt("id", apres);
    return requete;
  });
}
