import { describe, expect, it, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { genererArchiveFactures } from "@/lib/exports/archive";
import { toutesLesPages } from "@/lib/exports/donnees";
import { genererExcelClients } from "@/lib/exports/clients";
import type { ClientExporte } from "@/lib/exports/donnees";

describe("Exports complets", () => {
  it("archive les PDF par statut sans écraser les brouillons ni les numéros normalisés identiques", async () => {
    const factures = [
      { id: "a", numero: null, statut: "brouillon" },
      { id: "b", numero: null, statut: "brouillon" },
      { id: "c", numero: "F/1", statut: "emise" },
      { id: "d", numero: "F-1", statut: "emise" },
      { id: "e", numero: "F-2", statut: "annulee" },
    ];
    const progression = vi.fn();
    const contenu = await genererArchiveFactures(factures,
      async (id) => new TextEncoder().encode(`%PDF-${id}`).buffer as ArrayBuffer, progression);
    const zip = await JSZip.loadAsync(contenu);
    const fichiers = Object.values(zip.files).filter((f) => !f.dir);
    expect(fichiers).toHaveLength(5);
    expect(await zip.file("brouillon/Brouillon-b.pdf")!.async("string")).toBe("%PDF-b");
    expect(await zip.file("annulee/F-2-e.pdf")!.async("string")).toBe("%PDF-e");
    expect(progression).toHaveBeenLastCalledWith(5, 5);
  });
  it("ne fournit aucun ZIP si un PDF est indisponible", async () => {
    const charger = vi.fn().mockRejectedValue(new Error("PDF indisponible"));
    await expect(genererArchiveFactures([
      { id: "a", numero: null, statut: "brouillon" },
      { id: "b", numero: null, statut: "brouillon" },
    ], charger, () => {})).rejects.toThrow("PDF indisponible");
    expect(charger).toHaveBeenCalledTimes(1);
  });
  it("parcourt plus de 1000 lignes, même quand le serveur plafonne chaque réponse à 73 lignes", async () => {
    const source = Array.from({ length: 1205 }, (_, i) => ({ id: String(i).padStart(6, "0") }));
    const resultat = await toutesLesPages(async (apres) => ({
      data: source.filter((r) => apres === null || r.id > apres).slice(0, 73), error: null,
    }));
    expect(resultat).toEqual(source);
  });
  it("interrompt l'export sur une erreur de page au lieu de livrer un résultat partiel", async () => {
    await expect(toutesLesPages(async (apres) => apres === null
      ? { data: [{ id: "1" }], error: null }
      : { data: null, error: { message: "Base indisponible" } })).rejects.toThrow("Base indisponible");
  });
  it("conserve les archivés, accents, zéros initiaux, centimes et textes ressemblant à des formules dans le XLSX", async () => {
    const client = {
      id: "client", nom: "=1+1", prenom: "Élodie", reference: "E1", actif: false,
      academie: { nom: "Académie Espoir" }, emails_cc: ["copie@exemple.fr"],
      code_postal: "01230", telephone: "0612345678", siret: "00123456789012",
      arrhes_centimes: 12345, arrhes_saison: 2026, envoi_auto: false, arrhes_reglees: true,
    } as ClientExporte;
    const bytes = await genererExcelClients([client]);
    const livre = new ExcelJS.Workbook();
    await livre.xlsx.load(Buffer.from(bytes) as never);
    const feuille = livre.getWorksheet("Clients")!;
    expect(feuille.rowCount).toBe(2);
    expect(feuille.getCell("B2").value).toBe("Académie Espoir");
    expect(feuille.getCell("C2").value).toBe("Archivé");
    expect(feuille.getCell("F2").value).toBe("=1+1");
    expect(feuille.getCell("G2").value).toBe("Élodie");
    expect(feuille.getCell("O2").value).toBe("01230");
    expect(feuille.getCell("L2").value).toBe("0612345678");
    expect(feuille.getCell("R2").value).toBe("00123456789012");
    expect(feuille.getCell("V2").value).toBe(123.45);
    expect(feuille.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(feuille.autoFilter).toBeTruthy();
  });
});

const { sessionUtilisateur } = vi.hoisted(() => ({ sessionUtilisateur: vi.fn() }));
vi.mock("@/app/api/_partage/http", async (original) => ({
  ...await original<typeof import("@/app/api/_partage/http")>(), sessionUtilisateur,
}));
const clientsRoute = await import("@/app/api/clients/export/route");
const facturesRoute = await import("@/app/api/factures/export/route");
beforeEach(() => vi.clearAllMocks());

describe("Accès aux exports", () => {
  it("refuse les deux exports sans session", async () => {
    sessionUtilisateur.mockResolvedValue(null);
    expect((await clientsRoute.GET()).status).toBe(401);
    expect((await facturesRoute.GET()).status).toBe(401);
  });
  it("exporte via le client de la session, avec une réponse privée et non mise en cache", async () => {
    const requete = {
      select: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const from = vi.fn(() => requete);
    sessionUtilisateur.mockResolvedValue({ supabase: { from } });
    const xlsx = await clientsRoute.GET();
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(xlsx.headers.get("cache-control")).toBe("private, no-store");
    const manifeste = await facturesRoute.GET();
    expect(await manifeste.json()).toEqual([]);
    expect(manifeste.headers.get("cache-control")).toBe("private, no-store");
    expect(from.mock.calls).toEqual([["clients"], ["factures"]]);
  });
});
