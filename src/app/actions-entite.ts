"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { COOKIE_ENTITE } from "@/lib/entite-selectionnee";

/** Change l'entité affichée (null = toutes). */
export async function choisirEntite(entiteId: string | null) {
  const store = await cookies();
  if (entiteId) {
    store.set(COOKIE_ENTITE, entiteId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  } else {
    store.delete(COOKIE_ENTITE);
  }
  revalidatePath("/", "layout");
}
