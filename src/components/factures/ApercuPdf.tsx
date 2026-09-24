"use client";

import { useState } from "react";
import { IconeExterne, IconeFlecheBas, IconeFlecheHaut, IconeOeil } from "./Icones";

/**
 * Aperçu PDF intégré, replié par défaut : l'iframe n'est chargée qu'à l'ouverture.
 * `version` change à chaque modification de la facture pour éviter un PDF en cache.
 */
export function ApercuPdf({ factureId, version, brouillon }: { factureId: string; version: string; brouillon: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  const url = `/api/factures/${factureId}/pdf?v=${encodeURIComponent(version)}`;

  return (
    <section className="carte overflow-hidden" aria-label="Aperçu PDF">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-page/60"
      >
        <span className="flex items-center gap-2">
          <IconeOeil className="size-4 text-brand" />
          <span className="titre-section">Aperçu PDF</span>
          {brouillon && <span className="text-xs text-muted">(filigrane « BROUILLON »)</span>}
        </span>
        {ouvert ? <IconeFlecheHaut className="size-4 text-muted" /> : <IconeFlecheBas className="size-4 text-muted" />}
      </button>
      {ouvert && (
        <div className="border-t border-line bg-page">
          <iframe
            key={url}
            src={url}
            title="Aperçu PDF de la facture"
            className="h-[75vh] min-h-[480px] w-full bg-white"
          />
          <p className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-xs text-muted">
            <span>L&apos;aperçu ne s&apos;affiche pas sur certains mobiles.</span>
            <a href={url} target="_blank" rel="noopener" className="btn-lien text-xs">
              Ouvrir dans un nouvel onglet
              <IconeExterne className="size-3.5" />
            </a>
          </p>
        </div>
      )}
    </section>
  );
}
