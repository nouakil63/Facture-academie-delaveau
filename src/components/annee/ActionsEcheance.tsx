"use client";

import { startTransition, useActionState, useId, useState } from "react";
import {
  annulerPaiementEcheance,
  envoyerAvisEcheance,
  marquerEcheancePayee,
} from "@/app/(app)/facturation-annuelle/actions";
import { IconeAlerte, IconeAnnuler, IconeEnvoi, IconeEuro, IconeFermer, IconeValide } from "@/components/Icones";
import { Modale, ModaleConfirmation, useSignalerEnCours } from "@/components/Modale";
import { appeler } from "@/lib/appeler";
import { formatDate, formatEuros, formatPeriode, MODES_PAIEMENT } from "@/lib/format";
import type { Echeance, ResultatAction } from "@/lib/types";

export type EcheanceActions = Pick<
  Echeance,
  "id" | "statut" | "numero_avis" | "montant_centimes" | "periode" | "envoyee_le" | "date_echeance"
>;

type ModaleOuverte = "envoyer" | "payer" | "annuler-paiement" | null;

/**
 * Actions sur une échéance (ligne de tableau) : PDF de l'avis, envoi (ou renvoi) par e-mail,
 * paiement, annulation du paiement. Chaque action passe par une confirmation.
 */
export function ActionsEcheance({
  echeance,
  destinataires,
  emailConfigure,
  aujourdhui,
  factureAnnulee = false,
}: {
  echeance: EcheanceActions;
  /** Adresses du client (fiche actuelle). */
  destinataires: string[];
  emailConfigure: boolean;
  aujourdhui: string;
  factureAnnulee?: boolean;
}) {
  const [modale, setModale] = useState<ModaleOuverte>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const fermer = () => setModale(null);
  const ouverte = !factureAnnulee && (echeance.statut === "a_venir" || echeance.statut === "envoyee");
  const envoiImpossible = !emailConfigure || destinataires.length === 0;
  const raisonEnvoi = !emailConfigure
    ? "Envoi d'e-mails non configuré (Paramètres)"
    : destinataires.length === 0
      ? "Aucune adresse e-mail sur la fiche client"
      : undefined;
  const montant = formatEuros(echeance.montant_centimes);
  const mois = formatPeriode(echeance.periode);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        <a
          href={`/api/echeances/${echeance.id}/pdf`}
          target="_blank"
          rel="noopener"
          className="btn-secondaire btn-petit"
          title="Ouvrir le PDF de l'avis dans un nouvel onglet"
        >
          PDF
        </a>
        {ouverte && (
          <>
            <button
              type="button"
              className="btn-secondaire btn-petit"
              onClick={() => setModale("envoyer")}
              disabled={envoiImpossible}
              title={raisonEnvoi}
            >
              <IconeEnvoi className="size-3.5" />
              {echeance.statut === "a_venir" ? "Envoyer" : "Renvoyer"}
            </button>
            <button type="button" className="btn-secondaire btn-petit" onClick={() => setModale("payer")}>
              <IconeEuro className="size-3.5" />
              Payée
            </button>
          </>
        )}
        {echeance.statut === "payee" && !factureAnnulee && (
          <button type="button" className="btn-secondaire btn-petit" onClick={() => setModale("annuler-paiement")}>
            <IconeAnnuler className="size-3.5" />
            Annuler le paiement
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="flex items-start gap-1 text-left text-xs text-emerald-700">
          <IconeValide className="mt-0.5 size-3.5 shrink-0" />
          <span className="whitespace-pre-line">{message}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="Masquer le message" className="shrink-0">
            <IconeFermer className="size-3.5" />
          </button>
        </p>
      )}

      <ModaleConfirmation
        ouverte={modale === "envoyer"}
        onFermer={fermer}
        titre={echeance.statut === "a_venir" ? "Envoyer l'avis d'échéance" : "Renvoyer l'avis d'échéance"}
        libelleConfirmer={echeance.statut === "a_venir" ? "Envoyer" : "Renvoyer"}
        libelleEnCours="Envoi en cours…"
        onConfirmer={() => envoyerAvisEcheance(echeance.id)}
        onSucces={(r) => setMessage(r.message ?? "Avis envoyé.")}
      >
        <p>
          Avis <strong>{echeance.numero_avis}</strong> ({mois}, {montant}, à régler avant le{" "}
          {formatDate(echeance.date_echeance)}) : envoi par e-mail avec le PDF en pièce jointe.
          {echeance.statut === "envoyee" && echeance.envoyee_le && ` Dernier envoi le ${formatDate(echeance.envoyee_le)}.`}
        </p>
        <div>
          <p className="font-medium">Destinataires</p>
          <ul className="mt-1 space-y-0.5">
            {destinataires.map((d) => (
              <li key={d} className="truncate text-muted">
                {d}
              </li>
            ))}
          </ul>
        </div>
      </ModaleConfirmation>

      <Modale ouverte={modale === "payer"} onFermer={fermer} titre="Enregistrer le paiement" verrouillee={enregistrement}>
        <FormulairePaiementEcheance
          echeance={echeance}
          aujourdhui={aujourdhui}
          onEnCours={setEnregistrement}
          onAnnuler={fermer}
          onTermine={(m) => {
            fermer();
            setMessage(m ?? "Paiement enregistré.");
          }}
        />
      </Modale>

      <ModaleConfirmation
        ouverte={modale === "annuler-paiement"}
        onFermer={fermer}
        titre="Annuler le paiement"
        libelleConfirmer="Annuler le paiement"
        danger
        onConfirmer={() => annulerPaiementEcheance(echeance.id)}
        onSucces={(r) => setMessage(r.message ?? "Paiement annulé.")}
      >
        <p>
          Le paiement de l&apos;échéance <strong>{echeance.numero_avis}</strong> ({montant}) sera effacé. Si la facture
          annuelle était payée, elle redevient à régler. À faire en cas d&apos;erreur de saisie ou de paiement rejeté.
        </p>
      </ModaleConfirmation>
    </div>
  );
}

