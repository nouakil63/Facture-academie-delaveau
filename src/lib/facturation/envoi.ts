import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { construireHtmlEmail, emailConfigure, envoyerEmail, messageErreurEmail, remplirModele } from "@/lib/email";
import { chargerFactureComplete, destinatairesFacture, emettreFacture } from "@/lib/facturation/service";
import { nomClient } from "@/lib/format";
import { genererPdfFacture, nomFichierFacture } from "@/lib/pdf";
import type { Entite, FactureComplete } from "@/lib/types";

/*
 * Envoi d'une facture par e-mail : émission du brouillon si besoin, PDF en pièce jointe,
 * journal des envois (succès ET échecs) et mise à jour du statut.
 * Partagé par les Server Actions (client Supabase de l'utilisateur) et la tâche planifiée
 * (client admin). Ne lève jamais d'exception : retourne { ok: false, erreur }.
 */

export type ResultatEnvoi = { ok: true; destinataires: string[] } | { ok: false; erreur: string };

function messageDe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  return "erreur inconnue";
}

/** Adresse(s) en copie cachée de l'émetteur (archivage) : « a@x.fr » ou « a@x.fr, b@y.fr ». */
function adressesCopie(emailCopie: string | null): string[] {
  return (emailCopie ?? "")
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter((a) => a.includes("@"));
}

