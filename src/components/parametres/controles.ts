/**
 * Contrôles et mises en forme des identifiants saisis dans les paramètres
 * (IBAN, BIC, SIREN, SIRET, RNA, couleurs des factures et des académies).
 * Fonctions pures : utilisables côté serveur (validation) comme côté client (aide à la saisie).
 */

/** Longueur de l'IBAN par pays (zone SEPA et pays voisins courants). */
const LONGUEURS_IBAN: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18,
  FO: 18, FR: 27, GB: 22, GI: 23, GL: 18, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21,
  LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19,
  SK: 24, SM: 27, VA: 22, MA: 28, TN: 24,
};

/** « fr76 3000 6000… » → « FR7630006000… » (espaces et tirets retirés, majuscules). */
export function normaliserIban(saisie: string): string {
  return saisie.replace(/[\s  -]/g, "").toUpperCase();
}

/** Regroupement par 4 caractères (format papier) : « FR76 3000 6000 0112 3456 7890 189 ». */
export function formaterIban(saisie: string): string {
  return normaliserIban(saisie).replace(/(.{4})(?=.)/g, "$1 ");
}

/** Message d'erreur si l'IBAN est invalide (format, longueur du pays, clé mod 97), sinon null. */
export function erreurIban(saisie: string): string | null {
  const iban = normaliserIban(saisie);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return "IBAN invalide : 2 lettres (pays), 2 chiffres (clé) puis le numéro de compte (ex. FR76 3000 6000 0112 3456 7890 189).";
  }
  const attendue = LONGUEURS_IBAN[iban.slice(0, 2)];
  if (attendue && iban.length !== attendue) {
    return `IBAN invalide : un IBAN ${iban.slice(0, 2)} compte ${attendue} caractères (${iban.length} saisis).`;
  }
  // Clé de contrôle ISO 13616 : les 4 premiers caractères passent à la fin, lettres → 10..35, reste mod 97 = 1.
  const reordonne = iban.slice(4) + iban.slice(0, 4);
  let reste = 0;
  for (const c of reordonne) {
    const valeur = c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c;
    for (const chiffre of valeur) reste = (reste * 10 + Number(chiffre)) % 97;
  }
  if (reste !== 1) return "IBAN invalide : la clé de contrôle ne correspond pas. Vérifiez chaque caractère.";
  return null;
}

/** BIC / SWIFT : 8 ou 11 caractères (banque, pays, localité, agence facultative). */
export function normaliserBic(saisie: string): string {
  return saisie.replace(/\s/g, "").toUpperCase();
}

export function bicValide(saisie: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normaliserBic(saisie));
}

/** Algorithme de Luhn (clé des numéros SIREN et SIRET). */
function luhnValide(chiffres: string): boolean {
  let somme = 0;
  for (let i = 0; i < chiffres.length; i++) {
    let n = Number(chiffres[chiffres.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somme += n;
  }
  return somme % 10 === 0;
}

/** Chiffres seuls d'un SIREN / SIRET saisi avec espaces ou points. */
export function chiffresSeuls(saisie: string): string {
  return saisie.replace(/[\s.  -]/g, "");
}

/** Message d'erreur si le SIREN est invalide, sinon null. */
export function erreurSiren(saisie: string): string | null {
  const siren = chiffresSeuls(saisie);
  if (!/^\d{9}$/.test(siren)) return "SIREN invalide : 9 chiffres attendus.";
  if (!luhnValide(siren)) return "SIREN invalide : la clé de contrôle ne correspond pas. Vérifiez chaque chiffre.";
  return null;
}

/** Message d'erreur si le SIRET est invalide, sinon null. */
export function erreurSiret(saisie: string): string | null {
  const siret = chiffresSeuls(saisie);
  if (!/^\d{14}$/.test(siret)) return "SIRET invalide : 14 chiffres attendus (SIREN + 5 chiffres de l'établissement).";
  // Exception connue : les établissements de La Poste (SIREN 356 000 000) ne suivent pas la clé de Luhn.
  if (!siret.startsWith("356000000") && !luhnValide(siret)) {
    return "SIRET invalide : la clé de contrôle ne correspond pas. Vérifiez chaque chiffre.";
  }
  return null;
}

/** « 853472298 » → « 853 472 298 » (format imprimé). */
export function formaterSiren(saisie: string): string {
  return chiffresSeuls(saisie).replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
}

/** « 85347229800019 » → « 853 472 298 00019 » (format imprimé). */
export function formaterSiret(saisie: string): string {
  return chiffresSeuls(saisie).replace(/^(\d{3})(\d{3})(\d{3})(\d{5})$/, "$1 $2 $3 $4");
}

/** Numéro RNA d'une association : « W » suivi de 9 caractères (ex. W143007272). */
export function normaliserRna(saisie: string): string {
  return saisie.replace(/\s/g, "").toUpperCase();
}

export function rnaValide(saisie: string): boolean {
  return /^W[0-9A-Z]{9}$/.test(normaliserRna(saisie));
}

/** Couleur hexadécimale « #RRGGBB ». */
export const MOTIF_COULEUR = /^#[0-9A-Fa-f]{6}$/;

/** « 0050a0 », « #0050a0 » → « #0050A0 » ; null si la saisie n'est pas une couleur. */
export function normaliserCouleur(saisie: string): string | null {
  const brute = saisie.trim();
  const avecDiese = brute.startsWith("#") ? brute : `#${brute}`;
  return MOTIF_COULEUR.test(avecDiese) ? avecDiese.toUpperCase() : null;
}

/** Préfixe de numérotation : 1 à 8 lettres majuscules ou chiffres. */
export const MOTIF_PREFIXE = /^[A-Z0-9]{1,8}$/;
