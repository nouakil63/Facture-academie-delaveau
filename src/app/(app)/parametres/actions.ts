"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  bicValide,
  chiffresSeuls,
  erreurIban,
  erreurSiren,
  erreurSiret,
  formaterIban,
  formaterSiren,
  formaterSiret,
  MOTIF_PREFIXE,
  normaliserBic,
  normaliserCouleur,
  normaliserRna,
  rnaValide,
} from "@/components/parametres/controles";
import { variablesInconnues, VARIABLES_EMAIL } from "@/components/parametres/modeles-email";
import { exigerUtilisateur } from "@/lib/auth";
import { emailConfigure, envoyerEmail } from "@/lib/email";
import { formatDateHeure } from "@/lib/format";
import type { ResultatAction } from "@/lib/types";

/*
 * Server Actions des paramètres : enregistrement d'une entité (informations légales,
 * paiement, TVA, facturation mensuelle, modèles d'e-mail) et envoi d'un e-mail de test.
 * Toutes valident leurs entrées (zod), vérifient la session et renvoient un
 * ResultatAction (jamais d'exception vers le navigateur).
 */

// -----------------------------------------------------------------------------
// Outils internes (non exportés : un fichier "use server" n'exporte que des actions)
// -----------------------------------------------------------------------------

type ErreurSupabase = { code?: string; message: string; details?: string | null };

const ERREUR_RESEAU: ResultatAction = {
  ok: false,
  erreur: "Impossible de joindre la base de données. Vérifiez la connexion et réessayez.",
};

/** Traduit une erreur Postgres / PostgREST en message compréhensible. */
function traduireErreur(erreur: ErreurSupabase): string {
  const texte = `${erreur.message} ${erreur.details ?? ""}`;
  switch (erreur.code) {
    case "23505":
      if (texte.includes("prefixe_facture")) return "Ce préfixe de facture est déjà utilisé par une autre entité.";
      return "Cette valeur est déjà utilisée par une autre entité.";
    case "23514":
      if (texte.includes("prefixe_facture")) return "Préfixe de facture invalide : 1 à 8 lettres majuscules ou chiffres.";
      if (texte.includes("couleur")) return "Couleur invalide : format #RRGGBB attendu.";
      if (texte.includes("delai_paiement")) return "Le délai de paiement doit être compris entre 0 et 90 jours.";
      if (texte.includes("taux_tva")) return "Le taux de TVA doit être compris entre 0 et 99,99 %.";
      if (texte.includes("jour_generation")) return "Le jour de génération doit être compris entre 1 et 28.";
      return "Les données saisies ne respectent pas les règles de la base.";
    case "23502":
      return "Un champ obligatoire est manquant.";
    case "22003":
      return "Une valeur numérique est trop grande.";
    case "22P02":
      return "Une valeur saisie n'a pas le bon format.";
    case "42501":
      return "Accès refusé : votre compte n'est pas autorisé à modifier les paramètres.";
    case "P0001":
      return erreur.message;
    case "PGRST301":
    case "PGRST303":
      return "Votre session a expiré : reconnectez-vous.";
    default:
      return `Erreur de la base de données : ${erreur.message}`;
  }
}

/** Messages de validation zod, dédoublonnés, un par ligne. */
function messagesValidation(erreur: z.ZodError): string {
  return [...new Set(erreur.issues.map((i) => i.message))].join("\n");
}

/** Valeur texte d'un champ de formulaire ("" si absent). */
function champ(formData: FormData, nom: string): string {
  const valeur = formData.get(nom);
  return typeof valeur === "string" ? valeur : "";
}

/** Texte facultatif : espaces retirés, "" → null. */
const texteFacultatif = (max: number, libelle: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${libelle} : ${max} caractères au maximum.` })
    .transform((v) => (v === "" ? null : v));

/** Texte obligatoire (colonne NOT NULL). */
const texteObligatoire = (max: number, libelle: string, siVide: string) =>
  z
    .string()
    .trim()
    .min(1, { error: siVide })
    .max(max, { error: `${libelle} : ${max} caractères au maximum.` });

/** Entier saisi dans un <input type="number">, borné. */
const entierBorne = (min: number, max: number, libelle: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, { error: `${libelle} : nombre entier entre ${min} et ${max} attendu.` })
    .transform(Number)
    .refine((n) => n >= min && n <= max, { error: `${libelle} : nombre entier entre ${min} et ${max} attendu.` });

/** Texte facultatif soumis à un contrôle puis mis en forme ; "" → null. */
const identifiantFacultatif = (controle: (v: string) => string | null, formater: (v: string) => string) =>
  z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      const erreur = v === "" ? null : controle(v);
      if (erreur) ctx.addIssue({ code: "custom", message: erreur });
    })
    .transform((v) => (v === "" ? null : formater(v)));

const couleur = (libelle: string) =>
  z
    .string()
    .transform((v, ctx) => {
      const c = normaliserCouleur(v);
      if (!c) {
        ctx.addIssue({ code: "custom", message: `${libelle} : format #RRGGBB attendu (ex. #0050A0).` });
        return z.NEVER;
      }
      return c;
    });

