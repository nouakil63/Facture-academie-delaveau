"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { creerClientServeur } from "@/lib/supabase/server";
import type { ResultatAction } from "@/lib/types";
import { cheminDeRetour } from "./redirection";

const schemaConnexion = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Saisissez votre adresse e-mail.")
    .pipe(z.email("Cette adresse e-mail n'est pas valide.")),
  motDePasse: z.string().min(1, "Saisissez votre mot de passe."),
  suite: z.string(),
});

/** Traduit une erreur Supabase Auth en message compréhensible. */
function messageErreurConnexion(erreur: { code?: string; status?: number; name?: string }): string {
  if (erreur.code === "invalid_credentials") {
    return "E-mail ou mot de passe incorrect.";
  }
  if (erreur.code === "email_not_confirmed") {
    return "Cette adresse e-mail n'a pas encore été confirmée. Confirmez-la depuis le tableau de bord Supabase (Authentication → Users) puis réessayez.";
  }
  if (erreur.code === "user_banned") {
    return "Ce compte est désactivé. Contactez l'administrateur de l'application.";
  }
  if (erreur.status === 429 || erreur.code?.startsWith("over_")) {
    return "Trop de tentatives de connexion. Patientez quelques minutes avant de réessayer.";
  }
  if (erreur.name === "AuthRetryableFetchError" || erreur.status === 0) {
    return "Le service de connexion est injoignable. Vérifiez votre connexion Internet puis réessayez.";
  }
  return "Connexion impossible pour le moment. Réessayez dans un instant.";
}

/**
 * Connexion par e-mail et mot de passe. Les cookies de session sont posés côté serveur
 * par le client Supabase ; en cas de succès, redirection vers ?suite= (chemin interne) ou "/".
 */
export async function seConnecter(etatPrecedent: ResultatAction | null, formData: FormData): Promise<ResultatAction> {
  const texte = (cle: string) => {
    const valeur = formData.get(cle);
    return typeof valeur === "string" ? valeur : "";
  };

  const saisie = schemaConnexion.safeParse({
    email: texte("email"),
    motDePasse: texte("motDePasse"),
    suite: texte("suite"),
  });
  if (!saisie.success) {
    return { ok: false, erreur: saisie.error.issues[0]?.message ?? "Formulaire incomplet." };
  }

  try {
    const supabase = await creerClientServeur();
    const { error } = await supabase.auth.signInWithPassword({
      email: saisie.data.email.toLowerCase(),
      password: saisie.data.motDePasse,
    });
    if (error) {
      if (error.code !== "invalid_credentials") console.error("Connexion :", error.code, error.message);
      return { ok: false, erreur: messageErreurConnexion(error) };
    }
  } catch (e) {
    console.error("Connexion :", e);
    return { ok: false, erreur: "Connexion impossible : l'application n'est pas correctement configurée (voir le README)." };
  }

  // redirect() lève une exception de contrôle : il doit rester hors du try/catch.
  revalidatePath("/", "layout");
  redirect(cheminDeRetour(saisie.data.suite));
}
