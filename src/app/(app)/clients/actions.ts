"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { exigerUtilisateur } from "@/lib/auth";
import { parseEurosEnCentimes } from "@/lib/format";
import type { ResultatAction } from "@/lib/types";
import { parseQuantite } from "@/components/clients/tarifs";

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
  erreur: "Impossible de joindre la base de données. Vérifiez la connexion et réessayez.",
};

/** Traduit une erreur Postgres / PostgREST en message compréhensible. */
function traduireErreur(erreur: ErreurSupabase, siCleEtrangere?: string): string {
  const texte = `${erreur.message} ${erreur.details ?? ""}`;
  switch (erreur.code) {
    case "23503":
      return siCleEtrangere ?? "Opération impossible : cet élément est lié à d'autres données.";
    case "23514":
      if (texte.includes("clients_pro_raison_sociale"))
        return "La raison sociale est obligatoire pour un client professionnel.";
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
      return "Accès refusé : votre compte n'est pas autorisé à modifier ces données.";
    case "P0001":
      // Exceptions levées par les triggers : messages métier déjà rédigés en français.
      if (texte.includes("n'appartient pas à l'entité du client"))
        return "Cette prestation appartient au catalogue d'une autre entité que celle du client.";
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

/** Invalide tout l'arbre : noms de clients et tarifs apparaissent aussi dans factures et tableau de bord. */
function revaliderClients() {
  revalidatePath("/", "layout");
}

const schemaId = z.uuid({ error: "Identifiant invalide." });

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
    entite_id: z.uuid({ error: "Choisissez l'entité (Académie Delaveau ou Académie Espoir)." }),
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
  })
  .superRefine((c, ctx) => {
    if (c.type === "professionnel" && !c.raison_sociale) {
      ctx.addIssue({
        code: "custom",
        path: ["raison_sociale"],
        message: "La raison sociale est obligatoire pour un client professionnel.",
      });
    }
  })
  .transform((c) =>
    // Un particulier n'a ni raison sociale, ni SIRET, ni numéro de TVA.
    c.type === "particulier" ? { ...c, raison_sociale: null, siret: null, numero_tva: null } : c,
  );

function lireFormulaireClient(formData: FormData) {
  const noms = [
    "entite_id", "type", "civilite", "nom", "prenom", "raison_sociale", "email", "emails_cc",
    "telephone", "adresse_ligne1", "adresse_ligne2", "code_postal", "ville", "pays", "siret",
    "numero_tva", "cavaliers", "notes",
  ];
  return Object.fromEntries(noms.map((n) => [n, champ(formData, n)]));
}

/** Création d'un client, puis redirection vers sa fiche. */
export async function creerClient(_precedent: ResultatAction | null, formData: FormData): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const lecture = schemaClient.safeParse(lireFormulaireClient(formData));
  if (!lecture.success) return { ok: false, erreur: messagesValidation(lecture.error) };

  let id: string;
  try {
    const { data, error } = await supabase.from("clients").insert(lecture.data).select("id").single();
    if (error) return { ok: false, erreur: traduireErreur(error, "L'entité choisie n'existe pas.") };
    id = (data as { id: string }).id;
  } catch {
    return ERREUR_RESEAU;
  }

  revaliderClients();
  redirect(`/clients/${id}`);
}

