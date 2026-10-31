import { describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { codePays, csv, fichiersTabulaires, cheminPdf, preparerFactures, produireArchive } from "@/lib/pennylane/export";
import { chargerTable } from "@/lib/pennylane/donnees";
import type { ClientSupabase } from "@/lib/supabase/server";
import { donneesMigration } from "./pennylane-fixtures";

describe("Reprise Pennylane", () => {
  it("conserve les centimes, guillemets, retours à la ligne et bloque les formules CSV", () => {
    const texte = csv(["Texte", "Montant"], [['Cours ; "école"\nOctobre', "-12,34"], ["  =HYPERLINK(1)", 2]]);
    expect(texte).toContain('\uFEFF"Texte";"Montant"\r\n');
    expect(texte).toContain('"Cours ; ""école""\nOctobre";"-12,34"');
    expect(texte).toContain('"\'  =HYPERLINK(1)";"2"');
    const fichiers = fichiersTabulaires(donneesMigration());
    // Montant de ligne arrondi en base : 12345 * 1,5 = 18518 centimes ; aucun recalcul à l'export.
    expect(fichiers["suivi-factures-et-reglements.csv"]).toContain('"185,18";"0,00";"185,18"');
    expect(fichiers["archives/tarifs-clients.csv"]).toContain('"99,99";"2";"true"');
  });

  it("normalise la France et les codes ISO sans attribuer FR à un autre pays", () => {
    expect(codePays(" France ")).toBe("FR");
    expect(codePays("be")).toBe("BE");
    expect(codePays("Belgique")).toBe("");
    expect(codePays(null)).toBe("");
    const d = donneesMigration();
    d.clients[0].pays = "Belgique";
    d.clients[0].email = null;
    const fichiers = fichiersTabulaires(d);
    expect(fichiers["controles-avant-import.csv"]).toContain("e-mail, code pays ISO à renseigner");
    expect(fichiers["clients-particuliers.csv"]).toContain('"false"'); // Client inactif conservé.
  });

  it("reprend les coordonnées figées et refuse les totaux incohérents avant les PDF", () => {
    const d = donneesMigration();
    expect(preparerFactures(d)[0].client.nom).toBe("Ancien nom");
    expect(preparerFactures(d)[0].emetteur.raison_sociale).toBe("Académie Delaveau");
    d.factures[0].total_ttc_centimes += 1;
    expect(() => preparerFactures(d)).toThrow("Totaux incohérents");
  });

  it("sépare brouillons et annulations, conserve les paiements et les anciennes échéances", async () => {
    const d = donneesMigration();
    const payee = d.factures[0];
    const brouillon = { ...payee, id: "brouillon", numero: null, statut: "brouillon" as const, payee_le: null };
    const annulee = { ...payee, id: "annulee", numero: "F/1", statut: "annulee" as const, motif_annulation: "Erreur" };
    const annuelle = { ...payee, id: "annuelle", numero: "F:1", statut: "emise" as const, type_facture: "annuelle" as const, saison: 2026, payee_le: null };
    d.factures.push(brouillon, annulee, annuelle);
    const lignes = [...d.lignes_facture];
    for (const f of [brouillon, annulee, annuelle]) d.lignes_facture.push(...lignes.map((l) => ({ ...l, id: `${l.id}-${f.id}`, facture_id: f.id })));
    d.echeances.push({ id: "echeance", facture_id: annuelle.id, client_id: annuelle.client_id, numero_avis: "E1-2026-10",
      date_echeance: "2026-10-31", montant_centimes: 2000, statut: "payee", payee_le: "2026-10-03", mode_paiement: "Virement" });
    expect(cheminPdf(brouillon)).toMatch(/^archives\/brouillons\//);
    expect(cheminPdf(annulee)).toMatch(/^archives\/annulees\//);
    const morceaux: Uint8Array[] = [];
    for await (const morceau of produireArchive(d, preparerFactures(d), async () => new TextEncoder().encode("%PDF-test"))) morceaux.push(morceau);
    const fichiers = unzipSync(Buffer.concat(morceaux));
    expect(Object.keys(fichiers).filter((n) => n.startsWith("factures-a-importer/")).length).toBe(2);
    expect(Object.keys(fichiers).filter((n) => n.endsWith(".pdf")).length).toBe(4);
    const suivi = strFromU8(fichiers["suivi-factures-et-reglements.csv"]);
    expect(suivi).toContain('"payee";"true"');
    expect(suivi).toContain('"2026-10-05";"Virement"');
    expect(suivi).toContain('"annulee";"false"');
    expect(strFromU8(fichiers["archives/echeances.csv"])).toContain('"20,00";"payee";"2026-10-03"');
    expect(JSON.parse(strFromU8(fichiers["archives/donnees-source.json"]))).toEqual(d);
    const bilan = JSON.parse(strFromU8(fichiers["bilan.json"]));
    expect(bilan.total_ttc_a_importer_centimes).toBe(2 * payee.total_ttc_centimes);
    expect(bilan.factures_par_statut.annulee).toBe(1);
  });

  it("interrompt l'archive si la génération d'un PDF échoue", async () => {
    const d = donneesMigration();
    const lire = async () => {
      for await (const morceau of produireArchive(d, preparerFactures(d), async () => { throw new Error("PDF indisponible"); })) void morceau;
    };
    await expect(lire()).rejects.toThrow("PDF indisponible");
  });
});

describe("Pagination de l'historique", () => {
  function base(lignes: unknown[], plafond = 500, changerTotal = false) {
    const range = vi.fn(async (debut: number, fin: number) => ({
      data: lignes.slice(debut, Math.min(fin + 1, debut + plafond)), error: null,
      count: lignes.length + (changerTotal && debut > 0 ? 1 : 0),
    }));
    const order = vi.fn(() => ({ range }));
    const select = vi.fn(() => ({ order }));
    return { client: { from: vi.fn(() => ({ select })) } as unknown as ClientSupabase, range, order };
  }
  it("exporte plus de 1000 lignes même si le serveur plafonne chaque page à 200", async () => {
    const lignes = Array.from({ length: 1205 }, (_, id) => ({ id }));
    const { client, range, order } = base(lignes, 200);
    expect(await chargerTable(client, "factures")).toEqual(lignes);
    expect(range).toHaveBeenCalledTimes(7);
    expect(order).toHaveBeenCalledWith("id");
  });
  it("ne livre pas un export partiel si le nombre de lignes change en cours de lecture", async () => {
    const { client } = base(Array.from({ length: 501 }, (_, id) => ({ id })), 500, true);
    await expect(chargerTable(client, "factures")).rejects.toThrow("ont changé");
  });
  it("accepte une table vide et la clé annuelle des compteurs", async () => {
    const { client, order } = base([]);
    expect(await chargerTable(client, "compteurs_factures", "annee")).toEqual([]);
    expect(order).toHaveBeenCalledWith("annee");
  });
});
