"use server";

import { z } from "zod";
import {
  champ,
  creerBrouillon,
  messageException,
  messagesValidation,
  revaliderFactures,
  schemaId,
  schemaLigne,
  schemaPeriode,
  texteFacultatif,
  traduireErreur,
} from "@/components/factures/serveur";
import { exigerUtilisateur } from "@/lib/auth";
import { emailConfigure } from "@/lib/email";
import { envoyerFacture } from "@/lib/facturation/envoi";
import { destinatairesFacture, emettreFacture } from "@/lib/facturation/service";
import { aujourdhuiParis, formatDate, LIBELLES_STATUT, MODES_PAIEMENT } from "@/lib/format";
import type { ClientSupabase } from "@/lib/supabase/server";
import type { Client, Facture, LigneFacture, ResultatAction, StatutFacture } from "@/lib/types";

/*
 * Server Actions de la fiche facture : édition d'un brouillon (en-tête et lignes),
 * émission, envoi, paiement, annulation, duplication, notes internes.
 * Toutes valident leurs entrées (zod), vérifient la session et renvoient un
 * ResultatAction (jamais d'exception vers le navigateur).
 */

// -----------------------------------------------------------------------------
// Outils internes (non exportés)
// -----------------------------------------------------------------------------

const ERREUR_INATTENDUE: ResultatAction = {
  ok: false,
  erreur: "L'opération n'a pas abouti. Vérifiez la connexion puis réessayez.",
};

type EtatFacture = Pick<Facture, "id" | "statut" | "numero" | "entite_id" | "client_id" | "envoyee_le">;

/** Statut actuel de la facture, ou un message d'erreur. */
async function lireFacture(supabase: ClientSupabase, id: string): Promise<EtatFacture | string> {
  const { data, error } = await supabase
    .from("factures")
    .select("id, statut, numero, entite_id, client_id, envoyee_le")
    .eq("id", id)
    .maybeSingle();
  if (error) return traduireErreur(error);
  if (!data) return "Facture introuvable : elle a peut-être été supprimée.";
  return data as EtatFacture;
}

/** Message expliquant qu'une opération n'est pas possible dans le statut actuel. */
function horsStatut(statut: StatutFacture, operation: string): string {
  return `Impossible de ${operation} : la facture est au statut « ${LIBELLES_STATUT[statut]} ». Rechargez la page.`;
}

const MESSAGE_PLUS_BROUILLON =
  "Cette facture n'est plus un brouillon : son contenu ne peut plus être modifié. Rechargez la page.";

/** Vérifie qu'une facture est un brouillon (null si oui, sinon message d'erreur). */
async function exigerBrouillon(supabase: ClientSupabase, id: string): Promise<EtatFacture | string> {
  const facture = await lireFacture(supabase, id);
  if (typeof facture === "string") return facture;
  if (facture.statut !== "brouillon") return MESSAGE_PLUS_BROUILLON;
  return facture;
}

// -----------------------------------------------------------------------------
// Brouillon : en-tête
// -----------------------------------------------------------------------------

const schemaInfos = z.object({
  facture_id: schemaId,
  objet: texteFacultatif(200, "Objet"),
  periode: schemaPeriode,
  notes: texteFacultatif(2000, "Notes imprimées"),
});

/** Objet, période et notes imprimées d'un brouillon. */
export async function enregistrerInfosBrouillon(
  _precedent: ResultatAction | null,
  formData: FormData,
): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();
  const saisie = schemaInfos.safeParse({
    facture_id: champ(formData, "facture_id"),
    objet: champ(formData, "objet"),
    periode: champ(formData, "periode"),
    notes: champ(formData, "notes"),
  });
  if (!saisie.success) return { ok: false, erreur: messagesValidation(saisie.error) };
  const { facture_id, ...valeurs } = saisie.data;

  try {
    const { data, error } = await supabase
      .from("factures")
      .update(valeurs)
      .eq("id", facture_id)
      .eq("statut", "brouillon")
      .select("id");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return { ok: false, erreur: MESSAGE_PLUS_BROUILLON };
  } catch (e) {
    console.error(e);
    return ERREUR_INATTENDUE;
  }
  revaliderFactures();
  return { ok: true, message: "Informations enregistrées." };
}

