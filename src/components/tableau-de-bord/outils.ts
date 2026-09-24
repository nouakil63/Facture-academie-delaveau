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
