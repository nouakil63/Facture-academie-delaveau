"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Fenêtre modale sur l'élément <dialog> natif (focus piégé, touche Échap, fond cliquable).
 * Le contenu n'est monté que lorsque la modale est ouverte : un formulaire repart de zéro
 * à chaque ouverture.
 */
export function Modale({
  ouverte,
  onFermer,
  titre,
  sousTitre,
  children,
  largeur = "max-w-lg",
}: {
  ouverte: boolean;
  onFermer: () => void;
  titre: string;
  sousTitre?: React.ReactNode;
  children: React.ReactNode;
  largeur?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitre = useId();

  // Synchronisé à chaque rendu : si le navigateur a fermé la boîte de lui-même
  // (Échap répété) alors que le parent la veut ouverte, elle est rouverte.
  useEffect(() => {
    const dialogue = ref.current;
    if (!dialogue) return;
    if (ouverte && !dialogue.open) dialogue.showModal();
    if (!ouverte && dialogue.open) dialogue.close();
  });

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitre}
      onCancel={(e) => {
        // Échap : on laisse le parent décider (il peut refuser pendant un envoi).
        e.preventDefault();
        onFermer();
      }}
      onClose={() => {
        if (ouverte) onFermer();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onFermer();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${largeur} max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40`}
    >
      {ouverte && (
        <div className="p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={idTitre} className="titre-section">
                {titre}
              </h2>
              {sousTitre && <div className="mt-0.5 text-sm text-muted">{sousTitre}</div>}
            </div>
            <button
              type="button"
              onClick={onFermer}
              className="-m-1 rounded-md p-1 text-muted hover:bg-page hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
              aria-label="Fermer"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