// -----------------------------------------------------------------------------
// Brouillon : lignes
// -----------------------------------------------------------------------------

const schemaLigneFormulaire = z.object({
  facture_id: schemaId,
  ligne_id: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(schemaId.nullable()),
  ligne: schemaLigne,
});

/** Ajoute ou modifie une ligne d'un brouillon (prestation du catalogue ou ligne libre). */
export async function enregistrerLigne(_precedent: ResultatAction | null, formData: FormData): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();
  const mode = champ(formData, "mode");
  const saisie = schemaLigneFormulaire.safeParse({
    facture_id: champ(formData, "facture_id"),
    ligne_id: champ(formData, "ligne_id"),
    ligne: {
      prestation_id: mode === "catalogue" ? champ(formData, "prestation_id") : null,
      libelle: champ(formData, "libelle"),
      description: champ(formData, "description"),
      quantite: champ(formData, "quantite"),
      prix: champ(formData, "prix"),
    },
  });
  if (!saisie.success) return { ok: false, erreur: messagesValidation(saisie.error) };
  if (mode === "catalogue" && !saisie.data.ligne.prestation_id) {
    return { ok: false, erreur: "Choisissez une prestation du catalogue." };
  }
  const { facture_id, ligne_id, ligne } = saisie.data;

  try {
    const facture = await exigerBrouillon(supabase, facture_id);
    if (typeof facture === "string") return { ok: false, erreur: facture };

    if (ligne.prestation_id) {
      const resPrestation = await supabase
        .from("prestations")
        .select("id")
        .eq("id", ligne.prestation_id)
        .eq("entite_id", facture.entite_id)
        .maybeSingle();
      if (resPrestation.error) return { ok: false, erreur: traduireErreur(resPrestation.error) };
      if (!resPrestation.data) {
        return { ok: false, erreur: "Cette prestation n'appartient pas au catalogue de l'entité de la facture." };
      }
    }

    const valeurs = {
      libelle: ligne.libelle,
      description: ligne.description,
      quantite: ligne.quantite,
      prix_unitaire_centimes: ligne.prix,
      prestation_id: ligne.prestation_id,
    };

    if (ligne_id) {
      const { data, error } = await supabase
        .from("lignes_facture")
        .update(valeurs)
        .eq("id", ligne_id)
        .eq("facture_id", facture_id)
        .select("id");
      if (error) return { ok: false, erreur: traduireErreur(error) };
      if (!data || data.length === 0) return { ok: false, erreur: "Cette ligne n'existe plus. Rechargez la page." };
    } else {
      const resOrdre = await supabase
        .from("lignes_facture")
        .select("ordre")
        .eq("facture_id", facture_id)
        .order("ordre", { ascending: false })
        .limit(1);
      if (resOrdre.error) return { ok: false, erreur: traduireErreur(resOrdre.error) };
      const dernier = (resOrdre.data as { ordre: number }[])[0]?.ordre ?? 0;
      // total_centimes est une colonne générée : jamais insérée.
      const { error } = await supabase
        .from("lignes_facture")
        .insert({ ...valeurs, facture_id, ordre: dernier + 1 });
      if (error) return { ok: false, erreur: traduireErreur(error) };
    }
  } catch (e) {
    console.error(e);
    return ERREUR_INATTENDUE;
  }
  revaliderFactures();
  return { ok: true, message: ligne_id ? "Ligne modifiée." : "Ligne ajoutée." };
}

