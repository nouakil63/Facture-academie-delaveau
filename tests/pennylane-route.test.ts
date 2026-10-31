import { beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { donneesMigration } from "./pennylane-fixtures";

const sessionUtilisateur = vi.fn();
vi.mock("@/app/api/_partage/http", async (original) => ({
  ...await original<typeof import("@/app/api/_partage/http")>(), sessionUtilisateur,
}));
const { GET } = await import("@/app/api/exports/pennylane/route");

function session(membre = true, erreurTable?: string) {
  const d = donneesMigration();
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => ({
      limit: vi.fn(async () => ({ data: membre ? [{ email: "membre@exemple.fr" }] : [], error: null })),
      order: vi.fn(() => ({ range: vi.fn(async (debut: number, fin: number) => {
        const lignes = d[table as keyof typeof d];
        if (!Array.isArray(lignes)) throw new Error(`Table inattendue : ${table}`);
        return { data: lignes.slice(debut, fin + 1), count: lignes.length,
          error: table === erreurTable ? { message: "Accès indisponible" } : null };
      }) })),
    })),
  }));
  return { supabase: { from }, utilisateur: { id: "membre" } };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("Téléchargement du dossier Pennylane", () => {
  it("refuse les sessions absentes et les comptes non membres avant de lire les données", async () => {
    sessionUtilisateur.mockResolvedValue(null);
    const anonyme = await GET();
    expect(anonyme.status).toBe(401);
    expect(anonyme.headers.get("cache-control")).toBe("private, no-store");
    const nonMembre = session(false);
    sessionUtilisateur.mockResolvedValue(nonMembre);
    expect((await GET()).status).toBe(403);
    expect(nonMembre.supabase.from.mock.calls).toEqual([["membres"]]);
  });

  it("télécharge une archive lisible avec un vrai PDF et les données complètes sous RLS", async () => {
    sessionUtilisateur.mockResolvedValue(session());
    const reponse = await GET();
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("content-type")).toBe("application/zip");
    expect(reponse.headers.get("content-disposition")).toContain('attachment; filename="Reprise-Pennylane-');
    expect(reponse.headers.get("cache-control")).toBe("private, no-store");
    const fichiers = unzipSync(new Uint8Array(await reponse.arrayBuffer()));
    const nomPdf = Object.keys(fichiers).find((nom) => nom.startsWith("factures-a-importer/"))!;
    expect(Buffer.from(fichiers[nomPdf]).subarray(0, 5).toString()).toBe("%PDF-");
    const source = JSON.parse(strFromU8(fichiers["archives/donnees-source.json"]));
    expect(source.factures).toHaveLength(1);
    expect(source.extras_clients[0].facture_id).toBeNull();
    expect(source.compteurs_factures[0].dernier_numero).toBe(1);
  });

  it("ne livre aucune archive si une table métier est inaccessible", async () => {
    sessionUtilisateur.mockResolvedValue(session(true, "echeances"));
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    const reponse = await GET();
    expect(reponse.status).toBe(500);
    expect(reponse.headers.get("content-type")).toContain("text/plain");
    expect(await reponse.text()).toContain("export complet");
    journal.mockRestore();
  });
});
