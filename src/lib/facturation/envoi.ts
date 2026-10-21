import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { construireHtmlEmail, emailConfigure, envoyerEmail, messageErreurEmail, remplirModele } from "@/lib/email";
import {
  chargerFactureComplete,
  chargerParametres,
  destinatairesFacture,
  emettreFacture,
} from "@/lib/facturation/service";
import { nomClient } from "@/lib/format";
import { genererPdfFacture, nomFichierFacture } from "@/lib/pdf";
import type { FactureComplete, Parametres } from "@/lib/types";

/*
 * Envoi d'une facture par e-mail : émission du brouillon si besoin, PDF en pièce jointe,
 * journal des envois (succès ET échecs) et mise à jour du statut.
 * Partagé par les Server Actions (client Supabase de l'utilisateur) et la tâche planifiée
 * (client admin). Ne lève jamais d'exception : retourne { ok: false, erreur }.
 *
 * Le PDF imprime l'émetteur figé à l'émission (FactureComplete.emetteur) ; l'e-mail, lui,
 * utilise les paramètres actuels : modèles d'objet et de corps, copie cachée d'archivage,
 * couleurs et coordonnées du pied (un duplicata part avec les réglages du jour).
 * Les destinataires sont ceux de la fiche client actuelle (les adresses e-mail ne sont pas
 * imprimées sur la facture, donc pas figées) : une adresse corrigée sert dès le prochain envoi.
 */

export type ResultatEnvoi =
  | {
      ok: true;
      /** Adresses qui ont reçu l'e-mail. */
      destinataires: string[];
      /** Adresses en copie refusées par le serveur d'envoi (l'adresse principale, elle, a été acceptée). */
      refusees: string[];
    }
  | {
      ok: false;
      erreur: string;
      /** true : rien n'a été tenté (ex. facture déjà émise par un autre envoi, avec `exigerBrouillon`). */
      ignoree?: true;
    };

export interface OptionsEnvoi {
  /**
   * Envoi de brouillons (facturation mensuelle, cron) : une facture qui n'est plus un brouillon
   * au moment de l'envoi (émise ou envoyée entre-temps par un autre lot) est ignorée, sans e-mail.
   */
  exigerBrouillon?: boolean;
}

const DEJA_EMISE = "Ignorée : émise entre-temps. Si elle est restée « Émise », l'envoyer depuis sa fiche.";

function messageDe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  return "erreur inconnue";
}

/** Adresse(s) en copie cachée (paramètres, archivage) : « a@x.fr » ou « a@x.fr, b@y.fr ». */
function adressesCopie(emailCopie: string | null): string[] {
  return (emailCopie ?? "")
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter((a) => a.includes("@"));
}