const emailFacultatif = (libelle: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v.toLowerCase()))
    .pipe(z.email({ error: `${libelle} : adresse e-mail invalide.` }).max(254).nullable());

/** Modèle d'e-mail : obligatoire, sans variable inconnue. */
const modeleEmail = (max: number, libelle: string) =>
  texteObligatoire(max, libelle, `${libelle} : obligatoire.`).superRefine((v, ctx) => {
    const inconnues = variablesInconnues(v);
    if (inconnues.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `${libelle} : variable${inconnues.length > 1 ? "s" : ""} inconnue${
          inconnues.length > 1 ? "s" : ""
        } ${inconnues.map((n) => `{${n}}`).join(", ")}. Variables disponibles : ${VARIABLES_EMAIL.map((x) => `{${x.nom}}`).join(" ")}.`,
      });
    }
  });

const schemaId = z.uuid({ error: "Entité introuvable." });

const schemaEntite = z
  .object({
    // Identité
    nom: texteObligatoire(100, "Nom affiché", "Le nom affiché est obligatoire."),
    prefixe_facture: z
      .string()
      .transform((v) => v.trim().toUpperCase())
      .refine((v) => v === "" || MOTIF_PREFIXE.test(v), {
        error: "Préfixe de facture invalide : 1 à 8 lettres majuscules ou chiffres, sans espace ni tiret (ex. AD).",
      }),
    couleur_primaire: couleur("Couleur principale"),
    couleur_secondaire: couleur("Couleur secondaire"),
    logo_url: z
      .string()
      .trim()
      .max(1000, { error: "URL du logo : 1000 caractères au maximum." })
      .refine(
        (v) => {
          if (v === "") return true;
          try {
            const url = new URL(v);
            return url.protocol === "https:" || url.protocol === "http:";
          } catch {
            return false;
          }
        },
        { error: "URL du logo invalide : adresse complète attendue (https://…), ou laissez vide pour le logo Delaveau." },
      )
      .transform((v) => (v === "" ? null : v)),

    // Informations légales
    raison_sociale: texteObligatoire(200, "Raison sociale", "La raison sociale est obligatoire."),
    forme_juridique: texteFacultatif(100, "Forme juridique"),
    siren: identifiantFacultatif(erreurSiren, formaterSiren),
    siret: identifiantFacultatif(erreurSiret, formaterSiret),
    rna: identifiantFacultatif(
      (v) => (rnaValide(v) ? null : "Numéro RNA invalide : « W » suivi de 9 caractères (ex. W143007272)."),
      normaliserRna,
    ),
    numero_tva: identifiantFacultatif(
      (v) =>
        /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(v.replace(/\s/g, "").toUpperCase())
          ? null
          : "Numéro de TVA intracommunautaire invalide (ex. FR12853472298).",
      (v) => v.replace(/\s/g, "").toUpperCase(),
    ),
    objet_social: texteFacultatif(500, "Objet social"),

    // Coordonnées
    adresse_ligne1: texteFacultatif(200, "Adresse"),
    adresse_ligne2: texteFacultatif(200, "Complément d'adresse"),
    code_postal: texteFacultatif(12, "Code postal"),
    ville: texteFacultatif(120, "Ville"),
    pays: z
      .string()
      .trim()
      .max(80, { error: "Pays : 80 caractères au maximum." })
      .transform((v) => v || "France"),
    email_contact: emailFacultatif("E-mail de contact"),
    telephone: texteFacultatif(40, "Téléphone"),
    site_web: z
      .string()
      .trim()
      .max(200, { error: "Site web : 200 caractères au maximum." })
      .refine((v) => v === "" || /^(https?:\/\/)?[^\s/]+\.[^\s]{2,}$/i.test(v), {
        error: "Site web invalide (ex. www.academie-delaveau.fr).",
      })
      .transform((v) => (v === "" ? null : v)),

    // Paiement
    titulaire_compte: texteFacultatif(200, "Titulaire du compte"),
    iban: identifiantFacultatif(erreurIban, formaterIban),
    bic: identifiantFacultatif(
      (v) => (bicValide(v) ? null : "BIC invalide : 8 ou 11 caractères (ex. AGRIFRPP866)."),
      normaliserBic,
    ),
    conditions_paiement: texteObligatoire(
      500,
      "Conditions de paiement",
      "Les conditions de paiement sont obligatoires (ex. « Paiement par virement à réception de la facture. »).",
    ),
    delai_paiement_jours: entierBorne(0, 90, "Délai de paiement (jours)"),

    // TVA et mentions
    taux_tva: z
      .string()
      .transform((v) => v.replace(/[\s%]/g, "").replace(",", "."))
      .refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v), {
        error: "Taux de TVA invalide : pourcentage entre 0 et 99,99 (ex. 0, 5,5 ou 20).",
      })
      .transform(Number),
    mention_tva: texteFacultatif(300, "Mention TVA"),
    mentions_legales: texteFacultatif(1500, "Mentions légales"),
    mentions_professionnels: texteFacultatif(1500, "Mentions pour clients professionnels"),

    // Facturation mensuelle
    objet_facture_mensuelle: texteObligatoire(
      150,
      "Objet des factures mensuelles",
      "L'objet des factures mensuelles est obligatoire (ex. « Formation et accompagnement »).",
    ),
    jour_generation: entierBorne(1, 28, "Jour de génération"),
    mois_facture: z.enum(["courant", "precedent"], { error: "Choisissez le mois facturé (courant ou précédent)." }),
    generation_auto: z.boolean(),
    envoi_auto: z.boolean(),

    // E-mails
    email_objet: modeleEmail(200, "Objet de l'e-mail"),
    email_corps: modeleEmail(5000, "Corps de l'e-mail"),
    email_copie: emailFacultatif("Adresse en copie cachée"),
  })
  .refine((e) => e.taux_tva > 0 || Boolean(e.mention_tva), {
    path: ["mention_tva"],
    error:
      "Mention TVA obligatoire lorsque la TVA n'est pas facturée (taux 0 %) : ex. « TVA non applicable, art. 293 B du CGI ».",
    when: (p) => !p.issues.some((i) => i.path?.[0] === "taux_tva" || i.path?.[0] === "mention_tva"),
  })
  .refine((e) => !e.envoi_auto || e.generation_auto, {
    path: ["envoi_auto"],
    error: "L'envoi automatique nécessite la génération automatique des brouillons : cochez les deux, ou aucun.",
    when: (p) => !p.issues.some((i) => i.path?.[0] === "envoi_auto" || i.path?.[0] === "generation_auto"),
  })
  .refine((e) => !e.siren || !e.siret || chiffresSeuls(e.siret).startsWith(chiffresSeuls(e.siren)), {
    path: ["siret"],
    error: "Le SIRET doit commencer par les 9 chiffres du SIREN.",
    when: (p) => !p.issues.some((i) => i.path?.[0] === "siren" || i.path?.[0] === "siret"),
  });

