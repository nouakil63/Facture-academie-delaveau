import { libelleSaison, moisSaison } from "@/lib/tarifs";

/*
 * Outils de la page « Facturation de l'année » (serveur et navigateur).
 */

/** Valeur du paramètre d'URL `academie` pour « toutes les académies ». */
export const ACADEMIE_TOUTES = "toutes";

/** Chemin de la page. */
export const CHEMIN_ANNEE = "/facturation-annuelle";

/** Lien vers la page, en conservant académie, saison et mois. */
export function lienAnnee(p: { academie?: string | null; saison?: number | null; mois?: string | null; ancre?: string }): string {
  const params = new URLSearchParams();
  if (p.academie !== undefined) params.set("academie", p.academie ?? ACADEMIE_TOUTES);
  if (p.saison != null) params.set("saison", String(p.saison));
  if (p.mois) params.set("mois", p.mois);
  const chaine = params.toString();
  return `${CHEMIN_ANNEE}${chaine ? `?${chaine}` : ""}${p.ancre ? `#${p.ancre}` : ""}`;
}

/** Saisons proposées : la saison affichée ± 1, et la saison en cours. */
export function saisonsProposees(saison: number, enCours: number): number[] {
  return [...new Set([enCours - 1, enCours, enCours + 1, saison])].sort((a, b) => a - b);
}

/** Mois (« AAAA-MM ») des 10 échéances d'une saison, avec leur libellé court. */
export function moisDeLaSaison(saison: number): { mois: string; libelle: string }[] {
  const NOMS = ["sept.", "oct.", "nov.", "déc.", "janv.", "févr.", "mars", "avr.", "mai", "juin"];
  return moisSaison(saison).map((periode, k) => ({ mois: periode.slice(0, 7), libelle: `${NOMS[k]} ${periode.slice(2, 4)}` }));
}

export { libelleSaison };
