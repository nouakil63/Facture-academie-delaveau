"use server";

import { z } from "zod";
import { LOT_ENVOI_MAX, syntheseEnvoi, type ResultatEnvoiFacture } from "@/components/factures/outils";
import {
  champ,
  envoyerLot,
  messageException,
  messagesValidation,
  revaliderFactures,
  schemaId,
  texteFacultatif,
  traduireErreur,
} from "@/components/factures/serveur";
import { exigerUtilisateur } from "@/lib/auth";
import { emailConfigure } from "@/lib/email";
import { envoyerAvis, envoyerAvisLot } from "@/lib/facturation/avis";
import { genererFacturesAnnuelles } from "@/lib/facturation/service";
import { aujourdhuiParis, destinatairesFacture, formatDate, MODES_PAIEMENT, nomClient, pluriel } from "@/lib/format";
import { libelleSaison } from "@/lib/tarifs";
import type { EcheanceVue, ResultatAction, StatutEcheance } from "@/lib/types";

/*
 * Server Actions de l'année scolaire : préparation et envoi des factures annuelles, avis
 * d'échéance (envoi, paiement), nettoyage des anciens brouillons mensuels.
 * Utilisées par /facturation-annuelle, la fiche client et la fiche facture. Toutes valident
 * leurs entrées (zod), vérifient la session et renvoient un ResultatAction.
 */

const schemaSaison = z.number({ error: "Saison invalide." }).int().min(2000).max(2098);

const schemaIds = z
  .array(schemaId, { error: "Sélection invalide." })
  .min(1, { error: "Aucun élément à envoyer." })
  .max(LOT_ENVOI_MAX, { error: `${LOT_ENVOI_MAX} éléments au maximum par appel : procéder en plusieurs fois.` })
  .transform((ids) => [...new Set(ids)]);

// -----------------------------------------------------------------------------
// Factures annuelles
// -----------------------------------------------------------------------------

/**
 * Crée les brouillons des factures annuelles manquantes d'une saison, pour une académie ou pour
 * toutes (`academieId` null). Idempotent : les clients qui ont déjà leur facture sont ignorés.
 */
export async function preparerFacturesAnnuelles(
  academieId: string | null,
  saison: number,
): Promise<ResultatAction<{ crees: number }>> {
  const { supabase } = await exigerUtilisateur();
  const cible = z.object({ academieId: schemaId.nullable(), saison: schemaSaison }).safeParse({ academieId, saison });
  if (!cible.success) return { ok: false, erreur: messagesValidation(cible.error) };

  let crees: number;
  try {
    const resultats = await genererFacturesAnnuelles(supabase, cible.data.saison, { academieId: cible.data.academieId });
    crees = resultats.filter((r) => !r.deja_existante).length;
  } catch (e) {
    console.error("Préparation des factures annuelles impossible :", e);
    return { ok: false, erreur: messageException(e, "Préparation impossible") };
  }
  revaliderFactures();
  const annee = libelleSaison(cible.data.saison);
  return {
    ok: true,
    message:
      crees === 0
        ? `Aucune nouvelle facture : toutes les factures annuelles ${annee} sont déjà préparées.`
        : `${pluriel(crees, "facture annuelle préparée", "factures annuelles préparées")} (${annee}), en brouillon. À relire avant l'émission.`,
    donnees: { crees },
  };
}

/**
 * Émet et envoie les brouillons de factures annuelles confirmés par l'utilisateur (saison, et
 * académie si précisée). Un brouillon émis entre-temps par un autre envoi est ignoré : jamais
 * d'e-mail en double. Le navigateur appelle cette action par petits lots (LOT_ENVOI).
 */
