"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigerUtilisateur } from "@/lib/auth";
import type { ResultatAction } from "@/lib/types";

const ECHEC_DECONNEXION = "La déconnexion a échoué. Vérifiez votre connexion Internet puis réessayez.";

/** Ferme la session de cet appareil uniquement, puis renvoie vers /connexion. */
export async function seDeconnecter(): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  try {
    // « local » : les autres appareils de l'utilisateur (téléphone, ordinateur) restent connectés.
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      console.error("Déconnexion :", error.message);
      return { ok: false, erreur: ECHEC_DECONNEXION };
    }
  } catch (e) {
    console.error("Déconnexion :", e);
    return { ok: false, erreur: ECHEC_DECONNEXION };
  }

  revalidatePath("/", "layout");
  redirect("/connexion");
}
