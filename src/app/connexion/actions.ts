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
    .min(1, "Saisis ton adresse e-mail.")
    .pipe(z.email("Cette adresse e-mail n'est pas valide : vérifie-la.")),
  motDePasse: z.string().min(1, "Saisis ton mot de passe."),
  suite: z.string(),
});

/** Traduit une erreur Supabase Auth en message compréhensible. */
function messageErreurConnexion(erreur: { code?: string; status?: number; name?: string }): string {
  if (erreur.code === "invalid_credentials") {
    return "E-mail ou mot de passe incorrect.";
  }
  if (erreur.code === "email_not_confirmed") {
    return "Cette adresse e-mail n'est pas encore confirmée. Confirme-la dans Supabase (Authentication → Users), puis réessaie.";
  }
  if (erreur.code === "user_banned") {
    return "Ce compte est bloqué. Débloque-le dans Supabase (Authentication → Users), puis réessaie.";
  }
  if (erreur.status === 429 || erreur.code?.startsWith("over_")) {
    return "Trop de tentatives de connexion. Attends quelques minutes avant de réessayer.";
  }
  if (erreur.name === "AuthRetryableFetchError" || erreur.status === 0) {
    return "Le service de connexion ne répond pas. Vérifie ta connexion Internet, puis réessaie.";
  }
  return "Connexion impossible pour le moment. Réessaie dans un instant.";
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
    return { ok: false, erreur: saisie.error.issues[0]?.message ?? "Remplis l'e-mail et le mot de passe." };
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
    return { ok: false, erreur: "Connexion impossible : l'application est mal configurée. Vérifie les variables Supabase (URL et clé) dans Vercel." };
  }

  // redirect() lève une exception de contrôle : il doit rester hors du try/catch.
  revalidatePath("/", "layout");
  redirect(cheminDeRetour(saisie.data.suite));
}
