import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { genererPdfAvis, genererPdfFacture, nomFichierAvis, nomFichierFacture } from "@/lib/pdf";
import { rappelAvis, texteRappelAvis } from "@/lib/pdf/AvisEcheancePdf";
import { avisExemple, donneesAnnuellesExemple, donneesExemple, parametresExemple } from "@/lib/pdf/exemple";
import { echeancierFacture, texteRappelFacture, texteReductionLigne } from "@/lib/pdf/FacturePdf";
import type { Client, Parametres } from "@/lib/types";

/**
 * Les PDF rendus sont écrits dans APERCU_PDF_DIR (ou le dossier temporaire du système)
 * pour pouvoir vérifier la mise en page à l'œil :
 *   APERCU_PDF_DIR=/chemin npx vitest run tests/pdf.test.ts
 */
const DOSSIER_APERCU = process.env.APERCU_PDF_DIR ?? tmpdir();

// IBAN et SIRET sont enregistrés déjà mis en forme (voir Paramètres) : imprimés tels quels.
const PARAMETRES: Parametres = parametresExemple({
  telephone: "06 12 34 56 78",
  iban: "FR76 3000 6000 0112 3456 7890 189",
  bic: "AGRIFRPPXXX",
  titulaire_compte: "Académie Delaveau",
  mentions_legales: "Association loi 1901 – Formation de jeunes cavaliers vers le haut niveau.",
});

function nombrePages(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
}

function ecrireApercu(nom: string, pdf: Buffer): string {
  mkdirSync(DOSSIER_APERCU, { recursive: true });
  const chemin = join(DOSSIER_APERCU, nom);
  writeFileSync(chemin, pdf);
  return chemin;
}