/** Ligne de pied de l'e-mail : coordonnées de l'émetteur. */
function piedEmail(entite: Entite, nomFichier: string): string {
  const adresse = [entite.adresse_ligne1, [entite.code_postal, entite.ville].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const coordonnees = [entite.raison_sociale, adresse, entite.email_contact, entite.telephone]
    .filter(Boolean)
    .join(" · ");
  return `${coordonnees}\nPièce jointe : ${nomFichier}`;
}

async function journaliser(
  supabase: SupabaseClient,
  envoi: {
    facture_id: string;
    destinataires: string[];
    objet: string;
    succes: boolean;
    erreur: string | null;
    message_id: string | null;
  },
) {
  const { error } = await supabase.from("envois_email").insert(envoi);
  if (error)
    console.error(`Journal des envois : enregistrement impossible (facture ${envoi.facture_id}) :`, error.message);
}

/**
 * Envoie une facture par e-mail au client (e-mail principal + copies), avec le PDF en pièce jointe.
 * - annulée : refus ;
 * - brouillon : vérifie destinataires et configuration SMTP AVANT d'émettre (numéro définitif), puis envoie ;
 * - émise : passe à « envoyée » ; déjà envoyée ou payée (duplicata) : seule la date d'envoi change.
 */
export async function envoyerFacture(supabase: SupabaseClient, factureId: string): Promise<ResultatEnvoi> {
  let donnees: FactureComplete | null;
  try {
    donnees = await chargerFactureComplete(supabase, factureId);
  } catch (e) {
    return { ok: false, erreur: `Chargement de la facture impossible : ${messageDe(e)}` };
  }
  if (!donnees) return { ok: false, erreur: "Facture introuvable : elle a peut-être été supprimée." };

  const statutInitial = donnees.facture.statut;
  if (statutInitial === "annulee") {
    const numero = donnees.facture.numero ? ` ${donnees.facture.numero}` : "";
    return { ok: false, erreur: `La facture${numero} est annulée : elle ne peut pas être envoyée.` };
  }

  // Contrôles préalables : on n'attribue jamais de numéro à un brouillon qui ne pourrait pas partir.
  if (destinatairesFacture(donnees.client).length === 0) {
    return {
      ok: false,
      erreur: `Aucune adresse e-mail pour ${nomClient(donnees.client)} : complétez la fiche client avant d'envoyer la facture.`,
    };
  }
  if (!emailConfigure()) {
    return {
      ok: false,
      erreur: "L'envoi d'e-mails n'est pas configuré (variables SMTP manquantes) : voir les Paramètres.",
    };
  }

  if (statutInitial === "brouillon") {
    if (donnees.lignes.length === 0) {
      return {
        ok: false,
        erreur: "La facture ne contient aucune ligne : ajoutez au moins une ligne avant de l'envoyer.",
      };
    }
    try {
      await emettreFacture(supabase, factureId);
      donnees = await chargerFactureComplete(supabase, factureId);
    } catch (e) {
      return { ok: false, erreur: `Émission de la facture impossible : ${messageDe(e)}` };
    }
    if (!donnees) return { ok: false, erreur: "Facture introuvable après son émission." };
  }

  const { facture, entite } = donnees;
  // Facture émise : coordonnées figées à l'émission (les mêmes que celles imprimées sur le PDF).
  const destinataires = destinatairesFacture(donnees.client);
  if (destinataires.length === 0) {
    return { ok: false, erreur: `Aucune adresse e-mail pour ${nomClient(donnees.client)}.` };
  }

  const objet = remplirModele(entite.email_objet, donnees).trim() || `Facture ${facture.numero ?? ""}`.trim();
  const texte = remplirModele(entite.email_corps, donnees);
  const nomFichier = nomFichierFacture(facture);

  let pdf: Buffer;
  try {
    pdf = await genererPdfFacture(donnees);
  } catch (e) {
    console.error(`PDF de la facture ${facture.numero} : génération impossible :`, e);
    const erreur = `Génération du PDF impossible : ${messageDe(e)}`;
    await journaliser(supabase, {
      facture_id: facture.id,
      destinataires,
      objet,
      succes: false,
      erreur,
      message_id: null,
    });
    return { ok: false, erreur };
  }

  let messageId: string;
  try {
    ({ messageId } = await envoyerEmail({
      a: destinataires,
      objet,
      texte,
      html: construireHtmlEmail({
        texte,
        titre: entite.nom,
        couleur: entite.couleur_primaire,
        pied: piedEmail(entite, nomFichier),
      }),
      cci: adressesCopie(entite.email_copie),
      pieceJointe: { nom: nomFichier, contenu: pdf },
    }));
  } catch (e) {
    console.error(`Envoi de la facture ${facture.numero} impossible :`, e);
    const erreur = messageErreurEmail(e);
    await journaliser(supabase, {
      facture_id: facture.id,
      destinataires,
      objet,
      succes: false,
      erreur,
      message_id: null,
    });
    return { ok: false, erreur };
  }

  await journaliser(supabase, {
    facture_id: facture.id,
    destinataires,
    objet,
    succes: true,
    erreur: null,
    message_id: messageId || null,
  });

  // L'e-mail est parti : un échec de mise à jour du statut est journalisé mais pas signalé comme un échec d'envoi.
  const maintenant = new Date().toISOString();
  const miseAJour =
    facture.statut === "emise" ? { statut: "envoyee" as const, envoyee_le: maintenant } : { envoyee_le: maintenant };
  const { error } = await supabase.from("factures").update(miseAJour).eq("id", facture.id);
  if (error) console.error(`Facture ${facture.numero} envoyée mais statut non mis à jour :`, error.message);

  return { ok: true, destinataires };
}

/** Envoie plusieurs factures l'une après l'autre ; une erreur n'interrompt pas les suivantes. */
export async function envoyerFactures(
  supabase: SupabaseClient,
  ids: string[],
): Promise<{ id: string; ok: boolean; erreur?: string }[]> {
  const resultats: { id: string; ok: boolean; erreur?: string }[] = [];
  for (const id of ids) {
    try {
      const r = await envoyerFacture(supabase, id);
      resultats.push(r.ok ? { id, ok: true } : { id, ok: false, erreur: r.erreur });
    } catch (e) {
      console.error(`Envoi de la facture ${id} interrompu :`, e);
      resultats.push({ id, ok: false, erreur: messageDe(e) });
    }
  }
  return resultats;
}
