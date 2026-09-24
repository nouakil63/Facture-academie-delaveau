import "server-only";
import { cookies } from "next/headers";

/** Cookie mémorisant l'académie affichée (Delaveau / Espoir / toutes). */
export const COOKIE_ACADEMIE = "academie";

/** Identifiant de l'académie sélectionnée dans l'interface, ou null pour « Toutes ». */
export async function academieSelectionnee(): Promise<string | null> {
  const valeur = (await cookies()).get(COOKIE_ACADEMIE)?.value;
  return valeur && /^[0-9a-f-]{36}$/i.test(valeur) ? valeur : null;
}
