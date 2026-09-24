"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
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
import { COOKIE_ACADEMIE } from "@/lib/academie-selectionnee";
import { exigerUtilisateur } from "@/lib/auth";
import { emailConfigure, envoyerEmail } from "@/lib/email";
import { formatDateHeure } from "@/lib/format";
import type { ClientSupabase } from "@/lib/supabase/server";
import type { ResultatAction } from "@/lib/types";

/*
 * Server Actions des paramètres :
 *   - enregistrement des paramètres de l'association (ligne unique `parametres` :
 *     informations légales, IBAN, TVA, facturation mensuelle, modèles d'e-mail) ;
 *   - gestion des académies (ajout, modification, activation, suppression) ;
 *   - envoi d'un e-mail de test.
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

/** Message de la base lorsque le préfixe est modifié après la première émission (trigger proteger_parametres). */
const MESSAGE_PREFIXE_FIGE = "Le préfixe ne peut plus changer";

/** Traduit une erreur Postgres / PostgREST en message compréhensible. */
function traduireErreur(erreur: ErreurSupabase, siCleEtrangere?: string): string {
  const texte = `${erreur.message} ${erreur.details ?? ""}`;
  switch (erreur.code) {
    case "23503":
      return siCleEtrangere ?? "Opération impossible : cet élément est lié à d'autres données.";
    case "23505":
      if (texte.includes("academies_nom")) return "Une académie porte déjà ce nom : choisissez-en un autre.";
      return "Cette valeur est déjà utilisée.";
    case "23514":
      if (texte.includes("prefixe_facture")) return "Préfixe de facture invalide : 1 à 8 lettres majuscules ou chiffres.";
      if (texte.includes("couleur")) return "Couleur invalide : format #RRGGBB attendu.";
      if (texte.includes("delai_paiement")) return "Le délai de paiement doit être compris entre 0 et 90 jours.";
      if (texte.includes("taux_tva")) return "Le taux de TVA doit être compris entre 0 et 99,99 %.";
      if (texte.includes("jour_generation")) return "Le jour de génération doit être compris entre 1 et 28.";
      if (texte.includes("nom")) return "Le nom est obligatoire.";
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
      if (erreur.message.includes(MESSAGE_PREFIXE_FIGE)) {
        return "Le préfixe ne peut plus être modifié : des factures ont déjà été numérotées avec lui. La série de numérotation doit rester continue, sans trou ni doublon.";
      }
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

const schemaParametres = z
  .object({
    // Charte et numérotation
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
  "prefixe_facture", "couleur_primaire", "couleur_secondaire", "logo_url",
  "raison_sociale", "forme_juridique", "siren", "siret", "rna", "numero_tva", "objet_social",
  "adresse_ligne1", "adresse_ligne2", "code_postal", "ville", "pays", "email_contact", "telephone", "site_web",
  "titulaire_compte", "iban", "bic", "conditions_paiement", "delai_paiement_jours",
  "taux_tva", "mention_tva", "mentions_legales", "mentions_professionnels",
  "objet_facture_mensuelle", "jour_generation", "mois_facture",
  "email_objet", "email_corps", "email_copie",
] as const;

function lireFormulaireParametres(formData: FormData) {
  return {
    ...Object.fromEntries(CHAMPS_TEXTE.map((n) => [n, champ(formData, n)])),
    generation_auto: formData.get("generation_auto") === "on",
    envoi_auto: formData.get("envoi_auto") === "on",
  };
}

// -----------------------------------------------------------------------------
// Paramètres de l'association (ligne unique)
// -----------------------------------------------------------------------------

const PARAMETRES_INTROUVABLES: ResultatAction = {
  ok: false,
  erreur: "Paramètres introuvables, ou accès refusé : vérifiez que les migrations ont été appliquées.",
};

/**
 * Enregistre les paramètres de l'association (mise à jour de la ligne unique, jamais d'insertion).
 * Le préfixe de facture n'est modifiable que tant qu'aucun numéro n'a été attribué
 * (la série doit rester continue) : contrôlé ici et par un trigger en base.
 */
export async function enregistrerParametres(
  _precedent: ResultatAction | null,
  formData: FormData,
): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const lecture = schemaParametres.safeParse(lireFormulaireParametres(formData));
  if (!lecture.success) return { ok: false, erreur: messagesValidation(lecture.error) };
  const { prefixe_facture, ...champs } = lecture.data;

  try {
    const [actuels, compteurs] = await Promise.all([
      supabase.from("parametres").select("prefixe_facture").eq("id", true).maybeSingle(),
      supabase.from("compteurs_factures").select("annee", { count: "exact", head: true }),
    ]);
    if (actuels.error) return { ok: false, erreur: traduireErreur(actuels.error) };
    if (compteurs.error) return { ok: false, erreur: traduireErreur(compteurs.error) };
    if (!actuels.data) return PARAMETRES_INTROUVABLES;
    const prefixeActuel = (actuels.data as { prefixe_facture: string }).prefixe_facture;

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

    const { data, error } = await supabase.from("parametres").update(modification).eq("id", true).select("id");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return PARAMETRES_INTROUVABLES;
  } catch {
    return ERREUR_RESEAU;
  }

  // Raison sociale, couleurs et préfixe apparaissent sur plusieurs pages (tableau de bord, factures…).
  revalidatePath("/", "layout");
  return { ok: true, message: "Paramètres enregistrés. Ils s'appliquent aux prochaines factures émises." };
}

// -----------------------------------------------------------------------------
// Académies
// -----------------------------------------------------------------------------

const schemaIdAcademie = z.uuid({ error: "Académie introuvable." });

const schemaAcademie = z.object({
  id: z.union([z.literal(""), schemaIdAcademie]),
  nom: z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1, { error: "Le nom de l'académie est obligatoire (ex. Académie Espoir)." })
        .max(80, { error: "Nom de l'académie : 80 caractères au maximum." }),
    ),
  couleur: couleur("Couleur de l'académie"),
  actif: z.boolean(),
});

