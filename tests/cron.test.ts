import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Academie, Parametres, ResultatGeneration } from "@/lib/types";

// Base simulée : paramètres, académies et génération (service), envoi (envoi.ts), client admin.
const chargerParametres = vi.fn<() => Promise<Parametres>>();
const chargerAcademies = vi.fn<() => Promise<Academie[]>>();
const genererBrouillonsMensuels =
  vi.fn<(s: unknown, periode: string, o?: { academieId?: string | null; apercu?: boolean }) => Promise<ResultatGeneration[]>>();
vi.mock("@/lib/facturation/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/facturation/service")>()),
  chargerParametres,
  chargerAcademies,
  genererBrouillonsMensuels,
}));

const envoyerFactures = vi.fn<(s: unknown, ids: string[]) => Promise<{ id: string; ok: boolean; erreur?: string }[]>>();
vi.mock("@/lib/facturation/envoi", () => ({ envoyerFactures }));

/** Clients (id → académie) lus pour la répartition par académie. */
let academieDesClients: Record<string, string> = {};
const admin = {
  from: (table: string) => ({
    select: () => ({
      in: async (_colonne: string, ids: string[]) =>
        table === "clients"
          ? { data: ids.map((id) => ({ id, academie_id: academieDesClients[id] })), error: null }
          : { data: null, error: { message: `table ${table} inattendue` } },
    }),
  }),
};
vi.mock("@/lib/supabase/admin", () => ({ creerClientAdmin: () => admin }));

const { GET } = await import("@/app/api/cron/facturation-mensuelle/route");
const { academieExemple, parametresExemple } = await import("@/lib/pdf/exemple");

const DELAVEAU = academieExemple({ id: "a0000000-0000-4000-8000-000000000001", nom: "Académie Delaveau", ordre: 1 });
const ESPOIR = academieExemple({ id: "a0000000-0000-4000-8000-000000000002", nom: "Académie Espoir", ordre: 2 });

function appel(recherche = "", secret = "secret-cron") {
  return GET(
    new NextRequest(`https://facturation.test/api/cron/facturation-mensuelle${recherche}`, {
      headers: { authorization: `Bearer ${secret}` },
    }),
  );
}

