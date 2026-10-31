"use client";

import { useState } from "react";
import { titreSection } from "./sections";

export function ExportPennylane() {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [termine, setTermine] = useState(false);

  async function telecharger() {
    setEnCours(true);
    setErreur(null);
    setTermine(false);
    try {
      const reponse = await fetch("/api/exports/pennylane", { cache: "no-store" });
      if (!reponse.ok) throw new Error(await reponse.text());
      if (!reponse.headers.get("content-type")?.includes("application/zip")) {
        throw new Error("Session expirée : reconnectez-vous pour exporter les données.");
      }
      const fichier = await reponse.blob();
      const url = URL.createObjectURL(fichier);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = reponse.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "Reprise-Pennylane.zip";
      document.body.append(lien);
      lien.click();
      lien.remove();
      // Laisser le navigateur prendre en charge le téléchargement avant de libérer l'URL.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setTermine(true);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Téléchargement interrompu : relancez l'export.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <section id="pennylane" aria-labelledby="pennylane-titre" className="carte">
      <div className="border-b border-line px-5 py-4">
        <h2 id="pennylane-titre" className="titre-section">{titreSection("pennylane")}</h2>
        <p className="mt-1 text-sm text-muted">Préparer la reprise de tout l&apos;historique dans Pennylane.</p>
      </div>
      <div className="space-y-4 px-5 py-5 text-sm">
        <p>
          Le dossier ZIP contient les clients particuliers et entreprises, le catalogue des prestations,
          les factures PDF et le suivi des règlements. Il couvre <strong>toutes les académies et toutes les dates</strong>,
          y compris les clients inactifs. Les brouillons et factures annulées sont rangés dans les archives.
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-muted">
          <li>Télécharger le dossier, puis ouvrir le guide et le fichier de contrôles.</li>
          <li>Importer les clients et les produits dans Pennylane, puis les PDF du dossier « factures-a-importer ».</li>
          <li>Reprendre les paiements à partir du fichier de suivi et vérifier les totaux du bilan.</li>
        </ol>
        <p className="aide">
          Les tarifs récurrents, les arrhes et les anciennes échéances sont conservés pour préparer leur reprise.
          Les abonnements et les statuts de paiement nécessitent une vérification dans Pennylane.
          Si un FEC couvre déjà la même période, convenez de la reprise avec votre cabinet pour éviter les doublons.
        </p>
        <p className="aide">
          Évitez les saisies pendant l&apos;export. La préparation des PDF peut prendre plusieurs minutes.
          Le téléchargement ne désactive pas la facturation automatique : prévoyez son arrêt à la date de bascule.
        </p>
        <button type="button" onClick={telecharger} disabled={enCours} aria-busy={enCours} className="btn-primaire">
          {enCours ? "Préparation du dossier…" : "Télécharger le dossier Pennylane"}
        </button>
        <p role="status" aria-live="polite" className="text-muted">
          {enCours ? "Export en cours, gardez cette page ouverte." : termine ? "Dossier prêt : téléchargement lancé." : ""}
        </p>
        {erreur && <p role="alert" className="erreur">{erreur}</p>}
      </div>
    </section>
  );
}