/** Supprime une ligne d'un brouillon. */
export async function supprimerLigne(factureId: string, ligneId: string): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();
  const ids = z.object({ factureId: schemaId, ligneId: schemaId }).safeParse({ factureId, ligneId });
  if (!ids.success) return { ok: false, erreur: messagesValidation(ids.error) };

  try {
    const facture = await exigerBrouillon(supabase, ids.data.factureId);
    if (typeof facture === "string") return { ok: false, erreur: facture };
    const { error } = await supabase
      .from("lignes_facture")
      .delete()
      .eq("id", ids.data.ligneId)
      .eq("facture_id", ids.data.factureId);
    if (error) return { ok: false, erreur: traduireErreur(error) };
  } catch (e) {
    console.error(e);
    return ERREUR_INATTENDUE;
  }
  revaliderFactures();
  return { ok: true, message: "Ligne supprimée." };
}

/** Monte ou descend une ligne d'un brouillon (renumérote les lignes 1, 2, 3…). */
export async function deplacerLigne(factureId: string, ligneId: string, sens: "haut" | "bas"): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();
  const entree = z
    .object({ factureId: schemaId, ligneId: schemaId, sens: z.enum(["haut", "bas"]) })
    .safeParse({ factureId, ligneId, sens });
  if (!entree.success) return { ok: false, erreur: messagesValidation(entree.error) };

  try {
    const facture = await exigerBrouillon(supabase, entree.data.factureId);
    if (typeof facture === "string") return { ok: false, erreur: facture };

    const { data, error } = await supabase
      .from("lignes_facture")
      .select("id, ordre")
      .eq("facture_id", entree.data.factureId)
      .order("ordre")
      .order("created_at");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    const lignes = data as Pick<LigneFacture, "id" | "ordre">[];
    const i = lignes.findIndex((l) => l.id === entree.data.ligneId);
    const j = entree.data.sens === "haut" ? i - 1 : i + 1;
    if (i < 0) return { ok: false, erreur: "Cette ligne n'existe plus. Rechargez la page." };
    if (j < 0 || j >= lignes.length) return { ok: true };
    [lignes[i], lignes[j]] = [lignes[j], lignes[i]];

    for (const [index, ligne] of lignes.entries()) {
      if (ligne.ordre === index + 1) continue;
      const maj = await supabase.from("lignes_facture").update({ ordre: index + 1 }).eq("id", ligne.id);
      if (maj.error) return { ok: false, erreur: traduireErreur(maj.error) };
    }
  } catch (e) {
    console.error(e);
    return ERREUR_INATTENDUE;
  }
  revaliderFactures();
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Brouillon : suppression, émission
// -----------------------------------------------------------------------------

/** Supprime un brouillon (une facture émise ne se supprime pas : elle s'annule). */
export async function supprimerBrouillon(factureId: string): Promise<ResultatAction<{ redirection: string }>> {
  const { supabase } = await exigerUtilisateur();
  const id = schemaId.safeParse(factureId);
  if (!id.success) return { ok: false, erreur: messagesValidation(id.error) };

  try {
    const facture = await lireFacture(supabase, id.data);
    if (typeof facture === "string") return { ok: false, erreur: facture };
    if (facture.statut !== "brouillon") {
      return {
        ok: false,
        erreur: `La facture ${facture.numero} est émise : elle ne peut pas être supprimée, seulement annulée.`,
      };
    }
    const { data, error } = await supabase
      .from("factures")
      .delete()
      .eq("id", id.data)
      .eq("statut", "brouillon")
      .select("id");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return { ok: false, erreur: MESSAGE_PLUS_BROUILLON };
  } catch (e) {
    console.error(e);
    return ERREUR_INATTENDUE;
  }
  revaliderFactures();
  return { ok: true, message: "Brouillon supprimé.", donnees: { redirection: "/factures" } };
}

