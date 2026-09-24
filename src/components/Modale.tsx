"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { ResultatAction } from "@/lib/types";

/**
 * Fenêtres modales partagées par tous les modules (élément <dialog> natif :
 * focus piégé, touche Échap, fond cliquable).
 *
 * - `Modale` : fenêtre générique (formulaire, détail…). Le contenu n'est monté que
 *   lorsqu'elle est ouverte : un formulaire repart de zéro à chaque ouverture.
 * - `ModaleConfirmation` : confirmation d'une action (souvent destructive) qui appelle
 *   une Server Action ; en cas d'échec, l'erreur s'affiche dans la modale, qui reste ouverte.
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
  /** Classe Tailwind de largeur maximale (ex. « max-w-2xl »). */
  largeur?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitre = useId();

  // Synchronisé à chaque rendu : si le navigateur a fermé la boîte de lui-même
  // (Échap répété) alors que le parent la veut encore ouverte, elle est rouverte.
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
        // Échap : le parent décide (il peut refuser pendant un traitement).
        e.preventDefault();
        onFermer();
      }}
      onClose={() => {
        // Fermeture imposée par le navigateur : on resynchronise l'état du parent.
        if (ouverte) onFermer();
      }}
      onClick={(e) => {
        // Clic sur le fond (en dehors du panneau) : fermeture.
        if (e.target === e.currentTarget) onFermer();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${largeur} max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40`}
    >
      {ouverte && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={idTitre} className="titre-section">
                {titre}
              </h2>
              {sousTitre && <div className="mt-0.5 text-sm text-muted">{sousTitre}</div>}
            </div>
            <button
              type="button"
              onClick={onFermer}
              className="-m-1 shrink-0 rounded-md p-1 text-muted hover:bg-page hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
              aria-label="Fermer"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** Résultat réussi transmis à `onSucces` (un `onConfirmer` qui ne renvoie rien vaut succès). */
export type SuccesAction<T> = Extract<ResultatAction<T>, { ok: true }>;

/**
 * Modale de confirmation. `onConfirmer` appelle la Server Action et renvoie son
 * ResultatAction : en cas d'échec, l'erreur s'affiche dans la modale, qui reste ouverte ;
 * en cas de succès, la modale se ferme puis `onSucces` reçoit le résultat.
 */
export function ModaleConfirmation<T = undefined>({
  ouverte,
  onFermer,
  titre,
  sousTitre,
  children,
  libelleConfirmer,
  libelleEnCours = "Patientez…",
  libelleAnnuler = "Annuler",
  danger = false,
  desactiver = false,
  largeur,
  onConfirmer,
  onSucces,
}: {
  ouverte: boolean;
  onFermer: () => void;
  titre: string;
  sousTitre?: React.ReactNode;
  children: React.ReactNode;
  libelleConfirmer: string;
  libelleEnCours?: string;
  libelleAnnuler?: string;
  /** Bouton de confirmation rouge (suppression, annulation…). */
  danger?: boolean;
  desactiver?: boolean;
  largeur?: string;
  onConfirmer: () => Promise<ResultatAction<T> | void>;
  onSucces?: (resultat: SuccesAction<T>) => void;
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
      let resultat: ResultatAction<T> | void;
      try {
        resultat = await onConfirmer();
      } catch {
        setErreur("La requête n'a pas abouti. Vérifiez la connexion puis réessayez.");
        return;
      }
      if (resultat && !resultat.ok) {
        setErreur(resultat.erreur);
        return;
      }
      onFermer();
      onSucces?.(resultat ?? { ok: true });
    });
  }

  return (
    <Modale ouverte={ouverte} onFermer={fermer} titre={titre} sousTitre={sousTitre} largeur={largeur}>
      <div className="space-y-3 text-sm text-ink">{children}</div>
      {erreur && (
        <p role="alert" className="erreur mt-4 whitespace-pre-line">
          {erreur}
        </p>
      )}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondaire" onClick={fermer} disabled={enCours}>
          {libelleAnnuler}
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
