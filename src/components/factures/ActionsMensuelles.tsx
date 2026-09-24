"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { envoyerBrouillonsMensuels, genererBrouillons } from "@/app/(app)/facturation-mensuelle/actions";
import { ModaleConfirmation } from "@/components/Modale";
import { appeler } from "@/lib/appeler";
import { formatEuros, pluriel } from "@/lib/format";
import { IconeAlerte, IconeEnvoi, IconePlus, IconeValide } from "@/components/Icones";
import { envoyerParLots } from "./lots";
import { type ResultatEnvoiFacture } from "./outils";
import { ResultatsEnvoi } from "./ResultatsEnvoi";

/** Étape 1 : création des brouillons du mois (une académie, ou toutes si `academieId` est null). */
export function BoutonGenerer({
  academieId,
  mois,
  nombre,
  libelleMois,
}: {
  academieId: string | null;
  mois: string;
  nombre: number;
  libelleMois: string;
}) {
  const [enCours, demarrer] = useTransition();
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);

  function generer() {
    setRetour(null);
    demarrer(async () => {
      const r = await appeler(genererBrouillons(academieId, mois));
      setRetour(r.ok ? { ok: true, texte: r.message ?? "Brouillons créés." } : { ok: false, texte: r.erreur });
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
            {pluriel(nombre, "brouillon sera créé", "brouillons seront créés")} pour {libelleMois}. Rien n&apos;est envoyé
            à cette étape.
          </p>
        ) : (
          <p className="flex items-center gap-2 text-emerald-700">
            <IconeValide className="size-4" />
            Tous les brouillons de {libelleMois} sont déjà générés.
          </p>
        )}
      </div>
      <button type="button" className="btn-primaire shrink-0" onClick={generer} disabled={enCours || nombre === 0}>
        <IconePlus />
        {enCours ? "Génération…" : `Générer les brouillons (${nombre})`}
      </button>
    </div>
  );
}

/** Étape 2 : émission et envoi groupé des brouillons du mois (une académie, ou toutes). */
export function EnvoiBrouillons({
  academieId,
  mois,
  libelleMois,
  brouillons,
  nbSansEmail,
}: {
  academieId: string | null;
  mois: string;
  libelleMois: string;
  /** Brouillons envoyables (client avec au moins une adresse e-mail). */
  brouillons: { id: string; client: string; academie: string | null; totalTtc: number }[];
  nbSansEmail: number;
}) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState(false);
  const [progression, setProgression] = useState<{ traitees: number; total: number } | null>(null);
  const [compteRendu, setCompteRendu] = useState<{ resultats: ResultatEnvoiFacture[]; synthese?: string } | null>(null);
  const total = brouillons.reduce((s, b) => s + b.totalTtc, 0);
  const n = brouillons.length;

  /** Envoi par petits lots ; le serveur ignore les brouillons déjà émis (relance sans doublon). */
  async function envoyerParPetitsLots() {
    const ids = brouillons.map((b) => b.id);
    setProgression({ traitees: 0, total: ids.length });
    try {
      const resultat = await envoyerParLots(
        ids,
        (lot) => envoyerBrouillonsMensuels(academieId, mois, lot),
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
        <ResultatsEnvoi
          resultats={compteRendu.resultats}
          synthese={compteRendu.synthese}
          onFermer={() => setCompteRendu(null)}
        />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          {n > 0
            ? "Relisez les brouillons (lien « Relire »), puis émettez-les et envoyez-les en une fois."
            : "Aucun brouillon à envoyer pour ce mois."}
        </p>
        <button
          type="button"
          className="btn-primaire shrink-0"
          onClick={() => setConfirmation(true)}
          disabled={n === 0}
        >
          <IconeEnvoi />
          {n > 0 ? `Émettre et envoyer tous les brouillons (${n} — ${formatEuros(total)})` : "Émettre et envoyer"}
        </button>
      </div>

      {nbSansEmail > 0 && (
        <p className="avertissement flex items-start gap-2">
          <IconeAlerte className="mt-0.5 size-4 text-amber-600" />
          <span>
            {nbSansEmail === 1
              ? "1 brouillon concerne un client sans adresse e-mail : il n'est pas inclus dans l'envoi groupé. Ouvrez-le pour l'émettre sans envoi (remise en main propre) ou complétez la fiche client."
              : `${nbSansEmail} brouillons concernent des clients sans adresse e-mail : ils ne sont pas inclus dans l'envoi groupé. Ouvrez-les pour les émettre sans envoi (remise en main propre) ou complétez les fiches clients.`}
          </span>
        </p>
      )}

      <ModaleConfirmation
        ouverte={confirmation}
        onFermer={() => setConfirmation(false)}
        titre={`Émettre et envoyer les factures de ${libelleMois}`}
        libelleConfirmer={`Émettre et envoyer (${n})`}
        libelleEnCours={
          progression ? `Envoi en cours… ${progression.traitees} / ${progression.total}` : "Envoi en cours…"
        }
        desactiver={n === 0}
        onConfirmer={envoyerParPetitsLots}
        onSucces={(r) => setCompteRendu({ resultats: r.donnees ?? [], synthese: r.message })}
      >
        <p>
          <strong>{pluriel(n, "brouillon")}</strong> pour un total de <strong>{formatEuros(total)} TTC</strong> :
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>chaque facture reçoit son numéro définitif et ne pourra plus être modifiée ;</li>
          <li>elle est envoyée par e-mail au client (adresse principale et copies) avec le PDF en pièce jointe.</li>
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
        {n > 10 && <p className="text-xs text-muted">L&apos;envoi est séquentiel : comptez quelques secondes par facture.</p>}
      </ModaleConfirmation>
    </div>
  );
}
