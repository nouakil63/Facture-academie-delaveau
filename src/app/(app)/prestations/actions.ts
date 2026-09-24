"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigerUtilisateur } from "@/lib/auth";
import { parseEurosEnCentimes } from "@/lib/format";
import type { ClientSupabase } from "@/lib/supabase/server";
import type { ResultatAction } from "@/lib/types";
import { estUnitePredefinie, LONGUEUR_MAX_UNITE, pluriel, UNITE_AUTRE } from "@/components/prestations/unites";

/*
 * Server Actions du catalogue de prestations : création, modification,
 * archivage et suppression. Toutes valident leurs entrées (zod), vérifient la
 * session et renvoient un ResultatAction (jamais d'exception vers le navigateur).
 */

// -----------------------------------------------------------------------------
// Outils internes (non exportés : un fichier "use server" n'exporte que des actions)
// -----------------------------------------------------------------------------

type ErreurSupabase = { code?: string; message: string; details?: string | null };

const ERREUR_RESEAU: ResultatAction = {
  ok: false,
  erreur: "Impossible de joindre la base de données. Vérifiez la connexion et réessayez.",
};

const PRIX_MAX_CENTIMES = 100_000_000; // 1 000 000 €

/** Traduit une erreur Postgres / PostgREST en message compréhensible. */
function traduireErreur(erreur: ErreurSupabase, siCleEtrangere?: string): string {
  const texte = `${erreur.message} ${erreur.details ?? ""}`;
  switch (erreur.code) {
    case "23503":
      return siCleEtrangere ?? "Opération impossible : cette prestation est liée à d'autres données.";
    case "23514":
      if (texte.includes("libelle")) return "Le libellé est obligatoire.";
      if (texte.includes("prix_unitaire")) return "Le prix ne peut pas être négatif.";
      return "Les données saisies ne respectent pas les règles de la base.";
    case "23502":
      return "Un champ obligatoire est manquant.";
    case "22003":
      return "Une valeur numérique est trop grande.";
    case "22P02":
      return "Une valeur saisie n'a pas le bon format.";
    case "42501":
      return "Accès refusé : votre compte n'est pas autorisé à modifier le catalogue.";
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

/** Le catalogue apparaît aussi sur les fiches clients, le tableau de bord et la facturation. */
function revaliderCatalogue() {
  revalidatePath("/", "layout");
}

/** Nombre de lignes de tarif client (actives ou non) et de clients distincts qui utilisent la prestation. */
async function utilisations(
  supabase: ClientSupabase,
  prestationId: string,
): Promise<{ ok: true; lignes: number; clients: number } | { ok: false; erreur: string }> {
  const { data, error } = await supabase.from("tarifs_clients").select("client_id").eq("prestation_id", prestationId);
  if (error) return { ok: false, erreur: traduireErreur(error) };
  const lignes = (data ?? []) as { client_id: string }[];
  return { ok: true, lignes: lignes.length, clients: new Set(lignes.map((l) => l.client_id)).size };
}

const schemaId = z.uuid({ error: "Prestation introuvable." });

/** Texte facultatif : espaces retirés, "" → null. */
const texteFacultatif = (max: number, libelle: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${libelle} : ${max} caractères au maximum.` })
    .transform((v) => (v === "" ? null : v));

const schemaPrestation = z
  .object({
    id: z.union([z.literal(""), z.uuid({ error: "Prestation introuvable." })]),
    entite_id: z.uuid({ error: "Choisissez l'entité (Académie Delaveau ou Académie Espoir)." }),
    libelle: z
      .string()
      .trim()
      .min(1, { error: "Le libellé est obligatoire." })
      .max(200, { error: "Libellé : 200 caractères au maximum." }),
    description: texteFacultatif(1000, "Description"),
    prix: z.string().trim(),
    unite: z.string().trim(),
    unite_autre: z.string().trim(),
    recurrente: z.boolean(),
    actif: z.boolean(),
    ordre: z.string().trim(),
  })
  .transform((p, ctx) => {
    const erreur = (message: string) => ctx.addIssue({ code: "custom", message });

    let prix = 0;
    if (p.prix === "") {
      erreur("Le prix est obligatoire (0 pour une prestation gratuite).");
    } else {
      const centimes = parseEurosEnCentimes(p.prix);
      if (centimes === null) erreur("Prix invalide : saisissez un montant en euros (ex. 450 ou 450,50).");
      else if (centimes > PRIX_MAX_CENTIMES) erreur("Prix trop élevé (1 000 000 € au maximum).");
      else prix = centimes;
    }

    let unite = p.unite;
    if (p.unite === UNITE_AUTRE) {
      unite = p.unite_autre.replace(/^\/\s*/, "").toLowerCase();
      if (unite === "") erreur("Précisez l'unité (ex. stage, semaine, concours).");
      else if (unite.length > LONGUEUR_MAX_UNITE) erreur(`Unité : ${LONGUEUR_MAX_UNITE} caractères au maximum.`);
    } else if (!estUnitePredefinie(p.unite)) {
      erreur("Choisissez une unité dans la liste.");
    }

    let ordre: number | null = null;
    if (p.ordre !== "") {
      if (!/^\d{1,4}$/.test(p.ordre)) erreur("Ordre d'affichage : nombre entier entre 0 et 9999.");
      else ordre = Number(p.ordre);
    }

    return {
      id: p.id || null,
      ordre,
      ligne: {
        entite_id: p.entite_id,
        libelle: p.libelle,
        description: p.description,
        prix_unitaire_centimes: prix,
        unite,
        recurrente: p.recurrente,
        actif: p.actif,
      },
    };
  });

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

/** Création (id vide) ou modification d'une prestation du catalogue. */
export async function enregistrerPrestation(
  _precedent: ResultatAction | null,
  formData: FormData,
): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const lecture = schemaPrestation.safeParse({
    id: champ(formData, "id"),
    entite_id: champ(formData, "entite_id"),
    libelle: champ(formData, "libelle"),
    description: champ(formData, "description"),
    prix: champ(formData, "prix"),
    unite: champ(formData, "unite"),
    unite_autre: champ(formData, "unite_autre"),
    recurrente: formData.get("recurrente") === "on",
    actif: formData.get("actif") === "on",
    ordre: champ(formData, "ordre"),
  });
  if (!lecture.success) return { ok: false, erreur: messagesValidation(lecture.error) };
  const { id, ordre, ligne } = lecture.data;

  try {
    if (id) {
      const actuelle = await supabase.from("prestations").select("entite_id").eq("id", id).maybeSingle();
      if (actuelle.error) return { ok: false, erreur: traduireErreur(actuelle.error) };
      if (!actuelle.data) return { ok: false, erreur: "Prestation introuvable : elle a peut-être été supprimée." };

      // Changer d'entité romprait le lien avec les clients (une prestation doit être de l'entité du client).
      if ((actuelle.data as { entite_id: string }).entite_id !== ligne.entite_id) {
        const u = await utilisations(supabase, id);
        if (!u.ok) return u;
        if (u.lignes > 0) {
          return {
            ok: false,
            erreur: `L'entité ne peut plus être changée : cette prestation figure dans les tarifs de ${pluriel(u.clients, "client")}. Créez plutôt une nouvelle prestation dans l'autre entité.`,
          };
        }
      }

      const { data, error } = await supabase
        .from("prestations")
        .update(ordre === null ? ligne : { ...ligne, ordre })
        .eq("id", id)
        .select("id");
      if (error) return { ok: false, erreur: traduireErreur(error, "L'entité choisie n'existe pas.") };
      if (!data || data.length === 0) {
        return { ok: false, erreur: "Prestation introuvable : elle a peut-être été supprimée." };
      }
    } else {
      let position = ordre;
      if (position === null) {
        // Nouvelle prestation placée en fin de catalogue de son entité.
        const dernier = await supabase
          .from("prestations")
          .select("ordre")
          .eq("entite_id", ligne.entite_id)
          .order("ordre", { ascending: false })
          .limit(1);
        if (dernier.error) return { ok: false, erreur: traduireErreur(dernier.error) };
        position = Math.min(((dernier.data as { ordre: number }[])[0]?.ordre ?? 0) + 1, 9999);
      }
      const { error } = await supabase.from("prestations").insert({ ...ligne, ordre: position });
      if (error) return { ok: false, erreur: traduireErreur(error, "L'entité choisie n'existe pas.") };
    }
  } catch {
    return ERREUR_RESEAU;
  }

  revaliderCatalogue();
  return {
    ok: true,
    message: id ? `Prestation « ${ligne.libelle} » enregistrée.` : `Prestation « ${ligne.libelle} » ajoutée au catalogue.`,
  };
}

/** Archive (retire du catalogue proposé) ou réactive une prestation. */
export async function changerArchivagePrestation(prestationId: string, archiver: boolean): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const id = schemaId.safeParse(prestationId);
  if (!id.success || typeof archiver !== "boolean") return { ok: false, erreur: "Requête invalide." };

  try {
    const { data, error } = await supabase
      .from("prestations")
      .update({ actif: !archiver })
      .eq("id", id.data)
      .select("libelle");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return { ok: false, erreur: "Prestation introuvable." };
    const libelle = (data as { libelle: string }[])[0].libelle;

    revaliderCatalogue();
    return {
      ok: true,
      message: archiver
        ? `« ${libelle} » est archivée : elle n'est plus proposée pour de nouveaux tarifs.`
        : `« ${libelle} » est de nouveau proposée dans le catalogue.`,
    };
  } catch {
    return ERREUR_RESEAU;
  }
}