describe("PDF de facture", () => {
  it("rend une facture émise d'un particulier (2 lignes, cavaliers)", async () => {
    const donnees = donneesExemple(PARAMETRES, {
      statut: "emise",
      academie: { nom: "Académie Espoir", couleur: "#2E7D8C" },
      lignes: [
        {
          libelle: "Pension et formation – octobre 2026",
          description: "Hébergement au box, travail monté 5 jours / 7, soins quotidiens et suivi vétérinaire",
          quantite: 1,
          prix_unitaire_centimes: 125000,
        },
        { libelle: "Cours particuliers (séance d'1 h)", quantite: 4, prix_unitaire_centimes: 4550 },
      ],
      client: {
        civilite: "Mme",
        prenom: "Marie",
        nom: "Dupont-Lefèvre",
        adresse_ligne1: "12 rue des Écuries",
        code_postal: "14000",
        ville: "Caen",
        cavaliers: "Léa Dupont, Hugo Dupont",
      },
      facture: {
        numero: "AD-2026-0042",
        annee: 2026,
        sequence: 42,
        objet: "Formation et accompagnement – octobre 2026",
        periode: "2026-10-01",
        date_emission: "2026-10-01",
        date_echeance: "2026-10-31",
        notes: "Merci de votre confiance. Le stage de la Toussaint sera facturé séparément.",
      },
    });

    const pdf = await genererPdfFacture(donnees);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(nombrePages(pdf)).toBe(1);
    ecrireApercu("apercu-facture.pdf", pdf);
    expect(nomFichierFacture(donnees.facture)).toBe("Facture-AD-2026-0042.pdf");
  });

  it("rend une facture de 40 lignes sur plusieurs pages", async () => {
    const lignes = Array.from({ length: 40 }, (_, i) => ({
      libelle: `Séance d'entraînement n° ${i + 1}`,
      description: i % 3 === 0 ? "Travail sur le plat et à l'obstacle – préparation concours" : null,
      quantite: i % 4 === 0 ? 1.5 : 1,
      prix_unitaire_centimes: 3500 + i * 125,
    }));
    const donnees = donneesExemple(
      { ...PARAMETRES, taux_tva: 20, mention_tva: "TVA acquittée sur les débits." },
      {
        statut: "payee",
        academie: { nom: "Académie Delaveau" },
        lignes,
        client: {
          type: "professionnel",
          raison_sociale: "Haras du Cotentin SARL",
          civilite: "M.",
          prenom: "Paul",
          nom: "Martin",
          adresse_ligne1: "Route de la Mer",
          adresse_ligne2: "Lieu-dit Le Clos",
          code_postal: "50100",
          ville: "Cherbourg-en-Cotentin",
          siret: "123 456 789 00012",
          numero_tva: "FR12123456789",
          cavaliers: "Jeanne Martin",
        },
        facture: {
          numero: "AD-2026-0043",
          objet: "Stage intensif – septembre 2026",
          periode: "2026-09-01",
          date_emission: "2026-09-24",
          date_echeance: "2026-10-24",
          payee_le: "2026-09-30",
          mode_paiement: "Virement",
        },
      },
    );

    const pdf = await genererPdfFacture(donnees);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(nombrePages(pdf)).toBeGreaterThanOrEqual(2);
    ecrireApercu("apercu-facture-longue.pdf", pdf);
  });

  it("rend un brouillon (filigrane) et une facture annulée (bandeau)", async () => {
    const brouillon = donneesExemple(PARAMETRES);
    const pdfBrouillon = await genererPdfFacture(brouillon);
    expect(nombrePages(pdfBrouillon)).toBe(1);
    ecrireApercu("apercu-brouillon.pdf", pdfBrouillon);
    expect(nomFichierFacture(brouillon.facture)).toMatch(/^Brouillon-\d{4}-\d{2}-[0-9a-f]{8}\.pdf$/);

    const annulee = donneesExemple(PARAMETRES, {
      statut: "annulee",
      facture: {
        numero: "AD-2026-0044",
        date_emission: "2026-09-02",
        date_echeance: "2026-10-02",
        annulee_le: "2026-09-10T09:30:00Z",
        motif_annulation: "Erreur de tarif, remplacée par la facture AD-2026-0045",
      },
    });
    const pdfAnnulee = await genererPdfFacture(annulee);
    expect(nombrePages(pdfAnnulee)).toBe(1);
    ecrireApercu("apercu-annulee.pdf", pdfAnnulee);
  });

  it("rend une facture sans aucune ligne ni cavalier sans planter", async () => {
    const pdf = await genererPdfFacture(
      donneesExemple(PARAMETRES, { lignes: [], client: { cavaliers: null }, academie: { nom: "Académie Espoir" } }),
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("rend une facture d'un client professionnel avec SIREN seul et mentions professionnelles vidées", async () => {
    const donnees = donneesExemple(
      parametresExemple({ siret: null, mentions_professionnels: null, taux_tva: 20, mention_tva: null }),
      { statut: "emise", client: { type: "professionnel", raison_sociale: "Haras du Cotentin SARL" } },
    );
    const pdf = await genererPdfFacture(donnees);
    expect(nombrePages(pdf)).toBe(1);
    ecrireApercu("apercu-professionnel-siren.pdf", pdf);
  });

  it("rend une facture mensuelle avec le rappel des arrhes, sans changer le total", async () => {
    // Enseignement 1 320,00 €/mois, arrhes 3 960,00 € : 396,00 € déduits chaque mois → 924,00 € facturés.
    const arrhes = { arrhes_reglees: true, arrhes_centimes: 396000, arrhes_saison: 2026 };
    const donnees = donneesExemple(PARAMETRES, {
      statut: "emise",
      lignes: [
        { libelle: "Enseignement et pension", quantite: 1, prix_unitaire_centimes: 92400, deduction_arrhes_centimes: 39600 },
        { libelle: "Cours particuliers", quantite: 2, prix_unitaire_centimes: 4500 },
      ],
      client: { prenom: "Marie", nom: "Dupont", cavaliers: "Léa Dupont", arrhes_reglees: false },
      facture: {
        numero: "AD-2026-0050",
        generation_auto: true,
        objet: "Formation et accompagnement – octobre 2026",
        periode: "2026-10-01",
        date_emission: "2026-10-01",
        date_echeance: "2026-10-31",
      },
    });
    // Arrhes figées à l'émission (la fiche actuelle, sans arrhes, ne compte pas).
    donnees.facture.client_snapshot = { ...donnees.client, ...arrhes };
    expect(donnees.facture.total_ht_centimes).toBe(92400 + 9000); // total inchangé : lignes seules
    expect(texteRappelFacture(donnees.facture, donnees.client, donnees.lignes)).toBe(
      "Enseignement annuel : 14 100,00 € · Arrhes versées : 3 960,00 € · Échéancier sur 10 mois (septembre à juin)",
    );

    const pdf = await genererPdfFacture(donnees);
    expect(nombrePages(pdf)).toBe(1);
    ecrireApercu("apercu-facture-arrhes.pdf", pdf);
  });

  it("rend une facture mensuelle avec réduction motivée et arrhes", async () => {
    // Catalogue 2 400 €, prix personnalisé 2 100 € (motif), arrhes 3 960 € → 1 704 € facturés.
    const arrhes = { arrhes_reglees: true, arrhes_centimes: 396000, arrhes_saison: 2026 };
    const donnees = donneesExemple(PARAMETRES, {
      statut: "brouillon",
      lignes: [
        {
          libelle: "Académicien Delaveau – enseignement et pension",
          quantite: 1,
          prix_unitaire_centimes: 210000 - 39600,
          prix_catalogue_centimes: 240000,
          motif_reduction: "Prise en charge 50 % location cheval",
          deduction_arrhes_centimes: 39600,
        },
      ],
      client: { prenom: "Paul", nom: "Leroy", cavaliers: "Tom Leroy", ...arrhes },
      facture: { generation_auto: true, objet: "Formation et accompagnement – octobre 2026", periode: "2026-10-01" },
    });
    expect(donnees.facture.total_ht_centimes).toBe(170400);
    expect(texteRappelFacture(donnees.facture, donnees.client, donnees.lignes)).toBe(
      "Enseignement annuel : 24 000,00 € · Prise en charge 50 % location cheval : −3 000,00 € · Arrhes versées : 3 960,00 € · Échéancier sur 10 mois (septembre à juin)",
    );
    const pdf = await genererPdfFacture(donnees);
    expect(nombrePages(pdf)).toBe(1);
    ecrireApercu("apercu-facture-reduction-arrhes.pdf", pdf);
  });

  it("rappel : arrhes figées, réduction motivée, rien pour une facture non concernée", () => {
    const arrhes = { arrhes_reglees: true, arrhes_centimes: 396000, arrhes_saison: 2026 };
    const ligne = (modifs: Partial<Parameters<typeof texteRappelFacture>[2][number]> = {}) => ({
      quantite: 1,
      prix_unitaire_centimes: 92400,
      prix_catalogue_centimes: null,
      motif_reduction: null,
      deduction_arrhes_centimes: 39600,
      ...modifs,
    });
    const lignes = [ligne()];
    const mensuelle = {
      statut: "brouillon" as const,
      generation_auto: true,
      periode: "2026-10-01",
      total_ht_centimes: 92400,
      client_snapshot: null,
    };
    const sansArrhes = { arrhes_reglees: false, arrhes_centimes: null, arrhes_saison: null };
    // Brouillon : fiche actuelle.
    expect(texteRappelFacture(mensuelle, arrhes, lignes)).toContain("Enseignement annuel : 13 200,00 €");
    // Juin : la déduction est le reste ; montant annuel exact.
    const reste = { ...arrhes, arrhes_centimes: 396005 }; // 39 600 × 9 + 39 605
    expect(
      texteRappelFacture(
        { ...mensuelle, periode: "2027-06-01", total_ht_centimes: 132000 - 39605 },
        reste,
        [ligne({ prix_unitaire_centimes: 132000 - 39605, deduction_arrhes_centimes: 39605 })],
      ),
    ).toContain("Enseignement annuel : 13 200,00 € · Arrhes versées : 3 960,05 €");
    // Réduction motivée sans arrhes : pas de segment arrhes.
    const reduite = [
      ligne({ prix_unitaire_centimes: 210000, prix_catalogue_centimes: 240000, motif_reduction: " Prise en charge 50 % location cheval ", deduction_arrhes_centimes: null }),
      ligne({ prix_unitaire_centimes: 2000, prix_catalogue_centimes: 2000, deduction_arrhes_centimes: null }),
    ];
    expect(texteRappelFacture({ ...mensuelle, total_ht_centimes: 212000 }, sansArrhes, reduite)).toBe(
      "Enseignement annuel : 24 000,00 € · Prise en charge 50 % location cheval : −3 000,00 € · Échéancier sur 10 mois (septembre à juin)",
    );
    // Réduction sans motif, ou prix au catalogue : rien (sans arrhes).
    expect(
      texteRappelFacture(mensuelle, sansArrhes, [ligne({ prix_catalogue_centimes: 240000, deduction_arrhes_centimes: null })]),
    ).toBeNull();
    expect(
      texteRappelFacture(mensuelle, sansArrhes, [
        ligne({ prix_catalogue_centimes: 92400, motif_reduction: "Motif", deduction_arrhes_centimes: null }),
      ]),
    ).toBeNull();
    // Réduction sans motif mais arrhes : annuel = (total + déduction) × 10.
    expect(texteRappelFacture(mensuelle, arrhes, [ligne({ prix_catalogue_centimes: 240000 })])).toBe(
      "Enseignement annuel : 13 200,00 € · Arrhes versées : 3 960,00 € · Échéancier sur 10 mois (septembre à juin)",
    );
    // Rien à afficher :
    expect(texteRappelFacture({ ...mensuelle, generation_auto: false }, arrhes, lignes)).toBeNull(); // facture manuelle
    expect(texteRappelFacture({ ...mensuelle, periode: "2027-07-01" }, arrhes, lignes)).toBeNull(); // juillet
    expect(texteRappelFacture({ ...mensuelle, periode: "2026-08-01" }, arrhes, reduite)).toBeNull(); // août
    expect(texteRappelFacture({ ...mensuelle, periode: "2027-09-01" }, arrhes, lignes)).toBeNull(); // autre saison
    expect(texteRappelFacture(mensuelle, { ...arrhes, arrhes_reglees: false }, lignes)).toBeNull(); // non réglées
    expect(texteRappelFacture(mensuelle, arrhes, [ligne({ deduction_arrhes_centimes: null })])).toBeNull(); // non appliquée
    // Facture émise : l'instantané fait foi ; un instantané antérieur aux arrhes → rien.
    const emise = { ...mensuelle, statut: "emise" as const };
    expect(texteRappelFacture(emise, arrhes, lignes)).toBeNull();
    expect(texteRappelFacture({ ...emise, client_snapshot: { nom: "Dupont" } as unknown as Client }, arrhes, lignes)).toBeNull();
    expect(
      texteRappelFacture({ ...emise, client_snapshot: arrhes as unknown as Client }, sansArrhes, lignes),
    ).toContain("Arrhes versées : 3 960,00 €");
  });

  it("rend une facture sans académie (nom vide) ni coordonnées bancaires", async () => {
    const donnees = donneesExemple(parametresExemple(), { academie: { nom: "" } });
    const pdf = await genererPdfFacture(donnees);
    expect(nombrePages(pdf)).toBe(1);
  });
});

/** Texte brut d'un PDF (flux non compressés de react-pdf : chaînes entre parenthèses). */
function contientTexte(pdf: Buffer, texte: string): boolean {
  return pdf.toString("latin1").includes(texte);
}

describe("PDF de la facture annuelle et de l'avis d'échéance", () => {
  // Cas réel : Asma Dos Santos, Académie Espoir, E1, 1 320 €/mois → 13 200 €/an, arrhes 3 960 € → 10 × 924 €.
  const ASMA = {
    academie: { nom: "Académie Espoir", couleur: "#2E7D8C" },
    client: {
      civilite: "Mme",
      prenom: "Asma",
      nom: "Dos Santos",
      reference: "E1",
      cavaliers: "Inès Dos Santos",
      adresse_ligne1: "3 rue du Manège",
      code_postal: "50100",
      ville: "Cherbourg-en-Cotentin",
      arrhes_reglees: true,
      arrhes_centimes: 396000,
      arrhes_saison: 2026,
    },
    lignes: [
      {
        libelle: "Enseignement – 2026-2027",
        description: "Formation sportive et scolaire, pension et travail du cheval",
        quantite: 1,
        prix_unitaire_centimes: 1320000,
      },
    ],
  };

  it("facture annuelle émise : année scolaire, réf. élève, arrhes, reste à payer et échéancier de 10 × 924 €", async () => {
    const donnees = donneesAnnuellesExemple(PARAMETRES, ASMA);
    expect(donnees.facture.total_ttc_centimes).toBe(1320000);
    expect(donnees.echeances?.map((e) => e.montant_centimes)).toEqual(Array(10).fill(92400));
    const echeancier = echeancierFacture(donnees.facture, donnees.client, donnees.emetteur, donnees.echeances);
    expect(echeancier).toMatchObject({ arrhes: 396000, reste: 924000, previsionnel: false });
    expect(echeancier?.lignes.map((l) => l.periode)).toEqual([
      "2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01",
      "2027-02-01", "2027-03-01", "2027-04-01", "2027-05-01", "2027-06-01",
    ]);

    const pdf = await genererPdfFacture(donnees);
    ecrireApercu("apercu-facture-annuelle.pdf", pdf);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(nombrePages(pdf)).toBe(1);
    expect(nomFichierFacture(donnees.facture)).toBe("Facture-AD-2026-0001.pdf");
  });

  it("facture annuelle à prix réduit motivé (ligne détaillée) et brouillon (échéancier prévisionnel)", async () => {
    const ligne = {
      libelle: "Académicien Delaveau – 2026-2027",
      quantite: 1,
      prix_unitaire_centimes: 2100000,
      prix_catalogue_centimes: 2400000,
      motif_reduction: "Prise en charge 50 % location cheval",
    };
    expect(texteReductionLigne(ligne)).toBe(
      "Tarif annuel 24 000,00 € – Prise en charge 50 % location cheval : −3 000,00 €",
    );
    expect(texteReductionLigne({ ...ligne, motif_reduction: null })).toBeNull();
    expect(texteReductionLigne({ ...ligne, prix_catalogue_centimes: 2100000 })).toBeNull();

    const reduite = donneesAnnuellesExemple(PARAMETRES, {
      ...ASMA,
      lignes: [ligne, { libelle: "Licence FFE – 2026-2027", quantite: 1, prix_unitaire_centimes: 5000 }],
      facture: { numero: "AD-2026-0002", sequence: 2 },
    });
    const pdf = await genererPdfFacture(reduite);
    ecrireApercu("apercu-facture-annuelle-reduction.pdf", pdf);
    expect(nombrePages(pdf)).toBe(1);

    const brouillon = donneesAnnuellesExemple(PARAMETRES, { ...ASMA, statut: "brouillon" });
    const prevu = echeancierFacture(brouillon.facture, brouillon.client, brouillon.emetteur, brouillon.echeances);
    expect(prevu).toMatchObject({ arrhes: 396000, reste: 924000, previsionnel: true });
    expect(prevu?.lignes.map((l) => l.montant_centimes)).toEqual(Array(10).fill(92400));
    const pdfBrouillon = await genererPdfFacture(brouillon);
    ecrireApercu("apercu-facture-annuelle-brouillon.pdf", pdfBrouillon);
    expect(nombrePages(pdfBrouillon)).toBe(1);
    // Facture ponctuelle : pas d'échéancier.
    expect(echeancierFacture(donneesExemple(PARAMETRES).facture, donneesExemple(PARAMETRES).client, PARAMETRES, [])).toBeNull();
  });

  it("avis d'échéance : titre, numéro d'avis, facture, montant, date limite, rappel et mention non fiscale", async () => {
    const avis = avisExemple(PARAMETRES, 2, { ...ASMA, statutsEcheances: { 1: "payee", 2: "envoyee" } });
    expect(avis.echeance.numero_avis).toBe("E1-2026-10");
    expect(nomFichierAvis(avis.echeance)).toBe("Avis-E1-2026-10.pdf");
    const rappel = rappelAvis(avis.echeance, avis.echeances, avis.facture.total_ttc_centimes, 396000);
    expect(rappel).toEqual({ totalAnnuel: 1320000, arrhes: 396000, dejaRegle: 92400, resteApres: 924000 - 2 * 92400 });
    expect(texteRappelAvis(rappel)).toBe(
      "Total annuel : 13 200,00 € · Arrhes versées : 3 960,00 € · Déjà réglé : 924,00 € · Reste dû après cette échéance : 7 392,00 €",
    );

    const pdf = await genererPdfAvis(avis);
    ecrireApercu("apercu-avis-echeance.pdf", pdf);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(nombrePages(pdf)).toBe(1);
    expect(contientTexte(pdf, "FACTURE (")).toBe(false);

    // Échéance payée et échéance annulée : rendu sans erreur.
    const payee = await genererPdfAvis(avisExemple(PARAMETRES, 1, { ...ASMA, statutsEcheances: { 1: "payee" } }));
    expect(nombrePages(payee)).toBe(1);
    ecrireApercu("apercu-avis-payee.pdf", payee);
    const annulee = await genererPdfAvis(avisExemple(PARAMETRES, 3, { ...ASMA, statut: "annulee", statutsEcheances: { 3: "annulee" } }));
    expect(nombrePages(annulee)).toBe(1);
    ecrireApercu("apercu-avis-annule.pdf", annulee);
  });
});
