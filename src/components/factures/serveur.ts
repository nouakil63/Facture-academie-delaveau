import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { emailConfigure } from "@/lib/email";
import { envoyerFactures } from "@/lib/facturation/envoi";
import { destinatairesFacture } from "@/lib/facturation/service";
import { parseEurosEnCentimes } from "@/lib/format";
import type { ClientSupabase } from "@/lib/supabase/server";
import type { Client, Entite, FactureVue, ResultatAction } from "@/lib/types";
import {
  MAX_TOTAL_LIGNE_CENTIMES,
  moisVersPeriode,
  nomClientFacture,
  parseQuantite,
  totalLigneCentimes,
  type ResultatEnvoiFacture,
} from "./outils";

/*
 * Outils serveur du module Factures, partagés par les Server Actions de
 * /factures, /factures/[id] et /facturation-mensuelle. (Un fichier "use server"
 * ne peut exporter que des actions : les utilitaires vivent ici.)
 */

// -----------------------------------------------------------------------------
// Erreurs
// -----------------------------------------------------------------------------

type ErreurSupabase = { code?: string; message: string; details?: string | null; hint?: string | null };

export const MESSAGE_RESEAU = "Impossible de joindre la base de données. Vérifiez la connexion et réessayez.";

/** Traduit une erreur Postgres / PostgREST en message clair pour l'utilisateur. */
export function traduireErreur(erreur: ErreurSupabase, siCleEtrangere?: string): string {
  const texte = `${erreur.message} ${erreur.details ?? ""}`;
  if (/fetch failed|Failed to fetch|ECONNREFUSED|ENOTFOUND|network/i.test(erreur.message) && !erreur.code) {
    return MESSAGE_RESEAU;
  }
  switch (erreur.code) {
    case "23503":
      return siCleEtrangere ?? "Opération impossible : cet élément est lié à d'autres données.";
    case "23505":
      if (texte.includes("factures_mensuelle_unique"))
        return "Une facture mensuelle existe déjà pour ce client et ce mois.";
      return "Cet élément existe déjà.";
    case "23514":
      if (texte.includes("quantite")) return "La quantité doit être supérieure à zéro.";
      if (texte.includes("prix_unitaire")) return "Le prix ne peut pas être négatif.";
      if (texte.includes("libelle")) return "Le libellé de la ligne est obligatoire.";
      if (texte.includes("periode")) return "La période doit correspondre au premier jour d'un mois.";
      return "Les données saisies ne respectent pas les règles de la base.";
    case "22003":
      return "Un montant ou une quantité est trop élevé.";
    case "22P02":
    case "22007":
    case "22008":
      return "Une valeur saisie n'a pas le bon format.";
    case "42501":
      return "Accès refusé : votre compte n'est pas autorisé à modifier ces données.";
    case "PGRST116":
      return "Facture introuvable : elle a peut-être été supprimée.";
    case "PGRST301":
    case "PGRST303":
      return "Votre session a expiré : reconnectez-vous.";
    case "P0001":
      // Exceptions levées par les triggers et fonctions SQL : messages déjà rédigés en français.
      return traduireMessageMetier(erreur.message);
    default:
      return `Erreur de la base de données : ${erreur.message}`;
  }
}

/** Précise les messages métier de la base quand un conseil d'action est utile. */
function traduireMessageMetier(message: string): string {
  if (message.includes("ne contient aucune ligne"))
    return "La facture ne contient aucune ligne : ajoutez au moins une ligne avant de l'émettre.";
  if (message.includes("ne peut pas être supprimée"))
    return `${message} Une facture émise reste dans la numérotation : utilisez « Annuler la facture ».`;
  if (message.includes("contenu ne peut plus être modifié") || message.includes("ne peuvent pas être modifiées"))
    return "Cette facture est émise : son contenu ne peut plus être modifié. Dupliquez-la en brouillon pour la corriger.";
  if (message.includes("Transition de statut interdite"))
    return "Cette opération n'est pas possible dans le statut actuel de la facture. Rechargez la page.";
  return message;
}

/** Message d'une exception inattendue (service, envoi…), sans jamais la relancer. */
export function messageException(e: unknown, prefixe = "Opération impossible"): string {
  const message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!message) return `${prefixe} : erreur inconnue.`;
  if (/fetch failed|Failed to fetch|ECONNREFUSED|ENOTFOUND/i.test(message)) return MESSAGE_RESEAU;
  return traduireMessageMetier(message);
}

