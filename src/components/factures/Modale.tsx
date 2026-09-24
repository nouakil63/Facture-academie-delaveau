"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { ResultatAction } from "@/lib/types";
import { IconeCroix } from "./Icones";

/**
 * Fenêtre modale (élément <dialog> natif : focus piégé, touche Échap).
 * Le contenu n'est monté que lorsque la modale est ouverte (formulaires remis à zéro).
 */
export function Modale({
  ouverte,
  onFermer,
  titre,
  children,
  largeur = "max-w-lg",
}: {
  ouverte: boolean;
  onFermer: () => void;
  titre: string;
  children: React.ReactNode;
  largeur?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitre = useId();

  useEffect(() => {
    const dialogue = ref.current;
    if (!dialogue) return;
    if (ouverte && !dialogue.open) dialogue.showModal();
    if (!ouverte && dialogue.open) dialogue.close();
  }, [ouverte]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitre}
      onCancel={(e) => {
        // Échap : on laisse le parent décider (il peut refuser pendant un traitement).
        e.preventDefault();
        onFermer();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onFermer();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${largeur} max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40`}
    >
      {ouverte && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id={idTitre} className="titre-section">
              {titre}
            </h2>
            <button
              type="button"
              onClick={onFermer}
              className="-m-1 rounded-md p-1 text-muted hover:bg-page hover:text-ink"
              aria-label="Fermer"
            >
              <IconeCroix className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/**
 * Modale de confirmation. `onConfirmer` renvoie un ResultatAction : en cas d'échec,
 * l'erreur s'affiche dans la modale, qui reste ouverte.
 */
export function ModaleConfirmation<T>({
  ouverte,
  onFermer,
  titre,
  children,
  libelleConfirmer,
  libelleEnCours = "Patientez…",
  danger = false,
  desactiver = false,
  onConfirmer,
  onSucces,
}: {
  ouverte: boolean;
  onFermer: () => void;
  titre: string;
  children: React.ReactNode;
  libelleConfirmer: string;
  libelleEnCours?: string;
  danger?: boolean;
  desactiver?: boolean;
  onConfirmer: () => Promise<ResultatAction<T>>;
  onSucces?: (resultat: Extract<ResultatAction<T>, { ok: true }>) => void;
}) {
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function fermer() {
    if (enCours) return;
    setErreur(null);
    onFermer();
  }

  function confirmer() {
    setErreur(null);
    demarrer(async () => {
      let resultat: ResultatAction<T>;
      try {
        resultat = await onConfirmer();
      } catch {
        setErreur("La requête n'a pas abouti. Vérifiez la connexion puis réessayez.");
        return;
      }
      if (!resultat.ok) {
        setErreur(resultat.erreur);
        return;
      }
      onFermer();
      onSucces?.(resultat);
    });
  }

  return (
    <Modale ouverte={ouverte} onFermer={fermer} titre={titre}>
      <div className="space-y-3 text-sm text-ink">{children}</div>
      {erreur && (
        <p role="alert" className="erreur mt-4 whitespace-pre-line">
          {erreur}
        </p>
      )}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondaire" onClick={fermer} disabled={enCours}>
          Annuler
        </button>
        <button
          type="button"
          className={danger ? "btn-danger" : "btn-primaire"}
          onClick={confirmer}
          disabled={enCours || desactiver}
          autoFocus
        >
          {enCours ? libelleEnCours : libelleConfirmer}
        </button>
      </div>
    </Modale>
  );
}
