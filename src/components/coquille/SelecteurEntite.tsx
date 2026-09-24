"use client";

import { useId, useOptimistic, useTransition } from "react";
import { choisirEntite } from "@/app/actions-entite";

type Option = { id: string | null; court: string; nom: string };

/** « Académie Delaveau » → « Delaveau » (comme EntiteBadge). */
function nomCourt(nom: string): string {
  return nom.replace(/^Académie\s+/i, "");
}

/**
 * Choix de l'entité affichée (mémorisé dans un cookie par la Server Action choisirEntite).
 * Contrôle segmenté jusqu'à 3 choix, liste déroulante au-delà.
 */
export function SelecteurEntite({ entites, valeur }: { entites: { id: string; nom: string }[]; valeur: string | null }) {
  const idLibelle = useId();
  const [enCours, demarrer] = useTransition();
  const [affichee, setAffichee] = useOptimistic(valeur);

  if (entites.length === 0) return null;

  const options: Option[] = [
    { id: null, court: "Toutes", nom: "Toutes les entités" },
    ...entites.map((e) => ({ id: e.id, court: nomCourt(e.nom), nom: e.nom })),
  ];

  function choisir(id: string | null) {
    if (id === affichee) return;
    demarrer(async () => {
      setAffichee(id);
      try {
        await choisirEntite(id);
      } catch (e) {
        // L'affichage optimiste revient seul à la valeur réelle à la fin de la transition.
        console.error("Changement d'entité impossible :", e);
      }
    });
  }

  return (
    <div>
      <p id={idLibelle} className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">
        Entité affichée
      </p>

      {options.length <= 3 ? (
        <div
          role="group"
          aria-labelledby={idLibelle}
          aria-busy={enCours}
          className={`grid gap-1 rounded-lg bg-page p-1 ring-1 ring-line transition-opacity ${enCours ? "opacity-70" : ""}`}
          style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        >
          {options.map((o) => {
            const actif = o.id === affichee;
            return (
              <button
                key={o.id ?? "toutes"}
                type="button"
                aria-pressed={actif}
                title={o.nom}
                onClick={() => choisir(o.id)}
                className={`cursor-pointer truncate rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand ${
                  actif ? "bg-surface text-brand shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"
                }`}
              >
                {o.court}
              </button>
            );
          })}
        </div>
      ) : (
        <select
          aria-labelledby={idLibelle}
          aria-busy={enCours}
          className="champ"
          value={affichee ?? ""}
          onChange={(e) => choisir(e.target.value || null)}
        >
          {options.map((o) => (
            <option key={o.id ?? "toutes"} value={o.id ?? ""}>
              {o.nom}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