/** Messages de validation zod, dédoublonnés, un par ligne. */
export function messagesValidation(erreur: z.ZodError): string {
  return [...new Set(erreur.issues.map((i) => i.message))].join("\n");
}

/** Valeur texte d'un champ de formulaire ("" si absent). */
export function champ(formData: FormData, nom: string): string {
  const valeur = formData.get(nom);
  return typeof valeur === "string" ? valeur : "";
}

/** Factures, clients et tableau de bord affichent tous des factures : on invalide tout l'arbre. */
export function revaliderFactures() {
  revalidatePath("/", "layout");
}

// -----------------------------------------------------------------------------
// Schémas de validation
// -----------------------------------------------------------------------------

export const schemaId = z.guid({ error: "Identifiant invalide." });

/** Texte facultatif : espaces retirés, "" → null. */
export const texteFacultatif = (max: number, libelle: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${libelle} : ${max} caractères au maximum.` })
    .transform((v) => (v === "" ? null : v));

/** Mois facultatif d'un <input type="month"> ("AAAA-MM") → "AAAA-MM-01" ou null. */
export const schemaPeriode = z
  .string()
  .trim()
  .refine((v) => v === "" || moisVersPeriode(v) !== null, { error: "Période : mois invalide." })
  .transform((v) => (v === "" ? null : moisVersPeriode(v)));

/** Mois obligatoire ("AAAA-MM") → "AAAA-MM-01". */
export const schemaMoisObligatoire = z
  .string()
  .trim()
  .refine((v) => moisVersPeriode(v) !== null, { error: "Choisissez un mois valide." })
  .transform((v) => moisVersPeriode(v) as string);

/** Ligne saisie (montants en texte) → valeurs prêtes pour `lignes_facture`. */
export const schemaLigne = z
  .object({
    prestation_id: z
      .string()
      .trim()
      .nullish()
      .transform((v) => (v ? v : null))
      .pipe(z.guid({ error: "Prestation invalide." }).nullable()),
    libelle: z
      .string()
      .trim()
      .min(1, { error: "Chaque ligne doit avoir un libellé." })
      .max(200, { error: "Libellé : 200 caractères au maximum." }),
    description: z
      .string()
      .nullish()
      .transform((v) => (v ?? "").trim())
      .pipe(z.string().max(1000, { error: "Description : 1 000 caractères au maximum." }))
      .transform((v) => (v === "" ? null : v)),
    quantite: z
      .union([z.string(), z.number()])
      .transform((v, ctx) => {
        const q = parseQuantite(String(v));
        if (q == null) {
          ctx.addIssue({ code: "custom", message: "Quantité invalide : nombre positif, 2 décimales au maximum (ex. 1 ou 2,5)." });
          return z.NEVER;
        }
        return q;
      }),
    prix: z.union([z.string(), z.number()]).transform((v, ctx) => {
      const centimes = typeof v === "number" ? v : parseEurosEnCentimes(v);
      if (centimes == null || !Number.isInteger(centimes) || centimes < 0) {
        ctx.addIssue({ code: "custom", message: "Prix unitaire invalide : montant positif en euros (ex. 450 ou 450,50)." });
        return z.NEVER;
      }
      return centimes;
    }),
  })
  .superRefine((l, ctx) => {
    if (totalLigneCentimes(l.quantite, l.prix) > MAX_TOTAL_LIGNE_CENTIMES) {
      ctx.addIssue({ code: "custom", message: `Ligne « ${l.libelle} » : montant trop élevé.` });
    }
  });

export type LigneValidee = z.output<typeof schemaLigne>;

// -----------------------------------------------------------------------------
// Création d'un brouillon (nouvelle facture, duplication)
// -----------------------------------------------------------------------------

/**
 * Crée un brouillon et ses lignes pour un client.
 * - entité = celle DU CLIENT, taux de TVA = celui de l'entité ;
 * - une prestation qui n'appartient pas au catalogue de cette entité est détachée
 *   (la ligne garde son libellé et son prix) ;
 * - si l'insertion des lignes échoue, le brouillon créé est supprimé.
 */
export async function creerBrouillon(
  supabase: ClientSupabase,
  saisie: {
    clientId: string;
    objet: string | null;
    periode: string | null;
    notes: string | null;
    lignes: LigneValidee[];
  },
): Promise<ResultatAction<{ id: string }>> {
  const resClient = await supabase.from("clients").select("id, entite_id").eq("id", saisie.clientId).maybeSingle();
  if (resClient.error) return { ok: false, erreur: traduireErreur(resClient.error) };
  if (!resClient.data) return { ok: false, erreur: "Client introuvable : il a peut-être été supprimé." };
  const client = resClient.data as Pick<Client, "id" | "entite_id">;

  const resEntite = await supabase.from("entites").select("id, taux_tva").eq("id", client.entite_id).maybeSingle();
  if (resEntite.error) return { ok: false, erreur: traduireErreur(resEntite.error) };
  if (!resEntite.data) return { ok: false, erreur: "L'entité du client est introuvable." };
  const entite = resEntite.data as Pick<Entite, "id" | "taux_tva">;

  // Prestations référencées : uniquement celles du catalogue de l'entité du client.
  const idsPrestations = [...new Set(saisie.lignes.map((l) => l.prestation_id).filter((id): id is string => !!id))];
  let prestationsValides = new Set<string>();
  if (idsPrestations.length > 0) {
    const resPrestations = await supabase
      .from("prestations")
      .select("id")
      .eq("entite_id", client.entite_id)
      .in("id", idsPrestations);
    if (resPrestations.error) return { ok: false, erreur: traduireErreur(resPrestations.error) };
    prestationsValides = new Set((resPrestations.data as { id: string }[]).map((p) => p.id));
  }

  const resFacture = await supabase
    .from("factures")
    .insert({
      entite_id: client.entite_id,
      client_id: client.id,
      statut: "brouillon",
      objet: saisie.objet,
      periode: saisie.periode,
      notes: saisie.notes,
      taux_tva: Number(entite.taux_tva),
      generation_auto: false,
    })
    .select("id")
    .single();
  if (resFacture.error) {
    return { ok: false, erreur: traduireErreur(resFacture.error, "Le client ou l'entité n'existe plus.") };
  }
  const factureId = (resFacture.data as { id: string }).id;

  if (saisie.lignes.length > 0) {
    // total_centimes est une colonne générée : ne jamais l'insérer.
    const resLignes = await supabase.from("lignes_facture").insert(
      saisie.lignes.map((l, i) => ({
        facture_id: factureId,
        ordre: i + 1,
        libelle: l.libelle,
        description: l.description,
        quantite: l.quantite,
        prix_unitaire_centimes: l.prix,
        prestation_id: l.prestation_id && prestationsValides.has(l.prestation_id) ? l.prestation_id : null,
      })),
    );
    if (resLignes.error) {
      const nettoyage = await supabase.from("factures").delete().eq("id", factureId).eq("statut", "brouillon");
      if (nettoyage.error) console.error("Suppression du brouillon incomplet impossible :", nettoyage.error.message);
      return { ok: false, erreur: `Les lignes n'ont pas pu être enregistrées : ${traduireErreur(resLignes.error)}` };
    }
  }

  return { ok: true, donnees: { id: factureId } };
}

