import "server-only";
import ExcelJS from "exceljs";
import type { ClientExporte } from "./donnees";

export async function genererExcelClients(clients: ClientExporte[]) {
  const classeur = new ExcelJS.Workbook();
  classeur.creator = "Académie Delaveau";
  const feuille = classeur.addWorksheet("Clients", { views: [{ state: "frozen", ySplit: 1 }] });
  feuille.columns = [
    ["Référence", 14], ["Académie", 25], ["Statut", 12], ["Type", 16], ["Civilité", 12],
    ["Nom", 24], ["Prénom", 22], ["Raison sociale", 28], ["Cavalier(s)", 30],
    ["E-mail", 34], ["E-mails en copie", 40], ["Téléphone", 20], ["Adresse", 36],
    ["Complément d'adresse", 30], ["Code postal", 14], ["Ville", 24], ["Pays", 16],
    ["SIRET", 22], ["N° TVA", 22], ["Envoi automatique", 20], ["Arrhes réglées", 18],
    ["Arrhes (€)", 18], ["Saison des arrhes", 18], ["Notes", 50], ["Identifiant", 40],
  ].map(([header, width]) => ({ header: String(header), width: Number(width) }));
  const tries = [...clients].sort((a, b) => a.nom.localeCompare(b.nom, "fr") || (a.prenom ?? "").localeCompare(b.prenom ?? "", "fr"));
  for (const c of tries) {
    // Les chaînes sont des valeurs texte Excel : jamais des formules, même si elles commencent par « = ».
    feuille.addRow([
      c.reference, c.academie?.nom ?? "", c.actif ? "Actif" : "Archivé", c.type, c.civilite,
      c.nom, c.prenom, c.raison_sociale, c.cavaliers, c.email, c.emails_cc?.join(" ; "),
      c.telephone, c.adresse_ligne1, c.adresse_ligne2, c.code_postal, c.ville, c.pays,
      c.siret, c.numero_tva, c.envoi_auto ? "Oui" : "Non", c.arrhes_reglees ? "Oui" : "Non",
      c.arrhes_centimes == null ? null : c.arrhes_centimes / 100, c.arrhes_saison, c.notes, c.id,
    ]);
  }
  feuille.getColumn(22).numFmt = '#,##0.00 "€"';
  feuille.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, feuille.rowCount), column: 25 } };
  feuille.getRow(1).height = 30;
  feuille.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  feuille.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173C32" } };
  feuille.eachRow((row, n) => {
    row.alignment = { vertical: "top", wrapText: true };
    if (n > 1) row.font = { name: "Calibri", size: 11 };
  });
  return new Uint8Array(await classeur.xlsx.writeBuffer());
}
