import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageEmail } from "@/lib/email";
import type { AvisComplet, Echeance, StatutEcheance } from "@/lib/types";

// E-mail : configuration et envoi simulés (les modèles et le HTML restent les vrais).
const emailConfigure = vi.fn(() => true);
const envoyerEmail = vi.fn<(msg: MessageEmail) => Promise<{ messageId: string; refusees: string[] }>>();
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  emailConfigure,
  envoyerEmail,
}));

// PDF : rendu simulé.
const genererPdfAvis = vi.fn<(donnees: AvisComplet) => Promise<Buffer>>(async () => Buffer.from("%PDF-avis"));
vi.mock("@/lib/pdf", () => ({
  genererPdfAvis,
  genererPdfFacture: vi.fn(),
  nomFichierAvis: (e: Pick<Echeance, "numero_avis">) => `Avis-${e.numero_avis}.pdf`,
  nomFichierFacture: vi.fn(),
}));

const { envoyerAvis, envoyerAvisLot } = await import("@/lib/facturation/avis");
const { donneesAnnuellesExemple, parametresExemple } = await import("@/lib/pdf/exemple");

// -----------------------------------------------------------------------------
// Client Supabase factice (base en mémoire, sous-ensemble du query builder)
// -----------------------------------------------------------------------------

type Ligne = Record<string, unknown>;
type Resultat = { data: unknown; error: { message: string } | null };

class Requete implements PromiseLike<Resultat> {
  private filtres: ((l: Ligne) => boolean)[] = [];
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
    this.filtres.push((l) => l[colonne] === valeur);
    return this;
  }
  in(colonne: string, valeurs: unknown[]) {
    this.filtres.push((l) => valeurs.includes(l[colonne]));
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
      for (const v of Array.isArray(this.valeurs) ? this.valeurs : [this.valeurs]) lignes.push({ id: `envoi-${lignes.length + 1}`, ...v });
      return { data: null, error: null };
    }
    const selection = lignes.filter((l) => this.filtres.every((f) => f(l)));
    if (this.operation === "update") {
      this.base.misesAJour.push({ table: this.table, valeurs: this.valeurs as Ligne });
      for (const l of selection) Object.assign(l, this.valeurs);
    }
    return { data: selection.map((l) => structuredClone(l)), error: null };
  }

  async maybeSingle(): Promise<Resultat> {
    const r = this.executer();
    return { data: (r.data as Ligne[])[0] ?? null, error: r.error };
  }
  async single(): Promise<Resultat> {
    const premiere = (this.executer().data as Ligne[])[0];
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
  misesAJour: { table: string; valeurs: Ligne }[] = [];
  constructor(statuts: Partial<Record<number, StatutEcheance>> = {}, client: Ligne = {}) {
    const donnees = donneesAnnuellesExemple(parametresExemple({ email_copie: "archives@academie.fr" }), {
      academie: { nom: "Académie Espoir" },
      client: {
        prenom: "Asma",
        nom: "Dos Santos",
        reference: "E1",
        email: "famille@exemple.fr",
        emails_cc: ["papa@exemple.fr"],
        arrhes_reglees: true,
        arrhes_centimes: 396000,
        arrhes_saison: 2026,
        ...client,
      },
      lignes: [{ libelle: "Enseignement – 2026-2027", quantite: 1, prix_unitaire_centimes: 1320000 }],
      statutsEcheances: statuts,
    });
    this.tables = {
      factures: [structuredClone(donnees.facture) as unknown as Ligne],
      lignes_facture: donnees.lignes.map((l) => structuredClone(l) as unknown as Ligne),
      clients: [structuredClone(donnees.client) as unknown as Ligne],
      academies: [structuredClone(donnees.academie) as unknown as Ligne],
      parametres: [structuredClone(donnees.emetteur) as unknown as Ligne],
      echeances: (donnees.echeances ?? []).map((e) => structuredClone(e) as unknown as Ligne),
      envois_email: [],
    };
  }
  from(table: string) {
    return new Requete(this, table);
  }
  echeance(rang: number) {
    return this.tables.echeances.find((e) => e.rang === rang) as unknown as Echeance;
  }
  get envois() {
    return this.tables.envois_email;
  }
}

function base(statuts: Partial<Record<number, StatutEcheance>> = {}, client: Ligne = {}) {
  const faux = new FauxSupabase(statuts, client);
  return { faux, supabase: faux as unknown as SupabaseClient };
}

beforeEach(() => {
  emailConfigure.mockReset().mockReturnValue(true);
  envoyerEmail.mockReset().mockResolvedValue({ messageId: "<avis@test>", refusees: [] });
  genererPdfAvis.mockClear();
});

