"use client";

import Link from "next/link";
import { startTransition, useActionState, useId, useState, useTransition } from "react";
import { deplacerLigne, enregistrerLigne, supprimerLigne } from "@/app/(app)/factures/[id]/actions";
import { Modale, ModaleConfirmation, useSignalerEnCours } from "@/components/Modale";
import { appeler } from "@/lib/appeler";
import { centimesVersSaisie, formatEuros, formatQuantite, parseEurosEnCentimes } from "@/lib/format";
import { parseQuantite, quantiteVersSaisie, totalLigneCentimes } from "@/lib/tarifs";
import type { LigneFacture, ResultatAction } from "@/lib/types";
import type { PrestationFormulaire } from "./FormulaireNouvelleFacture";
import { IconeCorbeille, IconeCrayon, IconeFlecheBas, IconeFlecheHaut, IconePlus } from "@/components/Icones";
import { BlocTotaux, type Totaux } from "./LignesFacture";

type Edition = { ligne: LigneFacture | null } | null;

/** Lignes d'un brouillon : ajout, modification, suppression, ordre. Catalogue commun aux académies. */
export function EditeurLignes({
  factureId,
  lignes,
  catalogue,
  totaux,
}: {
  factureId: string;
  lignes: LigneFacture[];
  catalogue: PrestationFormulaire[];
  totaux: Totaux;
}) {
  const [edition, setEdition] = useState<Edition>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [aSupprimer, setASupprimer] = useState<LigneFacture | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [deplacement, demarrerDeplacement] = useTransition();

  function deplacer(ligne: LigneFacture, sens: "haut" | "bas") {
    setErreur(null);
    demarrerDeplacement(async () => {
      const r = await appeler(deplacerLigne(factureId, ligne.id, sens));
      if (!r.ok) setErreur(r.erreur);
    });
  }

  return (
    <>
      {(message || erreur) && (
        <div className="px-5 pt-4">
          {erreur ? (
            <p role="alert" className="erreur">
              {erreur}
            </p>
          ) : (
            <p role="status" className="succes">
              {message}
            </p>
          )}
        </div>
      )}

      {lignes.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="font-medium text-ink">Ce brouillon ne contient aucune ligne</p>
          <p className="mt-1 text-sm text-muted">Ajoutez une prestation du catalogue ou une ligne libre.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {lignes.map((l, i) => (
            <li key={l.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{l.libelle}</div>
                {l.description && <div className="text-xs whitespace-pre-line text-muted">{l.description}</div>}
                <div className="mt-0.5 text-xs text-muted tabular-nums">
                  {formatQuantite(l.quantite)} × {formatEuros(l.prix_unitaire_centimes)}
                  {l.prestation_id ? " · catalogue" : " · ligne libre"}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="font-medium tabular-nums sm:w-28 sm:text-right">{formatEuros(l.total_centimes)}</span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted hover:bg-page hover:text-ink disabled:opacity-30"
                    onClick={() => deplacer(l, "haut")}
                    disabled={i === 0 || deplacement}
                    aria-label={`Monter la ligne « ${l.libelle} »`}
                    title="Monter"
                  >
                    <IconeFlecheHaut />
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted hover:bg-page hover:text-ink disabled:opacity-30"
                    onClick={() => deplacer(l, "bas")}
                    disabled={i === lignes.length - 1 || deplacement}
                    aria-label={`Descendre la ligne « ${l.libelle} »`}
                    title="Descendre"
                  >
                    <IconeFlecheBas />
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted hover:bg-page hover:text-brand"
                    onClick={() => {
                      setMessage(null);
                      setEdition({ ligne: l });
                    }}
                    aria-label={`Modifier la ligne « ${l.libelle} »`}
                    title="Modifier"
                  >
                    <IconeCrayon />
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted hover:bg-red-50 hover:text-red-700"
                    onClick={() => {
                      setMessage(null);
                      setASupprimer(l);
                    }}
                    aria-label={`Supprimer la ligne « ${l.libelle} »`}
                    title="Supprimer"
                  >
                    <IconeCorbeille />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-line bg-page/40 px-5 py-3">
        <button
          type="button"
          className="btn-secondaire btn-petit"
          onClick={() => {
            setMessage(null);
            setEdition({ ligne: null });
          }}
        >
          <IconePlus className="size-3.5" />
          Ajouter une ligne
        </button>
      </div>

      <BlocTotaux totaux={totaux} />

      <Modale
        ouverte={edition !== null}
        onFermer={() => setEdition(null)}
        titre={edition?.ligne ? "Modifier la ligne" : "Ajouter une ligne"}
        verrouillee={enregistrement}
      >
        {edition && (
          <FormulaireLigne
            factureId={factureId}
            ligne={edition.ligne}
            catalogue={catalogue}
            onEnCours={setEnregistrement}
            onAnnuler={() => setEdition(null)}
            onTermine={(m) => {
              setEdition(null);
              setErreur(null);
              setMessage(m ?? null);
            }}
          />
        )}
      </Modale>

      <ModaleConfirmation
        ouverte={aSupprimer !== null}
        onFermer={() => setASupprimer(null)}
        titre="Supprimer la ligne"
        libelleConfirmer="Supprimer"
        danger
        onConfirmer={() => supprimerLigne(factureId, aSupprimer!.id)}
        onSucces={(r) => {
          setErreur(null);
          setMessage(r.message ?? null);
        }}
      >
        <p>
          Supprimer la ligne <strong>« {aSupprimer?.libelle} »</strong> (
          {aSupprimer ? formatEuros(aSupprimer.total_centimes) : ""}) de ce brouillon ?
        </p>
      </ModaleConfirmation>
    </>
  );
}

// -----------------------------------------------------------------------------
// Formulaire d'une ligne
// -----------------------------------------------------------------------------

type Mode = "catalogue" | "libre";

function FormulaireLigne({
  factureId,
  ligne,
  catalogue,
  onAnnuler,
  onTermine,
  onEnCours,
}: {
  factureId: string;
  ligne: LigneFacture | null;
  catalogue: PrestationFormulaire[];
  onAnnuler: () => void;
  onTermine: (message?: string) => void;
  onEnCours?: (enCours: boolean) => void;
}) {
  const id = useId();
  const [etat, envoyer, enCours] = useActionState<ResultatAction | null, FormData>(async (precedent, donnees) => {
    const resultat = await appeler(enregistrerLigne(precedent, donnees));
    if (resultat.ok) onTermine(resultat.message);
    return resultat;
  }, null);
  useSignalerEnCours(enCours, onEnCours);

  // Une ligne rattachée à une prestation retirée du catalogue reste proposée.
  const options =
    ligne?.prestation_id && !catalogue.some((p) => p.id === ligne.prestation_id)
      ? [
          ...catalogue,
          {
            id: ligne.prestation_id,
            libelle: `${ligne.libelle} (retirée du catalogue)`,
            description: ligne.description,
            prix_unitaire_centimes: ligne.prix_unitaire_centimes,
            unite: "unité",
          },
        ]
      : catalogue;

  const [mode, setMode] = useState<Mode>(
    ligne ? (ligne.prestation_id ? "catalogue" : "libre") : options.length > 0 ? "catalogue" : "libre",
  );
  const [prestationId, setPrestationId] = useState(ligne?.prestation_id ?? "");
  const [libelle, setLibelle] = useState(ligne?.libelle ?? "");
  const [description, setDescription] = useState(ligne?.description ?? "");
  const [quantite, setQuantite] = useState(quantiteVersSaisie(ligne?.quantite ?? 1));
  const [prix, setPrix] = useState(centimesVersSaisie(ligne?.prix_unitaire_centimes));

  function choisirPrestation(idPrestation: string) {
    setPrestationId(idPrestation);
    const p = options.find((x) => x.id === idPrestation);
    if (p) {
      // Reprend le libellé, la description et le prix du catalogue (modifiables ensuite).
      setLibelle(p.libelle.replace(/ \(retirée du catalogue\)$/, ""));
      setDescription(p.description ?? "");
      setPrix(centimesVersSaisie(p.prix_unitaire_centimes));
    }
  }

  const q = parseQuantite(quantite);
  const p = parseEurosEnCentimes(prix);
  const apercu = q != null && p != null ? totalLigneCentimes(q, p) : null;

  function soumettre(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const donnees = new FormData(e.currentTarget);
    startTransition(() => envoyer(donnees));
  }

  const afficherChamps = mode === "libre" || prestationId !== "";

  return (
    <form onSubmit={soumettre} className="space-y-4">
      <input type="hidden" name="facture_id" value={factureId} />
      <input type="hidden" name="ligne_id" value={ligne?.id ?? ""} />
      <input type="hidden" name="mode" value={mode} />

      <div role="group" aria-label="Nature de la ligne" className="grid grid-cols-2 gap-1 rounded-lg bg-page p-1">
        {(
          [
            ["catalogue", "Prestation du catalogue"],
            ["libre", "Ligne libre"],
          ] as const
        ).map(([valeur, texte]) => (
          <button
            key={valeur}
            type="button"
            aria-pressed={mode === valeur}
            onClick={() => setMode(valeur)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === valeur ? "bg-surface text-brand shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {texte}
          </button>
        ))}
      </div>

      {mode === "catalogue" &&
        (options.length === 0 ? (
          <p className="avertissement">
            Le catalogue ne contient aucune prestation active.{" "}
            <Link href="/prestations" className="font-medium underline">
              Gérer les prestations
            </Link>{" "}
            ou ajoutez une ligne libre.
          </p>
        ) : (
          <div>
            <label htmlFor={`${id}-prestation`} className="label">
              Prestation <span className="text-red-600">*</span>
            </label>
            <select
              id={`${id}-prestation`}
              name="prestation_id"
              required
              value={prestationId}
              onChange={(e) => choisirPrestation(e.target.value)}
              className="champ"
            >
              <option value="" disabled>
                Choisir une prestation…
              </option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.libelle} — {formatEuros(o.prix_unitaire_centimes)} / {o.unite}
                </option>
              ))}
            </select>
          </div>
        ))}

      {afficherChamps && (
        <>
          <div>
            <label htmlFor={`${id}-libelle`} className="label">
              Libellé <span className="text-red-600">*</span>
            </label>
            <input
              id={`${id}-libelle`}
              name="libelle"
              required
              maxLength={200}
              value={libelle}
              onChange={(e) => setLibelle(e.target.value)}
              className="champ"
            />
          </div>
          <div>
            <label htmlFor={`${id}-description`} className="label">
              Description <span className="font-normal text-muted">(facultatif)</span>
            </label>
            <textarea
              id={`${id}-description`}
              name="description"
              rows={2}
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="champ"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${id}-quantite`} className="label">
                Quantité <span className="text-red-600">*</span>
              </label>
              <input
                id={`${id}-quantite`}
                name="quantite"
                required
                inputMode="decimal"
                value={quantite}
                onChange={(e) => setQuantite(e.target.value)}
                className="champ text-right tabular-nums"
              />
            </div>
            <div>
              <label htmlFor={`${id}-prix`} className="label">
                Prix unitaire HT (€) <span className="text-red-600">*</span>
              </label>
              <input
                id={`${id}-prix`}
                name="prix"
                required
                inputMode="decimal"
                placeholder="0,00"
                value={prix}
                onChange={(e) => setPrix(e.target.value)}
                className="champ text-right tabular-nums"
              />
            </div>
          </div>
          <p className="text-right text-sm">
            Total de la ligne :{" "}
            <strong className="tabular-nums">{apercu == null ? "—" : formatEuros(apercu)}</strong>
          </p>
        </>
      )}

      {etat && !etat.ok && (
        <p role="alert" className="erreur whitespace-pre-line">
          {etat.erreur}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondaire" onClick={onAnnuler} disabled={enCours}>
          Annuler
        </button>
        <button type="submit" className="btn-primaire" disabled={enCours || !afficherChamps}>
          {enCours ? "Enregistrement…" : ligne ? "Enregistrer" : "Ajouter la ligne"}
        </button>
      </div>
    </form>
  );
}