export async function envoyerFacturesAnnuelles(
  academieId: string | null,
  saison: number,
  ids: string[],
): Promise<ResultatAction<ResultatEnvoiFacture[]>> {
  const { supabase } = await exigerUtilisateur();
  const saisie = z
    .object({ academieId: schemaId.nullable(), saison: schemaSaison, ids: schemaIds })
    .safeParse({ academieId, saison, ids });
  if (!saisie.success) return { ok: false, erreur: messagesValidation(saisie.error) };
  const { academieId: academie, saison: annee, ids: demandes } = saisie.data;

  try {
    let requete = supabase
      .from("factures")
      .select("id")
      .in("id", demandes)
      .eq("type_facture", "annuelle")
      .eq("saison", annee);
    if (academie) requete = requete.eq("academie_id", academie);
    const resValides = await requete;
    if (resValides.error) return { ok: false, erreur: traduireErreur(resValides.error) };
    const valides = new Set((resValides.data as { id: string }[]).map((f) => f.id));

    const resultat = await envoyerLot(
      supabase,
      demandes,
      (f) =>
        !valides.has(f.id)
          ? "Ignorée : hors factures annuelles de cette saison."
          : f.statut !== "brouillon"
            ? "Ignorée : émise entre-temps. Si elle est restée « Émise », l'envoyer depuis sa fiche."
            : null,
      { exigerBrouillon: true },
    );
    revaliderFactures();
    if (!resultat.ok) return resultat;
    return { ok: true, message: syntheseEnvoi(resultat.donnees ?? []), donnees: resultat.donnees };
  } catch (e) {
    console.error("Envoi des factures annuelles impossible :", e);
    revaliderFactures();
    return {
      ok: false,
      erreur: "Envoi interrompu. Recharger la page pour voir les factures déjà envoyées avant de relancer.",
    };
  }
}

/**
 * Supprime les anciens brouillons MENSUELS de la saison (générés automatiquement, jamais émis) :
 * de toute la saison, d'une académie ou d'un client. Une facture émise n'est jamais touchée.
 */
export async function supprimerAnciensBrouillons(
  saison: number,
  cible: { academieId?: string | null; clientId?: string | null } = {},
): Promise<ResultatAction<{ supprimes: number }>> {
  const { supabase } = await exigerUtilisateur();
  const saisie = z
    .object({ saison: schemaSaison, academieId: schemaId.nullish(), clientId: schemaId.nullish() })
    .safeParse({ saison, ...cible });
  if (!saisie.success) return { ok: false, erreur: messagesValidation(saisie.error) };
  const { saison: annee, academieId, clientId } = saisie.data;

  let supprimes: number;
  try {
    let requete = supabase
      .from("factures")
      .delete()
      .eq("statut", "brouillon")
      .eq("generation_auto", true)
      .eq("type_facture", "ponctuelle")
      .gte("periode", `${annee}-09-01`)
      .lte("periode", `${annee + 1}-06-01`);
    if (academieId) requete = requete.eq("academie_id", academieId);
    if (clientId) requete = requete.eq("client_id", clientId);
    const { data, error } = await requete.select("id");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    supprimes = (data ?? []).length;
  } catch (e) {
    console.error("Suppression des anciens brouillons impossible :", e);
    return { ok: false, erreur: messageException(e, "Suppression impossible") };
  }
  revaliderFactures();
  return {
    ok: true,
    message:
      supprimes === 0
        ? "Aucun ancien brouillon mensuel à supprimer."
        : `${pluriel(supprimes, "ancien brouillon mensuel supprimé", "anciens brouillons mensuels supprimés")}.`,
    donnees: { supprimes },
  };
}

// -----------------------------------------------------------------------------
// Avis d'échéance
// -----------------------------------------------------------------------------

type EcheanceLot = Pick<
  EcheanceVue,
  "id" | "statut" | "numero_avis" | "client_type" | "client_nom" | "client_prenom" | "client_raison_sociale" | "client_email" | "client_emails_cc"
>;

/**
 * Envoi groupé des avis d'échéance sélectionnés : seuls les avis « à envoyer » partent (un avis
 * déjà envoyé ou réglé est ignoré, jamais de doublon), ni ceux d'un client sans adresse e-mail.
 * Le navigateur appelle cette action par petits lots (LOT_ENVOI).
 */
