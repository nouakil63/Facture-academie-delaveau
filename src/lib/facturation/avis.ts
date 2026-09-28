import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { construireHtmlEmail, emailConfigure, envoyerEmail, messageErreurEmail, remplirModeleAvis } from "@/lib/email";
import { adressesCopie, journaliser, messageDe, piedEmail } from "@/lib/facturation/envoi";
import { chargerAvisComplet, chargerParametres } from "@/lib/facturation/service";
import { destinatairesFacture, nomClient } from "@/lib/format";
import { genererPdfAvis, nomFichierAvis } from "@/lib/pdf";
import type { AvisComplet, Parametres } from "@/lib/types";

/*
 * Envoi d'un avis d'échéance par e-mail : PDF de l'avis en pièce jointe, journal des envois
 * (table envois_email : facture annuelle + échéance, succès ET échecs), statut de l'échéance
 * « à envoyer » → « avis envoyé » et date du dernier envoi (envoyee_le).
 * Même principe que envoyerFacture : destinataires de la fiche client ACTUELLE, modèles
 * d'e-mail et copie cachée des paramètres ACTUELS, PDF avec l'émetteur figé de la facture.
 * Ne lève jamais d'exception : retourne { ok: false, erreur }.
 */

export type ResultatEnvoiAvis =
  | { ok: true; destinataires: string[]; refusees: string[] }
  | {
      ok: false;
      erreur: string;
      /** true : rien n'a été tenté (avis déjà envoyé ou réglé, avec `exigerAEnvoyer`). */
      ignoree?: true;
    };

export interface OptionsEnvoiAvis {
  /**
   * Envoi automatique (tâche planifiée) : un avis qui n'est plus « à envoyer » (envoyé à la main,
   * réglé entre-temps) est ignoré, sans e-mail — jamais de doublon.
   */
  exigerAEnvoyer?: boolean;
}

const DEJA_ENVOYE = "Ignoré : avis déjà envoyé ou échéance réglée entre-temps.";

/**
 * Envoie un avis d'échéance au client (e-mail principal + copies).
 * - échéance annulée ou réglée : refus (rien à appeler) ;
 * - « à envoyer » : passe à « avis envoyé » ; déjà envoyé : renvoi (seule la date d'envoi change).
 */
