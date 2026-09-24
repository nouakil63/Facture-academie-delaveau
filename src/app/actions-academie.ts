"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { exigerUtilisateur } from "@/lib/auth";
import { COOKIE_ACADEMIE } from "@/lib/academie-selectionnee";

/** Change l'académie affichée (null = toutes). */
export async function choisirAcademie(academieId: string | null) {
  await exigerUtilisateur();
  const store = await cookies();
  if (academieId && /^[0-9a-f-]{36}$/i.test(academieId)) {
    store.set(COOKIE_ACADEMIE, academieId, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  } else {
    store.delete(COOKIE_ACADEMIE);
  }
  revalidatePath("/", "layout");
}