const CHAMPS_TEXTE = [
  "nom", "prefixe_facture", "couleur_primaire", "couleur_secondaire", "logo_url",
  "raison_sociale", "forme_juridique", "siren", "siret", "rna", "numero_tva", "objet_social",
  "adresse_ligne1", "adresse_ligne2", "code_postal", "ville", "pays", "email_contact", "telephone", "site_web",
  "titulaire_compte", "iban", "bic", "conditions_paiement", "delai_paiement_jours",
  "taux_tva", "mention_tva", "mentions_legales", "mentions_professionnels",
  "objet_facture_mensuelle", "jour_generation", "mois_facture",
  "email_objet", "email_corps", "email_copie",
] as const;

function lireFormulaireEntite(formData: FormData) {
  return {
    ...Object.fromEntries(CHAMPS_TEXTE.map((n) => [n, champ(formData, n)])),
    generation_auto: formData.get("generation_auto") === "on",
    envoi_auto: formData.get("envoi_auto") === "on",
  };
}

// -----------------------------------------------------------------------------
// Entité
// -----------------------------------------------------------------------------

/**
 * Enregistre les paramètres d'une entité. Le préfixe de facture n'est modifiable
 * que tant qu'aucun numéro n'a été attribué (la série doit rester continue).
 */
export async function enregistrerEntite(_precedent: ResultatAction | null, formData: FormData): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const id = schemaId.safeParse(champ(formData, "id"));
  if (!id.success) return { ok: false, erreur: "Entité introuvable." };
  const lecture = schemaEntite.safeParse(lireFormulaireEntite(formData));
  if (!lecture.success) return { ok: false, erreur: messagesValidation(lecture.error) };
  const { prefixe_facture, ...champs } = lecture.data;

  try {
    const [actuelle, compteurs] = await Promise.all([
      supabase.from("entites").select("prefixe_facture").eq("id", id.data).maybeSingle(),
      supabase.from("compteurs_factures").select("annee", { count: "exact", head: true }).eq("entite_id", id.data),
    ]);
    if (actuelle.error) return { ok: false, erreur: traduireErreur(actuelle.error) };
    if (compteurs.error) return { ok: false, erreur: traduireErreur(compteurs.error) };
    if (!actuelle.data) return { ok: false, erreur: "Entité introuvable, ou accès refusé." };
    const prefixeActuel = (actuelle.data as { prefixe_facture: string }).prefixe_facture;

    let modification: Record<string, unknown> = champs;
    if ((compteurs.count ?? 0) > 0) {
      // Champ désactivé dans le formulaire : absent (""), ou identique si envoyé autrement.
      if (prefixe_facture !== "" && prefixe_facture !== prefixeActuel) {
        return {
          ok: false,
          erreur: `Le préfixe ne peut plus être modifié : des factures ont déjà été numérotées avec « ${prefixeActuel} ». La série de numérotation doit rester continue.`,
        };
      }
    } else {
      if (prefixe_facture === "") return { ok: false, erreur: "Le préfixe de facture est obligatoire (ex. AD)." };
      modification = { ...champs, prefixe_facture };
    }

    const { data, error } = await supabase.from("entites").update(modification).eq("id", id.data).select("id");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return { ok: false, erreur: "Entité introuvable, ou accès refusé." };
  } catch {
    return ERREUR_RESEAU;
  }

  // Nom, couleurs et préfixe apparaissent dans la barre latérale et sur toutes les pages.
  revalidatePath("/", "layout");
  return { ok: true, message: "Paramètres enregistrés. Ils s'appliquent aux prochaines factures émises." };
}