/** Émet un brouillon sans l'envoyer : numéro définitif, contenu figé. */
export async function emettreSansEnvoyer(factureId: string): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();
  const id = schemaId.safeParse(factureId);
  if (!id.success) return { ok: false, erreur: messagesValidation(id.error) };

  let numero: string | null;
  try {
    const facture = await emettreFacture(supabase, id.data);
    numero = facture.numero;
  } catch (e) {
    return { ok: false, erreur: messageException(e, "Émission impossible") };
  }
  revaliderFactures();
  return { ok: true, message: `Facture ${numero ?? ""} émise. Vous pouvez maintenant l'envoyer ou la télécharger.` };
}

// -----------------------------------------------------------------------------
// Envoi par e-mail
// -----------------------------------------------------------------------------

/**
 * Envoie la facture par e-mail (émet d'abord un brouillon). Une facture payée part
 * en duplicata sans changer de statut ; une facture annulée est refusée.
 */
export async function envoyerParEmail(factureId: string): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();
  const id = schemaId.safeParse(factureId);
  if (!id.success) return { ok: false, erreur: messagesValidation(id.error) };

  if (!emailConfigure()) {
    return { ok: false, erreur: "L'envoi d'e-mails n'est pas configuré (serveur SMTP) : voir les Paramètres." };
  }

  const avant = await lireFacture(supabase, id.data).catch(() => null);
  if (typeof avant === "string") return { ok: false, erreur: avant };
  if (avant?.statut === "annulee") return { ok: false, erreur: "Une facture annulée ne peut pas être envoyée." };
  if (avant?.statut === "brouillon") {
    // Ne jamais attribuer de numéro à un brouillon qui ne pourrait pas partir.
    const resClient = await supabase.from("clients").select("email, emails_cc").eq("id", avant.client_id).maybeSingle();
    if (resClient.error) return { ok: false, erreur: traduireErreur(resClient.error) };
    const client = resClient.data as Pick<Client, "email" | "emails_cc"> | null;
    if (!client || destinatairesFacture(client).length === 0) {
      return {
        ok: false,
        erreur:
          "Le client n'a aucune adresse e-mail : complétez sa fiche, ou émettez la facture sans l'envoyer pour la remettre en main propre.",
      };
    }
  }

  let resultat: Awaited<ReturnType<typeof envoyerFacture>>;
  try {
    resultat = await envoyerFacture(supabase, id.data);
  } catch (e) {
    console.error("Envoi de facture impossible :", e);
    resultat = { ok: false, erreur: messageException(e, "Envoi impossible") };
  }
  revaliderFactures();

  const apres = await lireFacture(supabase, id.data).catch(() => null);
  const numero = apres && typeof apres !== "string" ? apres.numero : null;

  if (!resultat.ok) {
    // Le brouillon a pu être émis avant l'échec de l'envoi : on le signale clairement.
    const emiseSansEnvoi = avant?.statut === "brouillon" && apres && typeof apres !== "string" && apres.statut !== "brouillon";
    return {
      ok: false,
      erreur: emiseSansEnvoi
        ? `${resultat.erreur}\nLa facture a bien été émise (${numero}) mais l'e-mail n'est pas parti : vous pouvez relancer l'envoi.`
        : resultat.erreur,
    };
  }

  const destinataires = resultat.destinataires.join(", ");
  if (avant?.statut === "brouillon") {
    return { ok: true, message: `Facture ${numero ?? ""} émise et envoyée à ${destinataires}.` };
  }
  if (avant?.statut === "payee") {
    return { ok: true, message: `Duplicata de la facture ${numero ?? ""} envoyé à ${destinataires}.` };
  }
  return { ok: true, message: `Facture ${numero ?? ""} envoyée à ${destinataires}.` };
}

// -----------------------------------------------------------------------------
// Paiement
// -----------------------------------------------------------------------------

const schemaPaiement = z.object({
  facture_id: schemaId,
  payee_le: z
    .string()
    .trim()
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), {
      error: "Date de paiement invalide.",
    })
    .refine((v) => v <= aujourdhuiParis(), { error: "La date de paiement ne peut pas être dans le futur." }),
  mode_paiement: z.enum(MODES_PAIEMENT, { error: "Choisissez le mode de paiement." }),
  reference_paiement: texteFacultatif(120, "Référence"),
});

