import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Page introuvable" };

/**
 * URL inconnue d'un utilisateur connecté : 404 affichée dans la coquille (barre latérale
 * disponible) par src/app/(app)/not-found.tsx. Les visiteurs non connectés sont
 * redirigés vers /connexion par le proxy avant d'arriver ici.
 */
export default function PageInconnue() {
  notFound();
}
