import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Transport SMTP factice : aucun e-mail réel n'est envoyé.
const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail, close: vi.fn() }));
vi.mock("nodemailer", () => ({ createTransport, default: { createTransport } }));

const {
  construireHtmlEmail,
  echapperHtml,
  emailConfigure,
  envoyerEmail,
  messageErreurEmail,
  remplirModele,
  texteVersHtml,
  variablesEmailManquantes,
} = await import("@/lib/email");
const { donneesExemple, parametresExemple } = await import("@/lib/pdf/exemple");
const { formatEuros } = await import("@/lib/format");

function factureEmise() {
  return donneesExemple(parametresExemple(), {
    statut: "emise",
    academie: { nom: "Académie Espoir" },
    client: { prenom: "Marie", nom: "Dupont" },
    facture: {
      numero: "AD-2026-0007",
      objet: "Formation et accompagnement – octobre 2026",
      periode: "2026-10-01",
      date_emission: "2026-10-01",
      date_echeance: "2026-10-31",
      total_ht_centimes: 123450,
      total_ttc_centimes: 123450,
    },
  });
}

describe("remplirModele", () => {
  it("remplace toutes les variables", () => {
    const texte = remplirModele(
      "{client} | {numero} | {montant} | {echeance} | {periode} | {structure} | {academie} | {objet}",
      factureEmise(),
    );
    expect(texte).toBe(
      `Marie Dupont | AD-2026-0007 | ${formatEuros(123450)} | 31/10/2026 | octobre 2026 | Académie Delaveau | Académie Espoir | Formation et accompagnement – octobre 2026`,
    );
  });

  it("{structure} = raison sociale de l'émetteur, {academie} = académie du client", () => {
    const d = donneesExemple(parametresExemple({ raison_sociale: "Association Académie Delaveau" }), {
      academie: { nom: "Académie Espoir" },
    });
    expect(remplirModele("{structure} / {academie}", d)).toBe("Association Académie Delaveau / Académie Espoir");
  });

  it("remplace chaque occurrence et laisse les accolades inconnues", () => {
    expect(remplirModele("{numero} / {numero} {inconnue} {Client}", factureEmise())).toBe(
      "AD-2026-0007 / AD-2026-0007 {inconnue} {Client}",
    );
  });

  it("gère un brouillon sans numéro ni période", () => {
    const brouillon = donneesExemple(parametresExemple(), { facture: { periode: null } });
    expect(remplirModele("Facture {numero} ({periode})", brouillon)).toBe("Facture brouillon ()");
  });

  it("affiche la raison sociale d'un client professionnel", () => {
    const pro = donneesExemple(parametresExemple(), {
      client: { type: "professionnel", raison_sociale: "Haras du Cotentin", prenom: "Paul", nom: "Martin" },
    });
    expect(remplirModele("Bonjour {client}", pro)).toBe("Bonjour Haras du Cotentin");
  });

  it("n'interprète pas les motifs spéciaux de remplacement ($&, $1…) des valeurs", () => {
    const donnees = factureEmise();
    donnees.client.prenom = "$&";
    expect(remplirModele("{client}", donnees)).toBe("$& Dupont");
  });

  it("remplit les modèles par défaut des paramètres", () => {
    const d = factureEmise();
    expect(remplirModele(d.emetteur.email_objet, d)).toBe("Facture AD-2026-0007 – Académie Delaveau");
    const corps = remplirModele(d.emetteur.email_corps, d);
    expect(corps).toContain("Bonjour Marie Dupont,");
    expect(corps).toContain("à régler avant le 31/10/2026");
    expect(corps).toMatch(/Cordialement,\nAcadémie Delaveau$/);
  });
});

