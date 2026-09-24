import { formatDateLongue } from "@/lib/format";

/** « 0 facture », « 1 facture », « 3 factures » (usage français : singulier jusqu'à 1). */
export function pluriel(nombre: number, singulier: string, pluriel = `${singulier}s`): string {
  return `${nombre} ${Math.abs(nombre) <= 1 ? singulier : pluriel}`;
}

/** Nombre de jours entre deux dates "AAAA-MM-JJ" (fin − début). */
export function joursEntre(debut: string, fin: string): number {
  const jour = (d: string) => {
    const [a, m, j] = d.slice(0, 10).split("-").map(Number);
    return Date.UTC(a, m - 1, j);
  };
  return Math.round((jour(fin) - jour(debut)) / 86_400_000);
}

/**
 * Dates de la génération mensuelle (le `jour` de chaque mois, 1 à 28) autour de `aujourdhui`
 * ("AAAA-MM-JJ") : la dernière, aujourd'hui compris (la tâche planifiée passe tôt le matin),
 * et la prochaine, strictement après aujourd'hui.
 */
export function datesGeneration(jour: number, aujourdhui: string): { derniere: string; prochaine: string } {
  const [a, m, j] = aujourdhui.slice(0, 10).split("-").map(Number);
  const le = (decalageMois: number) => new Date(Date.UTC(a, m - 1 + decalageMois, jour)).toISOString().slice(0, 10);
  return j >= jour ? { derniere: le(0), prochaine: le(1) } : { derniere: le(-1), prochaine: le(0) };
}

/** Jour du mois à la française : 1 → « 1er », 15 → « 15 ». */
export function jourDuMois(jour: number): string {
  return jour === 1 ? "1er" : String(jour);
}

/** "2026-10-01" → « 1er octobre 2026 » ; "2026-10-15" → « 15 octobre 2026 ». */
export function dateLongue(d: string): string {
  return formatDateLongue(d).replace(/^1 /, "1er ");
}

/**
 * Nom d'académie précédé de l'article élidé quand il commence par une voyelle :
 * « Académie Espoir » → « l'Académie Espoir » ; un autre nom est cité entre guillemets.
 */
export function nomAvecArticle(nom: string): string {
  return /^[aeiouyhàâäéèêëîïôöùûüœ]/i.test(nom) ? `l'${nom}` : `«\u00a0${nom}\u00a0»`;
}
