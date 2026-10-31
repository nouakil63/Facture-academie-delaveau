"use client";

import { useRef, useState } from "react";
import { IconeTelecharger } from "@/components/Icones";
import { genererArchiveFactures } from "@/lib/exports/archive";

function telecharger(blob: Blob, nom: string) {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function reponseValide(reponse: Response) {
  if (reponse.status === 401 || reponse.redirected) throw new Error("Session expirée : se reconnecter puis relancer l’export.");
  if (!reponse.ok) throw new Error(await reponse.text() || "Export impossible. Réessayer.");
  return reponse;
}

export function BoutonExport({ type }: { type: "clients" | "factures" }) {
  const verrou = useRef(false);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");

  async function exporter() {
    if (verrou.current) return;
    verrou.current = true;
    setEnCours(true);
    setErreur("");
    setMessage("Préparation de l’export…");
    try {
      const reponse = await reponseValide(await fetch(`/api/${type}/export`, { cache: "no-store" }));
      if (type === "clients") {
        telecharger(await reponse.blob(), "Clients-academies.xlsx");
        setMessage("Export Excel téléchargé : tous les clients, archivés compris, des deux académies.");
      } else {
        const factures: { id: string; numero: string | null; statut: string }[] = await reponse.json();
        if (!factures.length) { setMessage("Aucune facture à exporter."); return; }
        const archive = await genererArchiveFactures(factures, async (id) => {
          const pdf = await reponseValide(await fetch(`/api/factures/${id}/pdf?telecharger=1`, { cache: "no-store" }));
          if (!pdf.headers.get("content-type")?.startsWith("application/pdf")) throw new Error("Le serveur n’a pas retourné un PDF. Relancer l’export.");
          return pdf.arrayBuffer();
        }, (i, total) => setMessage(i === total ? "Création du fichier ZIP…"
          : `Téléchargement des factures : ${i + 1} / ${total}… Garder cette page ouverte.`));
        telecharger(new Blob([archive], { type: "application/zip" }), "Toutes-les-factures.zip");
        setMessage(`${factures.length} factures exportées, brouillons et factures annulées compris, des deux académies.`);
      }
    } catch (e) {
      setMessage("");
      setErreur(e instanceof Error ? e.message : "Export impossible. Réessayer.");
    } finally {
      verrou.current = false;
      setEnCours(false);
    }
  }

  return (
    <div className="max-w-sm space-y-2">
      <button type="button" className="btn-secondaire" disabled={enCours} onClick={exporter}
        title={type === "clients" ? "Tous les clients des deux académies, archivés compris" : "Tous les PDF des deux académies, tous statuts, sans filtre"}>
        <IconeTelecharger />
        {enCours ? "Export en cours…" : type === "clients" ? "Exporter tous les clients (Excel)" : "Exporter toutes les factures (ZIP)"}
      </button>
      {message && <p role="status" className="text-xs text-muted">{message}</p>}
      {erreur && <p role="alert" className="erreur text-sm">{erreur}</p>}
    </div>
  );
}