export async function envoyerAvisGroupes(ids: string[]): Promise<ResultatAction<ResultatEnvoiFacture[]>> {
  const { supabase } = await exigerUtilisateur();
  const saisie = schemaIds.safeParse(ids);
  if (!saisie.success) return { ok: false, erreur: messagesValidation(saisie.error) };
  if (!emailConfigure()) {
    return { ok: false, erreur: "Envoi d'e-mails non configuré (serveur SMTP) : voir les Paramètres." };
  }

  try {
    const res = await supabase
      .from("echeances_vue")
      .select("id, statut, numero_avis, client_type, client_nom, client_prenom, client_raison_sociale, client_email, client_emails_cc")
      .in("id", saisie.data);
    if (res.error) return { ok: false, erreur: traduireErreur(res.error) };
    const echeances = new Map((res.data as EcheanceLot[]).map((e) => [e.id, e]));

    const resultats = new Map<string, ResultatEnvoiFacture>();
    const aEnvoyer: string[] = [];
    for (const id of saisie.data) {
      const e = echeances.get(id);
      if (!e) {
        resultats.set(id, { id, numero: null, client: "—", ok: false, ignoree: true, erreur: "Avis introuvable." });
        continue;
      }
      const client = nomClient({ type: e.client_type, nom: e.client_nom, prenom: e.client_prenom, raison_sociale: e.client_raison_sociale });
      const refus =
        e.statut !== "a_venir"
          ? `Ignoré : ${e.statut === "payee" ? "échéance réglée" : e.statut === "annulee" ? "avis annulé" : "avis déjà envoyé"}.`
          : destinatairesFacture({ email: e.client_email, emails_cc: e.client_emails_cc }).length === 0
            ? "Ignoré : aucune adresse e-mail sur la fiche client."
            : null;
      if (refus) resultats.set(id, { id, numero: e.numero_avis, client, ok: false, ignoree: true, erreur: refus });
      else {
        resultats.set(id, { id, numero: e.numero_avis, client, ok: false });
        aEnvoyer.push(id);
      }
    }

    if (aEnvoyer.length > 0) {
      const envois = await envoyerAvisLot(supabase, aEnvoyer, { exigerAEnvoyer: true });
      for (const r of envois) {
        const avant = resultats.get(r.id)!;
        resultats.set(r.id, { ...avant, ok: r.ok, ...(r.ignoree ? { ignoree: true } : {}), erreur: r.erreur });
      }
    }
    revaliderFactures();
    const donnees = saisie.data.map((id) => resultats.get(id)!);
    return { ok: true, message: syntheseAvis(donnees), donnees };
  } catch (e) {
    console.error("Envoi groupé des avis impossible :", e);
    revaliderFactures();
    return { ok: false, erreur: "Envoi interrompu. Recharger la page pour voir les avis déjà envoyés avant de relancer." };
  }
}

/** « 3 avis envoyés, 1 en échec, 2 ignorés. » */
function syntheseAvis(resultats: ResultatEnvoiFacture[]): string {
  const envoyes = resultats.filter((r) => r.ok).length;
  const echecs = resultats.filter((r) => !r.ok && !r.ignoree).length;
  const ignores = resultats.filter((r) => r.ignoree).length;
  const morceaux = [pluriel(envoyes, "avis envoyé", "avis envoyés")];
  if (echecs > 0) morceaux.push(`${echecs} en échec`);
  if (ignores > 0) morceaux.push(pluriel(ignores, "ignoré", "ignorés"));
  return `${morceaux.join(", ")}.`;
}

/** Envoie (ou renvoie) un avis d'échéance par e-mail. */
export async function envoyerAvisEcheance(echeanceId: string): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();
  const id = schemaId.safeParse(echeanceId);
  if (!id.success) return { ok: false, erreur: messagesValidation(id.error) };
  if (!emailConfigure()) {
    return { ok: false, erreur: "Envoi d'e-mails non configuré (serveur SMTP) : voir les Paramètres." };
  }
  let resultat: Awaited<ReturnType<typeof envoyerAvis>>;
  try {
    resultat = await envoyerAvis(supabase, id.data);
  } catch (e) {
    console.error("Envoi de l'avis impossible :", e);
    resultat = { ok: false, erreur: messageException(e, "Envoi impossible") };
  }
  revaliderFactures();
  if (!resultat.ok) return { ok: false, erreur: resultat.erreur };
  const refus =
    resultat.refusees.length > 0
      ? `\nAdresse(s) en copie refusée(s) par le serveur d'envoi : ${resultat.refusees.join(", ")}.`
      : "";
  return { ok: true, message: `Avis envoyé à ${resultat.destinataires.join(", ")}.${refus}` };
}

