import { formatQuantite, sansEspacesSpeciales } from "@/lib/format";

/*
 * Outils communs aux documents PDF (facture, avis d'échéance) : texte compatible Helvetica,
 * couleurs de la charte, dates, dimensions de la page et du pied.
 *
 * Helvetica (police standard du PDF, encodage WinAnsi) ne connaît pas certains caractères
 * Unicode — notamment l'espace fine insécable U+202F produite par Intl pour les montants.
 * Tout texte affiché passe donc par `t()` (→ sansEspacesSpeciales) ou formatEurosPdf.
 */

/** Texte compatible Helvetica/WinAnsi : espaces spéciales → espace simple, caractères invisibles retirés. */
export function t(valeur: string | number | null | undefined): string {
  if (valeur == null) return "";
  return sansEspacesSpeciales(String(valeur))
    .replace(/[\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u2010\u2011\u2212]/g, "-")
    .replace(/\r\n?/g, "\n");
}

export function rempli(valeur: string | null | undefined): valeur is string {
  return valeur != null && valeur.trim() !== "";
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function couleurValide(couleur: string | null | undefined, defaut: string): string {
  return couleur && HEX.test(couleur) ? couleur : defaut;
}

/** Mélange une couleur avec du blanc : proportion 0 → blanc, 1 → couleur d'origine. */
export function teinte(hex: string, proportion: number): string {
  const canaux = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${canaux
    .map((c) => Math.round(255 + (c - 255) * proportion))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Assombrit une couleur : proportion 0 → couleur d'origine, 1 → noir. */
export function assombrir(hex: string, proportion: number): string {
  const canaux = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${canaux
    .map((c) => Math.round(c * (1 - proportion)))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** "2026-09-24" + 30 → "2026-10-24". */
export function ajouterJours(dateIso: string, jours: number): string {
  const [a, m, j] = dateIso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j + jours)).toISOString().slice(0, 10);
}

export function formatTaux(taux: number): string {
  return `${formatQuantite(taux)} %`;
}

export function villeComplete(codePostal: string | null, ville: string | null): string {
  return [codePostal, ville].filter(rempli).join(" ");
}

// -----------------------------------------------------------------------------
// Dimensions
// -----------------------------------------------------------------------------

export const A4_LARGEUR = 595.28;
export const A4_HAUTEUR = 841.89;
export const MARGE_X = 42;
export const MARGE_HAUT = 38;
export const LARGEUR_UTILE = A4_LARGEUR - 2 * MARGE_X;
export const BAS_PIED = 22;
export const TAILLE_PIED = 6.8;
export const INTERLIGNE_PIED = 1.4;
export const LARGEUR_NUMERO_PAGE = 34;

export const ENCRE = "#1C2430";
export const DISCRET = "#5B6573";
export const FILET = "#E3E7ED";
export const ROUGE = "#B42318";
export const VERT = "#067647";

/**
 * Hauteur (en points) réservée au pied de page fixe. Estimation prudente (largeur moyenne
 * d'un caractère Helvetica ≈ 0,5 em ; on compte 0,55 em) : mieux vaut un peu de marge
 * qu'un chevauchement du contenu.
 */
export function hauteurPied(paragraphes: string[], ligneLegale: string): number {
  const hauteurLigne = TAILLE_PIED * INTERLIGNE_PIED;
  const caracteresParLigne = Math.floor(LARGEUR_UTILE / (TAILLE_PIED * 0.55));
  const lignes = (texte: string, largeurCar: number) =>
    texte.split("\n").reduce((n, para) => n + Math.max(1, Math.ceil(para.length / largeurCar)), 0);

  let hauteur = 9; // filet + marge haute
  for (const p of paragraphes) hauteur += lignes(p, caracteresParLigne) * hauteurLigne + 2.5;
  hauteur +=
    lignes(ligneLegale, Math.floor((LARGEUR_UTILE - LARGEUR_NUMERO_PAGE - 8) / (7.2 * 0.6))) * (7.2 * INTERLIGNE_PIED) +
    3;
  return hauteur;
}

/** Logo : largeur/hauteur connues (logo intégré) ou cadre ajusté (URL). */
export function styleLogo(logoRatio?: number) {
  return logoRatio
    ? { width: 150, height: 150 / logoRatio }
    : { width: 170, height: 62, objectFit: "contain" as const, objectPositionX: 0 };
}
