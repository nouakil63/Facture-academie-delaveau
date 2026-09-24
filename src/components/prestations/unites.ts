/**
 * Unités de facturation proposées pour les prestations du catalogue.
 * Module neutre (utilisable côté serveur comme côté client).
 */

export const UNITES = ["mois", "séance", "heure", "jour", "forfait", "trimestre", "année"] as const;

/** Valeur du menu déroulant qui ouvre la saisie libre d'une unité. */
export const UNITE_AUTRE = "autre";

export const LONGUEUR_MAX_UNITE = 30;

/** L'unité fait-elle partie de la liste proposée ? */
export function estUnitePredefinie(unite: string): boolean {
  return (UNITES as readonly string[]).includes(unite);
}

/** Suffixe affiché après un prix : « / mois », « / séance »… et « (forfait) » pour un forfait. */
export function suffixeUnite(unite: string): string {
  return unite === "forfait" ? "(forfait)" : `/ ${unite}`;
}
