export interface FactureAExporter { id: string; numero: string | null; statut: string }

/** Aucun résultat partiel : la première erreur interrompt la création de l'archive. */
export async function genererArchiveFactures(
  factures: FactureAExporter[],
  chargerPdf: (id: string) => Promise<ArrayBuffer>,
  progression: (traitees: number, total: number) => void,
) {
  const { default: JSZip } = await import("jszip");
  const archive = new JSZip();
  for (const [i, facture] of factures.entries()) {
    progression(i, factures.length);
    const nom = (facture.numero ?? "Brouillon").replace(/[^A-Za-z0-9_-]+/g, "-");
    // UUID complet : aucune collision, même pour deux brouillons ou numéros normalisés identiques.
    archive.file(`${facture.statut}/${nom}-${facture.id}.pdf`, await chargerPdf(facture.id));
  }
  progression(factures.length, factures.length);
  return archive.generateAsync({ type: "arraybuffer" });
}
