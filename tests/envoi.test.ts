import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageEmail } from "@/lib/email";
import type { Client, Entite, Facture, FactureComplete, LigneFacture } from "@/lib/types";

// `server-only` refuse d'être chargé hors de Next.js : neutralisé pour les tests.
vi.mock("server-only", () => ({}));

// E-mail : configuration et envoi simulés (les modèles et le HTML restent les vrais).
const emailConfigure = vi.fn(() => true);
const envoyerEmail = vi.fn<(msg: MessageEmail) => Promise<{ messageId: string }>>();
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  emailConfigure,
  envoyerEmail,
}));

// PDF : rendu simulé.
const genererPdfFacture = vi.fn<(donnees: FactureComplete) => Promise<Buffer>>(async () => Buffer.from("%PDF-test"));
vi.mock("@/lib/pdf", () => ({
  genererPdfFacture,
  nomFichierFacture: (f: Facture) => (f.numero ? `Facture-${f.numero}.pdf` : "Brouillon.pdf"),
}));

const { envoyerFacture, envoyerFactures } = await import("@/lib/facturation/envoi");
const { donneesExemple, entiteExemple } = await import("@/lib/pdf/exemple");

// -----------------------------------------------------------------------------
// Client Supabase factice (base en mémoire, sous-ensemble du query builder)
// -----------------------------------------------------------------------------

type Ligne = Record<string, unknown>;
type Resultat = { data: unknown; error: { message: string } | null };

class Requete implements PromiseLike<Resultat> {
  private filtres: [string, unknown][] = [];
  private operation: "select" | "insert" | "update" = "select";
  private valeurs: Ligne | Ligne[] = {};

  constructor(
    private base: FauxSupabase,
    private table: string,
  ) {}

  select() {
    return this;
  }
  order() {
    return this;
  }
  eq(colonne: string, valeur: unknown) {
    this.filtres.push([colonne, valeur]);
    return this;
  }
  insert(valeurs: Ligne | Ligne[]) {
    this.operation = "insert";
    this.valeurs = valeurs;
    return this;
  }
  update(valeurs: Ligne) {
    this.operation = "update";
    this.valeurs = valeurs;
    return this;
  }

  private executer(): Resultat {
    const lignes = (this.base.tables[this.table] ??= []);
    if (this.operation === "insert") {
      for (const v of Array.isArray(this.valeurs) ? this.valeurs : [this.valeurs]) {
        lignes.push({ id: `envoi-${lignes.length + 1}`, ...v });
      }
      return { data: null, error: null };
    }
    const selection = lignes.filter((l) => this.filtres.every(([c, v]) => l[c] === v));
    if (this.operation === "update") {
      this.base.misesAJour.push({ table: this.table, valeurs: this.valeurs as Ligne });
      for (const l of selection) Object.assign(l, this.valeurs);
      return { data: null, error: null };
    }
    return { data: selection.map((l) => structuredClone(l)), error: null };
  }

  async maybeSingle(): Promise<Resultat> {
    const r = this.executer();
    return { data: (r.data as Ligne[])[0] ?? null, error: r.error };
  }
  async single(): Promise<Resultat> {
    const r = this.executer();
    const premiere = (r.data as Ligne[])[0];
    return premiere ? { data: premiere, error: null } : { data: null, error: { message: "Aucune ligne" } };
  }
  then<A = Resultat, B = never>(
    reussite?: ((valeur: Resultat) => A | PromiseLike<A>) | null,
    echec?: ((raison: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.executer()).then(reussite, echec);
  }
}

class FauxSupabase {
  tables: Record<string, Ligne[]>;
  appelsRpc: { nom: string; args: Record<string, unknown> }[] = [];
  misesAJour: { table: string; valeurs: Ligne }[] = [];

  constructor(donnees: { facture: Facture; lignes: LigneFacture[]; client: Client; entite: Entite }) {
    this.tables = {
      factures: [structuredClone(donnees.facture) as unknown as Ligne],
      lignes_facture: donnees.lignes.map((l) => structuredClone(l) as unknown as Ligne),
      clients: [structuredClone(donnees.client) as unknown as Ligne],
      entites: [structuredClone(donnees.entite) as unknown as Ligne],
      envois_email: [],
    };
  }

  from(table: string) {
    return new Requete(this, table);
  }

  /** emettre_facture : attribue un numéro et fige les coordonnées, comme la fonction SQL. */
  rpc(nom: string, args: Record<string, unknown>) {
    this.appelsRpc.push({ nom, args });
    return {
      single: async (): Promise<Resultat> => {
        const facture = this.tables.factures.find((f) => f.id === args.p_facture_id);
        if (nom !== "emettre_facture" || !facture) return { data: null, error: { message: "Facture introuvable" } };
        const client = this.tables.clients.find((c) => c.id === facture.client_id);
        const entite = this.tables.entites.find((e) => e.id === facture.entite_id);
        Object.assign(facture, {
          statut: "emise",
          numero: "AD-2026-0001",
          annee: 2026,
          sequence: 1,
          date_emission: "2026-09-24",
          date_echeance: "2026-10-24",
          client_snapshot: structuredClone(client),
          entite_snapshot: structuredClone(entite),
        });
        return { data: structuredClone(facture), error: null };
      },
    };
  }

