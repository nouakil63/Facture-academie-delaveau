"use client";

import { startTransition, useActionState, useId, useState } from "react";
import { enregistrerInfosBrouillon, enregistrerNotesInternes } from "@/app/(app)/factures/[id]/actions";
import { appeler } from "@/lib/appeler";
import type { ResultatAction } from "@/lib/types";
import { periodeVersMois } from "./outils";

/** Objet, mois facturé et notes imprimées d'un brouillon. */
export function InfosBrouillon({
  factureId,
  objet,
  periode,
  notes,
}: {
  factureId: string;
  objet: string | null;
  periode: string | null;
  notes: string | null;
}) {
  const id = useId();
  const [etat, envoyer, enCours] = useActionState<ResultatAction | null, FormData>(
    (precedent, donnees) => appeler(enregistrerInfosBrouillon(precedent, donnees)),
    null,
  );
  const [modifie, setModifie] = useState(false);

  function soumettre(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const donnees = new FormData(e.currentTarget);
    setModifie(false);
    startTransition(() => envoyer(donnees));
  }

  return (
    <form onSubmit={soumettre} onChange={() => setModifie(true)} className="space-y-4">
      <input type="hidden" name="facture_id" value={factureId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-objet`} className="label">
            Objet
          </label>
          <input
            id={`${id}-objet`}
            name="objet"
            defaultValue={objet ?? ""}
            maxLength={200}
            className="champ"
            placeholder="Ex. Formation et accompagnement – octobre 2026"
          />
        </div>
        <div>
          <label htmlFor={`${id}-periode`} className="label">
            Mois facturé
          </label>
          <input
            id={`${id}-periode`}
            name="periode"
            type="month"
            placeholder="AAAA-MM"
            pattern="\d{4}-(0[1-9]|1[0-2])"
            defaultValue={periodeVersMois(periode)}
            className="champ"
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-notes`} className="label">
          Notes imprimées sur la facture
        </label>
        <textarea
          id={`${id}-notes`}
          name="notes"
          defaultValue={notes ?? ""}
          maxLength={2000}
          rows={3}
          className="champ"
          placeholder="Facultatif"
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {etat && !modifie && (
          <p role={etat.ok ? "status" : "alert"} className={etat.ok ? "text-sm text-emerald-700" : "erreur"}>
            {etat.ok ? etat.message : etat.erreur}
          </p>
        )}
        <button type="submit" className="btn-secondaire" disabled={enCours}>
          {enCours ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

/** Notes internes (jamais imprimées), modifiables à tout statut. */
export function NotesInternes({ factureId, notes }: { factureId: string; notes: string | null }) {
  const id = useId();
  const [etat, envoyer, enCours] = useActionState<ResultatAction | null, FormData>(
    (precedent, donnees) => appeler(enregistrerNotesInternes(precedent, donnees)),
    null,
  );
  const [modifie, setModifie] = useState(false);

  function soumettre(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const donnees = new FormData(e.currentTarget);
    setModifie(false);
    startTransition(() => envoyer(donnees));
  }

  return (
    <form onSubmit={soumettre} onChange={() => setModifie(true)} className="space-y-3">
      <input type="hidden" name="facture_id" value={factureId} />
      <label htmlFor={`${id}-notes`} className="sr-only">
        Notes internes
      </label>
      <textarea
        id={`${id}-notes`}
        name="notes_internes"
        defaultValue={notes ?? ""}
        maxLength={4000}
        rows={4}
        className="champ"
        placeholder="Relances, échanges avec le client… (jamais imprimé)"
      />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {etat && !modifie && (
          <p role={etat.ok ? "status" : "alert"} className={etat.ok ? "text-sm text-emerald-700" : "erreur"}>
            {etat.ok ? etat.message : etat.erreur}
          </p>
        )}
        <button type="submit" className="btn-secondaire btn-petit" disabled={enCours || !modifie}>
          {enCours ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}
