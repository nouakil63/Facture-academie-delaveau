"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  envoyerAvisGroupes,
  envoyerFacturesAnnuelles,
  preparerFacturesAnnuelles,
  supprimerAnciensBrouillons,
} from "@/app/(app)/facturation-annuelle/actions";
import { IconeAlerte, IconeCorbeille, IconeEnvoi, IconePlus, IconeValide } from "@/components/Icones";
import { ModaleConfirmation } from "@/components/Modale";
import { envoyerParLots } from "@/components/factures/lots";
import type { ResultatEnvoiFacture } from "@/components/factures/outils";
import { ResultatsEnvoi } from "@/components/factures/ResultatsEnvoi";
import { appeler } from "@/lib/appeler";
import { formatEuros, pluriel } from "@/lib/format";

/** Préparation des brouillons des factures annuelles (une académie, ou toutes si `academieId` est null). */
export function BoutonPreparer({
  academieId,
  saison,
  nombre,
  libelle,
}: {
  academieId: string | null;
  saison: number;
  nombre: number;
  /** « 2026-2027 (Delaveau) ». */
  libelle: string;
}) {
  const [enCours, demarrer] = useTransition();
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);

  function preparer() {
    setRetour(null);
    demarrer(async () => {
      const r = await appeler(preparerFacturesAnnuelles(academieId, saison));
      setRetour(r.ok ? { ok: true, texte: r.message ?? "Factures préparées." } : { ok: false, texte: r.erreur });
    });
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm">
        {retour ? (
          <p role={retour.ok ? "status" : "alert"} className={retour.ok ? "succes" : "erreur whitespace-pre-line"}>
            {retour.texte}
          </p>
        ) : nombre > 0 ? (
          <p className="text-muted">
            {pluriel(nombre, "brouillon de facture annuelle", "brouillons de factures annuelles")} pour {libelle}. Rien ne
            part par e-mail à cette étape.
          </p>
        ) : (
          <p className="flex items-center gap-2 text-emerald-700">
            <IconeValide className="size-4" />
            Toutes les factures annuelles {libelle} sont préparées.
          </p>
        )}
      </div>
      <button type="button" className="btn-primaire shrink-0" onClick={preparer} disabled={enCours || nombre === 0}>
        <IconePlus />
        {enCours ? "Préparation…" : `Préparer les factures annuelles (${nombre})`}
      </button>
    </div>
  );
}