describe("envoyerAvis", () => {
  it("envoie un avis « à envoyer » : modèle d'avis, PDF joint, journal (facture + échéance), statut « avis envoyé »", async () => {
    const { faux, supabase } = base();
    const e = faux.echeance(2);
    const resultat = await envoyerAvis(supabase, e.id);

    expect(resultat).toEqual({ ok: true, destinataires: ["famille@exemple.fr", "papa@exemple.fr"], refusees: [] });
    expect(genererPdfAvis).toHaveBeenCalledOnce();
    expect(genererPdfAvis.mock.calls[0][0].echeance.numero_avis).toBe("E1-2026-10");
    const message = envoyerEmail.mock.calls[0][0];
    expect(message.a).toEqual(["famille@exemple.fr", "papa@exemple.fr"]);
    expect(message.cci).toEqual(["archives@academie.fr"]);
    expect(message.objet).toBe("Avis d'échéance E1-2026-10 – Académie Delaveau");
    expect(message.texte).toMatch(/^Bonjour Asma Dos Santos,\n\nVeuillez trouver ci-joint l'avis d'échéance E1-2026-10 de 924,00/);
    expect(message.pieceJointe?.nom).toBe("Avis-E1-2026-10.pdf");
    expect(message.html).toContain("Académie Espoir</div>");
    expect(faux.envois).toEqual([
      expect.objectContaining({ facture_id: faux.tables.factures[0].id, echeance_id: e.id, succes: true, message_id: "<avis@test>" }),
    ]);
    expect(faux.echeance(2)).toMatchObject({ statut: "envoyee", envoyee_le: expect.any(String) });
    // La facture annuelle, elle, ne change pas.
    expect(faux.misesAJour.every((m) => m.table === "echeances")).toBe(true);
  });

  it("renvoi d'un avis déjà envoyé : seule la date d'envoi change ; envoi automatique : ignoré", async () => {
    const { faux, supabase } = base({ 1: "envoyee" });
    const e = faux.echeance(1);
    const auto = await envoyerAvis(supabase, e.id, { exigerAEnvoyer: true });
    expect(auto).toEqual({ ok: false, erreur: expect.stringMatching(/^Ignoré/), ignoree: true });
    expect(envoyerEmail).not.toHaveBeenCalled();

    const manuel = await envoyerAvis(supabase, e.id);
    expect(manuel.ok).toBe(true);
    expect(faux.misesAJour.at(-1)).toEqual({ table: "echeances", valeurs: { envoyee_le: expect.any(String) } });
    expect(faux.echeance(1).statut).toBe("envoyee");
  });

  it("refuse une échéance réglée ou annulée, sans e-mail", async () => {
    const { faux, supabase } = base({ 1: "payee", 2: "annulee" });
    expect(await envoyerAvis(supabase, faux.echeance(1).id)).toEqual({ ok: false, erreur: expect.stringMatching(/déjà réglée/) });
    expect(await envoyerAvis(supabase, faux.echeance(2).id)).toEqual({ ok: false, erreur: expect.stringMatching(/annulé/) });
    expect(envoyerEmail).not.toHaveBeenCalled();
    expect(faux.envois).toHaveLength(0);
  });

  it("client sans adresse e-mail ou SMTP non configuré : rien n'est tenté", async () => {
    const { faux, supabase } = base({}, { email: null, emails_cc: [] });
    expect(await envoyerAvis(supabase, faux.echeance(1).id)).toEqual({
      ok: false,
      erreur: expect.stringMatching(/Aucune adresse e-mail pour Asma Dos Santos/),
    });
    emailConfigure.mockReturnValue(false);
    const { faux: autre, supabase: s2 } = base();
    expect(await envoyerAvis(s2, autre.echeance(1).id)).toEqual({ ok: false, erreur: expect.stringMatching(/non configuré/) });
    expect(envoyerEmail).not.toHaveBeenCalled();
  });

  it("échec SMTP : journalisé, l'avis reste « à envoyer »", async () => {
    envoyerEmail.mockRejectedValue(Object.assign(new Error("Invalid login"), { code: "EAUTH" }));
    const { faux, supabase } = base();
    const resultat = await envoyerAvis(supabase, faux.echeance(1).id);
    expect(resultat).toEqual({ ok: false, erreur: expect.stringMatching(/Identifiants refusés/) });
    expect(faux.envois).toEqual([expect.objectContaining({ succes: false, echeance_id: faux.echeance(1).id })]);
    expect(faux.echeance(1)).toMatchObject({ statut: "a_venir", envoyee_le: null });
  });

  it("n'efface pas un paiement enregistré pendant l'envoi", async () => {
    const { faux, supabase } = base();
    envoyerEmail.mockImplementation(async () => {
      Object.assign(faux.tables.echeances[0], { statut: "payee", payee_le: "2026-09-20" });
      return { messageId: "<m>", refusees: [] };
    });
    expect((await envoyerAvis(supabase, faux.echeance(1).id)).ok).toBe(true);
    expect(faux.echeance(1)).toMatchObject({ statut: "payee", payee_le: "2026-09-20", envoyee_le: expect.any(String) });
  });
});

describe("envoyerAvisLot", () => {
  it("envoie séquentiellement et continue après une erreur", async () => {
    const { faux, supabase } = base({ 2: "payee" });
    const resultats = await envoyerAvisLot(supabase, ["inexistante", faux.echeance(2).id, faux.echeance(3).id], {
      exigerAEnvoyer: true,
    });
    expect(resultats).toEqual([
      { id: "inexistante", ok: false, erreur: "Échéance introuvable." },
      { id: faux.echeance(2).id, ok: false, erreur: expect.stringMatching(/^Ignoré/), ignoree: true },
      { id: faux.echeance(3).id, ok: true },
    ]);
    expect(faux.echeance(3).statut).toBe("envoyee");
  });
});
