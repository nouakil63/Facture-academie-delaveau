import "server-only";
import { createTransport } from "nodemailer";
import { formatDate, formatEuros, formatPeriode, nomClient } from "@/lib/format";
import type { FactureComplete } from "@/lib/types";

/*
 * Envoi d'e-mails par SMTP (boîte mail de l'académie), avec nodemailer.
 *
 * Variables d'environnement :
 *   SMTP_HOST, SMTP_USER, SMTP_PASSWORD   obligatoires
 *   SMTP_PORT        défaut 465
 *   SMTP_SECURE      défaut true si le port est 465 (TLS implicite), sinon STARTTLS
 *   EMAIL_FROM       expéditeur affiché, défaut SMTP_USER
 *   EMAIL_REPLY_TO   adresse de réponse (facultative)
 */

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

interface ConfigSmtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  replyTo: string | undefined;
}

const VARIABLES_OBLIGATOIRES = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"] as const;

function lireVariable(nom: string): string | undefined {
  const valeur = process.env[nom]?.trim();
  return valeur ? valeur : undefined;
}

/** Variables SMTP obligatoires absentes (liste vide si l'envoi est configuré). */
export function variablesEmailManquantes(): string[] {
  return VARIABLES_OBLIGATOIRES.filter((nom) => !lireVariable(nom));
}

function lireConfig(): ConfigSmtp | null {
  const host = lireVariable("SMTP_HOST");
  const user = lireVariable("SMTP_USER");
  const pass = lireVariable("SMTP_PASSWORD");
  if (!host || !user || !pass) return null;

  const portSaisi = Number(lireVariable("SMTP_PORT") ?? 465);
  const port = Number.isInteger(portSaisi) && portSaisi > 0 && portSaisi < 65536 ? portSaisi : 465;
  const secureSaisi = lireVariable("SMTP_SECURE");
  const secure = secureSaisi ? /^(1|true|oui|yes|on)$/i.test(secureSaisi) : port === 465;

  return {
    host,
    port,
    secure,
    user,
    pass,
    from: lireVariable("EMAIL_FROM") ?? user,
    replyTo: lireVariable("EMAIL_REPLY_TO"),
  };
}

/** true si les variables SMTP nécessaires à l'envoi sont définies. */
export function emailConfigure(): boolean {
  return lireConfig() !== null;
}

// -----------------------------------------------------------------------------
// Transport (créé à la première utilisation, recréé si la configuration change)
// -----------------------------------------------------------------------------