  get facture() {
    return this.tables.factures[0] as unknown as Facture;
  }
  get envois() {
    return this.tables.envois_email;
  }
}

function base(options: Parameters<typeof donneesExemple>[1] = {}, entite: Partial<Entite> = {}) {
  const donnees = donneesExemple(entiteExemple(entite), {
    ...options,
    client: { email: "marie@exemple.fr", emails_cc: ["papa@exemple.fr"], ...options.client },
  });
  const faux = new FauxSupabase(donnees);
  return { faux, supabase: faux as unknown as SupabaseClient };
}

const EMISE = {
  numero: "AD-2026-0042",
  annee: 2026,
  sequence: 42,
  date_emission: "2026-09-01",
  date_echeance: "2026-10-01",
};

beforeEach(() => {
  emailConfigure.mockReset().mockReturnValue(true);
  envoyerEmail.mockReset().mockResolvedValue({ messageId: "<message@test>" });
  genererPdfFacture.mockClear();
});

// -----------------------------------------------------------------------------

describe("envoyerFacture", () => {
  it("n'émet pas un brouillon dont le client n'a aucune adresse e-mail", async () => {
    const { faux, supabase } = base({ client: { email: null, emails_cc: [] } });
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.erreur).toMatch(/Aucune adresse e-mail pour Client Exemple/);
    expect(faux.appelsRpc).toHaveLength(0);
    expect(faux.facture.statut).toBe("brouillon");
    expect(faux.facture.numero).toBeNull();
    expect(envoyerEmail).not.toHaveBeenCalled();
    expect(faux.envois).toHaveLength(0);
  });

  it("n'émet pas un brouillon si l'envoi d'e-mails n'est pas configuré", async () => {
    emailConfigure.mockReturnValue(false);
    const { faux, supabase } = base();
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat).toEqual({ ok: false, erreur: expect.stringMatching(/n'est pas configuré/) });
    expect(faux.appelsRpc).toHaveLength(0);
    expect(faux.facture.statut).toBe("brouillon");
  });

  it("émet puis envoie un brouillon, journalise l'envoi et passe la facture à « envoyée »", async () => {
    const { faux, supabase } = base({}, { email_copie: "archives@academie.fr" });
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat).toEqual({ ok: true, destinataires: ["marie@exemple.fr", "papa@exemple.fr"] });
    expect(faux.appelsRpc).toEqual([{ nom: "emettre_facture", args: { p_facture_id: faux.facture.id } }]);
    expect(genererPdfFacture).toHaveBeenCalledOnce();

    const message = envoyerEmail.mock.calls[0][0];
    expect(message.a).toEqual(["marie@exemple.fr", "papa@exemple.fr"]);
    expect(message.cci).toEqual(["archives@academie.fr"]);
    expect(message.objet).toBe("Facture AD-2026-0001 – Académie Delaveau");
    expect(message.texte).toContain("facture AD-2026-0001");
    expect(message.html).toContain("Facture-AD-2026-0001.pdf");
    expect(message.pieceJointe?.nom).toBe("Facture-AD-2026-0001.pdf");

    expect(faux.envois).toEqual([
      expect.objectContaining({
        facture_id: faux.facture.id,
        succes: true,
        erreur: null,
        message_id: "<message@test>",
        destinataires: ["marie@exemple.fr", "papa@exemple.fr"],
      }),
    ]);
    expect(faux.facture.statut).toBe("envoyee");
    expect(faux.facture.envoyee_le).toEqual(expect.any(String));
  });

  it("renvoie une facture payée (duplicata) sans changer son statut", async () => {
    const { faux, supabase } = base({
      statut: "payee",
      facture: { ...EMISE, payee_le: "2026-09-15", mode_paiement: "Virement", envoyee_le: "2026-09-01T08:00:00Z" },
    });
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat.ok).toBe(true);
    expect(faux.appelsRpc).toHaveLength(0);
    expect(faux.facture.statut).toBe("payee");
    expect(faux.facture.payee_le).toBe("2026-09-15");
    expect(faux.facture.envoyee_le).not.toBe("2026-09-01T08:00:00Z");
    expect(faux.misesAJour).toEqual([{ table: "factures", valeurs: { envoyee_le: expect.any(String) } }]);
  });

  it("refuse une facture annulée", async () => {
    const { faux, supabase } = base({ statut: "annulee", facture: EMISE });
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat).toEqual({
      ok: false,
      erreur: "La facture AD-2026-0042 est annulée : elle ne peut pas être envoyée.",
    });
    expect(envoyerEmail).not.toHaveBeenCalled();
    expect(faux.envois).toHaveLength(0);
  });

  it("journalise un échec SMTP et laisse la facture « émise »", async () => {
    envoyerEmail.mockRejectedValue(Object.assign(new Error("Invalid login"), { code: "EAUTH" }));
    const { faux, supabase } = base({ statut: "emise", facture: EMISE });
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.erreur).toMatch(/identification/);
    expect(faux.envois).toEqual([
      expect.objectContaining({ succes: false, erreur: expect.stringMatching(/identification/) }),
    ]);
    expect(faux.facture.statut).toBe("emise");
    expect(faux.facture.envoyee_le).toBeNull();
  });

  it("répond clairement si la facture n'existe pas", async () => {
    const { supabase } = base();
    expect(await envoyerFacture(supabase, "inexistante")).toEqual({
      ok: false,
      erreur: expect.stringMatching(/Facture introuvable/),
    });
  });
});

describe("envoyerFactures", () => {
  it("envoie séquentiellement et continue après une erreur", async () => {
    const { faux, supabase } = base({ statut: "emise", facture: EMISE });
    const resultats = await envoyerFactures(supabase, ["inexistante", faux.facture.id]);

    expect(resultats).toEqual([
      { id: "inexistante", ok: false, erreur: expect.stringMatching(/introuvable/) },
      { id: faux.facture.id, ok: true },
    ]);
    expect(faux.facture.statut).toBe("envoyee");
  });
});