export async function envoyerAvis(
  supabase: SupabaseClient,
  echeanceId: string,
  options: OptionsEnvoiAvis = {},
): Promise<ResultatEnvoiAvis> {
  let donnees: AvisComplet | null;
  try {
    donnees = await chargerAvisComplet(supabase, echeanceId);
  } catch (e) {
    return { ok: false, erreur: `Chargement de l'avis impossible : ${messageDe(e)}` };
  }
  if (!donnees) return { ok: false, erreur: "Échéance introuvable." };

  const { echeance, facture, academie } = donnees;
  if (options.exigerAEnvoyer && echeance.statut !== "a_venir") {
    return { ok: false, erreur: DEJA_ENVOYE, ignoree: true };
  }
  if (echeance.statut === "annulee" || facture.statut === "annulee") {
    return { ok: false, erreur: `Avis ${echeance.numero_avis} annulé (facture annuelle annulée) : envoi impossible.` };
  }
  if (echeance.statut === "payee") {
    return { ok: false, erreur: `Échéance ${echeance.numero_avis} déjà réglée : aucun avis à envoyer.` };
  }

  const destinataires = destinatairesFacture(donnees.client);
  if (destinataires.length === 0) {
    return {
      ok: false,
      erreur: `Aucune adresse e-mail pour ${nomClient(donnees.client)} : compléter la fiche client avant d'envoyer l'avis.`,
    };
  }
  if (!emailConfigure()) {
    return { ok: false, erreur: "Envoi d'e-mails non configuré (variables SMTP manquantes) : voir les Paramètres." };
  }

  let parametres: Parametres;
  try {
    parametres = await chargerParametres(supabase);
  } catch (e) {
    return { ok: false, erreur: `Lecture des paramètres impossible : ${messageDe(e)}` };
  }

  const objet =
    remplirModeleAvis(parametres.email_avis_objet, donnees).trim() || `Avis d'échéance ${echeance.numero_avis}`;
  const texte = remplirModeleAvis(parametres.email_avis_corps, donnees);
  const nomFichier = nomFichierAvis(echeance);
  const journal = { facture_id: facture.id, echeance_id: echeance.id, destinataires, objet };

  let pdf: Buffer;
  try {
    pdf = await genererPdfAvis(donnees);
  } catch (e) {
    console.error(`PDF de l'avis ${echeance.numero_avis} : génération impossible :`, e);
    const erreur = `Génération du PDF impossible : ${messageDe(e)}`;
    await journaliser(supabase, { ...journal, succes: false, erreur, message_id: null });
    return { ok: false, erreur };
  }

  let messageId: string;
  let refusees: string[];
  try {
    ({ messageId, refusees } = await envoyerEmail({
      a: destinataires,
      objet,
      texte,
      html: construireHtmlEmail({
        texte,
        titre: parametres.raison_sociale,
        sousTitre: academie.nom,
        couleur: parametres.couleur_primaire,
        couleurSecondaire: parametres.couleur_secondaire,
        pied: piedEmail(parametres, nomFichier),
      }),
      cci: adressesCopie(parametres.email_copie),
      pieceJointe: { nom: nomFichier, contenu: pdf },
    }));
  } catch (e) {
    console.error(`Envoi de l'avis ${echeance.numero_avis} impossible :`, e);
    const erreur = messageErreurEmail(e);
    await journaliser(supabase, { ...journal, succes: false, erreur, message_id: null });
    return { ok: false, erreur };
  }

  const cles = new Set(refusees.map((r) => r.toLowerCase()));
  const acceptees = destinataires.filter((d) => !cles.has(d.toLowerCase()));
  const principaleAcceptee = !cles.has(destinataires[0].toLowerCase());
  await journaliser(supabase, {
    ...journal,
    succes: principaleAcceptee,
    erreur: refusees.length > 0 ? `Adresse(s) refusée(s) par le serveur d'envoi : ${refusees.join(", ")}` : null,
    message_id: messageId || null,
  });
  if (!principaleAcceptee) {
    return {
      ok: false,
      erreur: `Adresse principale refusée par le serveur d'envoi (${destinataires[0]}) : avis reçu seulement en copie (${acceptees.join(", ")}). Corriger l'adresse sur la fiche client, puis renvoyer l'avis.`,
    };
  }

  // E-mail parti : mises à jour conditionnées au statut attendu (un paiement enregistré pendant
  // l'envoi n'est jamais effacé) ; un échec est journalisé sans être présenté comme un échec d'envoi.
  const maintenant = new Date().toISOString();
  const r = await supabase
    .from("echeances")
    .update({ statut: "envoyee", envoyee_le: maintenant })
    .eq("id", echeance.id)
    .eq("statut", "a_venir")
    .select("id");
  if (r.error) console.error(`Avis ${echeance.numero_avis} envoyé mais statut non mis à jour :`, r.error.message);
  if (!r.error && (r.data?.length ?? 0) === 0) {
    const { error } = await supabase
      .from("echeances")
      .update({ envoyee_le: maintenant })
      .eq("id", echeance.id)
      .in("statut", ["envoyee", "payee"]);
    if (error) console.error(`Avis ${echeance.numero_avis} envoyé mais date d'envoi non mise à jour :`, error.message);
  }

  return { ok: true, destinataires: acceptees, refusees };
}

export interface ResultatEnvoiAvisLot {
  id: string;
  ok: boolean;
  erreur?: string;
  ignoree?: boolean;
}

/** Envoie plusieurs avis l'un après l'autre ; une erreur n'interrompt pas les suivants. */
export async function envoyerAvisLot(
  supabase: SupabaseClient,
  ids: string[],
  options: OptionsEnvoiAvis = {},
): Promise<ResultatEnvoiAvisLot[]> {
  const resultats: ResultatEnvoiAvisLot[] = [];
  for (const id of ids) {
    try {
      const r = await envoyerAvis(supabase, id, options);
      resultats.push(
        r.ok
          ? { id, ok: true, ...(r.refusees.length > 0 ? { erreur: `Adresse(s) refusée(s) : ${r.refusees.join(", ")}` } : {}) }
          : { id, ok: false, erreur: r.erreur, ...(r.ignoree ? { ignoree: true } : {}) },
      );
    } catch (e) {
      console.error(`Envoi de l'avis ${id} interrompu :`, e);
      resultats.push({ id, ok: false, erreur: messageDe(e) });
    }
  }
  return resultats;
}