const schemaPaiement = z.object({
  echeance_id: schemaId,
  payee_le: z
    .string()
    .trim()
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), { error: "Date de paiement invalide." })
    .refine((v) => v <= aujourdhuiParis(), { error: "La date de paiement ne peut pas être dans le futur." }),
  mode_paiement: z.enum(MODES_PAIEMENT, { error: "Choisir le mode de paiement." }),
  reference_paiement: texteFacultatif(120, "Référence"),
});

/**
 * Enregistre le paiement d'une échéance (« à envoyer » ou « avis envoyé »). Toutes les échéances
 * réglées : la facture annuelle passe « payée » (base de données).
 */
export async function marquerEcheancePayee(_precedent: ResultatAction | null, formData: FormData): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();
  const saisie = schemaPaiement.safeParse({
    echeance_id: champ(formData, "echeance_id"),
    payee_le: champ(formData, "payee_le"),
    mode_paiement: champ(formData, "mode_paiement"),
    reference_paiement: champ(formData, "reference_paiement"),
  });
  if (!saisie.success) return { ok: false, erreur: messagesValidation(saisie.error) };
  const { echeance_id, ...paiement } = saisie.data;

  let factureId: string;
  try {
    const { data, error } = await supabase
      .from("echeances")
      .update({ statut: "payee", ...paiement })
      .eq("id", echeance_id)
      .in("statut", ["a_venir", "envoyee"])
      .select("facture_id");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return { ok: false, erreur: "Échéance déjà réglée ou annulée entre-temps. Recharger la page." };
    factureId = (data[0] as { facture_id: string }).facture_id;
  } catch (e) {
    console.error(e);
    return { ok: false, erreur: "Opération non aboutie. Vérifier la connexion et réessayer." };
  }
  revaliderFactures();
  const facture = await supabase.from("factures").select("statut, numero").eq("id", factureId).maybeSingle();
  const soldee = (facture.data as { statut: string; numero: string } | null)?.statut === "payee";
  return {
    ok: true,
    message: `Paiement du ${formatDate(paiement.payee_le)} enregistré (${paiement.mode_paiement}).${
      soldee ? ` Toutes les échéances sont réglées : facture ${(facture.data as { numero: string }).numero} payée.` : ""
    }`,
  };
}

/** Annule le paiement d'une échéance : retour à « avis envoyé » (ou « à envoyer » si jamais envoyé). */
export async function annulerPaiementEcheance(echeanceId: string): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();
  const id = schemaId.safeParse(echeanceId);
  if (!id.success) return { ok: false, erreur: messagesValidation(id.error) };

  let nouveau: StatutEcheance;
  try {
    const lecture = await supabase.from("echeances").select("statut, envoyee_le").eq("id", id.data).maybeSingle();
    if (lecture.error) return { ok: false, erreur: traduireErreur(lecture.error) };
    const e = lecture.data as { statut: StatutEcheance; envoyee_le: string | null } | null;
    if (!e) return { ok: false, erreur: "Échéance introuvable." };
    if (e.statut !== "payee") return { ok: false, erreur: "Cette échéance n'est pas réglée. Recharger la page." };
    nouveau = e.envoyee_le ? "envoyee" : "a_venir";
    const { data, error } = await supabase
      .from("echeances")
      .update({ statut: nouveau })
      .eq("id", id.data)
      .eq("statut", "payee")
      .select("id");
    if (error) return { ok: false, erreur: traduireErreur(error) };
    if (!data || data.length === 0) return { ok: false, erreur: "Statut modifié entre-temps. Recharger la page." };
  } catch (e) {
    console.error(e);
    return { ok: false, erreur: "Opération non aboutie. Vérifier la connexion et réessayer." };
  }
  revaliderFactures();
  return {
    ok: true,
    message: `Paiement annulé : échéance de nouveau « ${nouveau === "envoyee" ? "avis envoyé" : "à envoyer"} ».`,
  };
}
