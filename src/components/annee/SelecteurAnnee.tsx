"use client";

import { useRouter } from "next/navigation";
import { useId, useTransition } from "react";
import { nomCourtAcademie } from "@/lib/format";
import { libelleSaison, lienAnnee, moisDeLaSaison, saisonsProposees } from "./outils";

/**
 * Choix de l'académie (Toutes / Delaveau / Espoir), de la saison et du mois des avis de la page
 * « Facturation de l'année », portés par l'URL (`?academie=…&saison=AAAA&mois=AAAA-MM`). Ce choix
 * est propre à la page : il ne modifie pas le filtre d'académie de la barre latérale.
 */
export function SelecteurAnnee({
  academies,
  academieId,
  saison,
  saisonEnCours,
  mois,
}: {
  academies: { id: string; nom: string; couleur: string }[];
  academieId: string | null;
  saison: number;
  saisonEnCours: number;
  /** Mois des avis affichés, « AAAA-MM ». */
  mois: string;
}) {
  const router = useRouter();
  const id = useId();
  const [chargement, demarrer] = useTransition();

  function aller(academie: string | null, nouvelleSaison: number, nouveauMois: string | null) {
    demarrer(() =>
      router.replace(lienAnnee({ academie, saison: nouvelleSaison, mois: nouveauMois }), { scroll: false }),
    );
  }

  const options = [
    { id: null, libelle: "Toutes", titre: "Toutes les académies", couleur: null },
    ...academies.map((a) => ({ id: a.id, libelle: nomCourtAcademie(a.nom), titre: a.nom, couleur: a.couleur })),
  ];
  const moisSaison = moisDeLaSaison(saison);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end" aria-busy={chargement}>
      {academies.length > 1 && (
        <div className="min-w-0">
          <span className="label" id={`${id}-academie`}>
            Académie
          </span>
          <div
            role="group"
            aria-labelledby={`${id}-academie`}
            className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-page p-1 ring-1 ring-line sm:inline-grid"
          >
            {options.map((o) => {
              const actif = o.id === academieId;
              return (
                <button
                  key={o.id ?? "toutes"}
                  type="button"
                  aria-pressed={actif}
                  title={o.titre}
                  onClick={() => aller(o.id, saison, mois)}
                  className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                    actif ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  {o.couleur && (
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: o.couleur }} aria-hidden="true" />
                  )}
                  {o.libelle}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <label htmlFor={`${id}-saison`} className="label">
          Année scolaire
        </label>
        <select
          id={`${id}-saison`}
          className="champ sm:w-40"
          value={saison}
          onChange={(e) => aller(academieId, Number(e.target.value), null)}
        >
          {saisonsProposees(saison, saisonEnCours).map((s) => (
            <option key={s} value={s}>
              {libelleSaison(s)}
              {s === saisonEnCours ? " (en cours)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-mois`} className="label">
          Mois des avis
        </label>
        <select
          id={`${id}-mois`}
          className="champ sm:w-40"
          value={mois}
          onChange={(e) => aller(academieId, saison, e.target.value)}
        >
          {moisSaison.map((m) => (
            <option key={m.mois} value={m.mois}>
              {m.libelle}
            </option>
          ))}
        </select>
      </div>
      {chargement && <span className="text-xs text-muted sm:mb-2">Chargement…</span>}
    </div>
  );
}
