"use client";

import { useRouter } from "next/navigation";
import { useId, useTransition } from "react";

/** Choix de l'entité et du mois de la facturation mensuelle (paramètres d'URL). */
export function SelecteurMensuel({
  entites,
  entiteId,
  mois,
  moisParDefaut,
}: {
  entites: { id: string; nom: string; couleur_primaire: string }[];
  entiteId: string;
  mois: string;
  moisParDefaut: string;
}) {
  const router = useRouter();
  const id = useId();
  const [chargement, demarrer] = useTransition();

  function aller(entite: string, nouveauMois: string) {
    const p = new URLSearchParams({ entite });
    if (nouveauMois) p.set("mois", nouveauMois);
    demarrer(() => router.replace(`/facturation-mensuelle?${p.toString()}`, { scroll: false }));
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end" aria-busy={chargement}>
      {entites.length > 1 && (
        <div className="min-w-0">
          <span className="label" id={`${id}-entite`}>
            Entité
          </span>
          <div role="group" aria-labelledby={`${id}-entite`} className="inline-flex flex-wrap gap-1 rounded-lg bg-page p-1">
            {entites.map((e) => {
              const actif = e.id === entiteId;
              return (
                <button
                  key={e.id}
                  type="button"
                  aria-pressed={actif}
                  onClick={() => aller(e.id, "")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    actif ? "bg-surface shadow-sm" : "text-muted hover:text-ink"
                  }`}
                  style={actif ? { color: e.couleur_primaire } : undefined}
                >
                  {e.nom}
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
        <input
          id={`${id}-mois`}
          type="month"
          className="champ sm:w-48"
          value={mois}
          required
          onChange={(e) => {
            if (e.target.value) aller(entiteId, e.target.value);
          }}
        />
      </div>
      {mois !== moisParDefaut && (
        <button type="button" className="btn-lien mb-2" onClick={() => aller(entiteId, moisParDefaut)}>
          Revenir au mois à facturer
        </button>
      )}
      {chargement && <span className="mb-2 text-xs text-muted">Chargement…</span>}
    </div>
  );
}
