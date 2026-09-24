"use client";

import { useTransition } from "react";
import { choisirAcademie } from "@/app/actions-academie";

/** Restreint l'affichage à une académie (même effet que le filtre de la barre latérale). */
export function BoutonFiltrerAcademie({ academieId, nom }: { academieId: string; nom: string }) {
  const [enCours, demarrer] = useTransition();

  return (
    <button
      type="button"
      className="btn-lien shrink-0 disabled:opacity-50"
      disabled={enCours}
      aria-label={`Afficher uniquement ${nom}`}
      onClick={() =>
        demarrer(async () => {
          try {
            await choisirAcademie(academieId);
          } catch (e) {
            console.error("Changement d'académie impossible :", e);
          }
        })
      }
    >
      {enCours ? "Filtrage…" : "Afficher seule"}
    </button>
  );
}