/** Ligne de pied de l'e-mail : coordonnées de l'association. */
function piedEmail(parametres: Parametres, nomFichier: string): string {
  const adresse = [parametres.adresse_ligne1, [parametres.code_postal, parametres.ville].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const coordonnees = [parametres.raison_sociale, adresse, parametres.email_contact, parametres.telephone]
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
export async function envoyerFacture(
  supabase: SupabaseClient,
  factureId: string,
  options: OptionsEnvoi = {},
): Promise<ResultatEnvoi> {
  let donnees: FactureComplete | null;
  try {
    donnees = await chargerFactureComplete(supabase, factureId);
  } catch (e) {
    return { ok: false, erreur: `Chargement de la facture impossible : ${messageDe(e)}` };
  }
  if (!donnees) return { ok: false, erreur: "Facture introuvable : elle a peut-être été supprimée entre-temps." };

  const statutInitial = donnees.facture.statut;
  if (statutInitial === "annulee") {
    const numero = donnees.facture.numero ? ` ${donnees.facture.numero}` : "";
    return { ok: false, erreur: `La facture${numero} est annulée : envoi impossible.` };
  }
  if (options.exigerBrouillon && statutInitial !== "brouillon") {
    return { ok: false, erreur: DEJA_EMISE, ignoree: true };
  }

  // Contrôles préalables : on n'attribue jamais de numéro à un brouillon qui ne pourrait pas partir.
  if (destinatairesFacture(donnees.client).length === 0) {
    return {
      ok: false,
      erreur: `Aucune adresse e-mail pour ${nomClient(donnees.client)} : compléter la fiche client avant d'envoyer la facture.`,
    };
  }
  if (!emailConfigure()) {
    return {
      ok: false,
      erreur: "Envoi d'e-mails non configuré (variables SMTP manquantes) : voir les Paramètres.",
    };
  }

  // Modèles d'e-mail et copie cachée : paramètres actuels (lus avant toute émission).
  let parametres: Parametres;
  try {
    parametres = await chargerParametres(supabase);
  } catch (e) {
    return { ok: false, erreur: `Lecture des paramètres impossible : ${messageDe(e)}` };
  }

  if (statutInitial === "brouillon") {
    if (donnees.lignes.length === 0) {
      return {
        ok: false,
        erreur: "Facture sans ligne : en ajouter au moins une avant l'envoi.",
      };
    }
    try {
      await emettreFacture(supabase, factureId);
      donnees = await chargerFactureComplete(supabase, factureId);
    } catch (e) {
      // Émise au même instant par un autre envoi (verrou de emettre_facture) : rien n'est envoyé ici.
      if (options.exigerBrouillon && /est déjà émise/.test(messageDe(e))) {
        return { ok: false, erreur: DEJA_EMISE, ignoree: true };
      }
      return { ok: false, erreur: `Émission de la facture impossible : ${messageDe(e)}` };
    }
    if (!donnees) return { ok: false, erreur: "Facture introuvable après son émission." };
  }

  const { facture, academie } = donnees;
  // Adresses de la fiche client actuelle (chargerFactureComplete ne fige pas les e-mails).
  const destinataires = destinatairesFacture(donnees.client);
  if (destinataires.length === 0) {
    return { ok: false, erreur: `Aucune adresse e-mail pour ${nomClient(donnees.client)}.` };
  }

  const objet = remplirModele(parametres.email_objet, donnees).trim() || `Facture ${facture.numero ?? ""}`.trim();
  const texte = remplirModele(parametres.email_corps, donnees);
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

  // Refus partiel (le serveur a accepté au moins un destinataire) : l'envoi n'est réussi que si
  // l'adresse principale (payeur) a été acceptée.
  const cles = new Set(refusees.map((r) => r.toLowerCase()));
  const acceptees = destinataires.filter((d) => !cles.has(d.toLowerCase()));
  const principaleAcceptee = !cles.has(destinataires[0].toLowerCase());
  await journaliser(supabase, {
    facture_id: facture.id,
    destinataires,
    objet,
    succes: principaleAcceptee,
    erreur: refusees.length > 0 ? `Adresse(s) refusée(s) par le serveur d'envoi : ${refusees.join(", ")}` : null,
    message_id: messageId || null,
  });
  if (!principaleAcceptee) {
    return {
      ok: false,
      erreur: `Adresse principale refusée par le serveur d'envoi (${destinataires[0]}) : la facture n'a été reçue qu'en copie (${acceptees.join(", ")}). Corriger l'adresse sur la fiche client, puis renvoyer la facture.`,
    };
  }

  // L'e-mail est parti : un échec de mise à jour du statut est journalisé mais pas signalé comme un échec d'envoi.
  // Chaque mise à jour est conditionnée au statut attendu : un paiement ou une annulation enregistrés
  // pendant l'envoi ne sont jamais écrasés.
  const maintenant = new Date().toISOString();
  let dejaMisAJour = false;
  if (facture.statut === "emise") {
    const r = await supabase
      .from("factures")
      .update({ statut: "envoyee", envoyee_le: maintenant })
      .eq("id", facture.id)
      .eq("statut", "emise")
      .select("id");
    if (r.error) console.error(`Facture ${facture.numero} envoyée mais statut non mis à jour :`, r.error.message);
    dejaMisAJour = !r.error && (r.data?.length ?? 0) > 0;
  }
  if (!dejaMisAJour) {
    const { error } = await supabase
      .from("factures")
      .update({ envoyee_le: maintenant })
      .eq("id", facture.id)
      .in("statut", ["envoyee", "payee"]);
    if (error) console.error(`Facture ${facture.numero} envoyée mais date d'envoi non mise à jour :`, error.message);
  }

  return { ok: true, destinataires: acceptees, refusees };
}

export interface DemandeRelance {
  factureIds: string[];
  objet: string;
  corps: string;
  /** Contrôle du destinataire validé ; ne remplace jamais les adresses des fiches clients. */
  destinataireAttendu: string;
  apercu: boolean;
}

type ResultatRelance = Extract<ResultatEnvoi, { ok: false }> | {
  ok: true;
  destinataires: string[];
  refusees: string[];
  factures: string[];
  piecesJointes: string[];
  apercu: boolean;
  html?: string;
};

/** Une relance personnalisée et ses PDF, sans modifier les modèles ni les contacts. */
export async function envoyerRelance(supabase: SupabaseClient, demande: DemandeRelance): Promise<ResultatRelance> {
  let donnees: FactureComplete[];
  let parametres: Parametres;
  let destinataires: string[];
  let piecesJointes: { nom: string; contenu: Buffer }[];
  let html: string;
  try {
    const ids = [...new Set(demande.factureIds)];
    if (ids.length === 0 || ids.length > 10 || ids.length !== demande.factureIds.length)
      throw new Error("Sélectionner entre une et dix factures distinctes.");
    if (!emailConfigure()) throw new Error("Envoi d'e-mails non configuré : voir les Paramètres.");
    const chargees = await Promise.all(ids.map((id) => chargerFactureComplete(supabase, id)));
    if (chargees.some((d) => !d)) throw new Error("Une facture est introuvable ou inaccessible.");
    donnees = chargees as FactureComplete[];
    if (donnees.some((d) => !["emise", "envoyee"].includes(d.facture.statut)))
      throw new Error("Seules les factures émises ou envoyées et non marquées payées peuvent être relancées.");
    destinataires = destinatairesFacture(donnees[0].client);
    if (!destinataires.length || destinataires[0].toLowerCase() !== demande.destinataireAttendu.trim().toLowerCase())
      throw new Error("Le destinataire a changé : vérifier la fiche client avant l'envoi.");
    const memeAdresse = (adresses: string[]) => adresses.length === destinataires.length &&
      adresses[0]?.toLowerCase() === destinataires[0].toLowerCase() &&
      adresses.every((a) => destinataires.some((d) => d.toLowerCase() === a.toLowerCase()));
    if (donnees.some((d) => !memeAdresse(destinatairesFacture(d.client))))
      throw new Error("Toutes les factures regroupées doivent avoir les mêmes destinataires.");
    parametres = await chargerParametres(supabase);
    piecesJointes = await Promise.all(donnees.map(async (d) => ({
      nom: nomFichierFacture(d.facture), contenu: await genererPdfFacture(d),
    })));
    html = construireHtmlEmail({
      texte: demande.corps, titre: parametres.raison_sociale, sousTitre: donnees[0].academie.nom,
      couleur: parametres.couleur_primaire, couleurSecondaire: parametres.couleur_secondaire,
      pied: piedEmail(parametres, piecesJointes.map((p) => p.nom).join(", ")),
    });
    // Un paiement enregistré pendant le rendu des PDF doit arrêter la relance.
    const verification = await supabase.from("factures").select("id,statut").in("id", ids);
    if (verification.error || verification.data?.length !== ids.length ||
        verification.data.some((f) => !["emise", "envoyee"].includes(f.statut)))
      throw new Error("Le statut d'une facture a changé : vérifier les règlements avant de relancer.");
  } catch (e) {
    return { ok: false, erreur: messageDe(e) };
  }
  const resultat = {
    ok: true as const, destinataires, refusees: [] as string[], apercu: demande.apercu,
    factures: donnees.map((d) => d.facture.numero ?? d.facture.id),
    piecesJointes: piecesJointes.map((p) => p.nom),
  };
  if (demande.apercu) return { ...resultat, html };

  let messageId: string;
  let refusees: string[];
  try {
    ({ messageId, refusees } = await envoyerEmail({
      a: destinataires, objet: demande.objet, texte: demande.corps, html, piecesJointes,
      cci: adressesCopie(parametres.email_copie),
    }));
  } catch (e) {
    const erreur = messageErreurEmail(e);
    for (const d of donnees) await journaliser(supabase, {
      facture_id: d.facture.id, destinataires, objet: demande.objet, succes: false, erreur, message_id: null,
    });
    return { ok: false, erreur };
  }
  const principaleAcceptee = !refusees.some((a) => a.toLowerCase() === destinataires[0].toLowerCase());
  const erreur = refusees.length ? `Adresse(s) refusée(s) : ${refusees.join(", ")}` : null;
  const maintenant = new Date().toISOString();
  for (const d of donnees) {
    // Après acceptation SMTP, une erreur de suivi ne doit pas provoquer un second envoi.
    try {
      await journaliser(supabase, {
        facture_id: d.facture.id, destinataires, objet: demande.objet,
        succes: principaleAcceptee, erreur, message_id: messageId || null,
      });
      if (principaleAcceptee) {
        const miseAJour = await supabase.from("factures")
          .update({ statut: "envoyee", envoyee_le: maintenant })
          .eq("id", d.facture.id).in("statut", ["emise", "envoyee"]);
        if (miseAJour.error) console.error("Relance envoyée, suivi non mis à jour :", miseAJour.error.message);
      }
    } catch (e) {
      console.error("Relance envoyée, suivi impossible :", messageDe(e));
    }
  }
  if (!principaleAcceptee) return { ok: false, erreur: erreur ?? "Adresse principale refusée." };
  return { ...resultat, destinataires: destinataires.filter((a) => !refusees.includes(a)), refusees };
}

export interface ResultatEnvoiLot {
  id: string;
  ok: boolean;
  erreur?: string;
  /** true : facture ignorée sans tentative d'envoi (voir OptionsEnvoi.exigerBrouillon). */
  ignoree?: boolean;
}

/** Envoie plusieurs factures l'une après l'autre ; une erreur n'interrompt pas les suivantes. */
export async function envoyerFactures(
  supabase: SupabaseClient,
  ids: string[],
  options: OptionsEnvoi = {},
): Promise<ResultatEnvoiLot[]> {
  const resultats: ResultatEnvoiLot[] = [];
  for (const id of ids) {
    try {
      const r = await envoyerFacture(supabase, id, options);
      resultats.push(
        r.ok
          ? {
              id,
              ok: true,
              ...(r.refusees.length > 0 ? { erreur: `Adresse(s) refusée(s) : ${r.refusees.join(", ")}` } : {}),
            }
          : { id, ok: false, erreur: r.erreur, ...(r.ignoree ? { ignoree: true } : {}) },
      );
    } catch (e) {
      console.error(`Envoi de la facture ${id} interrompu :`, e);
      resultats.push({ id, ok: false, erreur: messageDe(e) });
    }
  }
  return resultats;
}