function resultat(client_id: string, facture_id: string | null, deja_existante = false): ResultatGeneration {
  return { client_id, facture_id, nb_lignes: 1, total_ht_centimes: 45000, deja_existante };
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "secret-cron");
  chargerParametres.mockReset().mockResolvedValue(
    parametresExemple({ generation_auto: true, jour_generation: 5, mois_facture: "courant" }),
  );
  chargerAcademies.mockReset().mockResolvedValue([DELAVEAU, ESPOIR]);
  genererBrouillonsMensuels.mockReset().mockResolvedValue([]);
  envoyerFactures.mockReset().mockImplementation(async (_s, ids) => ids.map((id) => ({ id, ok: true })));
  academieDesClients = {};
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/facturation-mensuelle", () => {
  it("refuse un appel sans le bon secret, et un secret non configuré", async () => {
    expect((await appel("", "mauvais")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await appel()).status).toBe(500);
    expect(chargerParametres).not.toHaveBeenCalled();
  });

  it("refuse une date invalide", async () => {
    const reponse = await appel("?date=2026-02-30");
    expect(reponse.status).toBe(400);
  });

  it("ne fait rien si ce n'est pas le jour de génération", async () => {
    const reponse = await appel("?date=2026-10-04");
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toMatchObject({
      ok: true,
      execute: false,
      raison: "génération prévue le 5 du mois",
    });
    expect(genererBrouillonsMensuels).not.toHaveBeenCalled();
  });

  it("ne fait rien si la génération automatique est désactivée", async () => {
    chargerParametres.mockResolvedValue(parametresExemple({ generation_auto: false, jour_generation: 5 }));
    const corps = await (await appel("?date=2026-10-05")).json();
    expect(corps).toMatchObject({ execute: false, raison: "génération automatique désactivée" });
    expect(genererBrouillonsMensuels).not.toHaveBeenCalled();
  });

  it("génère pour toutes les académies le mois précédent si réglé ainsi, sans envoi automatique", async () => {
    chargerParametres.mockResolvedValue(
      parametresExemple({ generation_auto: true, jour_generation: 5, mois_facture: "precedent", envoi_auto: false }),
    );
    academieDesClients = { c1: DELAVEAU.id, c2: ESPOIR.id, c3: ESPOIR.id };
    genererBrouillonsMensuels.mockResolvedValue([
      resultat("c1", "f1"),
      resultat("c2", "f2"),
      resultat("c3", "f3", true),
    ]);

    const reponse = await appel("?date=2026-10-05");
    expect(reponse.status).toBe(200);
    expect(genererBrouillonsMensuels).toHaveBeenCalledWith(admin, "2026-09-01", { apercu: false });
    expect(envoyerFactures).not.toHaveBeenCalled();
    expect(await reponse.json()).toMatchObject({
      ok: true,
      execute: true,
      date: "2026-10-05",
      periode: "2026-09-01",
      brouillons_crees: 2,
      deja_existantes: 1,
      envoi_auto: false,
      envoyees: 0,
      par_academie: [
        { id: DELAVEAU.id, nom: "Académie Delaveau", brouillons_crees: 1, deja_existantes: 0 },
        { id: ESPOIR.id, nom: "Académie Espoir", brouillons_crees: 1, deja_existantes: 1 },
      ],
    });
  });

  it("envoie uniquement les brouillons nouvellement créés et liste les échecs", async () => {
    chargerParametres.mockResolvedValue(parametresExemple({ generation_auto: true, jour_generation: 5, envoi_auto: true }));
    academieDesClients = { c1: DELAVEAU.id, c2: ESPOIR.id, c3: ESPOIR.id };
    genererBrouillonsMensuels.mockResolvedValue([
      resultat("c1", "f1"),
      resultat("c2", "f2"),
      resultat("c3", "f-ancienne", true),
    ]);
    envoyerFactures.mockResolvedValue([
      { id: "f1", ok: true },
      { id: "f2", ok: false, erreur: "Aucune adresse e-mail pour Marie Dupont" },
    ]);

    const corps = await (await appel("?date=2026-10-05")).json();
    expect(genererBrouillonsMensuels).toHaveBeenCalledWith(admin, "2026-10-01", { apercu: false });
    expect(envoyerFactures).toHaveBeenCalledWith(admin, ["f1", "f2"]);
    expect(corps).toMatchObject({
      ok: true,
      brouillons_crees: 2,
      envoi_auto: true,
      envoyees: 1,
      echecs_envoi: [{ facture_id: "f2", erreur: "Aucune adresse e-mail pour Marie Dupont" }],
    });
  });

  it("en aperçu, ne crée rien et n'envoie rien", async () => {
    chargerParametres.mockResolvedValue(parametresExemple({ generation_auto: true, jour_generation: 5, envoi_auto: true }));
    genererBrouillonsMensuels.mockResolvedValue([resultat("c1", null)]);

    const corps = await (await appel("?date=2026-10-05&apercu=1")).json();
    expect(genererBrouillonsMensuels).toHaveBeenCalledWith(admin, "2026-10-01", { apercu: true });
    expect(envoyerFactures).not.toHaveBeenCalled();
    expect(corps).toMatchObject({ apercu: true, brouillons_crees: 1, envoyees: 0 });
  });

  it("répond 500 avec un message clair si la génération échoue", async () => {
    genererBrouillonsMensuels.mockRejectedValue(new Error("Paramètres de facturation absents"));
    const reponse = await appel("?date=2026-10-05");
    expect(reponse.status).toBe(500);
    expect(await reponse.json()).toMatchObject({
      ok: false,
      erreur: "Génération des brouillons impossible : Paramètres de facturation absents",
    });
  });
});