type AcademieLue = { id: string; nom: string; actif: boolean };

/** Les académies actives autres que `sauf` : il doit toujours en rester une pour rattacher les nouveaux clients. */
async function autresAcademiesActives(
  supabase: ClientSupabase,
  sauf: string,
): Promise<{ ok: true; nombre: number } | { ok: false; erreur: string }> {
  const { count, error } = await supabase
    .from("academies")
    .select("id", { count: "exact", head: true })
    .eq("actif", true)
    .neq("id", sauf);
  if (error) return { ok: false, erreur: traduireErreur(error) };
  return { ok: true, nombre: count ?? 0 };
}

const DERNIERE_ACTIVE =
  "Au moins une académie doit rester active : les nouveaux clients doivent pouvoir y être rattachés. Activez ou ajoutez d'abord une autre académie.";

/** Création (id vide) ou modification (nom, couleur, active) d'une académie. */
export async function enregistrerAcademie(
  _precedent: ResultatAction | null,
  formData: FormData,
): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const lecture = schemaAcademie.safeParse({
    id: champ(formData, "id"),
    nom: champ(formData, "nom"),
    couleur: champ(formData, "couleur"),
    actif: formData.get("actif") === "on",
  });
  if (!lecture.success) return { ok: false, erreur: messagesValidation(lecture.error) };
  const { id, nom, couleur: teinte, actif } = lecture.data;

  try {
    if (id) {
      if (!actif) {
        const autres = await autresAcademiesActives(supabase, id);
        if (!autres.ok) return autres;
        if (autres.nombre === 0) return { ok: false, erreur: DERNIERE_ACTIVE };
      }
      const { data, error } = await supabase
        .from("academies")
        .update({ nom, couleur: teinte, actif })
        .eq("id", id)
        .select("id");
      if (error) return { ok: false, erreur: traduireErreur(error) };
      if (!data || data.length === 0) return { ok: false, erreur: "Académie introuvable : elle a peut-être été supprimée." };
    } else {
      // Nouvelle académie : active, placée après les autres.
      const derniere = await supabase.from("academies").select("ordre").order("ordre", { ascending: false }).limit(1);
      if (derniere.error) return { ok: false, erreur: traduireErreur(derniere.error) };
      const ordre = ((derniere.data as { ordre: number }[])[0]?.ordre ?? 0) + 1;
      const { error } = await supabase.from("academies").insert({ nom, couleur: teinte, actif: true, ordre });
      if (error) return { ok: false, erreur: traduireErreur(error) };
    }
  } catch {
    return ERREUR_RESEAU;
  }

  // Le nom et la couleur apparaissent dans la barre latérale (filtre), les listes et les factures.
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: id ? `Académie « ${nom} » enregistrée.` : `Académie « ${nom} » ajoutée : vous pouvez y rattacher des clients.`,
  };
}

/** Active ou désactive une académie (elle n'est alors plus proposée pour les nouveaux clients ni dans le filtre). */
export async function changerActivationAcademie(academieId: string, activer: boolean): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const id = schemaIdAcademie.safeParse(academieId);
  if (!id.success || typeof activer !== "boolean") return { ok: false, erreur: "Requête invalide." };

  try {
    if (!activer) {
      const autres = await autresAcademiesActives(supabase, id.data);
      if (!autres.ok) return autres;
      if (autres.nombre === 0) return { ok: false, erreur: DERNIERE_ACTIVE };
    }
    const { data, error } = await supabase
      .from("academies")
      .update({ actif: activer })
      .eq("id", id.data)
      .select("id, nom, actif");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return { ok: false, erreur: "Académie introuvable." };
    const { nom } = (data as AcademieLue[])[0];

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: activer
        ? `« ${nom} » est de nouveau active : elle est proposée pour les nouveaux clients et dans le filtre.`
        : `« ${nom} » est désactivée. Ses clients restent rattachés et continuent d'être facturés s'ils sont actifs.`,
    };
  } catch {
    return ERREUR_RESEAU;
  }
}

