"use client";

import { startTransition, useActionState, useState } from "react";
import { enregistrerPrestation } from "@/app/(app)/prestations/actions";
import { centimesVersSaisie, formatEuros, parseEurosEnCentimes } from "@/lib/format";
import type { Prestation, ResultatAction } from "@/lib/types";
import { estUnitePredefinie, LONGUEUR_MAX_UNITE, pluriel, suffixeUnite, UNITE_AUTRE, UNITES } from "./unites";

/**
 * Formulaire de création / modification d'une prestation du catalogue commun
 * (affiché dans une modale).
 * Soumission via onSubmit + startTransition : les champs ne sont pas réinitialisés
 * si le serveur renvoie une erreur de validation.
 */
export function FormulairePrestation({
  prestation,
  nbClientsPrixCatalogue = 0,
  onSucces,
  onAnnuler,
}: {
  /** Absente → création. */
  prestation?: Prestation;
  /** Clients actifs qui paient le prix catalogue (sans prix personnalisé). */
  nbClientsPrixCatalogue?: number;
  onSucces: (message?: string) => void;
  onAnnuler: () => void;
}) {
  const [etat, envoyer, enCours] = useActionState<ResultatAction | null, FormData>(async (precedent, donnees) => {
    const resultat = await enregistrerPrestation(precedent, donnees);
    if (resultat.ok) onSucces(resultat.message);
    return resultat;
  }, null);

  const uniteInitiale = prestation?.unite ?? "mois";
  const [unite, setUnite] = useState(estUnitePredefinie(uniteInitiale) ? uniteInitiale : UNITE_AUTRE);
  const [uniteAutre, setUniteAutre] = useState(estUnitePredefinie(uniteInitiale) ? "" : uniteInitiale);
  const [prix, setPrix] = useState(prestation ? centimesVersSaisie(prestation.prix_unitaire_centimes) : "");

  const centimes = parseEurosEnCentimes(prix);
  const uniteAffichee = unite === UNITE_AUTRE ? uniteAutre.trim().toLowerCase() : unite;
  const prixModifie = prestation != null && centimes != null && centimes !== prestation.prix_unitaire_centimes;

  function soumettre(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const donnees = new FormData(e.currentTarget);
    startTransition(() => envoyer(donnees));
  }

  return (
    <form onSubmit={soumettre} className="space-y-5">
      <input type="hidden" name="id" value={prestation?.id ?? ""} />

      <div>
        <label htmlFor="prestation-libelle" className="label">
          Libellé <Obligatoire />
        </label>
        <input
          id="prestation-libelle"
          name="libelle"
          required
          maxLength={200}
          defaultValue={prestation?.libelle ?? ""}
          placeholder="Ex. Pension complète, Entraînement, Scolarité"
          autoComplete="off"
          autoFocus={!prestation}
          className="champ"
        />
        <p className="aide">Imprimé tel quel sur les lignes de facture.</p>
      </div>

      <div>
        <label htmlFor="prestation-description" className="label">
          Description
        </label>
        <textarea
          id="prestation-description"
          name="description"
          rows={2}
          maxLength={1000}
          defaultValue={prestation?.description ?? ""}
          placeholder="Détail facultatif, imprimé sous le libellé"
          className="champ"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="prestation-prix" className="label">
            Prix unitaire HT <Obligatoire />
          </label>
          <div className="relative">
            <input
              id="prestation-prix"
              name="prix"
              required
              inputMode="decimal"
              autoComplete="off"
              value={prix}
              onChange={(e) => setPrix(e.target.value)}
              placeholder="0,00"
              aria-describedby="prestation-prix-aide"
              className="champ pr-8 text-right tabular-nums"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">€</span>
          </div>
          <p id="prestation-prix-aide" className="aide">
            {prix.trim() !== "" && centimes === null ? (
              <span className="text-red-700">Montant invalide (ex. 450 ou 450,50).</span>
            ) : (
              "Prix catalogue, personnalisable pour chaque client."
            )}
          </p>
        </div>

        <div>
          <label htmlFor="prestation-unite" className="label">
            Unité <Obligatoire />
          </label>
          <select
            id="prestation-unite"
            name="unite"
            value={unite}
            onChange={(e) => setUnite(e.target.value)}
            className="champ"
          >
            {UNITES.map((u) => (
              <option key={u} value={u}>
                {u.charAt(0).toUpperCase() + u.slice(1)}
              </option>
            ))}
            <option value={UNITE_AUTRE}>Autre…</option>
          </select>
          {unite === UNITE_AUTRE && (
            <input
              name="unite_autre"
              required
              maxLength={LONGUEUR_MAX_UNITE}
              value={uniteAutre}
              onChange={(e) => setUniteAutre(e.target.value)}
              placeholder="Ex. stage, semaine, concours"
              aria-label="Unité personnalisée"
              autoComplete="off"
              className="champ mt-2"
            />
          )}
        </div>
      </div>

      {centimes !== null && uniteAffichee !== "" && (
        <p className="rounded-lg bg-page px-3 py-2 text-sm text-muted">
          Affiché : <span className="font-medium text-ink tabular-nums">{formatEuros(centimes)}</span>{" "}
          {suffixeUnite(uniteAffichee)}
        </p>
      )}

      {prixModifie && nbClientsPrixCatalogue > 0 && (
        <p className="avertissement">
          Le nouveau prix s&apos;appliquera aux prochaines factures{" "}
          {nbClientsPrixCatalogue > 1 ? "des" : "du"} {pluriel(nbClientsPrixCatalogue, "client")} au prix catalogue
          (toutes académies confondues). Les clients au prix personnalisé et les factures déjà créées ne changent pas.
        </p>
      )}

      <fieldset className="space-y-3">
        <legend className="sr-only">Options</legend>
        <Case
          nom="recurrente"
          defaut={prestation?.recurrente ?? true}
          titre="Facturée chaque mois"
          detail="Proposée comme ligne récurrente de la facture mensuelle lorsqu'on l'ajoute aux tarifs d'un client."
        />
        <Case
          nom="actif"
          defaut={prestation?.actif ?? true}
          titre="Active"
          detail="Décochée : la prestation est archivée et n'est plus proposée pour de nouveaux tarifs."
        />
      </fieldset>

      <div className="sm:w-1/2">
        <label htmlFor="prestation-ordre" className="label">
          Ordre d&apos;affichage
        </label>
        <input
          id="prestation-ordre"
          name="ordre"
          type="number"
          min={0}
          max={9999}
          step={1}
          inputMode="numeric"
          defaultValue={prestation?.ordre ?? ""}
          placeholder="À la fin"
          className="champ"
        />
        <p className="aide">Les plus petits numéros apparaissent en premier.</p>
      </div>

      {etat && !etat.ok && (
        <p role="alert" className="erreur whitespace-pre-line">
          {etat.erreur}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondaire" onClick={onAnnuler} disabled={enCours}>
          Annuler
        </button>
        <button type="submit" className="btn-primaire" disabled={enCours}>
          {enCours ? "Enregistrement…" : prestation ? "Enregistrer" : "Ajouter au catalogue"}
        </button>
      </div>
    </form>
  );
}

function Obligatoire() {
  return (
    <span className="text-red-600" aria-hidden="true">
      *
    </span>
  );
}

function Case({ nom, defaut, titre, detail }: { nom: string; defaut: boolean; titre: string; detail: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-page">
      <input
        type="checkbox"
        name={nom}
        defaultChecked={defaut}
        className="mt-0.5 size-4 shrink-0 accent-brand"
      />
      <span className="text-sm">
        <span className="font-medium text-ink">{titre}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
    </label>
  );
}