describe("HTML des e-mails", () => {
  it("échappe les caractères spéciaux", () => {
    expect(echapperHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
  });

  it("convertit les sauts de ligne en <br> après échappement", () => {
    expect(texteVersHtml("Bonjour <b>Marie</b>,\r\n\nMerci")).toBe(
      "Bonjour &lt;b&gt;Marie&lt;/b&gt;,<br>\n<br>\nMerci",
    );
  });

  it("construit un gabarit aux couleurs de l'émetteur, corps et pied échappés", () => {
    const html = construireHtmlEmail({
      texte: "Bonjour <Marie>\nMerci",
      titre: "Académie <Delaveau>",
      sousTitre: "Académie <Espoir>",
      couleur: "#2E7D8C",
      couleurSecondaire: "#C0C0C0",
      pied: "Pièce jointe : Facture-AD-2026-0007.pdf",
    });
    expect(html).toContain("background-color:#2E7D8C");
    expect(html).toContain("border-bottom:3px solid #C0C0C0");
    expect(html).toContain("Académie &lt;Delaveau&gt;");
    expect(html).toContain("Académie &lt;Espoir&gt;</div>");
    expect(html).toContain("Bonjour &lt;Marie&gt;<br>\nMerci");
    expect(html).toContain("Pièce jointe : Facture-AD-2026-0007.pdf");
    expect(html).not.toContain("<Marie>");
  });

  it("n'affiche pas l'académie quand elle porte le nom de la structure", () => {
    const html = construireHtmlEmail({ texte: "x", titre: "Académie Delaveau", sousTitre: " académie delaveau " });
    expect(html).not.toContain("</div></td>");
    expect(html.match(/Académie Delaveau/g)).toHaveLength(2); // <title> + bandeau
  });

  it("ignore une couleur invalide (injection de style)", () => {
    const html = construireHtmlEmail({
      texte: "x",
      titre: "t",
      couleur: "red;background:url(x)",
      couleurSecondaire: "#fff;x:y",
    });
    expect(html).toContain("background-color:#0050A0");
    expect(html).toContain("border-bottom:3px solid #DADADA");
    expect(html).not.toContain("url(x)");
    expect(html).not.toContain("x:y");
  });
});

describe("configuration et envoi SMTP", () => {
  beforeEach(() => {
    vi.stubEnv("SMTP_HOST", "smtp.exemple.fr");
    vi.stubEnv("SMTP_PORT", "");
    vi.stubEnv("SMTP_SECURE", "");
    vi.stubEnv("SMTP_USER", "contact@exemple.fr");
    vi.stubEnv("SMTP_PASSWORD", "secret");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("EMAIL_REPLY_TO", "");
    sendMail.mockReset();
    createTransport.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("détecte une configuration incomplète", () => {
    expect(emailConfigure()).toBe(true);
    vi.stubEnv("SMTP_PASSWORD", "  ");
    expect(emailConfigure()).toBe(false);
    expect(variablesEmailManquantes()).toEqual(["SMTP_PASSWORD"]);
  });

  it("envoie avec les valeurs par défaut (port 465 sécurisé, expéditeur = SMTP_USER)", async () => {
    sendMail.mockResolvedValue({ messageId: "<abc@exemple.fr>", accepted: ["marie@exemple.fr"], rejected: [] });
    const resultat = await envoyerEmail({
      a: [" marie@exemple.fr ", "Marie@exemple.fr", ""],
      cci: ["archives@exemple.fr", "marie@exemple.fr"],
      objet: "Facture",
      texte: "Bonjour",
      pieceJointe: { nom: "Facture-AD-2026-0001.pdf", contenu: Buffer.from("%PDF") },
    });

    expect(resultat).toEqual({ messageId: "<abc@exemple.fr>", refusees: [] });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.exemple.fr",
        port: 465,
        secure: true,
        auth: { user: "contact@exemple.fr", pass: "secret" },
      }),
    );
    const message = sendMail.mock.calls[0][0];
    expect(message.from).toBe("contact@exemple.fr");
    expect(message.to).toEqual(["marie@exemple.fr"]);
    expect(message.bcc).toEqual(["archives@exemple.fr"]);
    expect(message.replyTo).toBeUndefined();
    expect(message.attachments[0]).toMatchObject({
      filename: "Facture-AD-2026-0001.pdf",
      contentType: "application/pdf",
    });
  });

  it("respecte SMTP_PORT, SMTP_SECURE, EMAIL_FROM et EMAIL_REPLY_TO", async () => {
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("EMAIL_FROM", "Académie Delaveau <contact@exemple.fr>");
    vi.stubEnv("EMAIL_REPLY_TO", "secretariat@exemple.fr");
    sendMail.mockResolvedValue({ messageId: "<x>", accepted: ["a@b.fr"], rejected: [] });
    await envoyerEmail({ a: ["a@b.fr"], objet: "o", texte: "t" });
    expect(createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ port: 587, secure: false }));
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      from: "Académie Delaveau <contact@exemple.fr>",
      replyTo: "secretariat@exemple.fr",
    });
  });

  it("signale les destinataires refusés, et échoue si seule la copie cachée est acceptée", async () => {
    sendMail.mockResolvedValue({
      messageId: "<x>",
      accepted: ["marie@exemple.fr"],
      rejected: [{ address: "Papa@Exemple.fr" }],
    });
    expect(await envoyerEmail({ a: ["marie@exemple.fr", "papa@exemple.fr"], objet: "o", texte: "t" })).toEqual({
      messageId: "<x>",
      refusees: ["papa@exemple.fr"],
    });

    sendMail.mockResolvedValue({ messageId: "<y>", accepted: ["archives@exemple.fr"], rejected: ["marie@exemple.fr"] });
    const envoi = envoyerEmail({ a: ["marie@exemple.fr"], cci: ["archives@exemple.fr"], objet: "o", texte: "t" });
    await expect(envoi).rejects.toMatchObject({ code: "EENVELOPE", message: expect.stringContaining("marie@exemple.fr") });
  });

  it("refuse un envoi non configuré ou sans destinataire", async () => {
    await expect(envoyerEmail({ a: [" "], objet: "o", texte: "t" })).rejects.toThrow("Aucun destinataire");
    vi.stubEnv("SMTP_HOST", "");
    await expect(envoyerEmail({ a: ["a@b.fr"], objet: "o", texte: "t" })).rejects.toThrow("SMTP_HOST");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("traduit les erreurs SMTP en messages clairs", () => {
    expect(messageErreurEmail(Object.assign(new Error("Invalid login"), { code: "EAUTH" }))).toMatch(/SMTP_PASSWORD/);
    expect(messageErreurEmail(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))).toMatch(/injoignable/);
    expect(messageErreurEmail(new Error("boum"))).toBe("Échec de l'envoi de l'e-mail : boum");
  });
});