// -----------------------------------------------------------------------------
// Envoi d'un lot de factures (liste, facturation mensuelle)
// -----------------------------------------------------------------------------

type FactureLot = Pick<
  FactureVue,
  "id" | "statut" | "numero" | "client_id" | "client_type" | "client_nom" | "client_prenom" | "client_raison_sociale"
>;

/**
 * Émet (si besoin) et envoie par e-mail un lot de factures, dans l'ordre donné.
 * - factures annulées : ignorées ;
 * - brouillons sans aucune adresse e-mail sur la fiche client : ignorés (ils ne sont PAS émis,
 *   pour ne pas attribuer de numéro à une facture qui ne pourrait pas partir) ;
 * - `filtre` permet de restreindre le lot (ex. brouillons mensuels d'une entité et d'un mois).
 * Renvoie un résultat par facture demandée, avec le numéro final.
 */
export async function envoyerLot(
  supabase: ClientSupabase,
  ids: string[],
  filtre?: (f: FactureLot) => string | null,
): Promise<ResultatAction<ResultatEnvoiFacture[]>> {
  if (!emailConfigure()) {
    return { ok: false, erreur: "L'envoi d'e-mails n'est pas configuré (serveur SMTP) : voir les Paramètres." };
  }
  const resFactures = await supabase
    .from("factures_vue")
    .select("id, statut, numero, client_id, client_type, client_nom, client_prenom, client_raison_sociale")
    .in("id", ids);
  if (resFactures.error) return { ok: false, erreur: traduireErreur(resFactures.error) };
  const factures = new Map((resFactures.data as FactureLot[]).map((f) => [f.id, f]));

  // Destinataires des brouillons : la fiche client actuelle (les factures émises utilisent leur copie figée).
  const idsClientsBrouillons = [
    ...new Set([...factures.values()].filter((f) => f.statut === "brouillon").map((f) => f.client_id)),
  ];
  const destinataires = new Map<string, string[]>();
  if (idsClientsBrouillons.length > 0) {
    const resClients = await supabase.from("clients").select("id, email, emails_cc").in("id", idsClientsBrouillons);
    if (resClients.error) return { ok: false, erreur: traduireErreur(resClients.error) };
    for (const c of resClients.data as Pick<Client, "id" | "email" | "emails_cc">[]) {
      destinataires.set(c.id, destinatairesFacture(c));
    }
  }

  const resultats = new Map<string, ResultatEnvoiFacture>();
  const aEnvoyer: string[] = [];
  for (const id of ids) {
    const f = factures.get(id);
    if (!f) {
      resultats.set(id, { id, numero: null, client: "—", ok: false, ignoree: true, erreur: "Facture introuvable." });
      continue;
    }
    const base = { id, numero: f.numero, client: nomClientFacture(f) };
    const refus =
      f.statut === "annulee"
        ? "Ignorée : facture annulée."
        : f.statut === "brouillon" && (destinataires.get(f.client_id) ?? []).length === 0
          ? "Non émise : aucune adresse e-mail sur la fiche client."
          : (filtre?.(f) ?? null);
    if (refus) {
      resultats.set(id, { ...base, ok: false, ignoree: true, erreur: refus });
    } else {
      aEnvoyer.push(id);
    }
  }

  if (aEnvoyer.length > 0) {
    let envois: { id: string; ok: boolean; erreur?: string }[];
    try {
      envois = await envoyerFactures(supabase, aEnvoyer);
    } catch (e) {
      console.error("Envoi groupé interrompu :", e);
      return { ok: false, erreur: messageException(e, "Envoi groupé interrompu") };
    }
    const parId = new Map(envois.map((r) => [r.id, r]));

    // Numéros attribués pendant l'envoi (brouillons émis).
    const resNumeros = await supabase.from("factures").select("id, numero").in("id", aEnvoyer);
    const numeros = new Map(
      resNumeros.error ? [] : (resNumeros.data as { id: string; numero: string | null }[]).map((f) => [f.id, f.numero]),
    );

    for (const id of aEnvoyer) {
      const f = factures.get(id)!;
      const r = parId.get(id);
      resultats.set(id, {
        id,
        numero: numeros.get(id) ?? f.numero,
        client: nomClientFacture(f),
        ok: r?.ok ?? false,
        erreur: r ? (r.ok ? undefined : (r.erreur ?? "Échec de l'envoi.")) : "Aucun résultat d'envoi.",
      });
    }
  }

  return { ok: true, donnees: ids.map((id) => resultats.get(id)!) };
}

/** Phrase de synthèse d'un lot envoyé. */
export function syntheseEnvoi(resultats: ResultatEnvoiFacture[]): string {
  const envoyees = resultats.filter((r) => r.ok).length;
  const echecs = resultats.filter((r) => !r.ok && !r.ignoree).length;
  const ignorees = resultats.filter((r) => r.ignoree).length;
  const morceaux = [`${envoyees} facture${envoyees > 1 ? "s" : ""} envoyée${envoyees > 1 ? "s" : ""}`];
  if (echecs > 0) morceaux.push(`${echecs} en échec`);
  if (ignorees > 0) morceaux.push(`${ignorees} ignorée${ignorees > 1 ? "s" : ""}`);
  return `${morceaux.join(", ")}.`;
}