/** Marque une facture émise ou envoyée comme payée. */
export async function marquerPayee(_precedent: ResultatAction | null, formData: FormData): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();
  const saisie = schemaPaiement.safeParse({
    facture_id: champ(formData, "facture_id"),
    payee_le: champ(formData, "payee_le"),
    mode_paiement: champ(formData, "mode_paiement"),
    reference_paiement: champ(formData, "reference_paiement"),
  });
  if (!saisie.success) return { ok: false, erreur: messagesValidation(saisie.error) };
  const { facture_id, ...paiement } = saisie.data;

  try {
    const facture = await lireFacture(supabase, facture_id);
    if (typeof facture === "string") return { ok: false, erreur: facture };
    if (facture.statut !== "emise" && facture.statut !== "envoyee") {
      return { ok: false, erreur: horsStatut(facture.statut, "enregistrer le paiement") };
    }
    const { data, error } = await supabase
      .from("factures")
      .update({ statut: "payee", ...paiement })
      .eq("id", facture_id)
      .in("statut", ["emise", "envoyee"])
      .select("id");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return { ok: false, erreur: "Le statut de la facture a changé entre-temps. Rechargez la page." };
  } catch (e) {
    console.error(e);
    return ERREUR_INATTENDUE;
  }
  revaliderFactures();
  return { ok: true, message: `Paiement du ${formatDate(paiement.payee_le)} enregistré (${paiement.mode_paiement}).` };
}

/** Annule l'enregistrement du paiement : la facture repasse « envoyée » (ou « émise » si jamais envoyée). */
export async function annulerPaiement(factureId: string): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();
  const id = schemaId.safeParse(factureId);
  if (!id.success) return { ok: false, erreur: messagesValidation(id.error) };

  let nouveau: StatutFacture;
  try {
    const facture = await lireFacture(supabase, id.data);
    if (typeof facture === "string") return { ok: false, erreur: facture };
    if (facture.statut !== "payee") return { ok: false, erreur: horsStatut(facture.statut, "annuler le paiement") };
    nouveau = facture.envoyee_le ? "envoyee" : "emise";
    const { data, error } = await supabase
      .from("factures")
      .update({ statut: nouveau })
      .eq("id", id.data)
      .eq("statut", "payee")
      .select("id");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return { ok: false, erreur: "Le statut de la facture a changé entre-temps. Rechargez la page." };
  } catch (e) {
    console.error(e);
    return ERREUR_INATTENDUE;
  }
  revaliderFactures();
  return { ok: true, message: `Paiement annulé : la facture est de nouveau « ${LIBELLES_STATUT[nouveau]} ».` };
}

// -----------------------------------------------------------------------------
// Annulation, duplication
// -----------------------------------------------------------------------------

const schemaAnnulation = z.object({
  facture_id: schemaId,
  motif: z
    .string()
    .trim()
    .min(3, { error: "Indiquez le motif de l'annulation." })
    .max(500, { error: "Motif : 500 caractères au maximum." }),
});

/** Annule une facture émise ou envoyée (elle reste dans la numérotation). */
export async function annulerFacture(_precedent: ResultatAction | null, formData: FormData): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();
  const saisie = schemaAnnulation.safeParse({
    facture_id: champ(formData, "facture_id"),
    motif: champ(formData, "motif"),
  });
  if (!saisie.success) return { ok: false, erreur: messagesValidation(saisie.error) };

  try {
    const facture = await lireFacture(supabase, saisie.data.facture_id);
    if (typeof facture === "string") return { ok: false, erreur: facture };
    if (facture.statut === "payee") {
      return { ok: false, erreur: "Cette facture est payée : annulez d'abord le paiement, puis la facture." };
    }
    if (facture.statut !== "emise" && facture.statut !== "envoyee") {
      return { ok: false, erreur: horsStatut(facture.statut, "annuler la facture") };
    }
    const { data, error } = await supabase
      .from("factures")
      .update({ statut: "annulee", motif_annulation: saisie.data.motif, annulee_le: new Date().toISOString() })
      .eq("id", saisie.data.facture_id)
      .in("statut", ["emise", "envoyee"])
      .select("id");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return { ok: false, erreur: "Le statut de la facture a changé entre-temps. Rechargez la page." };
  } catch (e) {
    console.error(e);
    return ERREUR_INATTENDUE;
  }
  revaliderFactures();
  return { ok: true, message: "Facture annulée." };
}

