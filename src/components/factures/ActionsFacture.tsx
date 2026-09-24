"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useId, useState } from "react";
import {
  annulerFacture,
  annulerPaiement,
  dupliquerFacture,
  emettreSansEnvoyer,
  envoyerParEmail,
  marquerPayee,
  supprimerBrouillon,
} from "@/app/(app)/factures/[id]/actions";
import { Modale, ModaleConfirmation, useSignalerEnCours } from "@/components/Modale";
import { appeler } from "@/lib/appeler";
import { formatDate, formatEuros, LIBELLES_STATUT, MODES_PAIEMENT } from "@/lib/format";
import type { ResultatAction, StatutFacture } from "@/lib/types";
import {
  IconeAlerte,
  IconeAnnuler,
  IconeCopie,
  IconeCorbeille,
  IconeFermer,
  IconeEnvoi,
  IconeEuro,
  IconeFacture,
  IconeValide,
} from "@/components/Icones";

type ModaleOuverte =
  | "emettre-envoyer"
  | "emettre"
  | "supprimer"
  | "envoyer"
  | "payer"
  | "annuler"
  | "annuler-paiement"
  | "dupliquer"
  | null;

const BTN_DANGER_DISCRET = "btn-secondaire text-red-700 hover:bg-red-50 hover:text-red-800";

/**
 * Actions disponibles selon le statut de la facture : émission, envoi, paiement,
 * annulation, suppression du brouillon, duplication. Chaque action passe par une confirmation.
 */
