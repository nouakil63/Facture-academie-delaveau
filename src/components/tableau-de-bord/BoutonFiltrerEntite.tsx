"use client";

import { useTransition } from "react";
import { choisirEntite } from "@/app/actions-entite";

/** Restreint l'affichage à une entité (même effet que le sélecteur de la barre latérale). */
export function BoutonFiltrerEntite({ entiteId, nom }: { entiteId: string; nom: string }) {
  const [enCours, demarrer] = useTransition();

  return (
    <button
      type="button"
      className="btn-lien disabled:opacity-50"
      disabled={enCours}
      aria-label={`Afficher uniquement ${nom}`}
      onClick={() =>
        demarrer(async () => {
          try {
            await choisirEntite(entiteId);
          } catch (e) {
            console.error("Changement d'entité impossible :", e);
          }
        })
      }
    >
      {enCours ? "Filtrage…" : "Afficher seule"}
    </button>
  );
}