/** Émission et envoi groupé des brouillons de factures annuelles de la saison. */
export function EnvoiFacturesAnnuelles({
  academieId,
  saison,
  libelle,
  brouillons,
  nbSansEmail,
}: {
  academieId: string | null;
  saison: number;
  libelle: string;
  brouillons: { id: string; client: string; academie: string | null; totalTtc: number }[];
  nbSansEmail: number;
}) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState(false);
  const [progression, setProgression] = useState<{ traitees: number; total: number } | null>(null);
  const [compteRendu, setCompteRendu] = useState<{ resultats: ResultatEnvoiFacture[]; synthese?: string } | null>(null);
  const total = brouillons.reduce((s, b) => s + b.totalTtc, 0);
  const n = brouillons.length;

  async function envoyer() {
    const ids = brouillons.map((b) => b.id);
    setProgression({ traitees: 0, total: ids.length });
    try {
      const resultat = await envoyerParLots(
        ids,
        (lot) => envoyerFacturesAnnuelles(academieId, saison, lot),
        (_lot, traitees) => setProgression({ traitees, total: ids.length }),
      );
      if (!resultat.ok) router.refresh();
      return resultat;
    } finally {
      setProgression(null);
    }
  }

  return (
    <div className="space-y-4">
      {compteRendu && (
        <ResultatsEnvoi resultats={compteRendu.resultats} synthese={compteRendu.synthese} onFermer={() => setCompteRendu(null)} />
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          {n > 0
            ? "Relire les brouillons (lien « Relire »), puis les émettre et les envoyer en une fois."
            : "Aucun brouillon de facture annuelle à envoyer."}
        </p>
        <button type="button" className="btn-primaire shrink-0" onClick={() => setConfirmation(true)} disabled={n === 0}>
          <IconeEnvoi />
          {n > 0 ? `Émettre et envoyer (${n} — ${formatEuros(total)})` : "Émettre et envoyer"}
        </button>
      </div>
      {nbSansEmail > 0 && (
        <p className="avertissement flex items-start gap-2">
          <IconeAlerte className="mt-0.5 size-4 text-amber-600" />
          <span>
            {nbSansEmail === 1
              ? "1 brouillon concerne un client sans adresse e-mail : exclu de l'envoi groupé. L'ouvrir pour l'émettre sans envoi, ou compléter la fiche client."
              : `${nbSansEmail} brouillons concernent des clients sans adresse e-mail : exclus de l'envoi groupé. Les ouvrir pour les émettre sans envoi, ou compléter les fiches clients.`}
          </span>
        </p>
      )}
      <ModaleConfirmation
        ouverte={confirmation}
        onFermer={() => setConfirmation(false)}
        titre={`Émettre et envoyer les factures annuelles ${libelle}`}
        libelleConfirmer={`Émettre et envoyer (${n})`}
        libelleEnCours={progression ? `Envoi en cours… ${progression.traitees} / ${progression.total}` : "Envoi en cours…"}
        desactiver={n === 0}
        onConfirmer={envoyer}
        onSucces={(r) => setCompteRendu({ resultats: r.donnees ?? [], synthese: r.message })}
      >
        <p>
          <strong>{pluriel(n, "facture annuelle", "factures annuelles")}</strong> pour un total de{" "}
          <strong>{formatEuros(total)} TTC</strong> :
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>chaque facture reçoit son numéro définitif et ne peut plus être modifiée ;</li>
          <li>ses 10 échéances (septembre à juin, arrhes déduites) sont créées ;</li>
          <li>elle part par e-mail au client (adresse principale et copies), PDF en pièce jointe.</li>
        </ul>
        <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {brouillons.map((b) => (
            <li key={b.id} className="flex justify-between gap-3 px-3 py-1.5 text-xs">
              <span className="truncate">
                {b.client}
                {b.academie && <span className="text-muted"> · {b.academie}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{formatEuros(b.totalTtc)}</span>
            </li>
          ))}
        </ul>
        {n > 10 && <p className="text-xs text-muted">Envoi facture par facture : compter quelques secondes pour chacune.</p>}
      </ModaleConfirmation>
    </div>
  );
}

/**
 * Suppression des anciens brouillons MENSUELS de la saison (générés avant le passage à la facture
 * annuelle), pour éviter une double facturation. Brouillons seulement : une facture émise n'est jamais touchée.
 */
export function SupprimerAnciensBrouillons({
  saison,
  academieId = null,
  clientId = null,
  nombre,
  libelle,
}: {
  saison: number;
  academieId?: string | null;
  clientId?: string | null;
  nombre: number;
  /** « de ce client », « de 3 clients ». */
  libelle: string;
}) {
  const [confirmation, setConfirmation] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="btn-secondaire btn-petit text-red-700 hover:bg-red-50" onClick={() => setConfirmation(true)}>
        <IconeCorbeille className="size-3.5" />
        Supprimer ces anciens brouillons
      </button>
      {message && (
        <p role="status" className="succes mt-2">
          {message}
        </p>
      )}
      <ModaleConfirmation
        ouverte={confirmation}
        onFermer={() => setConfirmation(false)}
        titre="Supprimer les anciens brouillons mensuels"
        libelleConfirmer={`Supprimer (${nombre})`}
        danger
        onConfirmer={() => supprimerAnciensBrouillons(saison, { academieId, clientId })}
        onSucces={(r) => setMessage(r.message ?? "Anciens brouillons supprimés.")}
      >
        <p>
          <strong>{pluriel(nombre, "brouillon mensuel", "brouillons mensuels")}</strong> {libelle}, préparés avant la
          facture annuelle, seront supprimés définitivement avec leurs lignes. Ils n&apos;ont pas de numéro : la
          numérotation reste continue.
        </p>
        <p className="text-muted">Brouillons seulement : aucune facture émise n&apos;est touchée.</p>
      </ModaleConfirmation>
    </>
  );
}

/** Envoi groupé des avis « à envoyer » du mois. */
export function EnvoiAvisMois({
  avis,
  libelleMois,
  nbSansEmail,
}: {
  /** Avis à envoyer (client avec au moins une adresse e-mail). */
  avis: { id: string; client: string; numero: string; montant: number }[];
  libelleMois: string;
  nbSansEmail: number;
}) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState(false);
  const [progression, setProgression] = useState<{ traitees: number; total: number } | null>(null);
  const [compteRendu, setCompteRendu] = useState<{ resultats: ResultatEnvoiFacture[]; synthese?: string } | null>(null);
  const total = avis.reduce((s, a) => s + a.montant, 0);
  const n = avis.length;

  async function envoyer() {
    const ids = avis.map((a) => a.id);
    setProgression({ traitees: 0, total: ids.length });
    try {
      const resultat = await envoyerParLots(ids, (lot) => envoyerAvisGroupes(lot), (_lot, traitees) =>
        setProgression({ traitees, total: ids.length }),
      );
      if (!resultat.ok) router.refresh();
      return resultat;
    } finally {
      setProgression(null);
    }
  }

  return (
    <div className="space-y-4">
      {compteRendu && (
        <ResultatsEnvoi
          resultats={compteRendu.resultats}
          synthese={compteRendu.synthese}
          onFermer={() => setCompteRendu(null)}
          lien={null}
          libelleEnvoi="Envoyé"
        />
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          {n > 0 ? `Avis de ${libelleMois} pas encore envoyés : envoi en une fois.` : `Aucun avis de ${libelleMois} à envoyer.`}
        </p>
        <button type="button" className="btn-primaire shrink-0" onClick={() => setConfirmation(true)} disabled={n === 0}>
          <IconeEnvoi />
          {n > 0 ? `Envoyer les avis (${n} — ${formatEuros(total)})` : "Envoyer les avis"}
        </button>
      </div>
      {nbSansEmail > 0 && (
        <p className="avertissement flex items-start gap-2">
          <IconeAlerte className="mt-0.5 size-4 text-amber-600" />
          <span>
            {pluriel(nbSansEmail, "avis concerne un client", "avis concernent des clients")} sans adresse e-mail : exclu
            {nbSansEmail > 1 ? "s" : ""} de l&apos;envoi. Télécharger le PDF pour une remise en main propre, ou compléter la
            fiche client.
          </span>
        </p>
      )}
      <ModaleConfirmation
        ouverte={confirmation}
        onFermer={() => setConfirmation(false)}
        titre={`Envoyer les avis d'échéance de ${libelleMois}`}
        libelleConfirmer={`Envoyer (${n})`}
        libelleEnCours={progression ? `Envoi en cours… ${progression.traitees} / ${progression.total}` : "Envoi en cours…"}
        desactiver={n === 0}
        onConfirmer={envoyer}
        onSucces={(r) => setCompteRendu({ resultats: r.donnees ?? [], synthese: r.message })}
      >
        <p>
          <strong>{pluriel(n, "avis", "avis")}</strong> pour un total de <strong>{formatEuros(total)}</strong>, envoyés par
          e-mail (adresse principale et copies), PDF en pièce jointe. Un avis déjà envoyé ou réglé n&apos;est jamais renvoyé.
        </p>
        <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {avis.map((a) => (
            <li key={a.id} className="flex justify-between gap-3 px-3 py-1.5 text-xs">
              <span className="truncate">
                {a.client} <span className="font-mono text-muted">· {a.numero}</span>
              </span>
              <span className="shrink-0 tabular-nums">{formatEuros(a.montant)}</span>
            </li>
          ))}
        </ul>
      </ModaleConfirmation>
    </div>
  );
}
