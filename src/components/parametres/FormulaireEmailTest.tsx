"use client";

import { startTransition, useActionState } from "react";
import { envoyerEmailTest } from "@/app/(app)/parametres/actions";
import { appeler } from "@/lib/appeler";
import type { ResultatAction } from "@/lib/types";
import { IconeEnveloppe } from "@/components/Icones";

/** Envoi d'un e-mail de test à une adresse (vérification de la configuration SMTP). */
export function FormulaireEmailTest({ adresseParDefaut, actif }: { adresseParDefaut: string; actif: boolean }) {
  const [etat, envoyer, enCours] = useActionState<ResultatAction | null, FormData>(
    (precedent, donnees) => appeler(envoyerEmailTest(precedent, donnees)),
    null,
  );

  function soumettre(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const donnees = new FormData(e.currentTarget);
    startTransition(() => envoyer(donnees));
  }

  return (
    <form onSubmit={soumettre} className="space-y-3">
      <div>
        <label htmlFor="email-test" className="label">
          Envoyer un e-mail de test
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="email-test"
            name="destinataire"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            defaultValue={adresseParDefaut}
            placeholder="adresse@exemple.fr"
            disabled={!actif}
            className="champ sm:max-w-sm"
          />
          <button type="submit" className="btn-primaire shrink-0" disabled={!actif || enCours}>
            <IconeEnveloppe />
            {enCours ? "Envoi en cours…" : "Envoyer le test"}
          </button>
        </div>
        <p className="aide">
          {actif
            ? "On envoie un petit message avec la configuration actuelle. Ça peut prendre quelques secondes."
            : "Possible dès que les variables SMTP sont ajoutées dans Vercel."}
        </p>
      </div>

      {etat && (
        <p role={etat.ok ? "status" : "alert"} className={`${etat.ok ? "succes" : "erreur"} whitespace-pre-line`}>
          {etat.ok ? etat.message : etat.erreur}
        </p>
      )}
    </form>
  );
}
