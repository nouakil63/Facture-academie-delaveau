import "server-only";
import { redirect } from "next/navigation";
import { creerClientServeur } from "@/lib/supabase/server";

/**
 * À appeler en tête de chaque page et Server Action protégée.
 * Vérifie la session auprès de Supabase et redirige vers /connexion sinon.
 * Retourne le client Supabase (RLS) et l'utilisateur.
 */
export async function exigerUtilisateur() {
  const supabase = await creerClientServeur();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/connexion");
  return { supabase, utilisateur: data.user };
}
