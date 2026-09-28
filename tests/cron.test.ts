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

const envoyerFactures =
  vi.fn<(s: unknown, ids: string[], o?: { exigerBrouillon?: boolean }) => Promise<{ id: string; ok: boolean; erreur?: string; ignoree?: boolean }[]>>();
vi.mock("@/lib/facturation/envoi", () => ({ envoyerFactures }));

const envoyerEmail = vi.fn<(msg: { a: string[]; objet: string; texte: string; html?: string }) => Promise<{ messageId: string; refusees: string[] }>>();
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  envoyerEmail,
}));

/**
 * Base simulée pour le client admin : tables en mémoire, filtres eq / in appliqués.
 * `lectures` garde chaque requête (table, filtres) ; `pannes` fait échouer une table.
 */
type Ligne = Record<string, unknown>;
let tables: Record<string, Ligne[]> = {};
let pannes: Record<string, string> = {};
function requete(table: string) {
  const filtres: ((l: Ligne) => boolean)[] = [];
  const q = {
    select: () => q,
    eq: (colonne: string, valeur: unknown) => (filtres.push((l) => l[colonne] === valeur), q),
    in: (colonne: string, valeurs: unknown[]) => (filtres.push((l) => valeurs.includes(l[colonne])), q),
    then: (resoudre: (r: { data: Ligne[] | null; error: { message: string } | null }) => unknown) =>
      Promise.resolve(
        pannes[table]
          ? { data: null, error: { message: pannes[table] } }
          : { data: (tables[table] ?? []).filter((l) => filtres.every((f) => f(l))), error: null },
      ).then(resoudre),
  };
  return q;
}
const admin = { from: requete };
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

function client(id: string, nom: string, academie_id: string, envoi_auto: boolean, actif = true): Ligne {
  return { id, type: "particulier", nom, prenom: null, raison_sociale: null, academie_id, envoi_auto, actif };
}

function facture(id: string, client_id: string, modifications: Ligne = {}): Ligne {
  return {
    id,
    client_id,
    periode: "2026-10-01",
    generation_auto: true,
    statut: "brouillon",
    numero: null,
    total_ttc_centimes: 45000,
    ...modifications,
  };
}

