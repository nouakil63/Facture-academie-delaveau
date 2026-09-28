import { echapperHtml as echapper } from "@/lib/email";
import { formatEuros, formatPeriode, pluriel } from "@/lib/format";

/*
 * E-mail récapitulatif de l'envoi automatique des avis d'échéance (tâche planifiée), adressé
 * aux utilisateurs de l'application (table `membres`) et à la copie cachée des paramètres
 * (`email_copie`). Module pur : composition du message seulement, l'envoi se fait avec envoyerEmail.
 */

export interface AvisEnvoye {
  client: string;
  /** Numéro de l'avis (E1-2026-10). */
  numero_avis: string;
  montant_centimes: number;
}

export interface AvisEnEchec {
  client: string;
  numero_avis: string | null;
  erreur: string;
}

/** Client en envoi automatique sans facture annuelle émise pour la saison : avis impossible. */
export interface ClientATraiter {
  client: string;
  reference: string;
  raison: string;
}

export interface Recapitulatif {
  objet: string;
  texte: string;
  html: string;
}

/** Destinataires du récapitulatif : membres + copie, sans vide ni doublon (casse ignorée). */
export function destinatairesRecapitulatif(membres: readonly string[], copie: string | null | undefined): string[] {
  const vues = new Set<string>();
  const resultat: string[] = [];
  for (const brute of [...membres, copie ?? ""]) {
    const adresse = brute.trim();
    if (adresse === "" || vues.has(adresse.toLowerCase())) continue;
    vues.add(adresse.toLowerCase());
    resultat.push(adresse);
  }
  return resultat;
}

/** « octobre 2026 » → « d'octobre 2026 » ; « mars 2026 » → « de mars 2026 ». */
function deMois(periode: string): string {
  const mois = formatPeriode(periode);
  return /^[aeiouyhàâéèêîôû]/i.test(mois) ? `d'${mois}` : `de ${mois}`;
}

/**
 * Compose le récapitulatif : nombre d'avis envoyés et total, liste (client, numéro d'avis,
 * montant), échecs avec leur raison, clients à traiter (sans facture annuelle émise) et lien
 * vers la facturation de l'année. `urlApplication` : adresse sans « / » final (null → pas de lien).
 */
export function composerRecapitulatif(donnees: {
  periode: string;
  envoyes: readonly AvisEnvoye[];
  echecs: readonly AvisEnEchec[];
  aTraiter: readonly ClientATraiter[];
  urlApplication: string | null;
}): Recapitulatif {
  const { periode, envoyes, echecs, aTraiter, urlApplication } = donnees;
  const total = envoyes.reduce((s, a) => s + a.montant_centimes, 0);
  const objet = `Avis d'échéance ${deMois(periode)} envoyés automatiquement`;
  const bilan = `${pluriel(envoyes.length, "avis envoyé", "avis envoyés")} — total ${formatEuros(total)}`;
  const lien = urlApplication ? `${urlApplication}/facturation-annuelle?mois=${periode.slice(0, 7)}` : null;

  const texte: string[] = [objet, "", bilan];
  if (envoyes.length > 0) {
    texte.push("", ...envoyes.map((a) => `- ${a.client} — ${a.numero_avis} — ${formatEuros(a.montant_centimes)}`));
  }
  if (echecs.length > 0) {
    texte.push(
      "",
      `Échecs : ${echecs.length}`,
      ...echecs.map((a) => `- ${a.client}${a.numero_avis ? ` (${a.numero_avis})` : ""} : ${a.erreur}`),
    );
  }
  if (aTraiter.length > 0) {
    texte.push(
      "",
      `À traiter : ${pluriel(aTraiter.length, "client", "clients")} en envoi automatique sans facture annuelle émise`,
      ...aTraiter.map((c) => `- ${c.client} (${c.reference}) : ${c.raison}`),
    );
  }
  if (lien && (echecs.length > 0 || aTraiter.length > 0)) texte.push("", `À reprendre dans l'application : ${lien}`);
  texte.push("", "Message automatique de l'application de facturation.");

  const td = 'style="padding:4px 12px 4px 0;border-bottom:1px solid #e5e7eb"';
  const html: string[] = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.5">',
    `<p style="font-size:16px;font-weight:bold;margin:0 0 12px">${echapper(bilan)}</p>`,
  ];
  if (envoyes.length > 0) {
    html.push(
      '<table style="border-collapse:collapse;margin:0 0 16px">',
      `<tr><th align="left" ${td}>Client</th><th align="left" ${td}>Avis</th><th align="right" ${td}>Montant</th></tr>`,
      ...envoyes.map(
        (a) =>
          `<tr><td ${td}>${echapper(a.client)}</td><td ${td}>${echapper(a.numero_avis)}</td>` +
          `<td align="right" ${td}>${echapper(formatEuros(a.montant_centimes))}</td></tr>`,
      ),
      "</table>",
    );
  }
  if (echecs.length > 0) {
    html.push(
      `<p style="font-weight:bold;color:#b91c1c;margin:0 0 4px">Échecs : ${echecs.length}</p>`,
      '<ul style="margin:0 0 12px;padding-left:20px">',
      ...echecs.map(
        (a) =>
          `<li><strong>${echapper(a.client)}</strong>${a.numero_avis ? ` (${echapper(a.numero_avis)})` : ""} : ${echapper(a.erreur)}</li>`,
      ),
      "</ul>",
    );
  }
  if (aTraiter.length > 0) {
    html.push(
      `<p style="font-weight:bold;color:#92400e;margin:0 0 4px">À traiter : ${echapper(
        pluriel(aTraiter.length, "client", "clients"),
      )} en envoi automatique sans facture annuelle émise</p>`,
      '<ul style="margin:0 0 12px;padding-left:20px">',
      ...aTraiter.map(
        (c) => `<li><strong>${echapper(c.client)}</strong> (${echapper(c.reference)}) : ${echapper(c.raison)}</li>`,
      ),
      "</ul>",
    );
  }
  if (lien && (echecs.length > 0 || aTraiter.length > 0)) {
    html.push(`<p style="margin:0 0 12px"><a href="${echapper(lien)}">Reprendre dans l'application</a></p>`);
  }
  html.push('<p style="color:#6b7280;font-size:12px;margin:16px 0 0">Message automatique de l\'application de facturation.</p>', "</div>");

  return { objet, texte: texte.join("\n"), html: html.join("\n") };
}
