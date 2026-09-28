import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { AvisComplet, Echeance, Facture, FactureComplete } from "@/lib/types";
import { AvisEcheancePdf } from "./AvisEcheancePdf";
import { FacturePdf } from "./FacturePdf";
import { LOGO_DELAVEAU_PNG, LOGO_DELAVEAU_RATIO } from "./logo";

/*
 * Génération des PDF (serveur uniquement : routes API, envoi par e-mail) : facture
 * (ponctuelle ou annuelle, avec son échéancier) et avis d'échéance.
 */

/** Logo à imprimer : l'URL des paramètres si c'est une adresse http(s) absolue, sinon le logo Delaveau intégré. */
function logoEmetteur(logoUrl: string | null | undefined): { logo: string; ratio?: number } {
  const url = (logoUrl ?? "").trim();
  if (/^https?:\/\/\S+$/i.test(url)) return { logo: url };
  return { logo: LOGO_DELAVEAU_PNG, ratio: LOGO_DELAVEAU_RATIO };
}

/**
 * Rend la facture (brouillon, émise, payée, annulée) au format PDF A4, avec la charte,
 * les mentions et l'IBAN de l'émetteur (paramètres, figés à l'émission) et l'académie du client.
 */
export async function genererPdfFacture(donnees: FactureComplete): Promise<Buffer> {
  const { facture, lignes, client, emetteur, academie, echeances } = donnees;
  const { logo, ratio } = logoEmetteur(emetteur.logo_url);
  return renderToBuffer(FacturePdf({ facture, lignes, client, emetteur, academie, logo, logoRatio: ratio, echeances }));
}

/**
 * Rend un avis d'échéance (document non fiscal) au format PDF A4 : montant à payer, date
 * limite, coordonnées bancaires et référence à rappeler (numéro de l'avis), avec l'émetteur
 * figé de la facture annuelle.
 */
export async function genererPdfAvis(donnees: AvisComplet): Promise<Buffer> {
  const { echeance, echeances, facture, client, emetteur, academie } = donnees;
  const { logo, ratio } = logoEmetteur(emetteur.logo_url);
  return renderToBuffer(
    AvisEcheancePdf({ echeance, echeances, facture, client, emetteur, academie, logo, logoRatio: ratio }),
  );
}

/** Nom du fichier PDF d'un avis : « Avis-E1-2026-09.pdf ». */
export function nomFichierAvis(echeance: Pick<Echeance, "numero_avis">): string {
  return `Avis-${echeance.numero_avis.replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`;
}

/** Nom du fichier PDF : « Facture-AD-2026-0001.pdf », ou « Brouillon-2026-10-1a2b3c4d.pdf » avant émission. */
export function nomFichierFacture(facture: Facture): string {
  if (facture.numero) {
    return `Facture-${facture.numero.replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`;
  }
  const periode = facture.periode ? `-${facture.periode.slice(0, 7)}` : "";
  return `Brouillon${periode}-${facture.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 8)}.pdf`;
}