/** Crée un nouveau brouillon avec le même client et les mêmes lignes. */
export async function dupliquerFacture(factureId: string): Promise<ResultatAction<{ redirection: string }>> {
  const { supabase } = await exigerUtilisateur();
  const id = schemaId.safeParse(factureId);
  if (!id.success) return { ok: false, erreur: messagesValidation(id.error) };

  let nouvelId: string;
  try {
    const [resFacture, resLignes] = await Promise.all([
      supabase.from("factures").select("id, client_id, objet, periode, notes").eq("id", id.data).maybeSingle(),
      supabase
        .from("lignes_facture")
        .select("libelle, description, quantite, prix_unitaire_centimes, prestation_id")
        .eq("facture_id", id.data)
        .order("ordre")
        .order("created_at"),
    ]);
    if (resFacture.error) return { ok: false, erreur: traduireErreur(resFacture.error) };
    if (resLignes.error) return { ok: false, erreur: traduireErreur(resLignes.error) };
    if (!resFacture.data) return { ok: false, erreur: "Facture introuvable : elle a peut-être été supprimée." };
    const source = resFacture.data as Pick<Facture, "id" | "client_id" | "objet" | "periode" | "notes">;
    const lignes = resLignes.data as Pick<
      LigneFacture,
      "libelle" | "description" | "quantite" | "prix_unitaire_centimes" | "prestation_id"
    >[];

    const resultat = await creerBrouillon(supabase, {
      clientId: source.client_id,
      objet: source.objet,
      periode: source.periode,
      notes: source.notes,
      lignes: lignes.map((l) => ({
        prestation_id: l.prestation_id,
        libelle: l.libelle,
        description: l.description,
        quantite: Number(l.quantite),
        prix: l.prix_unitaire_centimes,
      })),
    });
    if (!resultat.ok) return resultat;
    nouvelId = resultat.donnees!.id;
  } catch (e) {
    console.error(e);
    return ERREUR_INATTENDUE;
  }
  revaliderFactures();
  return {
    ok: true,
    message: "Brouillon créé à partir de cette facture.",
    donnees: { redirection: `/factures/${nouvelId}` },
  };
}

// -----------------------------------------------------------------------------
// Notes internes (modifiables à tout statut)
// -----------------------------------------------------------------------------

const schemaNotesInternes = z.object({
  facture_id: schemaId,
  notes_internes: texteFacultatif(4000, "Notes internes"),
});

export async function enregistrerNotesInternes(
  _precedent: ResultatAction | null,
  formData: FormData,
): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();
  const saisie = schemaNotesInternes.safeParse({
    facture_id: champ(formData, "facture_id"),
    notes_internes: champ(formData, "notes_internes"),
  });
  if (!saisie.success) return { ok: false, erreur: messagesValidation(saisie.error) };

  try {
    const { data, error } = await supabase
      .from("factures")
      .update({ notes_internes: saisie.data.notes_internes })
      .eq("id", saisie.data.facture_id)
      .select("id");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return { ok: false, erreur: "Facture introuvable : elle a peut-être été supprimée." };
  } catch (e) {
    console.error(e);
    return ERREUR_INATTENDUE;
  }
  revaliderFactures();
  return { ok: true, message: "Notes internes enregistrées." };
}
