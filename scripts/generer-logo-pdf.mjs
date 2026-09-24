#!/usr/bin/env node
/**
 * Génère src/lib/pdf/logo.ts : le logo Delaveau intégré au PDF des factures (PNG en base64).
 *
 * Le PDF est rendu côté serveur (Vercel) où le dossier public/ n'est pas lisible
 * de façon fiable : le logo est donc embarqué dans le code.
 *
 * Usage : node scripts/generer-logo-pdf.mjs
 * À relancer après toute modification de public/brand/logo-delaveau-pdf.png.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(racine, "public/brand/logo-delaveau-pdf.png");
const cible = join(racine, "src/lib/pdf/logo.ts");

const png = readFileSync(source);
const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (!png.subarray(0, 8).equals(SIGNATURE_PNG)) {
  console.error(`Le fichier ${relative(racine, source)} n'est pas une image PNG.`);
  process.exit(1);
}
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
console.log(`${relative(racine, cible)} généré (${largeur} × ${hauteur} px, ${Math.round(png.length / 1024)} Ko).`);
