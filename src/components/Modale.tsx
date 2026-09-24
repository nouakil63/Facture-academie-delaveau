"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { MESSAGE_REQUETE_INTERROMPUE } from "@/lib/appeler";
import type { ResultatAction } from "@/lib/types";
import { IconeFermer } from "@/components/Icones";

/**
 * Fenêtres modales partagées par tous les modules (élément <dialog> natif :
 * focus piégé, touche Échap, fond cliquable).
 *
 * - `Modale` : fenêtre générique (formulaire, détail…). Le contenu n'est monté que
 *   lorsqu'elle est ouverte : un formulaire repart de zéro à chaque ouverture.
 *   `verrouillee` (enregistrement en cours) : Échap, clic sur le fond et bouton X sont
 *   sans effet, pour ne perdre ni le résultat ni l'erreur, ni soumettre deux fois.
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
  verrouillee = false,
}: {
  ouverte: boolean;
  onFermer: () => void;
  titre: string;
  sousTitre?: React.ReactNode;
  children: React.ReactNode;
  /** Classe Tailwind de largeur maximale (ex. « max-w-2xl »). */
  largeur?: string;
  /** true pendant un enregistrement : la fenêtre ne peut pas être fermée. */
  verrouillee?: boolean;
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
        if (!verrouillee) onFermer();
      }}
      onClose={(e) => {
        // Fermeture imposée par le navigateur : on resynchronise l'état du parent
        // (ou, pendant un enregistrement, on rouvre la fenêtre).
        if (!ouverte) return;
        if (verrouillee) e.currentTarget.showModal();
        else onFermer();
      }}
      onClick={(e) => {
        // Clic sur le fond (en dehors du panneau) : fermeture.
        if (e.target === e.currentTarget && !verrouillee) onFermer();
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
              disabled={verrouillee}
              className="-m-1 shrink-0 rounded-md p-1 text-muted hover:bg-page hover:text-ink focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-40"
              aria-label="Fermer"
            >
              <IconeFermer className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/**
 * Pour un formulaire affiché dans une `Modale` : signale au parent qu'un enregistrement est
 * en cours (le parent passe alors `verrouillee` à la modale). Remis à false au démontage.
 */
export function useSignalerEnCours(enCours: boolean, onEnCours?: (enCours: boolean) => void) {
  useEffect(() => {
    onEnCours?.(enCours);
    return () => onEnCours?.(false);
  }, [enCours, onEnCours]);
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
      } catch (e) {
        // redirect() d'une Server Action (ou session expirée) : Next doit l'exécuter.
        unstable_rethrow(e);
        setErreur(MESSAGE_REQUETE_INTERROMPUE);
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
    <Modale
      ouverte={ouverte}
      onFermer={fermer}
      titre={titre}
      sousTitre={sousTitre}
      largeur={largeur}
      verrouillee={enCours}
    >
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
