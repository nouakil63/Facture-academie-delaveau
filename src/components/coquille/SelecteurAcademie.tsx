"use client";

import { useId, useOptimistic, useTransition } from "react";
import { choisirAcademie } from "@/app/actions-academie";
import { nomCourtAcademie } from "@/lib/format";

type Option = { id: string | null; court: string; nom: string; couleur: string | null };

/**
 * Filtre d'académie « Toutes / Delaveau / Espoir » : limite les listes et le tableau
 * de bord aux élèves d'une académie. Mémorisé dans un cookie par la Server Action
 * choisirAcademie. Contrôle segmenté jusqu'à 3 choix, liste déroulante au-delà.
 */
export function SelecteurAcademie({
  academies,
  valeur,
}: {
  academies: { id: string; nom: string; couleur: string }[];
  valeur: string | null;
}) {
  const idLibelle = useId();
  const [enCours, demarrer] = useTransition();
  const [affichee, setAffichee] = useOptimistic(valeur);

  if (academies.length === 0) return null;

  const options: Option[] = [
    { id: null, court: "Toutes", nom: "Toutes les académies", couleur: null },
    ...academies.map((a) => ({ id: a.id, court: nomCourtAcademie(a.nom), nom: a.nom, couleur: a.couleur })),
  ];

  function choisir(id: string | null) {
    if (id === affichee) return;
    demarrer(async () => {
      setAffichee(id);
      try {
        await choisirAcademie(id);
      } catch (e) {
        // L'affichage optimiste revient seul à la valeur réelle à la fin de la transition.
        console.error("Changement d'académie impossible :", e);
      }
    });
  }

  return (
    <div>
      <p id={idLibelle} className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">
        Académie affichée
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
                className={`cursor-pointer truncate rounded-md px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand lg:py-1.5 ${
                  actif ? "bg-surface text-brand shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"
                }`}
                // Académie active : soulignée de sa couleur (le texte garde la couleur de la charte, lisible).
                // Le style en ligne remplace l'ombre et l'anneau des classes : on les reprend ici.
                style={
                  actif && o.couleur
                    ? { boxShadow: `inset 0 -2px 0 ${o.couleur}, 0 0 0 1px var(--color-line), 0 1px 2px rgb(0 0 0 / 0.05)` }
                    : undefined
                }
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
