import "server-only";
import { cookies } from "next/headers";

/** Cookie mémorisant l'entité affichée (Delaveau / Espoir / toutes). */
export const COOKIE_ENTITE = "entite";

/** Identifiant de l'entité sélectionnée dans l'interface, ou null pour « Toutes ». */
export async function entiteSelectionnee(): Promise<string | null> {
  const valeur = (await cookies()).get(COOKIE_ENTITE)?.value;
  return valeur && /^[0-9a-f-]{36}$/i.test(valeur) ? valeur : null;
}
