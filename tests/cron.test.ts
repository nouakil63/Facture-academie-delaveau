import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Parametres } from "@/lib/types";

// Base simulée : paramètres (service), envoi des avis (avis.ts), e-mail, client admin.
const chargerParametres = vi.fn<() => Promise<Parametres>>();
vi.mock("@/lib/facturation/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/facturation/service")>()),
  chargerParametres,
}));

const envoyerAvisLot =
  vi.fn<(s: unknown, ids: string[], o?: { exigerAEnvoyer?: boolean }) => Promise<{ id: string; ok: boolean; erreur?: string; ignoree?: boolean }[]>>();
vi.mock("@/lib/facturation/avis", () => ({ envoyerAvisLot }));

const envoyerEmail = vi.fn<(msg: { a: string[]; objet: string; texte: string; html?: string }) => Promise<{ messageId: string; refusees: string[] }>>();
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  envoyerEmail,
}));

/** Base simulée pour le client admin : tables en mémoire, filtres eq / in appliqués ; `pannes` fait échouer une table. */
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
const { parametresExemple } = await import("@/lib/pdf/exemple");

function appel(recherche = "", secret = "secret-cron") {
  return GET(
    new NextRequest(`https://facturation.test/api/cron/facturation-mensuelle${recherche}`, {
      headers: { authorization: `Bearer ${secret}` },
    }),
  );
}

function client(id: string, nom: string, reference: string, envoi_auto: boolean, actif = true): Ligne {
  return { id, type: "particulier", nom, prenom: null, raison_sociale: null, reference, envoi_auto, actif };
}

/** Échéance d'octobre 2026 (vue echeances_vue). */
function echeance(id: string, client_id: string, numero_avis: string, modifications: Ligne = {}): Ligne {
  return {
    id,
    client_id,
    periode: "2026-10-01",
    statut: "a_venir",
    numero_avis,
    montant_centimes: 92400,
    facture_statut: "envoyee",
    ...modifications,
  };
}

