"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { exigerUtilisateur } from "@/lib/auth";
import { parseEurosEnCentimes } from "@/lib/format";
import { parseQuantite } from "@/lib/tarifs";
import type { ResultatAction } from "@/lib/types";

/*
 * Server Actions du module Clients : fiche client, archivage, suppression,
 * tarifs appliqués. Toutes valident leurs entrées (zod), vérifient la session
 * et renvoient un ResultatAction (jamais d'exception vers le navigateur).
 */

// -----------------------------------------------------------------------------
// Outils internes (non exportés : un fichier "use server" n'exporte que des actions)
// -----------------------------------------------------------------------------

type ErreurSupabase = { code?: string; message: string; details?: string | null; hint?: string | null };

const ERREUR_RESEAU: ResultatAction = {
  ok: false,
  erreur: "Impossible de joindre la base de données. Vérifier la connexion et réessayer.",
};

/** Traduit une erreur Postgres / PostgREST en message compréhensible. */
function traduireErreur(erreur: ErreurSupabase, siCleEtrangere?: string): string {
  const texte = `${erreur.message} ${erreur.details ?? ""}`;
  switch (erreur.code) {
    case "23503":
      return siCleEtrangere ?? "Impossible : cet élément est lié à d'autres données.";
    case "23514":
      if (texte.includes("clients_pro_raison_sociale"))
        return "La raison sociale est obligatoire pour un client professionnel.";
      if (texte.includes("clients_arrhes")) return "Arrhes : montant ou saison invalide.";
      if (texte.includes("tarifs_ligne_libre")) return "Une ligne libre doit avoir un libellé et un prix.";
      if (texte.includes("tarifs_dates"))
        return "La date de fin doit être postérieure ou égale à la date de début.";
      if (texte.includes("quantite")) return "La quantité doit être supérieure à zéro.";
      if (texte.includes("prix_unitaire")) return "Le prix ne peut pas être négatif.";
      if (texte.includes("nom")) return "Le nom est obligatoire.";
      return "Les données saisies ne respectent pas les règles de la base.";
    case "22003":
      return "Une valeur numérique est trop grande.";
    case "22P02":
    case "22007":
    case "22008":
      return "Une valeur saisie n'a pas le bon format.";
    case "42501":
      return "Accès refusé : ce compte n'a pas le droit de modifier ces données.";
    case "P0001":
      // Exceptions levées par les triggers : messages métier déjà rédigés en français.
      return erreur.message;
    case "PGRST204":
    case "42703":
      return "Base de données pas à jour : exécuter dans Supabase la dernière migration du dossier supabase/migrations.";
    case "PGRST301":
    case "PGRST303":
      return "Session expirée : se reconnecter.";
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

/** Invalide tout l'arbre : noms de clients et tarifs apparaissent aussi dans factures et tableau de bord. */
function revaliderClients() {
  revalidatePath("/", "layout");
}

const schemaId = z.uuid({ error: "Identifiant invalide." });

const ACADEMIE_INTROUVABLE = "Cette académie n'existe plus : actualiser la page et réessayer.";

/** Texte facultatif : espaces retirés, "" → null. */
const texteFacultatif = (max: number, libelle: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${libelle} : ${max} caractères au maximum.` })
    .transform((v) => (v === "" ? null : v));

/** Date facultative d'un <input type="date"> ("AAAA-MM-JJ"), "" → null. */
const dateFacultative = (libelle: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))), {
      error: `${libelle} : date invalide.`,
    })
    .transform((v) => (v === "" ? null : v));

// -----------------------------------------------------------------------------
// Fiche client
// -----------------------------------------------------------------------------

const schemaClient = z
  .object({
    academie_id: z.uuid({ error: "Choisir l'académie du client : Académie Delaveau ou Académie Espoir." }),
    type: z.enum(["particulier", "professionnel"], { error: "Type de client invalide." }),
    civilite: texteFacultatif(30, "Civilité"),
    nom: z
      .string()
      .trim()
      .min(1, { error: "Le nom est obligatoire." })
      .max(120, { error: "Nom : 120 caractères au maximum." }),
    prenom: texteFacultatif(120, "Prénom"),
    raison_sociale: texteFacultatif(200, "Raison sociale"),
    email: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .pipe(z.email({ error: "L'adresse e-mail principale est invalide." }).max(254).nullable()),
    emails_cc: z.string().transform((v, ctx) => {
      const adresses: string[] = [];
      for (const brute of v.split(/[\s,;]+/)) {
        const adresse = brute.trim();
        if (adresse === "") continue;
        if (!z.email().safeParse(adresse).success) {
          ctx.addIssue({ code: "custom", message: `Adresse en copie invalide : « ${adresse} ».` });
        } else if (!adresses.some((a) => a.toLowerCase() === adresse.toLowerCase())) {
          adresses.push(adresse);
        }
      }
      if (adresses.length > 10) {
        ctx.addIssue({ code: "custom", message: "10 adresses en copie au maximum." });
      }
      return adresses;
    }),
    telephone: texteFacultatif(40, "Téléphone"),
    adresse_ligne1: texteFacultatif(200, "Adresse"),
    adresse_ligne2: texteFacultatif(200, "Complément d'adresse"),
    code_postal: texteFacultatif(12, "Code postal"),
    ville: texteFacultatif(120, "Ville"),
    pays: z
      .string()
      .trim()
      .max(80, { error: "Pays : 80 caractères au maximum." })
      .transform((v) => v || "France"),
    siret: z
      .string()
      .transform((v) => v.replace(/\s/g, ""))
      .refine((v) => v === "" || /^\d{14}$/.test(v), { error: "Le SIRET doit comporter 14 chiffres." })
      .transform((v) => v || null),
    numero_tva: z
      .string()
      .transform((v) => v.replace(/\s/g, "").toUpperCase())
      .refine((v) => v === "" || /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(v), {
        error: "Numéro de TVA intracommunautaire invalide (ex. FR12345678901).",
      })
      .transform((v) => v || null),
    cavaliers: texteFacultatif(300, "Cavalier(s)"),
    notes: texteFacultatif(4000, "Notes internes"),
    envoi_auto: z.boolean({ error: "Envoi automatique : valeur invalide." }),
    arrhes_reglees: z.boolean({ error: "Arrhes réglées : valeur invalide." }),
    // Saisi en euros (« 450 », « 450,50 ») ; "" → null.
    arrhes_centimes: z.string().transform((v, ctx) => {
      if (v.trim() === "") return null;
      const centimes = parseEurosEnCentimes(v);
      if (centimes === null) {
        ctx.addIssue({ code: "custom", message: "Arrhes : montant invalide (ex. 450 ou 450,50)." });
        return z.NEVER;
      }
      if (centimes > 100_000_000) {
        ctx.addIssue({ code: "custom", message: "Arrhes : montant trop élevé." });
        return z.NEVER;
      }
      return centimes;
    }),
    arrhes_saison: z
      .string()
      .trim()
      .refine((v) => v === "" || (/^\d{4}$/.test(v) && Number(v) >= 2000 && Number(v) <= 2100), {
        error: "Arrhes : saison invalide.",
      })
      .transform((v) => (v === "" ? null : Number(v))),
  })
  .refine((c) => !c.arrhes_reglees || (c.arrhes_centimes ?? 0) > 0, {
    path: ["arrhes_centimes"],
    error: "Arrhes réglées : saisir leur montant.",
    when: (payload) =>
      !payload.issues.some((i) => ["arrhes_reglees", "arrhes_centimes"].includes(String(i.path?.[0]))),
  })
  .refine((c) => !c.arrhes_reglees || c.arrhes_saison !== null, {
    path: ["arrhes_saison"],
    error: "Arrhes réglées : choisir la saison.",
    when: (payload) =>
      !payload.issues.some((i) => ["arrhes_reglees", "arrhes_saison"].includes(String(i.path?.[0]))),
  })
  .refine((c) => c.type !== "professionnel" || Boolean(c.raison_sociale), {
    path: ["raison_sociale"],
    error: "La raison sociale est obligatoire pour un client professionnel.",
    // Vérifiée même si d'autres champs sont en erreur : toutes les erreurs s'affichent d'un coup.
    when: (payload) => !payload.issues.some((i) => i.path?.[0] === "type" || i.path?.[0] === "raison_sociale"),
  })
  .refine((c) => c.type !== "professionnel" || Boolean(c.adresse_ligne1 && c.code_postal && c.ville), {
    path: ["adresse_ligne1"],
    error: "Client professionnel : adresse complète obligatoire (rue, code postal et ville), imprimée sur ses factures.",
    when: (payload) =>
      !payload.issues.some((i) => ["type", "adresse_ligne1", "code_postal", "ville"].includes(String(i.path?.[0]))),
  })
  .transform((c) => {
    // Un particulier n'a ni raison sociale, ni SIRET, ni numéro de TVA.
    const client = c.type === "particulier" ? { ...c, raison_sociale: null, siret: null, numero_tva: null } : c;
    // Sans arrhes (ni réglées ni saisies), la saison n'a pas d'objet.
    return !client.arrhes_reglees && client.arrhes_centimes === null ? { ...client, arrhes_saison: null } : client;
  });

function lireFormulaireClient(formData: FormData) {
  const noms = [
    "academie_id", "type", "civilite", "nom", "prenom", "raison_sociale", "email", "emails_cc",
    "telephone", "adresse_ligne1", "adresse_ligne2", "code_postal", "ville", "pays", "siret",
    "numero_tva", "cavaliers", "notes", "arrhes_saison",
  ];
  return {
    ...Object.fromEntries(noms.map((n) => [n, champ(formData, n)])),
    envoi_auto: formData.get("envoi_auto") === "on",
    arrhes_reglees: formData.get("arrhes_reglees") === "on",
    arrhes_centimes: champ(formData, "arrhes_montant"),
  };
}

/** Création d'un client ; le formulaire ouvre ensuite sa fiche. */
export async function creerClient(
  _precedent: ResultatAction<{ id: string }> | null,
  formData: FormData,
): Promise<ResultatAction<{ id: string }>> {
  const { supabase } = await exigerUtilisateur();

  const lecture = schemaClient.safeParse(lireFormulaireClient(formData));
  if (!lecture.success) return { ok: false, erreur: messagesValidation(lecture.error) };

  let id: string;
  try {
    const { data, error } = await supabase.from("clients").insert(lecture.data).select("id").single();
    if (error) return { ok: false, erreur: traduireErreur(error, ACADEMIE_INTROUVABLE) };
    id = (data as { id: string }).id;
  } catch {
    return ERREUR_RESEAU;
  }

  revaliderClients();
  // La navigation vers la fiche est faite par le formulaire (router.push) : une redirection
  // lancée depuis l'action pouvait laisser le bouton en « Enregistrement… ».
  return { ok: true, message: "Client créé.", donnees: { id } };
}

/**
 * Enregistrement de la fiche. L'académie reste modifiable à tout moment : les brouillons
 * du client suivent la nouvelle académie, les factures émises gardent l'académie d'origine
 * (figée à l'émission).
 */
export async function modifierClient(_precedent: ResultatAction | null, formData: FormData): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const id = schemaId.safeParse(champ(formData, "id"));
  if (!id.success) return { ok: false, erreur: "Client introuvable." };
  const lecture = schemaClient.safeParse(lireFormulaireClient(formData));
  if (!lecture.success) return { ok: false, erreur: messagesValidation(lecture.error) };
  const academieId = lecture.data.academie_id;

  let nbBrouillons = 0;
  try {
    const avant = await supabase.from("clients").select("academie_id").eq("id", id.data).maybeSingle();
    if (avant.error) return { ok: false, erreur: traduireErreur(avant.error) };
    if (!avant.data) return { ok: false, erreur: "Client introuvable : il a peut-être été supprimé." };

    const { data, error } = await supabase.from("clients").update(lecture.data).eq("id", id.data).select("id");
    if (error) return { ok: false, erreur: traduireErreur(error, ACADEMIE_INTROUVABLE) };
    if (!data || data.length === 0) return { ok: false, erreur: "Client introuvable : il a peut-être été supprimé." };

    // Changement d'académie : la base rattache aussitôt les brouillons du client à la
    // nouvelle académie (trigger clients_academie_brouillons) ; on les compte pour le message.
    if (avant.data.academie_id !== academieId) {
      const brouillons = await supabase
        .from("factures")
        .select("id", { count: "exact", head: true })
        .eq("client_id", id.data)
        .eq("statut", "brouillon");
      nbBrouillons = brouillons.count ?? 0;
    }
  } catch {
    return ERREUR_RESEAU;
  }

  revaliderClients();
  return {
    ok: true,
    message:
      nbBrouillons === 0
        ? "Fiche client enregistrée."
        : `Fiche client enregistrée. ${nbBrouillons === 1 ? "1 brouillon a" : `${nbBrouillons} brouillons ont`} été rattaché${nbBrouillons > 1 ? "s" : ""} à la nouvelle académie.`,
  };
}

/** Archive (exclut de la facturation mensuelle) ou réactive un client. */
export async function changerArchivageClient(clientId: string, archiver: boolean): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const id = schemaId.safeParse(clientId);
  if (!id.success || typeof archiver !== "boolean") return { ok: false, erreur: "Requête invalide." };

  try {
    const { data, error } = await supabase
      .from("clients")
      .update({ actif: !archiver })
      .eq("id", id.data)
      .select("id");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return { ok: false, erreur: "Client introuvable." };
  } catch {
    return ERREUR_RESEAU;
  }

  revaliderClients();
  return {
    ok: true,
    message: archiver
      ? "Client archivé : plus de facture mensuelle."
      : "Client réactivé : il revient dans la facturation mensuelle.",
  };
}

/** Suppression définitive — uniquement pour un client sans aucune facture. */
export async function supprimerClient(clientId: string): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const id = schemaId.safeParse(clientId);
  if (!id.success) return { ok: false, erreur: "Client introuvable." };

  const refus = "Suppression impossible : ce client a des factures, à conserver. L'archiver plutôt.";
  try {
    const factures = await supabase
      .from("factures")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id.data);
    if (factures.error) return { ok: false, erreur: traduireErreur(factures.error) };
    if ((factures.count ?? 0) > 0) return { ok: false, erreur: refus };

    // Les tarifs du client sont supprimés en cascade ; les factures bloquent (on delete restrict).
    const { data, error } = await supabase.from("clients").delete().eq("id", id.data).select("id");
    if (error) return { ok: false, erreur: traduireErreur(error, refus) };
    if (!data || data.length === 0) return { ok: false, erreur: "Client introuvable : il a peut-être déjà été supprimé." };
  } catch {
    return ERREUR_RESEAU;
  }

  revaliderClients();
  redirect("/clients");
}

// -----------------------------------------------------------------------------
// Tarifs appliqués
// -----------------------------------------------------------------------------

const schemaTarif = z
  .object({
    client_id: schemaId,
    tarif_id: z.union([z.literal(""), schemaId]),
    mode: z.enum(["catalogue", "libre"], { error: "Choisir une prestation du catalogue ou une ligne libre." }),
    prestation_id: z.string().trim(),
    libelle: texteFacultatif(200, "Libellé"),
    description: texteFacultatif(1000, "Description"),
    prix: z.string().trim(),
    quantite: z.string().trim(),
    recurrent: z.boolean(),
    actif: z.boolean(),
    date_debut: dateFacultative("Date de début"),
    date_fin: dateFacultative("Date de fin"),
    motif_reduction: texteFacultatif(120, "Motif de la réduction"),
  })
  .transform((t, ctx) => {
    const erreur = (message: string) => ctx.addIssue({ code: "custom", message });

    let prix: number | null = null;
    if (t.prix !== "") {
      prix = parseEurosEnCentimes(t.prix);
      if (prix === null) erreur("Prix invalide : saisir un montant en euros (ex. 450 ou 450,50).");
      else if (prix > 1_000_000_000) erreur("Prix trop élevé.");
    }

    const quantite = parseQuantite(t.quantite);
    if (quantite === null) erreur("Quantité invalide : nombre positif, 2 décimales au plus (ex. 1 ou 2,5).");

    const prestationId = t.mode === "catalogue" ? t.prestation_id : "";
    if (t.mode === "catalogue" && !schemaId.safeParse(prestationId).success) {
      erreur("Choisir une prestation du catalogue.");
    }
    if (t.mode === "libre") {
      if (!t.libelle) erreur("Le libellé est obligatoire pour une ligne libre.");
      if (t.prix === "") erreur("Le prix est obligatoire pour une ligne libre.");
    }
    if (t.date_debut && t.date_fin && t.date_debut > t.date_fin) {
      erreur("La date de fin doit être postérieure ou égale à la date de début.");
    }

    return {
      client_id: t.client_id,
      tarif_id: t.tarif_id || null,
      ligne: {
        prestation_id: prestationId || null,
        libelle: t.libelle,
        description: t.description,
        prix_unitaire_centimes: prix,
        quantite: quantite ?? 1,
        recurrent: t.recurrent,
        actif: t.actif,
        date_debut: t.date_debut,
        date_fin: t.date_fin,
        // Motif : seulement pour un prix personnalisé d'une prestation du catalogue (comparé au
        // prix catalogue à l'enregistrement).
        motif_reduction: t.mode === "catalogue" && prix !== null ? t.motif_reduction : null,
      },
    };
  });

/** Ajout (tarif_id vide) ou modification d'une ligne de tarif d'un client. */
export async function enregistrerTarif(_precedent: ResultatAction | null, formData: FormData): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const lecture = schemaTarif.safeParse({
    client_id: champ(formData, "client_id"),
    tarif_id: champ(formData, "tarif_id"),
    mode: champ(formData, "mode"),
    prestation_id: champ(formData, "prestation_id"),
    libelle: champ(formData, "libelle"),
    description: champ(formData, "description"),
    prix: champ(formData, "prix"),
    quantite: champ(formData, "quantite"),
    recurrent: formData.get("recurrent") === "on",
    actif: formData.get("actif") === "on",
    date_debut: champ(formData, "date_debut"),
    date_fin: champ(formData, "date_fin"),
    motif_reduction: champ(formData, "motif_reduction"),
  });
  if (!lecture.success) return { ok: false, erreur: messagesValidation(lecture.error) };
  const { client_id, tarif_id, ligne } = lecture.data;

  try {
    // Un motif n'a de sens que pour un prix inférieur au catalogue : sinon, il est retiré.
    if (ligne.motif_reduction && ligne.prestation_id) {
      const catalogue = await supabase
        .from("prestations")
        .select("prix_unitaire_centimes")
        .eq("id", ligne.prestation_id)
        .maybeSingle();
      if (catalogue.error) return { ok: false, erreur: traduireErreur(catalogue.error) };
      const prixCatalogue = (catalogue.data as { prix_unitaire_centimes: number } | null)?.prix_unitaire_centimes;
      if (prixCatalogue == null || ligne.prix_unitaire_centimes == null || ligne.prix_unitaire_centimes >= prixCatalogue) {
        ligne.motif_reduction = null;
      }
    }

    if (tarif_id) {
      const { data, error } = await supabase
        .from("tarifs_clients")
        .update(ligne)
        .eq("id", tarif_id)
        .eq("client_id", client_id)
        .select("id");
      if (error) return { ok: false, erreur: traduireErreur(error, "Cette prestation n'existe plus dans le catalogue.") };
      if (!data || data.length === 0) return { ok: false, erreur: "Ligne de tarif introuvable : elle a peut-être été supprimée." };
    } else {
      // Nouvelle ligne placée en dernier.
      const dernier = await supabase
        .from("tarifs_clients")
        .select("ordre")
        .eq("client_id", client_id)
        .order("ordre", { ascending: false })
        .limit(1);
      if (dernier.error) return { ok: false, erreur: traduireErreur(dernier.error) };
      const ordre = ((dernier.data as { ordre: number }[])[0]?.ordre ?? 0) + 1;

      const { error } = await supabase.from("tarifs_clients").insert({ ...ligne, client_id, ordre });
      if (error) {
        return {
          ok: false,
          erreur: traduireErreur(error, "Client ou prestation introuvable : actualiser la page et réessayer."),
        };
      }
    }
  } catch {
    return ERREUR_RESEAU;
  }

  revaliderClients();
  return { ok: true, message: tarif_id ? "Ligne de tarif modifiée." : "Ligne de tarif ajoutée." };
}

/** Suppression d'une ligne de tarif (les factures déjà créées ne sont pas touchées). */
export async function supprimerTarif(tarifId: string): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const id = schemaId.safeParse(tarifId);
  if (!id.success) return { ok: false, erreur: "Ligne de tarif introuvable." };

  try {
    const { data, error } = await supabase.from("tarifs_clients").delete().eq("id", id.data).select("id");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return { ok: false, erreur: "Ligne de tarif introuvable : elle a peut-être déjà été supprimée." };
  } catch {
    return ERREUR_RESEAU;
  }

  revaliderClients();
  return { ok: true, message: "Ligne de tarif supprimée." };
}

/** Monte ou descend une ligne : l'ordre des tarifs est celui des lignes de la facture mensuelle. */
export async function deplacerTarif(tarifId: string, sens: "haut" | "bas"): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const id = schemaId.safeParse(tarifId);
  if (!id.success || (sens !== "haut" && sens !== "bas")) return { ok: false, erreur: "Requête invalide." };

  try {
    const cible = await supabase.from("tarifs_clients").select("client_id").eq("id", id.data).maybeSingle();
    if (cible.error) return { ok: false, erreur: traduireErreur(cible.error) };
    if (!cible.data) return { ok: false, erreur: "Ligne de tarif introuvable." };

    const lignes = await supabase
      .from("tarifs_clients")
      .select("id, ordre")
      .eq("client_id", (cible.data as { client_id: string }).client_id)
      .order("ordre")
      .order("created_at");
    if (lignes.error) return { ok: false, erreur: traduireErreur(lignes.error) };

    const ordre = (lignes.data as { id: string; ordre: number }[]).map((l) => l.id);
    const position = ordre.indexOf(id.data);
    const voisine = sens === "haut" ? position - 1 : position + 1;
    if (position < 0 || voisine < 0 || voisine >= ordre.length) return { ok: true };
    [ordre[position], ordre[voisine]] = [ordre[voisine], ordre[position]];

    // Renumérotation 1..n (corrige aussi les ordres en double) : seules les lignes changées sont écrites.
    const avant = new Map((lignes.data as { id: string; ordre: number }[]).map((l) => [l.id, l.ordre]));
    for (const [index, ligneId] of ordre.entries()) {
      if (avant.get(ligneId) === index + 1) continue;
      const { error } = await supabase.from("tarifs_clients").update({ ordre: index + 1 }).eq("id", ligneId);
      if (error) return { ok: false, erreur: traduireErreur(error) };
    }
  } catch {
    return ERREUR_RESEAU;
  }

  revaliderClients();
  return { ok: true };
}
