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