function factureAnnuelle(id: string, client_id: string, statut = "envoyee", saison = 2026): Ligne {
  return { id, client_id, statut, type_facture: "annuelle", saison };
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "secret-cron");
  vi.stubEnv("APP_URL", "https://facturation.academie.test/");
  chargerParametres.mockReset().mockResolvedValue(
    parametresExemple({ jour_generation: 5, mois_facture: "courant", email_copie: null }),
  );
  envoyerAvisLot.mockReset().mockImplementation(async (_s, ids) => ids.map((id) => ({ id, ok: true })));
  envoyerEmail.mockReset().mockResolvedValue({ messageId: "recap", refusees: [] });
  tables = {
    clients: [],
    echeances_vue: [],
    factures: [],
    membres: [{ email: "equipe@academie.test" }, { email: "associe@academie.test" }],
  };
  pannes = {};
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/facturation-mensuelle (avis d'échéance)", () => {
  it("refuse un appel sans le bon secret, et un secret non configuré", async () => {
    expect((await appel("", "mauvais")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await appel()).status).toBe(500);
    expect(chargerParametres).not.toHaveBeenCalled();
  });

  it("refuse une date invalide", async () => {
    expect((await appel("?date=2026-02-30")).status).toBe(400);
  });

  it("ne fait rien sans client actif en envoi automatique, ni un autre jour que le jour d'envoi", async () => {
    tables.clients = [client("c1", "Archivé", "E1", true, false), client("c2", "Durand", "E2", false)];
    expect(await (await appel("?date=2026-10-05")).json()).toMatchObject({
      ok: true,
      execute: false,
      raison: "aucun client en envoi automatique",
      reglages: { clients_envoi_auto: 0 },
    });
    tables.clients.push(client("c3", "Martin", "E3", true));
    expect(await (await appel("?date=2026-10-04")).json()).toMatchObject({
      execute: false,
      raison: "envoi des avis prévu le 5 du mois",
      reglages: { jour_generation: 5, clients_envoi_auto: 1 },
    });
    expect(envoyerAvisLot).not.toHaveBeenCalled();
    expect(envoyerEmail).not.toHaveBeenCalled();
  });

  it("envoie les seuls avis « à envoyer » du mois des clients actifs en envoi automatique ; aucune facture générée", async () => {
    tables.clients = [
      client("c1", "Dos Santos", "E1", true),
      client("c2", "Durand", "E2", false),
      client("c3", "Petit", "E3", true),
      client("c4", "Archivé", "E4", true, false),
    ];
    tables.factures = [factureAnnuelle("f1", "c1"), factureAnnuelle("f2", "c2"), factureAnnuelle("f3", "c3"), factureAnnuelle("f4", "c4")];
    tables.echeances_vue = [
      echeance("e1", "c1", "E1-2026-10"),
      echeance("e2", "c2", "E2-2026-10"), // client sans envoi automatique
      echeance("e3", "c3", "E3-2026-10", { statut: "envoyee" }), // déjà envoyé : jamais renvoyé
      echeance("e4", "c4", "E4-2026-10"), // client archivé
      echeance("e1-sept", "c1", "E1-2026-09", { periode: "2026-09-01" }), // autre mois
    ];

    const corps = await (await appel("?date=2026-10-05")).json();
    expect(envoyerAvisLot).toHaveBeenCalledTimes(1);
    expect(envoyerAvisLot.mock.calls[0][1]).toEqual(["e1"]);
    expect(envoyerAvisLot.mock.calls[0][2]).toEqual({ exigerAEnvoyer: true });
    expect(corps).toMatchObject({
      ok: true,
      execute: true,
      periode: "2026-10-01",
      saison: 2026,
      reglages: { clients_envoi_auto: 2 },
      a_envoyer: [{ echeance_id: "e1", client: "Dos Santos", numero_avis: "E1-2026-10", montant_centimes: 92400 }],
      deja_envoyes: 1,
      envoyes: 1,
      echecs_envoi: [],
      sans_facture_annuelle: [],
      recapitulatif: { envoye: true },
    });
    expect(corps).not.toHaveProperty("brouillons_crees");
  });

  it("signale les clients en envoi automatique sans facture annuelle émise, et le récapitulatif les liste", async () => {
    chargerParametres.mockResolvedValue(parametresExemple({ jour_generation: 5, email_copie: "Equipe@Academie.test" }));
    tables.clients = [
      client("c1", "Dos Santos", "E1", true),
      client("c2", "Durand", "E2", true),
      client("c3", "Petit", "E3", true),
      client("c4", "Leroy", "E4", true),
    ];
    tables.factures = [
      factureAnnuelle("f1", "c1"),
      factureAnnuelle("f2", "c2", "brouillon"),
      factureAnnuelle("f3", "c3", "annulee"),
      factureAnnuelle("f4", "c4", "emise", 2025), // autre saison
    ];
    tables.echeances_vue = [echeance("e1", "c1", "E1-2026-10")];
    envoyerAvisLot.mockResolvedValue([{ id: "e1", ok: false, erreur: "Aucune adresse e-mail pour Asma Dos Santos" }]);

    const corps = await (await appel("?date=2026-10-05")).json();
    expect(corps).toMatchObject({
      envoyes: 0,
      echecs_envoi: [{ echeance_id: "e1", client: "Dos Santos", numero_avis: "E1-2026-10", erreur: "Aucune adresse e-mail pour Asma Dos Santos" }],
      sans_facture_annuelle: [
        { client_id: "c2", client: "Durand", reference: "E2", raison: "facture annuelle en brouillon : à émettre" },
        { client_id: "c4", client: "Leroy", reference: "E4", raison: "aucune facture annuelle pour 2026-2027" },
        { client_id: "c3", client: "Petit", reference: "E3", raison: "aucune facture annuelle pour 2026-2027" },
      ],
      recapitulatif: { envoye: true, destinataires: ["equipe@academie.test", "associe@academie.test"] },
    });
    const message = envoyerEmail.mock.calls[0][0];
    expect(message.objet).toBe("Avis d'échéance d'octobre 2026 envoyés automatiquement");
    expect(message.texte).toContain("0 avis envoyé — total 0,00");
    expect(message.texte).toContain("Échecs : 1");
    expect(message.texte).toContain("- Dos Santos (E1-2026-10) : Aucune adresse e-mail pour Asma Dos Santos");
    expect(message.texte).toContain("À traiter : 3 clients en envoi automatique sans facture annuelle émise");
    expect(message.texte).toContain("- Durand (E2) : facture annuelle en brouillon : à émettre");
    expect(message.texte).toContain("https://facturation.academie.test/facturation-annuelle?mois=2026-10");
    expect(message.html).toContain('href="https://facturation.academie.test/facturation-annuelle?mois=2026-10"');
    expect(message.texte).not.toMatch(/\b(tu|ton|ta|tes|nos|notre|on)\b/i);
  });

  it("récapitulatif des avis envoyés (liste, total), HTML échappé", async () => {
    tables.clients = [client("c1", "<b>Dos Santos</b>", "E1", true), client("c2", "Martin", "E2", true)];
    tables.factures = [factureAnnuelle("f1", "c1"), factureAnnuelle("f2", "c2")];
    tables.echeances_vue = [echeance("e1", "c1", "E1-2026-10"), echeance("e2", "c2", "E2-2026-10", { montant_centimes: 150000 })];
    const corps = await (await appel("?date=2026-10-05")).json();
    expect(corps).toMatchObject({ envoyes: 2, recapitulatif: { envoye: true } });
    const message = envoyerEmail.mock.calls[0][0];
    expect(message.texte).toMatch(/2 avis envoyés — total 2\s424,00/);
    expect(message.texte).toMatch(/- Martin — E2-2026-10 — 1\s500,00/);
    expect(message.html).toContain("&lt;b&gt;Dos Santos&lt;/b&gt;");
    expect(message.html).not.toContain("<b>Dos Santos</b>");
  });

  it("pas de récapitulatif sans envoi tenté ni client à traiter ; un avis envoyé entre-temps est ignoré", async () => {
    tables.clients = [client("c1", "Dos Santos", "E1", true)];
    tables.factures = [factureAnnuelle("f1", "c1")];
    tables.echeances_vue = [echeance("e1", "c1", "E1-2026-10")];
    envoyerAvisLot.mockResolvedValue([{ id: "e1", ok: false, ignoree: true }]);
    const corps = await (await appel("?date=2026-10-05")).json();
    expect(corps).toMatchObject({ envoyes: 0, echecs_envoi: [], ignores: 1, recapitulatif: null });
    expect(envoyerEmail).not.toHaveBeenCalled();

    // Avis déjà réglé : rien à envoyer.
    tables.echeances_vue = [echeance("e1", "c1", "E1-2026-10", { statut: "payee" })];
    envoyerAvisLot.mockClear();
    expect(await (await appel("?date=2026-10-05")).json()).toMatchObject({ a_envoyer: [], deja_envoyes: 1, recapitulatif: null });
    expect(envoyerAvisLot).not.toHaveBeenCalled();
  });

  it("un échec du récapitulatif est signalé sans faire échouer la tâche", async () => {
    const erreurConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    tables.clients = [client("c1", "Dos Santos", "E1", true)];
    tables.factures = [factureAnnuelle("f1", "c1")];
    tables.echeances_vue = [echeance("e1", "c1", "E1-2026-10")];
    envoyerEmail.mockRejectedValue(new Error("Le serveur d'envoi a refusé tous les destinataires."));

    const reponse = await appel("?date=2026-10-05");
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toMatchObject({
      ok: true,
      envoyes: 1,
      recapitulatif: { envoye: false, erreur: "Le serveur d'envoi a refusé tous les destinataires." },
    });
    expect(erreurConsole).toHaveBeenCalledWith("Cron avis d'échéance : récapitulatif non envoyé :", expect.any(Error));
    erreurConsole.mockRestore();
  });

  it("en aperçu, n'envoie rien mais indique ce qui partirait", async () => {
    tables.clients = [client("c1", "Dos Santos", "E1", true), client("c2", "Durand", "E2", true)];
    tables.factures = [factureAnnuelle("f1", "c1")];
    tables.echeances_vue = [echeance("e1", "c1", "E1-2026-10")];
    const corps = await (await appel("?date=2026-10-05&apercu=1")).json();
    expect(envoyerAvisLot).not.toHaveBeenCalled();
    expect(envoyerEmail).not.toHaveBeenCalled();
    expect(corps).toMatchObject({
      apercu: true,
      envoyes: 0,
      a_envoyer: [{ echeance_id: "e1", client: "Dos Santos", numero_avis: "E1-2026-10" }],
      sans_facture_annuelle: [{ client: "Durand" }],
      recapitulatif: { envoye: false, destinataires: ["equipe@academie.test", "associe@academie.test"] },
    });
  });

  it("juillet et août : rien (pas d'échéance) ; le mois s'apprécie sur le réglage « mois précédent »", async () => {
    tables.clients = [client("c1", "Dos Santos", "E1", true)];
    for (const date of ["2026-07-05", "2026-08-05"]) {
      for (const recherche of [`?date=${date}`, `?date=${date}&apercu=1`]) {
        expect(await (await appel(recherche)).json()).toMatchObject({
          ok: true,
          date,
          execute: false,
          periode: `${date.slice(0, 7)}-01`,
          raison: "juillet/août : pas d'avis d'échéance",
        });
      }
    }
    chargerParametres.mockResolvedValue(parametresExemple({ jour_generation: 5, mois_facture: "precedent" }));
    // Le 5 septembre : avis d'août → rien. Le 5 juillet : avis de juin (saison 2025).
    expect(await (await appel("?date=2026-09-05")).json()).toMatchObject({ execute: false, periode: "2026-08-01" });
    expect(await (await appel("?date=2026-07-05")).json()).toMatchObject({ execute: true, periode: "2026-06-01", saison: 2025 });
    expect(envoyerEmail).toHaveBeenCalledTimes(1); // récapitulatif : client sans facture annuelle 2025
    expect(envoyerAvisLot).not.toHaveBeenCalled();
  });

  it("répond 500 avec un message clair si la lecture des échéances échoue", async () => {
    const erreurConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    tables.clients = [client("c1", "Dos Santos", "E1", true)];
    pannes.echeances_vue = "relation inexistante";
    const reponse = await appel("?date=2026-10-05");
    expect(reponse.status).toBe(500);
    expect(await reponse.json()).toMatchObject({ ok: false, erreur: "Lecture des échéances impossible : relation inexistante" });
    erreurConsole.mockRestore();
  });
});
