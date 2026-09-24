import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Entite } from "@/lib/types";

// `server-only` refuse d'être chargé hors de Next.js : neutralisé pour les tests.
vi.mock("server-only", () => ({}));

const { genererPdfFacture, nomFichierFacture } = await import("@/lib/pdf");
const { donneesExemple } = await import("@/lib/pdf/exemple");

/**
 * Les PDF rendus sont écrits dans APERCU_PDF_DIR (ou le dossier temporaire du système)
 * pour pouvoir vérifier la mise en page à l'œil :
 *   APERCU_PDF_DIR=/chemin npx vitest run tests/pdf.test.ts
 */
const DOSSIER_APERCU = process.env.APERCU_PDF_DIR ?? tmpdir();

const ENTITE: Entite = {
  id: "11111111-1111-4111-8111-111111111111",
  nom: "Académie Delaveau",
  prefixe_facture: "AD",
  couleur_primaire: "#0050A0",
  couleur_secondaire: "#DADADA",
  logo_url: null,
  raison_sociale: "Académie Delaveau",
  forme_juridique: "Association déclarée",
  adresse_ligne1: "5 chemin du Foyer",
  adresse_ligne2: null,
  code_postal: "14800",
  ville: "Vauville",
  pays: "France",
  siren: "853 472 298",
  siret: "853 472 298 00019",
  rna: "W143007272",
  numero_tva: null,
  objet_social: "Formation de jeunes cavaliers vers le haut niveau à travers le double projet sportif et scolaire.",
  email_contact: "contact@academiedelaveau.com",
  telephone: "06 12 34 56 78",
  site_web: null,
  iban: "FR7630006000011234567890189",
  bic: "AGRIFRPPXXX",
  titulaire_compte: "Académie Delaveau",
  conditions_paiement: "Paiement par virement bancaire à réception de la facture.",
  delai_paiement_jours: 30,
  taux_tva: 0,
  mention_tva: "TVA non applicable, art. 293 B du CGI",
  mentions_legales: "Association loi 1901 – Formation de jeunes cavaliers vers le haut niveau.",
  mentions_professionnels:
    "En cas de retard de paiement : pénalités au taux de trois fois le taux d'intérêt légal et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 et D441-5 du Code de commerce). Pas d'escompte pour paiement anticipé.",
  objet_facture_mensuelle: "Formation et accompagnement",
  jour_generation: 1,
  mois_facture: "courant",
  generation_auto: false,
  envoi_auto: false,
  email_objet: "Facture {numero} – {entite}",
  email_corps: "Bonjour {client},",
  email_copie: null,
  actif: true,
  ordre: 1,
  created_at: "2026-09-24T08:00:00Z",
  updated_at: "2026-09-24T08:00:00Z",
};

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
    const donnees = donneesExemple(ENTITE, {
      statut: "emise",
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
      { ...ENTITE, taux_tva: 20, mention_tva: "TVA acquittée sur les débits." },
      {
        statut: "payee",
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
    const brouillon = donneesExemple(ENTITE);
    const pdfBrouillon = await genererPdfFacture(brouillon);
    expect(nombrePages(pdfBrouillon)).toBe(1);
    ecrireApercu("apercu-brouillon.pdf", pdfBrouillon);
    expect(nomFichierFacture(brouillon.facture)).toMatch(/^Brouillon-\d{4}-\d{2}-[0-9a-f]{8}\.pdf$/);

    const annulee = donneesExemple(ENTITE, {
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

  it("utilise une facture sans aucune ligne sans planter", async () => {
    const pdf = await genererPdfFacture(donneesExemple(ENTITE, { lignes: [] }));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
