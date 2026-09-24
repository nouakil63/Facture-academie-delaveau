"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { enregistrerTarif } from "@/app/(app)/clients/actions";
import { centimesVersSaisie, formatEuros, parseEurosEnCentimes } from "@/lib/format";
import {
  parseQuantite,
  quantiteVersSaisie,
  totalLigneCentimes,
  type PrestationDuTarif,
  type TarifAvecPrestation,
} from "@/lib/tarifs";
import type { ResultatAction } from "@/lib/types";

type Mode = "catalogue" | "libre";

/**
 * Ajout / modification d'une ligne de tarif : prestation du catalogue (prix
 * personnalisé facultatif) ou ligne libre (libellé + prix obligatoires).
 */
export function FormulaireTarif({
  clientId,
  tarif,
  prestations,
  onTermine,
  onAnnuler,
}: {
  clientId: string;
  /** null → nouvelle ligne. */
  tarif: TarifAvecPrestation | null;
  /** Catalogue commun (prestations actives + celle du tarif édité si elle a été retirée). */
  prestations: PrestationDuTarif[];
  onTermine: (message?: string) => void;
  onAnnuler: () => void;
}) {
  const [etat, envoyer, enCours] = useActionState<ResultatAction | null, FormData>(async (precedent, donnees) => {
    const resultat = await enregistrerTarif(precedent, donnees);
    if (resultat.ok) onTermine(resultat.message);
    return resultat;
  }, null);

  const [mode, setMode] = useState<Mode>(tarif && !tarif.prestation_id ? "libre" : prestations.length ? "catalogue" : "libre");
  const [prestationId, setPrestationId] = useState(tarif?.prestation_id ?? "");
  const [prix, setPrix] = useState(centimesVersSaisie(tarif?.prix_unitaire_centimes));
  const [quantite, setQuantite] = useState(quantiteVersSaisie(tarif?.quantite));
  const [recurrent, setRecurrent] = useState(tarif?.recurrent ?? true);

  const prestation = mode === "catalogue" ? (prestations.find((p) => p.id === prestationId) ?? null) : null;

  // Aperçu du total de la ligne (même arrondi que la base).
  const prixSaisi = prix.trim() === "" ? null : parseEurosEnCentimes(prix);
  const prixEffectif = prix.trim() === "" ? (prestation?.prix_unitaire_centimes ?? null) : prixSaisi;
  const quantiteSaisie = parseQuantite(quantite);
  const apercu = prixEffectif != null && quantiteSaisie != null ? totalLigneCentimes(quantiteSaisie, prixEffectif) : null;
  const personnalise = prestation != null && prixSaisi != null && prixSaisi !== prestation.prix_unitaire_centimes;

  function choisirPrestation(id: string) {
    setPrestationId(id);
    // Nouvelle ligne : on reprend le caractère mensuel / ponctuel proposé par le catalogue.
    const choisie = prestations.find((p) => p.id === id);
    if (!tarif && choisie) setRecurrent(choisie.recurrente);
  }

  function soumettre(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const donnees = new FormData(e.currentTarget);
    startTransition(() => envoyer(donnees));
  }

  return (
    <form onSubmit={soumettre} className="space-y-5">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="tarif_id" value={tarif?.id ?? ""} />
      <input type="hidden" name="mode" value={mode} />

      <div role="group" aria-label="Nature de la ligne" className="grid grid-cols-2 gap-1 rounded-lg bg-page p-1">
        {(
          [
            ["catalogue", "Prestation du catalogue"],
            ["libre", "Ligne libre"],
          ] as const
        ).map(([valeur, libelle]) => (
          <button
            key={valeur}
            type="button"
            aria-pressed={mode === valeur}
            onClick={() => setMode(valeur)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === valeur ? "bg-surface text-brand shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {libelle}
          </button>
        ))}
      </div>

      {mode === "catalogue" ? (
        prestations.length === 0 ? (
          <p className="avertissement">
            Le catalogue ne contient aucune prestation active. Créez-en dans{" "}
            <Link href="/prestations" className="font-medium underline">
              Prestations
            </Link>{" "}
            ou ajoutez une ligne libre.
          </p>
        ) : (
          <div>
            <label htmlFor="prestation_id" className="label">
              Prestation <span className="text-red-600">*</span>
            </label>
            <select
              id="prestation_id"
              name="prestation_id"
              required
              value={prestationId}
              onChange={(e) => choisirPrestation(e.target.value)}
              className="champ"
            >
              <option value="" disabled>
                Choisir une prestation…
              </option>
              {prestations.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.libelle} — {formatEuros(p.prix_unitaire_centimes)} / {p.unite}
                  {p.actif ? "" : " (retirée du catalogue)"}
                </option>
              ))}
            </select>
          </div>
        )
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="libelle" className="label">
            {mode === "libre" ? (
              <>
                Libellé <span className="text-red-600">*</span>
              </>
            ) : (
              "Libellé personnalisé"
            )}
          </label>
          <input
            id="libelle"
            name="libelle"
            maxLength={200}
            required={mode === "libre"}
            defaultValue={tarif?.libelle ?? ""}
            placeholder={prestation?.libelle ?? (mode === "libre" ? "Ex. Participation aux frais de concours" : "")}
            className="champ"
          />
          {mode === "catalogue" && <p className="aide">Laisser vide pour reprendre le libellé du catalogue.</p>}
        </div>

        <div>
          <label htmlFor="prix" className="label">
            {mode === "libre" ? (
              <>
                Prix unitaire (€) <span className="text-red-600">*</span>
              </>
            ) : (
              "Prix personnalisé (€)"
            )}
          </label>
          <input
            id="prix"
            name="prix"
            inputMode="decimal"
            autoComplete="off"
            required={mode === "libre"}
            value={prix}
            onChange={(e) => setPrix(e.target.value)}
            placeholder={prestation ? centimesVersSaisie(prestation.prix_unitaire_centimes) : "0,00"}
            className="champ"
          />
          <p className="aide">
            {mode === "catalogue"
              ? prestation
                ? personnalise
                  ? `Tarif personnalisé (catalogue : ${formatEuros(prestation.prix_unitaire_centimes)}).`
                  : "Laisser vide pour suivre le prix du catalogue, y compris s'il évolue."
                : "Laisser vide pour appliquer le prix du catalogue."
              : "Montant hors taxes."}
          </p>
        </div>

        <div>
          <label htmlFor="quantite" className="label">
            Quantité <span className="text-red-600">*</span>
          </label>
          <input
            id="quantite"
            name="quantite"
            inputMode="decimal"
            autoComplete="off"
            required
            value={quantite}
            onChange={(e) => setQuantite(e.target.value)}
            className="champ"
          />
          <p className="aide">{prestation ? `En ${prestation.unite}. ` : ""}Décimales acceptées (ex. 2,5).</p>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="description" className="label">
            Description <span className="font-normal text-muted">(facultative)</span>
          </label>
          <input
            id="description"
            name="description"
            maxLength={1000}
            defaultValue={tarif?.description ?? ""}
            placeholder={prestation?.description ?? "Précision imprimée sous le libellé"}
            className="champ"
          />
        </div>

        <div>
          <label htmlFor="date_debut" className="label">
            Valable du
          </label>
          <input
            id="date_debut"
            name="date_debut"
            type="date"
            defaultValue={tarif?.date_debut ?? ""}
            className="champ"
          />
        </div>
        <div>
          <label htmlFor="date_fin" className="label">
            au
          </label>
          <input id="date_fin" name="date_fin" type="date" defaultValue={tarif?.date_fin ?? ""} className="champ" />
        </div>
        <p className="aide -mt-2 sm:col-span-2">
          Dates facultatives : une ligne mensuelle est facturée pour chaque mois qui chevauche sa période de validité.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-line bg-page/60 px-4 py-3">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="recurrent"
            checked={recurrent}
            onChange={(e) => setRecurrent(e.target.checked)}
            className="mt-0.5 size-4 accent-brand"
          />
          <span>
            <span className="font-medium">Facturer chaque mois</span>
            <span className="block text-xs text-muted">
              Décoché : ligne ponctuelle, non reprise dans la facturation mensuelle automatique.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="actif"
            defaultChecked={tarif?.actif ?? true}
            className="mt-0.5 size-4 accent-brand"
          />
          <span>
            <span className="font-medium">Ligne active</span>
            <span className="block text-xs text-muted">Décoché : ligne conservée mais suspendue.</span>
          </span>
        </label>
      </div>

      <div className="flex items-baseline justify-between gap-4 border-t border-line pt-4">
        <span className="text-sm text-muted">Total de la ligne</span>
        <span className="text-lg font-semibold tabular-nums text-ink">{apercu != null ? formatEuros(apercu) : "—"}</span>
      </div>

      {etat && !etat.ok && (
        <p role="alert" className="erreur whitespace-pre-line">
          {etat.erreur}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondaire" onClick={onAnnuler} disabled={enCours}>
          Annuler
        </button>
        <button
          type="submit"
          className="btn-primaire"
          disabled={enCours || (mode === "catalogue" && prestations.length === 0)}
        >
          {enCours ? "Enregistrement…" : tarif ? "Enregistrer la ligne" : "Ajouter la ligne"}
        </button>
      </div>
    </form>
  );
}