/** Enregistrement de la fiche. L'entité n'est modifiable que sans facture ni tarif du catalogue. */
export async function modifierClient(_precedent: ResultatAction | null, formData: FormData): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const id = schemaId.safeParse(champ(formData, "id"));
  if (!id.success) return { ok: false, erreur: "Client introuvable." };
  const lecture = schemaClient.safeParse(lireFormulaireClient(formData));
  if (!lecture.success) return { ok: false, erreur: messagesValidation(lecture.error) };

  try {
    const actuel = await supabase.from("clients").select("id, entite_id").eq("id", id.data).maybeSingle();
    if (actuel.error) return { ok: false, erreur: traduireErreur(actuel.error) };
    if (!actuel.data) return { ok: false, erreur: "Client introuvable : il a peut-être été supprimé." };

    if ((actuel.data as { entite_id: string }).entite_id !== lecture.data.entite_id) {
      const [factures, tarifs] = await Promise.all([
        supabase.from("factures").select("id", { count: "exact", head: true }).eq("client_id", id.data),
        supabase
          .from("tarifs_clients")
          .select("id", { count: "exact", head: true })
          .eq("client_id", id.data)
          .not("prestation_id", "is", null),
      ]);
      if (factures.error) return { ok: false, erreur: traduireErreur(factures.error) };
      if (tarifs.error) return { ok: false, erreur: traduireErreur(tarifs.error) };
      if ((factures.count ?? 0) > 0 || (tarifs.count ?? 0) > 0) {
        return {
          ok: false,
          erreur:
            "L'entité ne peut plus être changée : ce client a déjà des factures ou des tarifs liés au catalogue de son entité.",
        };
      }
    }

    const { data, error } = await supabase.from("clients").update(lecture.data).eq("id", id.data).select("id");
    if (error) return { ok: false, erreur: traduireErreur(error, "L'entité choisie n'existe pas.") };
    if (!data || data.length === 0) return { ok: false, erreur: "Client introuvable : il a peut-être été supprimé." };
  } catch {
    return ERREUR_RESEAU;
  }

  revaliderClients();
  return { ok: true, message: "Fiche client enregistrée." };
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
      ? "Client archivé : il n'est plus inclus dans la facturation mensuelle."
      : "Client réactivé : il sera de nouveau inclus dans la facturation mensuelle.",
  };
}

/** Suppression définitive — uniquement pour un client sans aucune facture. */
export async function supprimerClient(clientId: string): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const id = schemaId.safeParse(clientId);
  if (!id.success) return { ok: false, erreur: "Client introuvable." };

  const refus = "Ce client a des factures : il ne peut pas être supprimé (conservation obligatoire). Archivez-le plutôt.";
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
    mode: z.enum(["catalogue", "libre"], { error: "Choisissez une prestation du catalogue ou une ligne libre." }),
    prestation_id: z.string().trim(),
    libelle: texteFacultatif(200, "Libellé"),
    description: texteFacultatif(1000, "Description"),
    prix: z.string().trim(),
    quantite: z.string().trim(),
    recurrent: z.boolean(),
    actif: z.boolean(),
    date_debut: dateFacultative("Date de début"),
    date_fin: dateFacultative("Date de fin"),
  })
  .transform((t, ctx) => {
    const erreur = (message: string) => ctx.addIssue({ code: "custom", message });

    let prix: number | null = null;
    if (t.prix !== "") {
      prix = parseEurosEnCentimes(t.prix);
      if (prix === null) erreur("Prix invalide : saisissez un montant en euros (ex. 450 ou 450,50).");
      else if (prix > 1_000_000_000) erreur("Prix trop élevé.");
    }

    const quantite = parseQuantite(t.quantite);
    if (quantite === null) erreur("Quantité invalide : nombre positif, 2 décimales au plus (ex. 1 ou 2,5).");

    const prestationId = t.mode === "catalogue" ? t.prestation_id : "";
    if (t.mode === "catalogue" && !schemaId.safeParse(prestationId).success) {
      erreur("Choisissez une prestation du catalogue.");
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
  });
  if (!lecture.success) return { ok: false, erreur: messagesValidation(lecture.error) };
  const { client_id, tarif_id, ligne } = lecture.data;

  try {
    if (tarif_id) {
      const { data, error } = await supabase
        .from("tarifs_clients")
        .update(ligne)
        .eq("id", tarif_id)
        .eq("client_id", client_id)
        .select("id");
      if (error) return { ok: false, erreur: traduireErreur(error, "La prestation choisie n'existe plus dans le catalogue.") };
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
          erreur: traduireErreur(error, "Client ou prestation introuvable : actualisez la page et réessayez."),
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
