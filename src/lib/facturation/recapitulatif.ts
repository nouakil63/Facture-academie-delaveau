import { echapperHtml as echapper } from "@/lib/email";
import { formatEuros, formatPeriode, pluriel } from "@/lib/format";

/*
 * E-mail récapitulatif de l'envoi automatique (tâche planifiée), adressé aux utilisateurs de
 * l'application (table `membres`) et à la copie cachée des paramètres (`email_copie`).
 * Module pur : composition du message seulement, l'envoi se fait avec envoyerEmail.
 */

export interface FactureEnvoyee {
  client: string;
  numero: string | null;
  montant_ttc_centimes: number;
}

export interface FactureEnEchec {
  client: string;
  /** Numéro si la facture a été émise avant l'échec de l'envoi. */
  numero: string | null;
  erreur: string;
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
 * Compose le récapitulatif : nombre de factures envoyées et total TTC, liste (client, numéro,
 * montant), échecs avec leur raison et lien vers les brouillons à reprendre.
 * `urlApplication` : adresse de l'application sans « / » final (null → pas de lien).
 */
export function composerRecapitulatif(donnees: {
  periode: string;
  envoyees: readonly FactureEnvoyee[];
  echecs: readonly FactureEnEchec[];
  urlApplication: string | null;
}): Recapitulatif {
  const { periode, envoyees, echecs, urlApplication } = donnees;
  const total = envoyees.reduce((s, f) => s + f.montant_ttc_centimes, 0);
  const objet = `Factures ${deMois(periode)} envoyées automatiquement`;
  const bilan = `${pluriel(envoyees.length, "facture envoyée", "factures envoyées")} — total ${formatEuros(total)}`;
  const lien = urlApplication ? `${urlApplication}/factures?statut=brouillon` : null;
  const numero = (n: string | null) => n ?? "sans numéro";

  const texte: string[] = [objet, "", bilan];
  if (envoyees.length > 0) {
    texte.push("", ...envoyees.map((f) => `- ${f.client} — ${numero(f.numero)} — ${formatEuros(f.montant_ttc_centimes)}`));
  }
  if (echecs.length > 0) {
    texte.push(
      "",
      `Échecs : ${echecs.length}`,
      ...echecs.map((f) => `- ${f.client}${f.numero ? ` (${f.numero})` : ""} : ${f.erreur}`),
    );
    if (lien) texte.push("", `À reprendre dans l'application : ${lien}`);
  }
  texte.push("", "Message automatique de l'application de facturation.");

  const td = 'style="padding:4px 12px 4px 0;border-bottom:1px solid #e5e7eb"';
  const html: string[] = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.5">',
    `<p style="font-size:16px;font-weight:bold;margin:0 0 12px">${echapper(bilan)}</p>`,
  ];
  if (envoyees.length > 0) {
    html.push(
      '<table style="border-collapse:collapse;margin:0 0 16px">',
      `<tr><th align="left" ${td}>Client</th><th align="left" ${td}>Numéro</th><th align="right" ${td}>Montant TTC</th></tr>`,
      ...envoyees.map(
        (f) =>
          `<tr><td ${td}>${echapper(f.client)}</td><td ${td}>${echapper(numero(f.numero))}</td>` +
          `<td align="right" ${td}>${echapper(formatEuros(f.montant_ttc_centimes))}</td></tr>`,
      ),
      "</table>",
    );
  }
  if (echecs.length > 0) {
    html.push(
      `<p style="font-weight:bold;color:#b91c1c;margin:0 0 4px">Échecs : ${echecs.length}</p>`,
      '<ul style="margin:0 0 12px;padding-left:20px">',
      ...echecs.map(
        (f) =>
          `<li><strong>${echapper(f.client)}</strong>${f.numero ? ` (${echapper(f.numero)})` : ""} : ${echapper(f.erreur)}</li>`,
      ),
      "</ul>",
    );
    if (lien) {
      html.push(`<p style="margin:0 0 12px"><a href="${echapper(lien)}">Reprendre dans l'application</a></p>`);
    }
  }
  html.push('<p style="color:#6b7280;font-size:12px;margin:16px 0 0">Message automatique de l\'application de facturation.</p>', "</div>");

  return { objet, texte: texte.join("\n"), html: html.join("\n") };
}
