import "server-only";
import { cookies } from "next/headers";

/** Cookie mémorisant l'académie affichée (Delaveau / Espoir / toutes). */
export const COOKIE_ACADEMIE = "academie";

/**
 * Identifiant mémorisé dans le cookie (format UUID vérifié), ou null pour « Toutes ».
 * Il peut désigner une académie supprimée ou désactivée : passer ensuite par
 * `resoudreAcademie` avec la liste des académies pour obtenir le filtre réellement appliqué.
 */
export async function academieSelectionnee(): Promise<string | null> {
  const valeur = (await cookies()).get(COOKIE_ACADEMIE)?.value;
  return valeur && /^[0-9a-f-]{36}$/i.test(valeur) ? valeur : null;
}

/**
 * Académie réellement filtrée : celle du cookie si elle figure dans `academies` et
 * qu'elle est active, sinon null (« Toutes »). Un cookie périmé (académie supprimée
 * ou désactivée) retombe donc sur « Toutes », partout de la même façon.
 */
export function resoudreAcademie<T extends { id: string; actif?: boolean }>(
  idCookie: string | null,
  academies: readonly T[],
): T | null {
  if (!idCookie) return null;
  return academies.find((a) => a.id === idCookie && a.actif !== false) ?? null;
}