function creerTransport(config: ConfigSmtp) {
  return createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    // Fonction serverless : on n'attend jamais indéfiniment le serveur SMTP.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

let transport: { cle: string; instance: ReturnType<typeof creerTransport> } | null = null;

function obtenirTransport(config: ConfigSmtp) {
  const cle = JSON.stringify([config.host, config.port, config.secure, config.user, config.pass]);
  if (!transport || transport.cle !== cle) {
    transport?.instance.close();
    transport = { cle, instance: creerTransport(config) };
  }
  return transport.instance;
}

// -----------------------------------------------------------------------------
// Envoi
// -----------------------------------------------------------------------------

export interface MessageEmail {
  a: string[];
  objet: string;
  texte: string;
  html?: string;
  cci?: string[];
  pieceJointe?: { nom: string; contenu: Buffer };
}

/** Adresses nettoyées : espaces retirés, vides et doublons supprimés (comparaison insensible à la casse). */
function nettoyerAdresses(adresses: readonly (string | null | undefined)[]): string[] {
  const vues = new Set<string>();
  const resultat: string[] = [];
  for (const brute of adresses) {
    const adresse = (brute ?? "").trim();
    const cle = adresse.toLowerCase();
    if (adresse === "" || vues.has(cle)) continue;
    vues.add(cle);
    resultat.push(adresse);
  }
  return resultat;
}

/**
 * Envoie un e-mail. Lève une Error si l'envoi n'est pas configuré, s'il n'y a aucun
 * destinataire ou si le serveur SMTP refuse le message (voir messageErreurEmail).
 */
export async function envoyerEmail(msg: MessageEmail): Promise<{ messageId: string }> {
  const config = lireConfig();
  if (!config) {
    throw new Error(
      `L'envoi d'e-mails n'est pas configuré : variable(s) manquante(s) ${variablesEmailManquantes().join(", ")}.`,
    );
  }
  const a = nettoyerAdresses(msg.a);
  if (a.length === 0) throw new Error("Aucun destinataire pour cet e-mail.");
  const dejaDestinataires = new Set(a.map((x) => x.toLowerCase()));
  const cci = nettoyerAdresses(msg.cci ?? []).filter((x) => !dejaDestinataires.has(x.toLowerCase()));

  const info = await obtenirTransport(config).sendMail({
    from: config.from,
    replyTo: config.replyTo,
    to: a,
    bcc: cci.length > 0 ? cci : undefined,
    subject: msg.objet,
    text: msg.texte,
    html: msg.html,
    attachments: msg.pieceJointe
      ? [
          {
            filename: msg.pieceJointe.nom,
            content: msg.pieceJointe.contenu,
            contentType: msg.pieceJointe.nom.toLowerCase().endsWith(".pdf") ? "application/pdf" : undefined,
          },
        ]
      : undefined,
  });

  if (Array.isArray(info.accepted) && info.accepted.length === 0) {
    throw new Error("Le serveur d'envoi a refusé tous les destinataires.");
  }
  return { messageId: String(info.messageId ?? "") };
}

/** Traduit une erreur d'envoi (nodemailer / SMTP) en message clair pour l'utilisateur. */
export function messageErreurEmail(erreur: unknown): string {
  const e = (erreur ?? {}) as { code?: unknown; message?: unknown; responseCode?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const brut = typeof e.message === "string" ? e.message : String(erreur);
  switch (code) {
    case "EAUTH":
    case "ENOAUTH":
      return "Le serveur d'envoi a refusé l'identification : vérifiez SMTP_USER et SMTP_PASSWORD (mot de passe d'application pour Gmail).";
    case "ECONNECTION":
    case "ETIMEDOUT":
    case "ESOCKET":
    case "EDNS":
      return `Serveur d'envoi injoignable (${lireVariable("SMTP_HOST") ?? "SMTP_HOST non défini"}) : vérifiez SMTP_HOST et SMTP_PORT, puis réessayez.`;
    case "ETLS":
      return "Connexion sécurisée impossible avec le serveur d'envoi : vérifiez SMTP_PORT et SMTP_SECURE (465 → true, 587 → false).";
    case "EENVELOPE":
      return `Adresse refusée par le serveur d'envoi : vérifiez les adresses e-mail du client. (${brut})`;
    case "EMESSAGE":
      return `Le serveur d'envoi a refusé le message. (${brut})`;
    default:
      return brut.startsWith("L'envoi d'e-mails") ||
        brut.startsWith("Aucun destinataire") ||
        brut.startsWith("Le serveur")
        ? brut
        : `Échec de l'envoi de l'e-mail : ${brut}`;
  }
}

// -----------------------------------------------------------------------------
// Modèles
// -----------------------------------------------------------------------------

/**
 * Remplace les variables d'un modèle d'e-mail (objet ou corps, définis dans les paramètres) :
 *   {client}    nom du client          {numero}   numéro de la facture (« brouillon » avant émission)
 *   {montant}   montant TTC            {echeance} date d'échéance
 *   {periode}   mois facturé           {objet}    objet de la facture
 *   {structure} raison sociale de l'association (émetteur)
 *   {academie}  académie du client (Académie Delaveau / Académie Espoir)
 * Les accolades inconnues sont laissées telles quelles.
 */
export function remplirModele(modele: string, donnees: FactureComplete): string {
  const { facture, client, emetteur, academie } = donnees;
  const valeurs: Record<string, string> = {
    client: nomClient(client),
    numero: facture.numero ?? "brouillon",
    montant: formatEuros(facture.total_ttc_centimes),
    echeance: formatDate(facture.date_echeance),
    periode: facture.periode ? formatPeriode(facture.periode) : "",
    structure: emetteur.raison_sociale,
    academie: academie.nom,
    objet: facture.objet ?? "",
  };
  return modele.replace(/\{([a-z]+)\}/g, (tout, nom: string) =>
    Object.prototype.hasOwnProperty.call(valeurs, nom) ? valeurs[nom] : tout,
  );
}

// -----------------------------------------------------------------------------
// HTML
// -----------------------------------------------------------------------------

/** Échappe les caractères spéciaux HTML. */
export function echapperHtml(texte: string): string {
  return texte
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Texte brut → HTML : échappé, sauts de ligne convertis en <br>. */
export function texteVersHtml(texte: string): string {
  return echapperHtml(texte.replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>\n");
}

export interface OptionsHtmlEmail {
  /** Corps du message en texte brut (sera échappé). */
  texte: string;
  /** Nom affiché dans le bandeau (raison sociale de l'émetteur, ex. « Académie Delaveau »). */
  titre: string;
  /** Mention discrète sous le titre (ex. l'académie du client « Académie Espoir ») ; ignorée si identique au titre. */
  sousTitre?: string | null;
  /** Couleur du bandeau (#RRGGBB) : couleur primaire des paramètres, défaut bleu Delaveau. */
  couleur?: string | null;
  /** Couleur du filet sous le bandeau (#RRGGBB) : couleur secondaire des paramètres, défaut gris Delaveau. */
  couleurSecondaire?: string | null;
  /** Ligne de pied discrète (coordonnées de l'émetteur), en texte brut. */
  pied?: string | null;
}

const COULEUR_HEX = /^#[0-9A-Fa-f]{6}$/;

/** Gabarit HTML sobre (tableaux et styles en ligne, compatible avec les messageries), aux couleurs de l'émetteur. */
export function construireHtmlEmail({
  texte,
  titre,
  sousTitre,
  couleur,
  couleurSecondaire,
  pied,
}: OptionsHtmlEmail): string {
  const bandeau = couleur && COULEUR_HEX.test(couleur) ? couleur : "#0050A0";
  const filet = couleurSecondaire && COULEUR_HEX.test(couleurSecondaire) ? couleurSecondaire : "#DADADA";
  const mention = (sousTitre ?? "").trim();
  const afficherMention = mention !== "" && mention.toLowerCase() !== titre.trim().toLowerCase();
  const police = "Helvetica, Arial, sans-serif";
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${echapperHtml(titre)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f7fa;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f7fa;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid #e3e7ed;border-radius:8px;">
<tr><td style="background-color:${bandeau};padding:18px 28px;border-radius:8px 8px 0 0;border-bottom:3px solid ${filet};font-family:${police};font-size:18px;font-weight:bold;letter-spacing:0.5px;color:#ffffff;">${echapperHtml(titre)}${
    afficherMention
      ? `<div style="margin-top:2px;font-size:13px;font-weight:normal;letter-spacing:0.3px;color:#ffffff;opacity:0.85;">${echapperHtml(mention)}</div>`
      : ""
  }</td></tr>
<tr><td style="padding:28px;font-family:${police};font-size:15px;line-height:1.6;color:#1c2430;">
${texteVersHtml(texte)}
</td></tr>${
    pied
      ? `
<tr><td style="padding:14px 28px 18px;border-top:1px solid #e3e7ed;font-family:${police};font-size:12px;line-height:1.5;color:#5b6573;">${texteVersHtml(pied)}</td></tr>`
      : ""
  }
</table>
</td></tr>
</table>
</body>
</html>`;
}