/**
 * Suppression définitive d'une académie — refusée si des clients ou des factures y sont rattachés
 * (clé étrangère « on delete restrict » : on propose alors la désactivation).
 */
export async function supprimerAcademie(academieId: string): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const id = schemaIdAcademie.safeParse(academieId);
  if (!id.success) return { ok: false, erreur: "Académie introuvable." };

  const refus =
    "Cette académie ne peut pas être supprimée : des clients ou des factures y sont rattachés. Rattachez les clients à une autre académie depuis leur fiche, ou désactivez-la plutôt.";

  try {
    const [academie, clients, factures, autres] = await Promise.all([
      supabase.from("academies").select("id, nom, actif").eq("id", id.data).maybeSingle(),
      supabase.from("clients").select("id", { count: "exact", head: true }).eq("academie_id", id.data),
      supabase.from("factures").select("id", { count: "exact", head: true }).eq("academie_id", id.data),
      autresAcademiesActives(supabase, id.data),
    ]);
    if (academie.error) return { ok: false, erreur: traduireErreur(academie.error) };
    if (clients.error) return { ok: false, erreur: traduireErreur(clients.error) };
    if (factures.error) return { ok: false, erreur: traduireErreur(factures.error) };
    if (!autres.ok) return autres;
    if (!academie.data) return { ok: false, erreur: "Académie introuvable : elle a peut-être déjà été supprimée." };
    const { nom } = academie.data as AcademieLue;

    const nbClients = clients.count ?? 0;
    const nbFactures = factures.count ?? 0;
    if (nbClients > 0) {
      return {
        ok: false,
        erreur: `« ${nom} » ne peut pas être supprimée : ${
          nbClients > 1 ? `${nbClients} clients y sont rattachés` : "1 client y est rattaché"
        } (clients archivés compris). Rattachez-les à une autre académie depuis leur fiche, ou désactivez plutôt l'académie.`,
      };
    }
    if (nbFactures > 0) {
      return {
        ok: false,
        erreur: `« ${nom} » ne peut pas être supprimée : ${
          nbFactures > 1 ? `${nbFactures} factures y sont rattachées` : "1 facture y est rattachée"
        } (historique de facturation). Désactivez-la plutôt.`,
      };
    }
    if ((academie.data as AcademieLue).actif && autres.nombre === 0) return { ok: false, erreur: DERNIERE_ACTIVE };

    const { data, error } = await supabase.from("academies").delete().eq("id", id.data).select("id");
    if (error) return { ok: false, erreur: traduireErreur(error, refus) };
    if (!data || data.length === 0) {
      return { ok: false, erreur: "Académie introuvable : elle a peut-être déjà été supprimée." };
    }

    // L'académie supprimée ne doit plus servir de filtre.
    const magasin = await cookies();
    if (magasin.get(COOKIE_ACADEMIE)?.value === id.data) magasin.delete(COOKIE_ACADEMIE);

    revalidatePath("/", "layout");
    return { ok: true, message: `Académie « ${nom} » supprimée.` };
  } catch {
    return ERREUR_RESEAU;
  }
}

// -----------------------------------------------------------------------------
// E-mail de test
// -----------------------------------------------------------------------------

/** Traduit une erreur d'envoi (codes nodemailer) en message exploitable. */
function messageErreurEnvoi(e: unknown): string {
  const erreur = (e ?? {}) as { code?: string; responseCode?: number; message?: string };
  switch (erreur.code) {
    case "EAUTH":
    case "ENOAUTH":
      return "Identifiants refusés par le serveur SMTP : SMTP_USER doit être l'adresse complète de la boîte (ex. contact@academiedelaveau.com) et SMTP_PASSWORD le mot de passe de cette boîte.";
    case "ECONNECTION":
    case "ECONNREFUSED":
    case "ETIMEDOUT":
    case "ESOCKET":
    case "EDNS":
    case "ETLS":
      return "Connexion au serveur SMTP impossible : vérifiez SMTP_HOST (serveur indiqué dans l'espace client Amen), SMTP_PORT et SMTP_SECURE (port 465 → true, port 587 → false).";
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
      erreur: "L'envoi d'e-mails n'est pas configuré : définissez les variables SMTP dans Vercel (voir l'aide ci-dessus), puis redéployez.",
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