/** Émission simulée : l'envoi réussi attribue un numéro, comme emettre_facture. */
function emettre(id: string, numero: string) {
  const f = tables.factures.find((x) => x.id === id);
  if (f) Object.assign(f, { statut: "envoyee", numero });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "secret-cron");
  vi.stubEnv("APP_URL", "https://facturation.academie.test/");
  chargerParametres.mockReset().mockResolvedValue(
    parametresExemple({ generation_auto: true, jour_generation: 5, mois_facture: "courant", email_copie: null }),
  );
  chargerAcademies.mockReset().mockResolvedValue([DELAVEAU, ESPOIR]);
  genererBrouillonsMensuels.mockReset().mockResolvedValue([]);
  envoyerFactures.mockReset().mockImplementation(async (_s, ids) =>
    ids.map((id, i) => {
      emettre(id, `AD-2026-${String(i + 1).padStart(4, "0")}`);
      return { id, ok: true };
    }),
  );
  envoyerEmail.mockReset().mockResolvedValue({ messageId: "recap", refusees: [] });
  tables = {
    clients: [],
    factures: [],
    membres: [{ email: "equipe@academie.test" }, { email: "associe@academie.test" }],
  };
  pannes = {};
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

  it("ne fait rien si la génération automatique est désactivée et qu'aucun client n'est en envoi automatique", async () => {
    chargerParametres.mockResolvedValue(parametresExemple({ generation_auto: false, jour_generation: 5 }));
    // Un client archivé en envoi automatique ne compte pas.
    tables.clients = [client("c1", "Martin", DELAVEAU.id, true, false)];
    const corps = await (await appel("?date=2026-10-05")).json();
    expect(corps).toMatchObject({
      execute: false,
      raison: "génération automatique désactivée et aucun client en envoi automatique",
      reglages: { clients_envoi_auto: 0 },
    });
    expect(genererBrouillonsMensuels).not.toHaveBeenCalled();
  });

  it("génère pour toutes les académies le mois précédent si réglé ainsi, sans envoi ni récapitulatif", async () => {
    chargerParametres.mockResolvedValue(
      parametresExemple({ generation_auto: true, jour_generation: 5, mois_facture: "precedent" }),
    );
    tables.clients = [
      client("c1", "Martin", DELAVEAU.id, false),
      client("c2", "Durand", ESPOIR.id, false),
      client("c3", "Petit", ESPOIR.id, false),
    ];
    tables.factures = [facture("f1", "c1", { periode: "2026-09-01" }), facture("f2", "c2", { periode: "2026-09-01" })];
    genererBrouillonsMensuels.mockResolvedValue([
      resultat("c1", "f1"),
      resultat("c2", "f2"),
      resultat("c3", "f3", true),
    ]);

    const reponse = await appel("?date=2026-10-05");
    expect(reponse.status).toBe(200);
    expect(genererBrouillonsMensuels).toHaveBeenCalledWith(admin, "2026-09-01", { apercu: false });
    expect(envoyerFactures).not.toHaveBeenCalled();
    expect(envoyerEmail).not.toHaveBeenCalled();
    expect(await reponse.json()).toMatchObject({
      ok: true,
      execute: true,
      date: "2026-10-05",
      periode: "2026-09-01",
      brouillons_crees: 2,
      deja_existantes: 1,
      reglages: { clients_envoi_auto: 0 },
      a_envoyer: [],
      envoyees: 0,
      echecs_envoi: [],
      recapitulatif: null,
      par_academie: [
        { id: DELAVEAU.id, nom: "Académie Delaveau", brouillons_crees: 1, deja_existantes: 0 },
        { id: ESPOIR.id, nom: "Académie Espoir", brouillons_crees: 1, deja_existantes: 1 },
      ],
    });
  });

  it("génère même sans génération automatique dès qu'un client est en envoi automatique", async () => {
    chargerParametres.mockResolvedValue(parametresExemple({ generation_auto: false, jour_generation: 5 }));
    tables.clients = [client("c1", "Martin", DELAVEAU.id, true)];
    const corps = await (await appel("?date=2026-10-04")).json();
    expect(corps).toMatchObject({ execute: false, raison: "génération prévue le 5 du mois" });

    tables.factures = [facture("f1", "c1")];
    genererBrouillonsMensuels.mockResolvedValue([resultat("c1", "f1")]);
    const bilan = await (await appel("?date=2026-10-05")).json();
    expect(genererBrouillonsMensuels).toHaveBeenCalledWith(admin, "2026-10-01", { apercu: false });
    expect(bilan).toMatchObject({ execute: true, reglages: { generation_auto: false, clients_envoi_auto: 1 }, envoyees: 1 });
  });

  it("émet et envoie les seuls brouillons mensuels des clients actifs en envoi automatique, anciens compris", async () => {
    tables.clients = [
      client("c1", "Martin", DELAVEAU.id, true),
      client("c2", "Durand", ESPOIR.id, false),
      client("c3", "Petit", ESPOIR.id, true),
      client("c4", "Archivé", ESPOIR.id, true, false),
    ];
    tables.factures = [
      facture("f1", "c1"),
      facture("f2", "c2"),
      facture("f-ancienne", "c3", { total_ttc_centimes: 30000 }),
      // Pas concernées : autre mois, facture manuelle, déjà émise, client archivé.
      facture("f-septembre", "c1", { periode: "2026-09-01" }),
      facture("f-manuelle", "c1", { generation_auto: false }),
      facture("f-emise", "c3", { statut: "emise", numero: "AD-2026-0001" }),
      facture("f-archive", "c4"),
    ];
    genererBrouillonsMensuels.mockResolvedValue([
      resultat("c1", "f1"),
      resultat("c2", "f2"),
      resultat("c3", "f-ancienne", true),
    ]);

    const corps = await (await appel("?date=2026-10-05")).json();
    expect(genererBrouillonsMensuels).toHaveBeenCalledWith(admin, "2026-10-01", { apercu: false });
    expect(envoyerFactures).toHaveBeenCalledTimes(1);
    expect(new Set(envoyerFactures.mock.calls[0][1])).toEqual(new Set(["f1", "f-ancienne"]));
    expect(envoyerFactures.mock.calls[0][2]).toEqual({ exigerBrouillon: true });
    expect(corps).toMatchObject({
      ok: true,
      brouillons_crees: 2,
      deja_existantes: 1,
      reglages: { clients_envoi_auto: 2 },
      envoyees: 2,
      echecs_envoi: [],
      recapitulatif: { envoye: true },
    });
    expect(corps.a_envoyer).toEqual([
      expect.objectContaining({ facture_id: "f1", client: "Martin", montant_ttc_centimes: 45000 }),
      expect.objectContaining({ facture_id: "f-ancienne", client: "Petit", montant_ttc_centimes: 30000 }),
    ]);
    expect(corps.a_envoyer.map((f: { numero: string }) => f.numero)).toEqual([
      expect.stringMatching(/^AD-2026-/),
      expect.stringMatching(/^AD-2026-/),
    ]);
  });

  it("adresse un récapitulatif aux membres et à la copie, avec les envois et les échecs", async () => {
    chargerParametres.mockResolvedValue(
      parametresExemple({ generation_auto: true, jour_generation: 5, email_copie: "Equipe@Academie.test" }),
    );
    tables.clients = [client("c1", "Martin", DELAVEAU.id, true), client("c2", "Durand", ESPOIR.id, true)];
    tables.factures = [facture("f1", "c1", { total_ttc_centimes: 45000 }), facture("f2", "c2")];
    genererBrouillonsMensuels.mockResolvedValue([resultat("c1", "f1"), resultat("c2", "f2")]);
    envoyerFactures.mockImplementation(async () => {
      emettre("f1", "AD-2026-0012");
      return [
        { id: "f1", ok: true },
        { id: "f2", ok: false, erreur: "Aucune adresse e-mail pour Durand" },
      ];
    });

    const corps = await (await appel("?date=2026-10-05")).json();
    expect(corps).toMatchObject({
      envoyees: 1,
      echecs_envoi: [{ facture_id: "f2", client: "Durand", numero: null, erreur: "Aucune adresse e-mail pour Durand" }],
      recapitulatif: { envoye: true, destinataires: ["equipe@academie.test", "associe@academie.test"] },
    });

    expect(envoyerEmail).toHaveBeenCalledTimes(1);
    const message = envoyerEmail.mock.calls[0][0];
    expect(message.a).toEqual(["equipe@academie.test", "associe@academie.test"]);
    expect(message.objet).toBe("Factures d'octobre 2026 envoyées automatiquement");
    expect(message.texte).toContain("1 facture envoyée — total 450,00");
    expect(message.texte).toMatch(/- Martin — AD-2026-0012 — 450,00/);
    expect(message.texte).toContain("Échecs : 1");
    expect(message.texte).toContain("- Durand : Aucune adresse e-mail pour Durand");
    expect(message.texte).toContain("https://facturation.academie.test/factures?statut=brouillon");
    expect(message.html).toContain("AD-2026-0012");
    expect(message.html).toContain('href="https://facturation.academie.test/factures?statut=brouillon"');
    expect(message.texte).not.toMatch(/\b(tu|ton|ta|tes|nos|notre|on)\b/i);
  });

  it("échappe le HTML du récapitulatif", async () => {
    tables.clients = [client("c1", "<b>Martin</b>", DELAVEAU.id, true)];
    tables.factures = [facture("f1", "c1")];
    await appel("?date=2026-10-05");
    const message = envoyerEmail.mock.calls[0][0];
    expect(message.html).toContain("&lt;b&gt;Martin&lt;/b&gt;");
    expect(message.html).not.toContain("<b>Martin</b>");
  });

  it("n'envoie pas de récapitulatif si aucun envoi n'a été tenté", async () => {
    tables.clients = [client("c1", "Martin", DELAVEAU.id, true)];
    tables.factures = [facture("f1", "c1")];
    // Facture envoyée à la main entre-temps : ignorée par l'envoi automatique.
    envoyerFactures.mockResolvedValue([{ id: "f1", ok: false, ignoree: true }]);
    const corps = await (await appel("?date=2026-10-05")).json();
    expect(corps).toMatchObject({ envoyees: 0, echecs_envoi: [], ignorees: 1, recapitulatif: null });
    expect(envoyerEmail).not.toHaveBeenCalled();

    // Aucun brouillon à envoyer : ni envoi ni récapitulatif.
    tables.factures = [];
    envoyerFactures.mockClear();
    const vide = await (await appel("?date=2026-10-05")).json();
    expect(envoyerFactures).not.toHaveBeenCalled();
    expect(vide).toMatchObject({ envoyees: 0, recapitulatif: null });
    expect(envoyerEmail).not.toHaveBeenCalled();
  });

  it("un échec du récapitulatif est signalé sans faire échouer la tâche", async () => {
    const erreurConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    tables.clients = [client("c1", "Martin", DELAVEAU.id, true)];
    tables.factures = [facture("f1", "c1")];
    envoyerEmail.mockRejectedValue(new Error("Le serveur d'envoi a refusé tous les destinataires."));

    const reponse = await appel("?date=2026-10-05");
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toMatchObject({
      ok: true,
      envoyees: 1,
      recapitulatif: { envoye: false, erreur: "Le serveur d'envoi a refusé tous les destinataires." },
    });
    expect(erreurConsole).toHaveBeenCalledWith("Cron facturation mensuelle : récapitulatif non envoyé :", expect.any(Error));
    erreurConsole.mockRestore();
  });

  it("en aperçu, ne crée rien et n'envoie rien, mais indique ce qui serait envoyé", async () => {
    chargerParametres.mockResolvedValue(parametresExemple({ generation_auto: true, jour_generation: 5, taux_tva: 20 }));
    tables.clients = [client("c1", "Martin", DELAVEAU.id, true), client("c2", "Durand", ESPOIR.id, false), client("c3", "Petit", ESPOIR.id, true)];
    tables.factures = [facture("f-ancienne", "c3", { total_ttc_centimes: 30000 })];
    genererBrouillonsMensuels.mockResolvedValue([
      resultat("c1", null),
      resultat("c2", null),
      resultat("c3", "f-ancienne", true),
    ]);

    const corps = await (await appel("?date=2026-10-05&apercu=1")).json();
    expect(genererBrouillonsMensuels).toHaveBeenCalledWith(admin, "2026-10-01", { apercu: true });
    expect(envoyerFactures).not.toHaveBeenCalled();
    expect(envoyerEmail).not.toHaveBeenCalled();
    expect(corps).toMatchObject({
      apercu: true,
      brouillons_crees: 2,
      deja_existantes: 1,
      envoyees: 0,
      a_envoyer: [
        { facture_id: null, client: "Martin", montant_ttc_centimes: 54000 },
        { facture_id: "f-ancienne", client: "Petit", montant_ttc_centimes: 30000 },
      ],
      recapitulatif: { envoye: false, destinataires: ["equipe@academie.test", "associe@academie.test"] },
    });
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