/** Suppression définitive — refusée si la prestation figure dans un tarif client (on propose l'archivage). */
export async function supprimerPrestation(prestationId: string): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const id = schemaId.safeParse(prestationId);
  if (!id.success) return { ok: false, erreur: "Prestation introuvable." };

  const refus = (clients: number | null) =>
    `Cette prestation ne peut pas être supprimée : elle figure dans les tarifs ${
      clients ? `de ${pluriel(clients, "client")}` : "de clients"
    }. Archivez-la plutôt : elle ne sera plus proposée pour de nouveaux tarifs, et les tarifs existants resteront inchangés.`;

  try {
    const u = await utilisations(supabase, id.data);
    if (!u.ok) return u;
    if (u.lignes > 0) return { ok: false, erreur: refus(u.clients) };

    // Les lignes des factures déjà créées conservent leur libellé et leur prix (on delete set null).
    const { data, error } = await supabase.from("prestations").delete().eq("id", id.data).select("libelle");
    if (error) return { ok: false, erreur: traduireErreur(error, refus(null)) };
    if (!data || data.length === 0) {
      return { ok: false, erreur: "Prestation introuvable : elle a peut-être déjà été supprimée." };
    }

    revaliderCatalogue();
    return { ok: true, message: `Prestation « ${(data as { libelle: string }[])[0].libelle} » supprimée.` };
  } catch {
    return ERREUR_RESEAU;
  }
}
