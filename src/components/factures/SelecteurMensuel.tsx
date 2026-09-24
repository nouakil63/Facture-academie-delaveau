"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { nomCourtAcademie } from "@/lib/format";
import { ACADEMIE_TOUTES, MOTIF_MOIS, moisVoisin } from "./outils";

/**
 * Choix de l'académie (Toutes / Delaveau / Espoir) et du mois de la facturation
 * mensuelle, portés par l'URL (`?academie=…&mois=AAAA-MM`). Ce choix est propre à la
 * page : il ne modifie pas le filtre d'académie de la barre latérale.
 * La saisie du mois est locale (navigateurs sans sélecteur de mois : champ texte « AAAA-MM ») :
 * l'URL ne change qu'une fois le mois complet. Le parent remonte le composant (key) à chaque mois.
 */
export function SelecteurMensuel({
  academies,
  academieId,
  mois,
  moisParDefaut,
}: {
  academies: { id: string; nom: string; couleur: string }[];
  /** Académie affichée, null = toutes. */
  academieId: string | null;
  mois: string;
  moisParDefaut: string;
}) {
  const router = useRouter();
  const id = useId();
  const [chargement, demarrer] = useTransition();
  const [saisie, setSaisie] = useState(mois);

  function aller(academie: string | null, nouveauMois: string) {
    const p = new URLSearchParams({ academie: academie ?? ACADEMIE_TOUTES });
    if (nouveauMois) p.set("mois", nouveauMois);
    demarrer(() => router.replace(`/facturation-mensuelle?${p.toString()}`, { scroll: false }));
  }

  const options = [
    { id: null, libelle: "Toutes", titre: "Toutes les académies", couleur: null },
    ...academies.map((a) => ({ id: a.id, libelle: nomCourtAcademie(a.nom), titre: a.nom, couleur: a.couleur })),
  ];

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
                  key={o.id ?? ACADEMIE_TOUTES}
                  type="button"
                  aria-pressed={actif}
                  title={o.titre}
                  onClick={() => aller(o.id, mois)}
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
        <label htmlFor={`${id}-mois`} className="label">
          Mois facturé
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-secondaire btn-petit"
            onClick={() => aller(academieId, moisVoisin(mois, -1))}
            aria-label="Mois précédent"
            title="Mois précédent"
          >
            ‹
          </button>
          <input
            id={`${id}-mois`}
            type="month"
            className="champ sm:w-40"
            value={saisie}
            required
            placeholder="AAAA-MM"
            pattern="\d{4}-(0[1-9]|1[0-2])"
            onChange={(e) => {
              setSaisie(e.target.value);
              if (MOTIF_MOIS.test(e.target.value)) aller(academieId, e.target.value);
            }}
          />
          <button
            type="button"
            className="btn-secondaire btn-petit"
            onClick={() => aller(academieId, moisVoisin(mois, 1))}
            aria-label="Mois suivant"
            title="Mois suivant"
          >
            ›
          </button>
        </div>
      </div>
      {mois !== moisParDefaut && (
        <button type="button" className="btn-lien sm:mb-2" onClick={() => aller(academieId, moisParDefaut)}>
          Revenir au mois à facturer
        </button>
      )}
      {chargement && <span className="text-xs text-muted sm:mb-2">Chargement…</span>}
    </div>
  );
}