// -----------------------------------------------------------------------------
// E-mail de test
// -----------------------------------------------------------------------------

/** Traduit une erreur d'envoi (codes nodemailer) en message exploitable. */
function messageErreurEnvoi(e: unknown): string {
  const erreur = (e ?? {}) as { code?: string; responseCode?: number; message?: string };
  switch (erreur.code) {
    case "EAUTH":
      return "Identifiants refusés par le serveur SMTP : vérifiez SMTP_USER et SMTP_PASSWORD (pour Gmail, utilisez un « mot de passe d'application »).";
    case "ECONNECTION":
    case "ECONNREFUSED":
    case "ETIMEDOUT":
    case "ESOCKET":
    case "EDNS":
    case "ETLS":
      return "Connexion au serveur SMTP impossible : vérifiez SMTP_HOST, SMTP_PORT et SMTP_SECURE (port 465 → true, port 587 → false).";
    case "EENVELOPE":
      return "Adresse refusée par le serveur SMTP : vérifiez l'adresse de destination et l'expéditeur (EMAIL_FROM).";
    default:
      return `L'envoi a échoué : ${erreur.message ?? "erreur inconnue"}.`;
  }
}

/** Envoie un e-mail de test pour vérifier la configuration SMTP. */
export async function envoyerEmailTest(_precedent: ResultatAction | null, formData: FormData): Promise<ResultatAction> {
  const { supabase, utilisateur } = await exigerUtilisateur();

  const destinataire = z
    .email({ error: "Adresse e-mail invalide." })
    .max(254)
    .safeParse(champ(formData, "destinataire").trim());
  if (!destinataire.success) return { ok: false, erreur: "Adresse e-mail invalide." };

  if (!emailConfigure()) {
    return {
      ok: false,
      erreur: "L'envoi d'e-mails n'est pas configuré : définissez les variables SMTP dans Vercel (voir le README), puis redéployez.",
    };
  }

  // Le serveur SMTP de l'académie n'est utilisable que par les membres autorisés.
  try {
    const membre = await supabase.from("membres").select("email").limit(1);
    if (membre.error) return { ok: false, erreur: traduireErreur(membre.error) };
    if (!membre.data || membre.data.length === 0) {
      return { ok: false, erreur: "Accès refusé : votre adresse ne figure pas parmi les utilisateurs autorisés." };
    }
  } catch {
    return ERREUR_RESEAU;
  }

  const date = formatDateHeure(new Date().toISOString());
  const texte = [
    "Bonjour,",
    "",
    `Cet e-mail de test a été envoyé le ${date} depuis l'application de facturation de l'Académie Delaveau (Paramètres → Envoi des e-mails)${
      utilisateur.email ? `, par ${utilisateur.email}` : ""
    }.`,
    "",
    "Si vous le recevez, la configuration SMTP fonctionne : les factures pourront être envoyées aux clients.",
    "",
    "— Facturation Académie Delaveau / Académie Espoir",
  ].join("\n");

  try {
    await envoyerEmail({
      a: [destinataire.data],
      objet: "E-mail de test – Facturation Académie Delaveau",
      texte,
    });
  } catch (e) {
    return { ok: false, erreur: messageErreurEnvoi(e) };
  }

  return {
    ok: true,
    message: `E-mail de test envoyé à ${destinataire.data}. Vérifiez la boîte de réception (et le dossier des indésirables).`,
  };
}