export function ActionsFacture({
  factureId,
  statut,
  numero,
  totalTtc,
  nbLignes,
  destinataires,
  emailConfigure,
  envoyeeLe,
  aujourdhui,
  generationAuto,
  nomClient,
  clientId,
  prefixe,
}: {
  factureId: string;
  statut: StatutFacture;
  numero: string | null;
  totalTtc: number;
  nbLignes: number;
  destinataires: string[];
  emailConfigure: boolean;
  envoyeeLe: string | null;
  aujourdhui: string;
  /** Brouillon préparé par la facturation mensuelle. */
  generationAuto: boolean;
  nomClient: string;
  clientId: string;
  prefixe: string;
}) {
  const router = useRouter();
  const [modale, setModale] = useState<ModaleOuverte>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);

  const fermer = () => setModale(null);
  const reussite = (r: { message?: string }) => setMessage(r.message ?? "C'est fait.");
  const naviguer = (r: { message?: string; donnees?: { redirection: string } }) => {
    if (r.donnees?.redirection) router.push(r.donnees.redirection);
    else reussite(r);
  };

  const sansLignes = nbLignes === 0;
  const sansDestinataire = destinataires.length === 0;
  const envoiImpossible = sansDestinataire || !emailConfigure;
  const libelle = numero ?? "ce brouillon";
  const montant = formatEuros(totalTtc);

  // Raison affichée sous les boutons quand l'envoi est indisponible.
  const raisonEnvoi = !emailConfigure ? (
    <>
      L&apos;envoi d&apos;e-mails n&apos;est pas configuré (serveur SMTP).{" "}
      <Link href="/parametres#envoi-emails" className="font-medium underline">
        Paramètres
      </Link>
    </>
  ) : sansDestinataire ? (
    <>
      Le client n&apos;a aucune adresse e-mail.{" "}
      <Link href={`/clients/${clientId}`} className="font-medium underline">
        Compléter la fiche client
      </Link>
    </>
  ) : null;

  const listeDestinataires = (
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
  );

  return (
    <section className="carte carte-corps space-y-4" aria-label="Actions sur la facture">
      {message && (
        <div role="status" className="succes flex items-start justify-between gap-3">
          <span className="flex items-start gap-2">
            <IconeValide className="mt-0.5 size-4 text-emerald-600" />
            <span className="whitespace-pre-line">{message}</span>
          </span>
          <button type="button" onClick={() => setMessage(null)} aria-label="Masquer le message" className="text-emerald-700">
            <IconeFermer className="size-4" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {statut === "brouillon" && (
          <>
            <button
              type="button"
              className="btn-primaire"
              onClick={() => setModale("emettre-envoyer")}
              disabled={sansLignes || envoiImpossible}
            >
              <IconeEnvoi />
              Émettre et envoyer
            </button>
            <button type="button" className="btn-secondaire" onClick={() => setModale("emettre")} disabled={sansLignes}>
              <IconeFacture />
              Émettre sans envoyer
            </button>
            <button type="button" className={BTN_DANGER_DISCRET} onClick={() => setModale("supprimer")}>
              <IconeCorbeille />
              Supprimer le brouillon
            </button>
          </>
        )}

        {(statut === "emise" || statut === "envoyee") && (
          <>
            <button
              type="button"
              className={statut === "emise" ? "btn-primaire" : "btn-secondaire"}
              onClick={() => setModale("envoyer")}
              disabled={envoiImpossible}
            >
              <IconeEnvoi />
              {statut === "emise" ? "Envoyer par e-mail" : "Renvoyer par e-mail"}
            </button>
            <button
              type="button"
              className={statut === "envoyee" ? "btn-primaire" : "btn-secondaire"}
              onClick={() => setModale("payer")}
            >
              <IconeEuro />
              Marquer comme payée
            </button>
            <button type="button" className={BTN_DANGER_DISCRET} onClick={() => setModale("annuler")}>
              <IconeAnnuler />
              Annuler la facture
            </button>
          </>
        )}

        {statut === "payee" && (
          <>
            <button type="button" className="btn-secondaire" onClick={() => setModale("envoyer")} disabled={envoiImpossible}>
              <IconeEnvoi />
              Renvoyer (duplicata)
            </button>
            <button type="button" className="btn-secondaire" onClick={() => setModale("annuler-paiement")}>
              <IconeAnnuler />
              Annuler le paiement
            </button>
          </>
        )}

        {statut !== "brouillon" && (
          <button type="button" className="btn-secondaire" onClick={() => setModale("dupliquer")}>
            <IconeCopie />
            Dupliquer en brouillon
          </button>
        )}
      </div>

      {statut === "brouillon" && sansLignes && (
        <p className="aide">Ajoutez au moins une ligne pour pouvoir émettre la facture.</p>
      )}
      {statut !== "annulee" && raisonEnvoi && !(statut === "brouillon" && sansLignes) && (
        <p className="aide flex items-start gap-1.5 text-amber-800">
          <IconeAlerte className="mt-0.5 size-3.5 text-amber-600" />
          <span>{raisonEnvoi}</span>
        </p>
      )}
      {statut === "payee" && (
        <p className="aide">Pour annuler une facture payée, annulez d&apos;abord le paiement.</p>
      )}

      {/* Émettre et envoyer (brouillon) */}
      <ModaleConfirmation
        ouverte={modale === "emettre-envoyer"}
        onFermer={fermer}
        titre="Émettre et envoyer la facture"
        libelleConfirmer="Émettre et envoyer"
        libelleEnCours="Envoi en cours…"
        onConfirmer={() => envoyerParEmail(factureId)}
        onSucces={reussite}
      >
        <p>
          La facture de <strong>{nomClient}</strong> d&apos;un montant de <strong>{montant} TTC</strong> recevra son numéro
          définitif ({prefixe}-AAAA-NNNN) et ne pourra plus être modifiée. Elle sera ensuite envoyée par e-mail avec le PDF
          en pièce jointe.
        </p>
        {listeDestinataires}
      </ModaleConfirmation>

      {/* Émettre sans envoyer */}
      <ModaleConfirmation
        ouverte={modale === "emettre"}
        onFermer={fermer}
        titre="Émettre sans envoyer"
        libelleConfirmer="Émettre la facture"
        onConfirmer={() => emettreSansEnvoyer(factureId)}
        onSucces={reussite}
      >
        <p>
          La facture de <strong>{nomClient}</strong> ({montant} TTC) recevra son <strong>numéro définitif</strong> et ne
          pourra <strong>plus être modifiée ni supprimée</strong> (seulement annulée).
        </p>
        <p className="text-muted">
          Aucun e-mail n&apos;est envoyé : vous pourrez la télécharger pour la remettre en main propre, ou l&apos;envoyer
          plus tard.
        </p>
      </ModaleConfirmation>

      {/* Supprimer le brouillon */}
      <ModaleConfirmation
        ouverte={modale === "supprimer"}
        onFermer={fermer}
        titre="Supprimer le brouillon"
        libelleConfirmer="Supprimer définitivement"
        danger
        onConfirmer={() => supprimerBrouillon(factureId)}
        onSucces={naviguer}
      >
        <p>
          Le brouillon de <strong>{nomClient}</strong> ({montant}) et ses {nbLignes} ligne{nbLignes > 1 ? "s" : ""} seront
          supprimés. Cette action est irréversible.
        </p>
        {generationAuto && (
          <p className="avertissement">
            Ce brouillon mensuel sera recréé à la prochaine génération du mois tant que le client a un tarif récurrent
            actif. Pour ne pas le facturer ce mois-ci, mettez une date de fin au tarif ou archivez le client.
          </p>
        )}
      </ModaleConfirmation>

      {/* Envoyer / renvoyer */}
      <ModaleConfirmation
        ouverte={modale === "envoyer"}
        onFermer={fermer}
        titre={
          statut === "payee" ? "Renvoyer un duplicata" : statut === "envoyee" ? "Renvoyer la facture" : "Envoyer la facture"
        }
        libelleConfirmer={statut === "emise" ? "Envoyer" : "Renvoyer"}
        libelleEnCours="Envoi en cours…"
        onConfirmer={() => envoyerParEmail(factureId)}
        onSucces={reussite}
      >
        <p>
          La facture <strong>{libelle}</strong> ({montant} TTC) sera envoyée par e-mail avec le PDF en pièce jointe.
          {statut === "payee" && " Son statut « Payée » ne change pas."}
          {statut === "envoyee" && envoyeeLe && ` Dernier envoi le ${formatDate(envoyeeLe)}.`}
        </p>
        {listeDestinataires}
      </ModaleConfirmation>

      {/* Paiement */}
      <Modale ouverte={modale === "payer"} onFermer={fermer} titre="Enregistrer le paiement" verrouillee={enregistrement}>
        <FormulairePaiement
          factureId={factureId}
          montant={montant}
          libelle={libelle}
          aujourdhui={aujourdhui}
          onEnCours={setEnregistrement}
          onAnnuler={fermer}
          onTermine={(m) => {
            fermer();
            setMessage(m ?? "Paiement enregistré.");
          }}
        />
      </Modale>

      {/* Annuler le paiement */}
      <ModaleConfirmation
        ouverte={modale === "annuler-paiement"}
        onFermer={fermer}
        titre="Annuler le paiement"
        libelleConfirmer="Annuler le paiement"
        danger
        onConfirmer={() => annulerPaiement(factureId)}
        onSucces={reussite}
      >
        <p>
          Le paiement enregistré sera effacé et la facture <strong>{libelle}</strong> repassera au statut «{" "}
          {LIBELLES_STATUT[envoyeeLe ? "envoyee" : "emise"]} ». À utiliser en cas d&apos;erreur de saisie ou de paiement
          rejeté.
        </p>
      </ModaleConfirmation>

      {/* Annuler la facture */}
      <Modale ouverte={modale === "annuler"} onFermer={fermer} titre="Annuler la facture" verrouillee={enregistrement}>
        <FormulaireAnnulation
          factureId={factureId}
          libelle={libelle}
          montant={montant}
          onEnCours={setEnregistrement}
          onAnnuler={fermer}
          onTermine={(m) => {
            fermer();
            setMessage(m ?? "Facture annulée.");
          }}
        />
      </Modale>

      {/* Dupliquer */}
      <ModaleConfirmation
        ouverte={modale === "dupliquer"}
        onFermer={fermer}
        titre="Dupliquer en brouillon"
        libelleConfirmer="Créer le brouillon"
        onConfirmer={() => dupliquerFacture(factureId)}
        onSucces={naviguer}
      >
        <p>
          Un nouveau brouillon sera créé pour <strong>{nomClient}</strong> avec les mêmes lignes, le même objet et la même
          période. Vous pourrez le modifier avant de l&apos;émettre. La facture <strong>{libelle}</strong> n&apos;est pas
          modifiée.
        </p>
      </ModaleConfirmation>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Formulaires en modale
// -----------------------------------------------------------------------------

function FormulairePaiement({
  factureId,
  montant,
  libelle,
  aujourdhui,
  onAnnuler,
  onTermine,
  onEnCours,
}: {
  factureId: string;
  montant: string;
  libelle: string;
  aujourdhui: string;
  onAnnuler: () => void;
  onTermine: (message?: string) => void;
  onEnCours?: (enCours: boolean) => void;
}) {
  const id = useId();
  const [etat, envoyer, enCours] = useActionState<ResultatAction | null, FormData>(async (precedent, donnees) => {
    const resultat = await appeler(marquerPayee(precedent, donnees));
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
      <input type="hidden" name="facture_id" value={factureId} />
      <p className="text-sm">
        Facture <strong>{libelle}</strong> — {montant} TTC.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-date`} className="label">
            Date du paiement <span className="text-red-600">*</span>
          </label>
          <input
            id={`${id}-date`}
            name="payee_le"
            type="date"
            required
            max={aujourdhui}
            defaultValue={aujourdhui}
            className="champ"
          />
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
        <p role="alert" className="erreur whitespace-pre-line">
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

function FormulaireAnnulation({
  factureId,
  libelle,
  montant,
  onAnnuler,
  onTermine,
  onEnCours,
}: {
  factureId: string;
  libelle: string;
  montant: string;
  onAnnuler: () => void;
  onTermine: (message?: string) => void;
  onEnCours?: (enCours: boolean) => void;
}) {
  const id = useId();
  const [etat, envoyer, enCours] = useActionState<ResultatAction | null, FormData>(async (precedent, donnees) => {
    const resultat = await appeler(annulerFacture(precedent, donnees));
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
      <input type="hidden" name="facture_id" value={factureId} />
      <div className="space-y-2 text-sm">
        <p>
          La facture <strong>{libelle}</strong> ({montant} TTC) passera au statut « Annulée ». Cette opération est{" "}
          <strong>définitive</strong>.
        </p>
        <p className="text-muted">
          Une facture émise ne peut pas être supprimée : elle reste dans la numérotation continue, marquée comme annulée,
          conformément aux règles de facturation. Pour la remplacer, dupliquez-la ensuite en brouillon, corrigez-la puis
          émettez-la.
        </p>
      </div>
      <div>
        <label htmlFor={`${id}-motif`} className="label">
          Motif de l&apos;annulation <span className="text-red-600">*</span>
        </label>
        <textarea
          id={`${id}-motif`}
          name="motif"
          required
          minLength={3}
          maxLength={500}
          rows={3}
          className="champ"
          placeholder="Ex. Erreur de montant, facture remplacée par une nouvelle facture…"
        />
      </div>
      {etat && !etat.ok && (
        <p role="alert" className="erreur whitespace-pre-line">
          {etat.erreur}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondaire" onClick={onAnnuler} disabled={enCours}>
          Retour
        </button>
        <button type="submit" className="btn-danger" disabled={enCours}>
          {enCours ? "Annulation…" : "Annuler la facture"}
        </button>
      </div>
    </form>
  );
}