function FormulairePaiementEcheance({
  echeance,
  aujourdhui,
  onAnnuler,
  onTermine,
  onEnCours,
}: {
  echeance: EcheanceActions;
  aujourdhui: string;
  onAnnuler: () => void;
  onTermine: (message?: string) => void;
  onEnCours?: (enCours: boolean) => void;
}) {
  const id = useId();
  const [etat, envoyer, enCours] = useActionState<ResultatAction | null, FormData>(async (precedent, donnees) => {
    const resultat = await appeler(marquerEcheancePayee(precedent, donnees));
    if (resultat.ok) onTermine(resultat.message);
    return resultat;
  }, null);
  useSignalerEnCours(enCours, onEnCours);

  function soumettre(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const donnees = new FormData(e.currentTarget);
    startTransition(() => envoyer(donnees));
  }

  return (
    <form onSubmit={soumettre} className="space-y-4">
      <input type="hidden" name="echeance_id" value={echeance.id} />
      <p className="text-sm">
        Échéance <strong>{echeance.numero_avis}</strong> ({formatPeriode(echeance.periode)}) —{" "}
        {formatEuros(echeance.montant_centimes)}.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-date`} className="label">
            Date du paiement <span className="text-red-600">*</span>
          </label>
          <input id={`${id}-date`} name="payee_le" type="date" required max={aujourdhui} defaultValue={aujourdhui} className="champ" />
        </div>
        <div>
          <label htmlFor={`${id}-mode`} className="label">
            Mode de paiement <span className="text-red-600">*</span>
          </label>
          <select id={`${id}-mode`} name="mode_paiement" required defaultValue="Virement" className="champ">
            {MODES_PAIEMENT.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-ref`} className="label">
          Référence <span className="font-normal text-muted">(facultatif)</span>
        </label>
        <input
          id={`${id}-ref`}
          name="reference_paiement"
          maxLength={120}
          className="champ"
          placeholder="N° de chèque, libellé du virement…"
        />
      </div>
      {etat && !etat.ok && (
        <p role="alert" className="erreur flex items-start gap-2 whitespace-pre-line">
          <IconeAlerte className="mt-0.5 size-4" />
          {etat.erreur}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondaire" onClick={onAnnuler} disabled={enCours}>
          Annuler
        </button>
        <button type="submit" className="btn-primaire" disabled={enCours}>
          {enCours ? "Enregistrement…" : "Marquer comme payée"}
        </button>
      </div>
    </form>
  );
}
