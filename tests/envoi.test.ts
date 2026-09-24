import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageEmail } from "@/lib/email";
import type { Academie, Facture, FactureComplete, Parametres } from "@/lib/types";

// E-mail : configuration et envoi simulés (les modèles et le HTML restent les vrais).
const emailConfigure = vi.fn(() => true);
const envoyerEmail = vi.fn<(msg: MessageEmail) => Promise<{ messageId: string; refusees: string[] }>>();
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
const { donneesExemple, parametresExemple } = await import("@/lib/pdf/exemple");

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
      for (const v of Array.isArray(this.valeurs) ? this.valeurs : [this.valeurs]) {
        lignes.push({ id: `envoi-${lignes.length + 1}`, ...v });
      }
      return { data: null, error: null };
    }
    const selection = lignes.filter((l) => this.filtres.every((f) => f(l)));
    if (this.operation === "update") {
      this.base.misesAJour.push({ table: this.table, valeurs: this.valeurs as Ligne });
      for (const l of selection) Object.assign(l, this.valeurs);
      return { data: selection.map((l) => structuredClone(l)), error: null };
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

  constructor(donnees: FactureComplete) {
    this.tables = {
      factures: [structuredClone(donnees.facture) as unknown as Ligne],
      lignes_facture: donnees.lignes.map((l) => structuredClone(l) as unknown as Ligne),
      clients: [structuredClone(donnees.client) as unknown as Ligne],
      academies: [structuredClone(donnees.academie) as unknown as Ligne],
      parametres: [structuredClone(donnees.emetteur) as unknown as Ligne],
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
        const academie = this.tables.academies.find((a) => a.id === facture.academie_id);
        Object.assign(facture, {
          statut: "emise",
          numero: "AD-2026-0001",
          annee: 2026,
          sequence: 1,
          date_emission: "2026-09-24",
          date_echeance: "2026-10-24",
          client_snapshot: structuredClone(client),
          emetteur_snapshot: structuredClone(this.tables.parametres[0]),
          academie_snapshot: structuredClone(academie),
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

function base(options: Parameters<typeof donneesExemple>[1] = {}, parametres: Partial<Parametres> = {}) {
  const donnees = donneesExemple(parametresExemple(parametres), {
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
  envoyerEmail.mockReset().mockResolvedValue({ messageId: "<message@test>", refusees: [] });
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

  it("n'émet pas un brouillon si les paramètres (modèles d'e-mail) sont illisibles", async () => {
    const { faux, supabase } = base();
    // 1re lecture (chargement de la facture) réussie, 2e (modèles d'e-mail) vide : accès retiré entre-temps.
    const lire = faux.from.bind(faux);
    let lectures = 0;
    faux.from = (table: string) => {
      if (table === "parametres" && ++lectures > 1) faux.tables.parametres = [];
      return lire(table);
    };
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat).toEqual({ ok: false, erreur: expect.stringMatching(/^Lecture des paramètres impossible/) });
    expect(faux.appelsRpc).toHaveLength(0);
    expect(faux.facture.statut).toBe("brouillon");
    expect(envoyerEmail).not.toHaveBeenCalled();
  });

  it("émet puis envoie un brouillon, journalise l'envoi et passe la facture à « envoyée »", async () => {
    const { faux, supabase } = base({}, { email_copie: "archives@academie.fr" });
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat).toEqual({ ok: true, destinataires: ["marie@exemple.fr", "papa@exemple.fr"], refusees: [] });
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
    // Émission : émetteur et académie figés.
    expect(faux.facture.emetteur_snapshot?.raison_sociale).toBe("Académie Delaveau");
    expect(faux.facture.academie_snapshot?.nom).toBe("Académie Delaveau");
  });

  it("met l'e-mail aux couleurs des paramètres et rappelle l'académie du client", async () => {
    const { faux, supabase } = base(
      { academie: { nom: "Académie Espoir", couleur: "#2E7D8C" } },
      {
        couleur_primaire: "#123456",
        couleur_secondaire: "#ABCDEF",
        email_objet: "Facture {numero} – {academie}",
        email_corps: "Bonjour {client},\n{structure} – {academie}",
      },
    );
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat.ok).toBe(true);
    const message = envoyerEmail.mock.calls[0][0];
    expect(message.objet).toBe("Facture AD-2026-0001 – Académie Espoir");
    expect(message.texte).toBe("Bonjour Client Exemple,\nAcadémie Delaveau – Académie Espoir");
    expect(message.html).toContain("background-color:#123456");
    expect(message.html).toContain("border-bottom:3px solid #ABCDEF");
    expect(message.html).toContain("Académie Espoir</div>");
    expect(message.cci).toEqual([]);
  });

  it("utilise les modèles et la copie cachée actuels pour un duplicata (PDF : émetteur figé)", async () => {
    const figes: Partial<Parametres> = {
      raison_sociale: "Académie Delaveau (ancienne)",
      email_objet: "Ancien objet {numero}",
      email_corps: "Ancien corps",
      email_copie: "ancienne-archive@academie.fr",
    };
    const { faux, supabase } = base(
      {
        statut: "envoyee",
        facture: {
          ...EMISE,
          envoyee_le: "2026-09-01T08:00:00Z",
          emetteur_snapshot: parametresExemple(figes),
          academie_snapshot: { nom: "Académie Espoir" } as Academie,
        },
      },
      { email_objet: "Rappel : facture {numero} ({structure})", email_copie: "archives@academie.fr; compta@academie.fr" },
    );
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat.ok).toBe(true);
    const message = envoyerEmail.mock.calls[0][0];
    // {structure} = émetteur imprimé sur la facture (figé) ; modèle et copie = paramètres du jour.
    expect(message.objet).toBe("Rappel : facture AD-2026-0042 (Académie Delaveau (ancienne))");
    expect(message.cci).toEqual(["archives@academie.fr", "compta@academie.fr"]);
    const pdf = genererPdfFacture.mock.calls[0][0];
    expect(pdf.emetteur.raison_sociale).toBe("Académie Delaveau (ancienne)");
    expect(pdf.academie.nom).toBe("Académie Espoir");
    expect(faux.facture.statut).toBe("envoyee");
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
    if (!resultat.ok) expect(resultat.erreur).toMatch(/Identifiants refusés/);
    expect(faux.envois).toEqual([
      expect.objectContaining({ succes: false, erreur: expect.stringMatching(/Identifiants refusés/) }),
    ]);
    expect(faux.facture.statut).toBe("emise");
    expect(faux.facture.envoyee_le).toBeNull();
  });

  it("facture émise : PDF avec le client figé, e-mail à l'adresse actuelle de la fiche client", async () => {
    const { faux, supabase } = base({
      statut: "emise",
      facture: EMISE,
      client: { email: "nouvelle@exemple.fr", emails_cc: [] },
    });
    // Instantané de l'émission : ancien nom, aucune adresse e-mail à l'époque.
    const client = faux.tables.clients[0];
    faux.tables.factures[0].client_snapshot = { ...client, nom: "Ancien nom", email: null, emails_cc: [] };
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat).toEqual({ ok: true, destinataires: ["nouvelle@exemple.fr"], refusees: [] });
    expect(envoyerEmail.mock.calls[0][0].a).toEqual(["nouvelle@exemple.fr"]);
    expect(genererPdfFacture.mock.calls[0][0].client.nom).toBe("Ancien nom");
    expect(faux.facture.statut).toBe("envoyee");
  });

  it("n'efface pas un paiement enregistré pendant l'envoi", async () => {
    const { faux, supabase } = base({ statut: "emise", facture: EMISE });
    envoyerEmail.mockImplementation(async () => {
      // L'autre utilisatrice marque la facture payée pendant l'échange SMTP.
      Object.assign(faux.tables.factures[0], { statut: "payee", payee_le: "2026-09-20", mode_paiement: "Chèque" });
      return { messageId: "<m>", refusees: [] };
    });
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat.ok).toBe(true);
    expect(faux.facture.statut).toBe("payee");
    expect(faux.facture.payee_le).toBe("2026-09-20");
    expect(faux.facture.mode_paiement).toBe("Chèque");
    expect(faux.facture.envoyee_le).toEqual(expect.any(String));
  });

  it("adresse en copie refusée : envoi réussi, refus signalé et journalisé", async () => {
    envoyerEmail.mockResolvedValue({ messageId: "<m>", refusees: ["papa@exemple.fr"] });
    const { faux, supabase } = base({ statut: "emise", facture: EMISE });
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat).toEqual({ ok: true, destinataires: ["marie@exemple.fr"], refusees: ["papa@exemple.fr"] });
    expect(faux.envois).toEqual([
      expect.objectContaining({ succes: true, erreur: expect.stringMatching(/refusée\(s\).*papa@exemple\.fr/) }),
    ]);
    expect(faux.facture.statut).toBe("envoyee");
  });

  it("adresse principale refusée : échec, la facture reste « émise »", async () => {
    envoyerEmail.mockResolvedValue({ messageId: "<m>", refusees: ["marie@exemple.fr"] });
    const { faux, supabase } = base({ statut: "emise", facture: EMISE });
    const resultat = await envoyerFacture(supabase, faux.facture.id);

    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.erreur).toMatch(/Adresse principale refusée.*marie@exemple\.fr/);
    expect(faux.envois).toEqual([expect.objectContaining({ succes: false })]);
    expect(faux.facture.statut).toBe("emise");
    expect(faux.facture.envoyee_le).toBeNull();
  });

  it("exigerBrouillon : une facture émise entre-temps est ignorée, sans e-mail", async () => {
    const { faux, supabase } = base({ statut: "envoyee", facture: { ...EMISE, envoyee_le: "2026-09-01T08:00:00Z" } });
    const resultat = await envoyerFacture(supabase, faux.facture.id, { exigerBrouillon: true });

    expect(resultat).toEqual({ ok: false, erreur: expect.stringMatching(/^Ignorée : déjà émise/), ignoree: true });
    expect(envoyerEmail).not.toHaveBeenCalled();
    expect(faux.envois).toHaveLength(0);
  });

  it("exigerBrouillon : un brouillon émis au même instant par un autre envoi est ignoré", async () => {
    const { faux, supabase } = base();
    faux.rpc = () => ({
      single: async () => ({ data: null, error: { message: "La facture AD-2026-0001 est déjà émise" } }),
    });
    const resultats = await envoyerFactures(supabase, [faux.facture.id], { exigerBrouillon: true });

    expect(resultats).toEqual([
      { id: faux.facture.id, ok: false, erreur: expect.stringMatching(/^Ignorée : déjà émise/), ignoree: true },
    ]);
    expect(envoyerEmail).not.toHaveBeenCalled();
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
