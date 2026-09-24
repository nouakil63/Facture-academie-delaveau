"use client";

import { useState, useTransition } from "react";
import { changerArchivageClient, supprimerClient } from "@/app/(app)/clients/actions";
import { IconeArchive, IconeCorbeille } from "@/components/Icones";
import { ModaleConfirmation } from "@/components/Modale";

/** Boutons « Archiver / Réactiver » et « Supprimer » de la fiche client. */
export function ActionsClient({
  clientId,
  nom,
  actif,
  nbFactures,
}: {
  clientId: string;
  nom: string;
  actif: boolean;
  nbFactures: number;
}) {
  const [confirmation, setConfirmation] = useState<"archiver" | "supprimer" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [reactivation, demarrerReactivation] = useTransition();
  const supprimable = nbFactures === 0;

  function reactiver() {
    setMessage(null);
    demarrerReactivation(async () => {
      const r = await changerArchivageClient(clientId, false);
      setMessage(r.ok ? { ok: true, texte: r.message ?? "Client réactivé." } : { ok: false, texte: r.erreur });
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        {actif ? (
          <button
            type="button"
            className="btn-secondaire"
            onClick={() => {
              setMessage(null);
              setConfirmation("archiver");
            }}
          >
            <IconeArchive />
            Archiver
          </button>
        ) : (
          <button type="button" className="btn-secondaire" onClick={reactiver} disabled={reactivation}>
            <IconeArchive />
            {reactivation ? "Réactivation…" : "Réactiver"}
          </button>
        )}
        <button
          type="button"
          className="btn-secondaire text-red-700 hover:bg-red-50"
          onClick={() => {
            setMessage(null);
            setConfirmation("supprimer");
          }}
        >
          <IconeCorbeille />
          Supprimer
        </button>
      </div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`${message.ok ? "succes" : "erreur"} max-w-md text-left`}>
          {message.texte}
        </p>
      )}

      <ModaleConfirmation
        ouverte={confirmation === "archiver"}
        onFermer={() => setConfirmation(null)}
        titre="Archiver ce client ?"
        libelleConfirmer="Archiver"
        onConfirmer={() => changerArchivageClient(clientId, true)}
        onSucces={(r) => r.message && setMessage({ ok: true, texte: r.message })}
      >
        <p>
          <strong>{nom}</strong> ne sera plus inclus dans la facturation mensuelle et n&apos;apparaîtra plus dans la
          liste des clients (sauf en affichant les archivés).
        </p>
        <p className="text-muted">Ses factures et ses tarifs sont conservés. Vous pourrez le réactiver à tout moment.</p>
      </ModaleConfirmation>

      {supprimable ? (
        <ModaleConfirmation
          ouverte={confirmation === "supprimer"}
          onFermer={() => setConfirmation(null)}
          titre="Supprimer définitivement ce client ?"
          libelleConfirmer="Supprimer définitivement"
          danger
          onConfirmer={() => supprimerClient(clientId)}
        >
          <p>
            La fiche de <strong>{nom}</strong> et tous ses tarifs seront supprimés. Cette action est irréversible.
          </p>
        </ModaleConfirmation>
      ) : (
        <ModaleConfirmation
          ouverte={confirmation === "supprimer"}
          onFermer={() => setConfirmation(null)}
          titre="Suppression impossible"
          libelleConfirmer={actif ? "Archiver plutôt" : "Compris"}
          onConfirmer={async () => (actif ? changerArchivageClient(clientId, true) : undefined)}
          onSucces={(r) => r.message && setMessage({ ok: true, texte: r.message })}
        >
          <p>
            <strong>{nom}</strong> a {nbFactures} facture{nbFactures > 1 ? "s" : ""}. Les factures doivent être
            conservées : un client facturé ne peut pas être supprimé.
          </p>
          <p className="text-muted">
            {actif
              ? "Archivez-le pour le retirer de la liste et de la facturation mensuelle, tout en gardant son historique."
              : "Ce client est déjà archivé : il n'apparaît plus dans la liste ni dans la facturation mensuelle."}
          </p>
        </ModaleConfirmation>
      )}
    </div>
  );
}
