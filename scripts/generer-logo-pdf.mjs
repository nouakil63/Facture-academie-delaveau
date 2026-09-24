#!/usr/bin/env node
/**
 * Prépare les logos « fond clair » à partir du logo d'origine, puis génère
 * src/lib/pdf/logo.ts (logo intégré au PDF des factures, PNG en base64).
 *
 * Le logo d'origine (public/brand/logo-delaveau.png) est conçu pour un fond sombre :
 * « ACADÉMIE » et « SPORT ÉTUDES ÉQUITATION » sont blancs, « DELAVEAU » gris très clair.
 * Sur l'application (fond blanc) et sur la facture imprimée, ces textes disparaissent.
 * Ce script recolore les pixels gris/blancs (texte) dans un gris lisible, sans toucher
 * au bleu, au trait noir du cheval ni à la transparence :
 *   - public/brand/logo-delaveau-fond-clair.png  (pleine résolution, pour l'application)
 *   - public/brand/logo-delaveau-pdf.png         (700 px de large, pour le PDF)
 *
 * Le PDF est rendu côté serveur (Vercel) où le dossier public/ n'est pas lisible
 * de façon fiable : le logo du PDF est donc embarqué dans le code.
 *
 * Usage : node scripts/generer-logo-pdf.mjs
 * À relancer après toute modification de public/brand/logo-delaveau.png.
 */
import { writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const origine = join(racine, "public/brand/logo-delaveau.png");
const fondClair = join(racine, "public/brand/logo-delaveau-fond-clair.png");
const pourPdf = join(racine, "public/brand/logo-delaveau-pdf.png");
const cible = join(racine, "src/lib/pdf/logo.ts");

/** Gris du texte du logo sur fond clair (lisible à l'écran comme à l'impression). */
const GRIS_TEXTE = { r: 0x70, g: 0x77, b: 0x81 };
/** Au-dessus de cette luminosité, un pixel neutre (gris) est du texte à recolorer. */
const SEUIL_TEXTE = 120;

const { data, info } = await sharp(origine).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let recolores = 0;
for (let i = 0; i < data.length; i += 4) {
  const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
  if (a === 0) continue;
  const neutre = Math.max(r, g, b) - Math.min(r, g, b) <= 12;
  if (neutre && Math.min(r, g, b) >= SEUIL_TEXTE) {
    data[i] = GRIS_TEXTE.r;
    data[i + 1] = GRIS_TEXTE.g;
    data[i + 2] = GRIS_TEXTE.b;
    recolores++;
  }
}
const image = () => sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
await image().png({ compressionLevel: 9 }).toFile(fondClair);
const png = await image().resize({ width: 700 }).png({ compressionLevel: 9, palette: false }).toBuffer();
writeFileSync(pourPdf, png);

// En-tête IHDR : largeur et hauteur (octets 16 à 23), utiles pour conserver les proportions.
const largeur = png.readUInt32BE(16);
const hauteur = png.readUInt32BE(20);

const contenu = `/*
 * Fichier généré par scripts/generer-logo-pdf.mjs — ne pas modifier à la main.
 * Source : public/brand/logo-delaveau-pdf.png (${largeur} × ${hauteur} px, ${png.length} octets).
 */

/** Logo Académie Delaveau (PNG) au format data URI, utilisé quand l'émetteur n'a pas de logo_url. */
export const LOGO_DELAVEAU_PNG =
  "data:image/png;base64,${png.toString("base64")}";

/** Proportions du logo intégré (largeur / hauteur). */
export const LOGO_DELAVEAU_RATIO = ${(largeur / hauteur).toFixed(4)};
`;

writeFileSync(cible, contenu);
console.log(`${relative(racine, fondClair)} : ${recolores} pixels de texte recolorés.`);
console.log(`${relative(racine, cible)} généré (${largeur} × ${hauteur} px, ${Math.round(png.length / 1024)} Ko).`);
