import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionUtilisateur = vi.fn();
const envoyerRelance = vi.fn();
const revalidatePath = vi.fn();
vi.mock("@/app/api/_partage/http", () => ({ sessionUtilisateur }));
vi.mock("@/lib/facturation/envoi", () => ({ envoyerRelance }));
vi.mock("next/cache", () => ({ revalidatePath }));
const { POST } = await import("@/app/api/factures/relance/route");

const demande = {
  factureIds: ["00000000-0000-4000-8000-000000000001"],
  objet: "Suivi de facture", corps: "Bonjour", destinataireAttendu: "famille@exemple.fr",
};
function requete(body: unknown = demande, origin = "https://crm.exemple.fr") {
  return new NextRequest("https://crm.exemple.fr/api/factures/relance", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionUtilisateur.mockResolvedValue({ supabase: {}, utilisateur: { id: "utilisateur" } });
  envoyerRelance.mockResolvedValue({ ok: true, apercu: true });
});
describe("API de relance", () => {
  it("refuse une origine externe et une session absente avant toute relance", async () => {
    expect((await POST(requete(demande, "https://autre.fr"))).status).toBe(403);
    sessionUtilisateur.mockResolvedValue(null);
    expect((await POST(requete())).status).toBe(401);
    expect(envoyerRelance).not.toHaveBeenCalled();
  });
  it("refuse les identifiants invalides et les champs inattendus", async () => {
    expect((await POST(requete({ ...demande, factureIds: ["invalide"] }))).status).toBe(400);
    expect((await POST(requete({ ...demande, destinataire: "autre@exemple.fr" }))).status).toBe(400);
    expect(envoyerRelance).not.toHaveBeenCalled();
  });
  it("utilise un aperçu par défaut, sans revalidation", async () => {
    expect((await POST(requete())).status).toBe(200);
    expect(envoyerRelance).toHaveBeenCalledWith({}, { ...demande, apercu: true });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("actualise le CRM après un envoi demandé explicitement", async () => {
    envoyerRelance.mockResolvedValue({ ok: true, apercu: false });
    expect((await POST(requete({ ...demande, apercu: false }))).status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledWith("/factures");
    expect(revalidatePath).toHaveBeenCalledWith(`/factures/${demande.factureIds[0]}`);
  });
});
