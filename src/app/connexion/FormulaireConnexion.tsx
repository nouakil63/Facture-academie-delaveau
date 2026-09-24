"use client";

import { useActionState, useState } from "react";
import { IconeOeil, IconeOeilBarre } from "@/components/Icones";
import { appeler } from "@/lib/appeler";
import type { ResultatAction } from "@/lib/types";
import { seConnecter } from "./actions";

export function FormulaireConnexion({ suite }: { suite: string }) {
  const [etat, connecter, enCours] = useActionState<ResultatAction | null, FormData>(
    (precedent, donnees) => appeler(seConnecter(precedent, donnees)),
    null,
  );
  // Après l'envoi, React réinitialise le formulaire à ses valeurs par défaut :
  // l'e-mail saisi devient la valeur par défaut pour ne pas avoir à le retaper.
  const [email, setEmail] = useState("");
  const [motDePasseVisible, setMotDePasseVisible] = useState(false);

  const erreur = etat && !etat.ok ? etat.erreur : null;

  return (
    <form action={connecter} className="space-y-5" aria-describedby={erreur ? "erreur-connexion" : undefined}>
      <input type="hidden" name="suite" value={suite} />

      <div>
        <label htmlFor="email" className="label">
          Adresse e-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={email}
          onChange={(e) => setEmail(e.target.value)}
          className="champ"
          placeholder="prenom.nom@exemple.fr"
        />
      </div>

      <div>
        <label htmlFor="motDePasse" className="label">
          Mot de passe
        </label>
        <div className="relative">
          <input
            id="motDePasse"
            name="motDePasse"
            type={motDePasseVisible ? "text" : "password"}
            autoComplete="current-password"
            required
            className="champ pr-11"
          />
          <button
            type="button"
            onClick={() => setMotDePasseVisible((v) => !v)}
            aria-pressed={motDePasseVisible}
            className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-r-lg text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
          >
            {motDePasseVisible ? <IconeOeilBarre className="h-4.5 w-4.5" /> : <IconeOeil className="h-4.5 w-4.5" />}
            <span className="sr-only">{motDePasseVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}</span>
          </button>
        </div>
      </div>

      {erreur && (
        <p id="erreur-connexion" role="alert" className="erreur">
          {erreur}
        </p>
      )}

      <button type="submit" className="btn-primaire w-full py-2.5" disabled={enCours}>
        {enCours ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
