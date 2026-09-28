import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import {
  aujourdhuiParis,
  formatDate,
  formatEurosPdf,
  formatPeriode,
  formatQuantite,
  nomClient,
  sansEspacesSpeciales,
} from "@/lib/format";
import {
  dateEcheanceAvis,
  deductionArrhes,
  echeancierAnnuel,
  libelleSaison,
  moisSaison,
  totalLigneCentimes,
  type ArrhesClient,
} from "@/lib/tarifs";
import type { Academie, Client, Echeance, Facture, LigneFacture, Parametres } from "@/lib/types";
import {
  A4_HAUTEUR,
  assombrir,
  ajouterJours,
  BAS_PIED,
  couleurValide,
  DISCRET,
  ENCRE,
  FILET,
  formatTaux,
  hauteurPied,
  INTERLIGNE_PIED,
  LARGEUR_NUMERO_PAGE,
  MARGE_HAUT,
  MARGE_X,
  rempli,
  ROUGE,
  styleLogo as dimensionsLogo,
  t,
  TAILLE_PIED,
  teinte,
  VERT,
  villeComplete,
} from "./outils";

/*
 * Mise en page A4 d'une facture (@react-pdf/renderer, police Helvetica intégrée au PDF).
 * Facture annuelle (type « annuelle ») : année scolaire, référence élève, arrhes et reste à
 * payer, échéancier des 10 avis d'échéance (septembre → juin).
 * Texte : toujours via `t()` ou formatEurosPdf (voir ./outils).
 */

/** Informations de la structure émettrice (paramètres) imprimées sur la facture. */
export type EmetteurPdf = Pick<
  Parametres,
  | "raison_sociale"
  | "forme_juridique"
  | "adresse_ligne1"
  | "adresse_ligne2"
  | "code_postal"
  | "ville"
  | "pays"
  | "siren"
  | "siret"
  | "rna"
  | "numero_tva"
  | "email_contact"
  | "telephone"
  | "site_web"
  | "iban"
  | "bic"
  | "titulaire_compte"
  | "conditions_paiement"
  | "delai_paiement_jours"
  | "mention_tva"
  | "mentions_legales"
  | "mentions_professionnels"
  | "couleur_primaire"
  | "couleur_secondaire"
  | "jour_generation"
>;

export interface ProprietesFacturePdf {
  facture: Facture;
  lignes: LigneFacture[];
  client: Client;
  emetteur: EmetteurPdf;
  /** Académie du client (Académie Delaveau / Académie Espoir), rappelée sous le(s) cavalier(s). */
  academie: Pick<Academie, "nom"> | null;
  /** Logo : data URI ou URL http(s) ; null → pas de logo. */
  logo: string | null;
  /** Proportions connues du logo (largeur / hauteur) ; absent → logo ajusté dans un cadre. */
  logoRatio?: number;
  /** Facture annuelle émise : ses échéances (sinon l'échéancier est calculé, prévisionnel). */
  echeances?: Echeance[];
}

/**
 * Mentions obligatoires entre professionnels (pénalités de retard, indemnité de 40 €), imprimées
 * pour un client professionnel si le champ des paramètres a été vidé (même texte que le défaut SQL).
 */
export const MENTION_B2B_DEFAUT =
  "En cas de retard de paiement : pénalités au taux de trois fois le taux d'intérêt légal et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 et D441-5 du Code de commerce). Pas d'escompte pour paiement anticipé.";

// Pas de césure automatique : react-pdf applique des règles anglaises (« vétéri-naire »).
Font.registerHyphenationCallback((mot) => [mot]);

type LigneRappel = Pick<
  LigneFacture,
  "quantite" | "prix_unitaire_centimes" | "prix_catalogue_centimes" | "motif_reduction" | "deduction_arrhes_centimes"
>;

/**
 * Rappel de l'échéancier d'une facture MENSUELLE (septembre à juin), imprimé sous l'objet :
 *   « Enseignement annuel : 24 000,00 € · Prise en charge 50 % location cheval : −3 000,00 € ·
 *     Arrhes versées : 3 960,00 € · Échéancier sur 10 mois (septembre à juin) »
 * Informatif : ni le total ni les lignes ne changent. null s'il n'y a rien à afficher.
 *
 * - Arrhes : affichées si la déduction s'applique à la période (deductionArrhes sur les arrhes
 *   FIGÉES : instantané client pour une facture émise — rien si l'instantané, antérieur aux
 *   arrhes, n'en contient pas —, fiche actuelle pour un brouillon) ET si la génération l'a
 *   effectivement retirée d'une ligne (`deduction_arrhes_centimes`).
 * - Ligne principale : celle qui porte la déduction, sinon celle de plus grand total parmi les
 *   lignes de quantité 1 (la première en cas d'égalité). Son prix brut = prix + déduction.
 * - Réduction motivée (prix catalogue > prix brut et motif renseigné, figés sur la ligne) :
 *   annuel = catalogue × quantité × 10, réduction = (catalogue − brut) × quantité × 10.
 * - Sinon, avec arrhes : annuel = (total HT + déduction) × 10 (exact, juin compris).
 */
export function texteRappelFacture(
  facture: Pick<Facture, "statut" | "generation_auto" | "periode" | "total_ht_centimes" | "client_snapshot">,
  client: ArrhesClient,
  lignes: LigneRappel[],
): string | null {
  if (!facture.generation_auto || !facture.periode) return null;
  // Juillet et août : hors échéancier.
  if (["07", "08"].includes(facture.periode.slice(5, 7))) return null;

  // Arrhes figées.
  const source: Partial<ArrhesClient> | null = facture.statut === "brouillon" ? client : facture.client_snapshot;
  const arrhes: ArrhesClient | null =
    source && typeof source.arrhes_reglees === "boolean"
      ? {
          arrhes_reglees: source.arrhes_reglees,
          arrhes_centimes: source.arrhes_centimes ?? null,
          arrhes_saison: source.arrhes_saison ?? null,
        }
      : null;
  const ligneArrhes = lignes.find((l) => (l.deduction_arrhes_centimes ?? 0) > 0) ?? null;
  const avecArrhes = arrhes !== null && ligneArrhes !== null && deductionArrhes(arrhes, facture.periode) > 0;
  const deduction = avecArrhes ? (ligneArrhes.deduction_arrhes_centimes ?? 0) : 0;

  // Ligne principale et réduction motivée.
  const principale =
    (avecArrhes ? ligneArrhes : null) ??
    lignes
      .filter((l) => Number(l.quantite) === 1)
      .reduce<LigneRappel | null>((max, l) => (max === null || l.prix_unitaire_centimes > max.prix_unitaire_centimes ? l : max), null);
  const brut = principale ? principale.prix_unitaire_centimes + (principale === ligneArrhes ? deduction : 0) : 0;
  const motif = principale?.motif_reduction?.trim() ?? "";
  const catalogue = principale?.prix_catalogue_centimes ?? null;
  const reduction = principale !== null && catalogue !== null && catalogue > brut && motif !== "";

  if (!reduction && !avecArrhes) return null;
  const segments: string[] = [];
  if (reduction) {
    segments.push(`Enseignement annuel : ${formatEurosPdf(totalLigneCentimes(principale.quantite, catalogue) * 10)}`);
    segments.push(`${motif} : −${formatEurosPdf(totalLigneCentimes(principale.quantite, catalogue - brut) * 10)}`);
  } else {
    segments.push(`Enseignement annuel : ${formatEurosPdf((Number(facture.total_ht_centimes) + deduction) * 10)}`);
  }
  if (avecArrhes) segments.push(`Arrhes versées : ${formatEurosPdf(arrhes.arrhes_centimes ?? 0)}`);
  segments.push("Échéancier sur 10 mois (septembre à juin)");
  return sansEspacesSpeciales(segments.join(" · "));
}

/** Ligne d'échéancier imprimée sur la facture annuelle. */
export interface LigneEcheancier {
  periode: string;
  date_echeance: string;
  montant_centimes: number;
}

/**
 * Échéancier et arrhes d'une facture annuelle : échéances réelles si elle est émise, sinon
 * calcul prévisionnel (mêmes règles que emettre_facture) à partir du total, des arrhes de la
 * fiche client et des paramètres. null pour une facture ponctuelle.
 */
export function echeancierFacture(
  facture: Pick<Facture, "type_facture" | "saison" | "statut" | "total_ttc_centimes" | "date_emission" | "client_snapshot">,
  client: ArrhesClient,
  emetteur: Pick<Parametres, "jour_generation" | "delai_paiement_jours">,
  echeances: Echeance[] | undefined,
  aujourdhui: string = aujourdhuiParis(),
): { arrhes: number; reste: number; lignes: LigneEcheancier[]; previsionnel: boolean } | null {
  if (facture.type_facture !== "annuelle" || facture.saison == null) return null;
  const saison = facture.saison;
  // Arrhes figées à l'émission (instantané client), fiche actuelle pour un brouillon.
  const source: Partial<ArrhesClient> | null = facture.statut === "brouillon" ? client : facture.client_snapshot;
  const arrhesClient: ArrhesClient = {
    arrhes_reglees: source?.arrhes_reglees ?? false,
    arrhes_centimes: source?.arrhes_centimes ?? null,
    arrhes_saison: source?.arrhes_saison ?? null,
  };
  const prevu = echeancierAnnuel(Number(facture.total_ttc_centimes), arrhesClient, saison);
  if (facture.statut !== "brouillon" && echeances && echeances.length > 0) {
    const lignes = [...echeances]
      .sort((x, y) => x.rang - y.rang)
      .map((e) => ({ periode: e.periode, date_echeance: e.date_echeance, montant_centimes: e.montant_centimes }));
    // Les échéances ne s'annulent qu'avec la facture : leur somme est le reste à payer d'origine.
    const reste = echeances.reduce((somme, e) => somme + e.montant_centimes, 0);
    return { arrhes: prevu.arrhes, reste, lignes, previsionnel: false };
  }
  const emission = facture.date_emission ?? aujourdhui;
  const jour = Number(emetteur.jour_generation) || 1;
  const delai = Number(emetteur.delai_paiement_jours) || 0;
  const lignes = prevu.montants.map((montant, k) => {
    const periode = moisSaison(saison)[k];
    return { periode, date_echeance: dateEcheanceAvis(periode, jour, delai, emission), montant_centimes: montant };
  });
  return { arrhes: prevu.arrhes, reste: prevu.reste, lignes, previsionnel: facture.statut === "brouillon" };
}

/**
 * Détail d'une ligne annuelle à prix réduit (motif renseigné, prix catalogue supérieur, figés
 * sur la ligne) : « Tarif annuel 24 000,00 € – Prise en charge 50 % location cheval : −3 000,00 € ».
 */
export function texteReductionLigne(
  l: Pick<LigneFacture, "quantite" | "prix_unitaire_centimes" | "prix_catalogue_centimes" | "motif_reduction">,
): string | null {
  const motif = l.motif_reduction?.trim() ?? "";
  const catalogue = l.prix_catalogue_centimes;
  if (motif === "" || catalogue == null || catalogue <= l.prix_unitaire_centimes) return null;
  return sansEspacesSpeciales(
    `Tarif annuel ${formatEurosPdf(totalLigneCentimes(l.quantite, catalogue))} – ${motif} : −${formatEurosPdf(
      totalLigneCentimes(l.quantite, catalogue - l.prix_unitaire_centimes),
    )}`,
  );
}

/** « Mois » d'un échéancier : "2026-09-01" → « Septembre 2026 ». */
function moisCapitalise(periode: string): string {
  const mois = formatPeriode(periode);
  return mois.charAt(0).toUpperCase() + mois.slice(1);
}

function creerStyles(primaire: string, secondaire: string) {
  const fond = teinte(primaire, 0.07);
  const fondDoux = teinte(primaire, 0.035);
  return StyleSheet.create({
    page: {
      paddingTop: MARGE_HAUT,
      paddingHorizontal: MARGE_X,
      fontFamily: "Helvetica",
      fontSize: 9,
      lineHeight: 1.4,
      color: ENCRE,
      backgroundColor: "#FFFFFF",
    },

    // Filigrane (brouillon / annulée)
    filigraneConteneur: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    filigrane: {
      fontFamily: "Helvetica-Bold",
      fontSize: 80,
      letterSpacing: 5,
      transform: "rotate(-38deg)",
    },

    // Rappel en haut des pages suivantes
    suite: {
      position: "absolute",
      top: 16,
      right: MARGE_X,
      fontSize: 7.5,
      color: DISCRET,
    },

    // En-tête
    entete: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    enteteGauche: { width: 200, paddingTop: 2 },
    enteteDroite: { alignItems: "flex-end", maxWidth: 280 },
    titre: {
      fontFamily: "Helvetica-Bold",
      fontSize: 25,
      letterSpacing: 3,
      color: primaire,
      lineHeight: 1.1,
    },
    titreBrouillon: {
      fontFamily: "Helvetica-Bold",
      fontSize: 22,
      letterSpacing: 2.5,
      color: primaire,
      lineHeight: 1.1,
    },
    sousTitreBrouillon: { fontSize: 8.5, color: ROUGE, marginTop: 2 },
    numero: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 4, color: ENCRE },
    // Facture annuelle : année scolaire sous le titre, référence élève en évidence.
    sousTitreAnnee: { fontFamily: "Helvetica-Bold", fontSize: 10.5, color: primaire, marginTop: 3, letterSpacing: 0.4 },
    referenceEleve: {
      marginTop: 5,
      paddingVertical: 2.5,
      paddingHorizontal: 7,
      backgroundColor: fond,
      borderLeftWidth: 2,
      borderLeftColor: primaire,
      fontSize: 9,
      color: ENCRE,
    },
    meta: { marginTop: 9, borderTopWidth: 0.75, borderTopColor: secondaire, paddingTop: 6 },
    metaLigne: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 1.5 },
    metaLibelle: { color: DISCRET, fontSize: 8.5, width: 92, textAlign: "right", marginRight: 10 },
    metaValeur: { fontFamily: "Helvetica-Bold", fontSize: 8.5, width: 72, textAlign: "right" },

    filet: { marginTop: 16, height: 2.5, backgroundColor: primaire },
    filetFin: { height: 0.75, backgroundColor: secondaire, marginTop: 1.5 },

    // Bandeau « ANNULÉE »
    bandeauAnnulee: {
      marginTop: 12,
      paddingVertical: 7,
      paddingHorizontal: 12,
      backgroundColor: "#FDECEA",
      borderLeftWidth: 3,
      borderLeftColor: ROUGE,
      flexDirection: "row",
      alignItems: "center",
    },
    bandeauTitre: { fontFamily: "Helvetica-Bold", fontSize: 12, letterSpacing: 2, color: ROUGE, marginRight: 12 },
    bandeauCorps: { flex: 1 },
    bandeauTexte: { fontSize: 8.5, color: "#7A271A" },

    // Émetteur / destinataire
    parties: { flexDirection: "row", marginTop: 18 },
    // Même retrait haut que le cadre du destinataire : les deux étiquettes sont alignées.
    emetteur: { flex: 1, paddingRight: 18, paddingTop: 10 },
    destinataire: {
      flex: 1,
      backgroundColor: fondDoux,
      borderLeftWidth: 2.5,
      borderLeftColor: primaire,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    etiquette: {
      fontFamily: "Helvetica-Bold",
      fontSize: 7.5,
      letterSpacing: 1.2,
      color: primaire,
      marginBottom: 4,
    },
    nomPartie: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginBottom: 1.5 },
    lignePartie: { fontSize: 8.5 },
    lignePartieDiscrete: { fontSize: 8, color: DISCRET },
    cavaliers: { fontSize: 8.5, marginTop: 5 },
    academie: { fontSize: 7.5, color: DISCRET, marginTop: 2, letterSpacing: 0.3 },
    referenceClient: { fontSize: 8.5, marginTop: 3 },
    gras: { fontFamily: "Helvetica-Bold" },

    // Objet et période
    objet: {
      marginTop: 18,
      marginBottom: 5,
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "flex-end",
    },
    objetBloc: { marginRight: 26, marginBottom: 7 },
    objetLibelle: { fontSize: 7.5, color: DISCRET, letterSpacing: 0.8 },
    objetValeur: { fontFamily: "Helvetica-Bold", fontSize: 10 },
    // Rappel de l'échéancier (arrhes) : sur sa propre ligne, sous l'objet et la période.
    arrhes: {
      width: "100%",
      marginBottom: 7,
      paddingVertical: 4,
      paddingHorizontal: 7,
      borderLeftWidth: 2,
      borderLeftColor: primaire,
      backgroundColor: teinte(primaire, 0.06),
      fontSize: 8,
      color: DISCRET,
    },

    // Tableau des lignes
    tableau: { marginTop: 2 },
    tableauEntete: {
      flexDirection: "row",
      backgroundColor: primaire,
      color: "#FFFFFF",
      paddingVertical: 6,
      fontFamily: "Helvetica-Bold",
      fontSize: 7.5,
      letterSpacing: 0.8,
    },
    ligne: {
      flexDirection: "row",
      paddingVertical: 5.5,
      borderBottomWidth: 0.6,
      borderBottomColor: FILET,
    },
    ligneAlternee: { backgroundColor: fondDoux },
    colDesignation: { flex: 1, paddingHorizontal: 8 },
    colQuantite: { width: 46, paddingHorizontal: 6, textAlign: "right" },
    colPrix: { width: 88, paddingHorizontal: 8, textAlign: "right" },
    colTotal: { width: 90, paddingHorizontal: 8, textAlign: "right" },
    libelle: { fontFamily: "Helvetica-Bold", fontSize: 9 },
    description: { fontSize: 7.8, color: DISCRET, marginTop: 1.5 },
    reduction: { fontSize: 7.8, color: primaire, marginTop: 1.5 },
    vide: { paddingVertical: 14, textAlign: "center", color: DISCRET, fontSize: 8.5 },

    // Totaux
    totaux: { marginTop: 10, alignItems: "flex-end" },
    totauxBoite: { width: 250 },
    totalLigne: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderBottomWidth: 0.6,
      borderBottomColor: FILET,
    },
    totalLibelle: { color: DISCRET },
    totalValeur: { fontFamily: "Helvetica-Bold" },
    totalFinal: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 7,
      paddingHorizontal: 10,
      backgroundColor: primaire,
      color: "#FFFFFF",
      marginTop: 3,
    },
    totalFinalLibelle: { fontFamily: "Helvetica-Bold", fontSize: 10, letterSpacing: 1 },
    totalFinalValeur: { fontFamily: "Helvetica-Bold", fontSize: 12 },
    mentionTva: { fontSize: 7.8, color: DISCRET, marginTop: 4, textAlign: "right", fontFamily: "Helvetica-Oblique" },
    // Facture annuelle : arrhes et reste à payer sous le total.
    reste: {
      marginTop: 4,
      alignSelf: "flex-end",
      paddingVertical: 4,
      paddingHorizontal: 10,
      backgroundColor: fond,
      fontSize: 9,
    },

    // Échéancier (facture annuelle) : deux colonnes de 5 mois.
    echeancier: { marginTop: 8 },
    echeancierEntete: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
    echeancierNote: { fontSize: 7.5, color: DISCRET },
    echeancierColonnes: { flexDirection: "row", marginTop: 2 },
    echeancierColonne: { flex: 1 },
    echeancierColonneDroite: { flex: 1, marginLeft: 14 },
    echeancierTete: {
      flexDirection: "row",
      paddingVertical: 2.5,
      borderBottomWidth: 1,
      borderBottomColor: primaire,
      fontFamily: "Helvetica-Bold",
      fontSize: 7,
      letterSpacing: 0.6,
      color: primaire,
    },
    echeancierLigne: {
      flexDirection: "row",
      paddingVertical: 1.8,
      borderBottomWidth: 0.6,
      borderBottomColor: FILET,
      fontSize: 8.2,
    },
    colMois: { flex: 1, paddingLeft: 4 },
    colDate: { width: 70, textAlign: "center" },
    colMontant: { width: 70, textAlign: "right", paddingRight: 4 },

    // Règlement
    reglement: {
      marginTop: 18,
      borderWidth: 0.75,
      borderColor: secondaire,
      borderLeftWidth: 2.5,
      borderLeftColor: primaire,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    reglementColonnes: { flexDirection: "row" },
    reglementGauche: { flex: 1.15, paddingRight: 14 },
    reglementDroite: { flex: 1, paddingLeft: 14, borderLeftWidth: 0.6, borderLeftColor: FILET },
    reglementLigne: { fontSize: 8.5, marginBottom: 1.5 },
    reglementLibelle: { color: DISCRET },
    reference: {
      marginTop: 6,
      alignSelf: "flex-start",
      backgroundColor: fond,
      paddingVertical: 3,
      paddingHorizontal: 7,
      fontSize: 8.5,
    },
    acquittee: { marginTop: 6, fontSize: 8.5, color: VERT, fontFamily: "Helvetica-Bold" },

    // Notes
    notes: { marginTop: 14 },
    notesTexte: { fontSize: 8.5 },

    // Pied de page
    pied: {
      position: "absolute",
      left: MARGE_X,
      right: MARGE_X,
      bottom: BAS_PIED,
      borderTopWidth: 0.75,
      borderTopColor: secondaire,
      paddingTop: 6,
    },
    piedParagraphe: { fontSize: TAILLE_PIED, lineHeight: INTERLIGNE_PIED, color: DISCRET, marginBottom: 2.5 },
    // Pas de texte en « flex: 1 » dans ce bloc absolu : react-pdf le mesure alors à largeur nulle.
    piedLegal: { marginTop: 1, paddingRight: LARGEUR_NUMERO_PAGE + 8 },
    piedLegalTexte: {
      fontSize: 7.2,
      lineHeight: INTERLIGNE_PIED,
      color: assombrir(primaire, 0.15),
      fontFamily: "Helvetica-Bold",
    },
    // Texte dynamique (render) : ancré par `top`, car react-pdf 4.9 calcule une hauteur
    // aberrante pour un texte dynamique ancré par `bottom`.
    piedPage: {
      position: "absolute",
      right: MARGE_X,
      top: A4_HAUTEUR - BAS_PIED - 7.2 * INTERLIGNE_PIED,
      width: LARGEUR_NUMERO_PAGE,
      textAlign: "right",
      fontSize: 7.2,
      lineHeight: INTERLIGNE_PIED,
      color: DISCRET,
    },
  });
}

// -----------------------------------------------------------------------------
// Document
// -----------------------------------------------------------------------------

/**
 * Construit le document PDF d'une facture. Fonction pure (aucun hook) : elle est appelée
 * directement pour obtenir l'élément <Document> attendu par renderToBuffer.
 */
export function FacturePdf({
  facture,
  lignes,
  client,
  emetteur,
  academie,
  logo,
  logoRatio,
  echeances,
}: ProprietesFacturePdf): ReactElement<DocumentProps> {
  const primaire = couleurValide(emetteur.couleur_primaire, "#0050A0");
  const secondaire = couleurValide(emetteur.couleur_secondaire, "#DADADA");
  const s = creerStyles(primaire, secondaire);

  const brouillon = facture.statut === "brouillon";
  const annulee = facture.statut === "annulee";
  const payee = facture.statut === "payee";
  const professionnel = client.type === "professionnel";

  // Un brouillon n'a pas encore de dates : on affiche celles qu'il aurait s'il était émis aujourd'hui.
  const dateEmission = facture.date_emission ?? aujourdhuiParis();
  const dateEcheance = facture.date_echeance ?? ajouterJours(dateEmission, Number(emetteur.delai_paiement_jours) || 0);
  const tauxTva = Number(facture.taux_tva) || 0;
  const numero = facture.numero;
  const annuelle = facture.type_facture === "annuelle" && facture.saison != null;
  const echeancier = echeancierFacture(facture, client, emetteur, echeances);
  // Référence élève : figée à l'émission (instantané) ; fiche actuelle pour un brouillon.
  const referenceEleve = brouillon ? client.reference : (facture.client_snapshot?.reference ?? null);

  // --- Émetteur
  const lignesEmetteur = [
    emetteur.adresse_ligne1,
    emetteur.adresse_ligne2,
    villeComplete(emetteur.code_postal, emetteur.ville),
    rempli(emetteur.pays) && emetteur.pays.trim().toLowerCase() !== "france" ? emetteur.pays : null,
  ].filter(rempli);
  const identifiantsEmetteur = [
    rempli(emetteur.siret) ? `SIRET : ${emetteur.siret}` : rempli(emetteur.siren) ? `SIREN : ${emetteur.siren}` : null,
    rempli(emetteur.rna) ? `RNA : ${emetteur.rna}` : null,
    rempli(emetteur.numero_tva) ? `N° TVA : ${emetteur.numero_tva}` : null,
  ].filter(rempli);
  const contactsEmetteur = [emetteur.email_contact, emetteur.telephone, emetteur.site_web].filter(rempli);

  // --- Client
  const nom = nomClient(client);
  const nomAffiche = !professionnel && rempli(client.civilite) ? `${client.civilite} ${nom}` : nom;
  const contactPro = professionnel ? [client.civilite, client.prenom, client.nom].filter(rempli).join(" ") : "";
  const lignesClient = [
    client.adresse_ligne1,
    client.adresse_ligne2,
    villeComplete(client.code_postal, client.ville),
    rempli(client.pays) && client.pays.trim().toLowerCase() !== "france" ? client.pays : null,
  ].filter(rempli);
  const identifiantsClient = professionnel
    ? [
        rempli(client.siret) ? `SIRET : ${client.siret}` : null,
        rempli(client.numero_tva) ? `N° TVA : ${client.numero_tva}` : null,
      ].filter(rempli)
    : [];
  const nomAcademie = academie?.nom?.trim() ?? "";
  // Facture mensuelle avec arrhes ou réduction motivée : rappel informatif (sans effet sur le total).
  const texteArrhes = texteRappelFacture(facture, client, lignes);

  // --- Pied de page
  const paragraphesPied = [
    tauxTva > 0 ? emetteur.mention_tva : null, // à 0 % la mention figure déjà sous le total
    emetteur.mentions_legales,
    professionnel ? (rempli(emetteur.mentions_professionnels) ? emetteur.mentions_professionnels : MENTION_B2B_DEFAUT) : null,
  ]
    .filter(rempli)
    .map((p) => t(p.trim()));
  const ligneLegale = t(
    [
      emetteur.raison_sociale,
      emetteur.forme_juridique,
      rempli(emetteur.siret) ? `SIRET ${emetteur.siret}` : rempli(emetteur.siren) ? `SIREN ${emetteur.siren}` : null,
      rempli(emetteur.rna) ? `RNA ${emetteur.rna}` : null,
    ]
      .filter(rempli)
      .join(" – "),
  );
  const paddingBas = BAS_PIED + hauteurPied(paragraphesPied, ligneLegale) + 16;

  const titreDocument = brouillon ? "Brouillon de facture" : `Facture ${numero ?? ""}`.trim();
  const libelleAnnee = annuelle ? `Année scolaire ${libelleSaison(facture.saison as number)}` : null;
  const rappelSuite = brouillon ? "Brouillon de facture (suite)" : `Facture ${numero ?? ""} (suite)`;

  // --- Logo
  const styleLogo = dimensionsLogo(logoRatio);

  const filigrane = brouillon ? "BROUILLON" : annulee ? "ANNULÉE" : null;

  return (
    <Document
      title={t(titreDocument)}
      author={t(emetteur.raison_sociale)}
      subject={t(facture.objet ?? titreDocument)}
      creator={t(emetteur.raison_sociale)}
      producer="Facturation Académie Delaveau"
      language="fr-FR"
    >
      <Page size="A4" style={[s.page, { paddingBottom: paddingBas }]}>
        {filigrane && (
          <View fixed style={s.filigraneConteneur}>
            <Text style={[s.filigrane, { color: annulee ? ROUGE : primaire, opacity: annulee ? 0.1 : 0.075 }]}>
              {filigrane}
            </Text>
          </View>
        )}

        <Text fixed style={s.suite} render={({ pageNumber }) => (pageNumber > 1 ? t(rappelSuite) : "")} />

        {/* En-tête : logo, titre, numéro et dates */}
        <View style={s.entete}>
          <View style={s.enteteGauche}>
            {logo ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- composant Image de react-pdf : pas d'attribut alt en PDF
              <Image src={logo} style={styleLogo} />
            ) : null}
          </View>
          <View style={s.enteteDroite}>
            {brouillon ? (
              <>
                <Text style={s.titreBrouillon}>BROUILLON</Text>
                <Text style={s.sousTitreBrouillon}>— non valable comme facture</Text>
              </>
            ) : (
              <Text style={s.titre}>FACTURE</Text>
            )}
            {libelleAnnee && <Text style={s.sousTitreAnnee}>{t(libelleAnnee)}</Text>}
            {!brouillon && <Text style={s.numero}>{t(`N° ${numero ?? ""}`)}</Text>}
            {annuelle && rempli(referenceEleve) && (
              <Text style={s.referenceEleve}>
                <Text style={{ color: DISCRET }}>Réf. élève : </Text>
                <Text style={s.gras}>{t(referenceEleve)}</Text>
              </Text>
            )}
            <View style={s.meta}>
              <View style={s.metaLigne}>
                <Text style={s.metaLibelle}>{brouillon ? "Date (provisoire)" : "Date d'émission"}</Text>
                <Text style={s.metaValeur}>{t(formatDate(dateEmission))}</Text>
              </View>
              {echeancier ? null : (
                <View style={s.metaLigne}>
                  <Text style={s.metaLibelle}>Échéance</Text>
                  <Text style={s.metaValeur}>{t(formatDate(dateEcheance))}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <View style={s.filet} />
        <View style={s.filetFin} />

        {annulee && (
          <View style={s.bandeauAnnulee}>
            <Text style={s.bandeauTitre}>ANNULÉE</Text>
            <View style={s.bandeauCorps}>
              <Text style={s.bandeauTexte}>
                {t(
                  [
                    facture.annulee_le ? `Facture annulée le ${formatDate(facture.annulee_le)}` : "Facture annulée",
                    rempli(facture.motif_annulation) ? `Motif : ${facture.motif_annulation.trim()}` : null,
                  ]
                    .filter(rempli)
                    .join(" – "),
                )}
              </Text>
            </View>
          </View>
        )}

        {/* Émetteur et destinataire */}
        <View style={annuelle ? [s.parties, { marginTop: 12 }] : s.parties}>
          <View style={s.emetteur}>
            <Text style={s.etiquette}>ÉMETTEUR</Text>
            <Text style={s.nomPartie}>{t(emetteur.raison_sociale)}</Text>
            {rempli(emetteur.forme_juridique) && (
              <Text style={s.lignePartieDiscrete}>{t(emetteur.forme_juridique)}</Text>
            )}
            {lignesEmetteur.map((l, i) => (
              <Text key={`e${i}`} style={s.lignePartie}>
                {t(l)}
              </Text>
            ))}
            {identifiantsEmetteur.length > 0 && (
              <Text style={[s.lignePartieDiscrete, { marginTop: 4 }]}>{t(identifiantsEmetteur.join("  ·  "))}</Text>
            )}
            {contactsEmetteur.length > 0 && (
              <Text style={s.lignePartieDiscrete}>{t(contactsEmetteur.join("  ·  "))}</Text>
            )}
          </View>

          <View style={s.destinataire}>
            <Text style={s.etiquette}>FACTURÉ À</Text>
            <Text style={s.nomPartie}>{t(nomAffiche)}</Text>
            {rempli(referenceEleve) && (
              <Text style={[s.referenceClient, { marginTop: 0, marginBottom: 2 }]}>
                <Text style={s.gras}>Réf. élève : </Text>
                {t(referenceEleve)}
              </Text>
            )}
            {rempli(contactPro) && contactPro !== nom && (
              <Text style={s.lignePartieDiscrete}>
                {t(`À l'attention ${/^[aeiouyàâäéèêëîïôöùûüœ]/i.test(contactPro) ? "d'" : "de "}${contactPro}`)}
              </Text>
            )}
            {lignesClient.map((l, i) => (
              <Text key={`c${i}`} style={s.lignePartie}>
                {t(l)}
              </Text>
            ))}
            {identifiantsClient.length > 0 && (
              <Text style={[s.lignePartieDiscrete, { marginTop: 3 }]}>{t(identifiantsClient.join("  ·  "))}</Text>
            )}
            {rempli(client.cavaliers) && (
              <Text style={s.cavaliers}>
                <Text style={s.gras}>Cavalier(s) : </Text>
                {t(client.cavaliers.trim())}
              </Text>
            )}
            {rempli(nomAcademie) && (
              <Text style={[s.academie, rempli(client.cavaliers) ? {} : { marginTop: 5 }]}>{t(nomAcademie)}</Text>
            )}
          </View>
        </View>

        {/* Objet et période — minPresenceAhead : jamais seul en bas de page, sans le début du tableau */}
        <View style={annuelle ? [s.objet, { marginTop: 12 }] : s.objet} minPresenceAhead={70}>
          {rempli(facture.objet) && (
            <View style={[s.objetBloc, { flexShrink: 1 }]}>
              <Text style={s.objetLibelle}>OBJET</Text>
              <Text style={s.objetValeur}>{t(facture.objet.trim())}</Text>
            </View>
          )}
          {facture.periode && (
            <View style={s.objetBloc}>
              <Text style={s.objetLibelle}>PÉRIODE</Text>
              <Text style={s.objetValeur}>{t(formatPeriode(facture.periode))}</Text>
            </View>
          )}
          {annuelle && (
            <View style={s.objetBloc}>
              <Text style={s.objetLibelle}>PÉRIODE</Text>
              <Text style={s.objetValeur}>
                {t(`Septembre ${facture.saison} à juin ${(facture.saison as number) + 1}`)}
              </Text>
            </View>
          )}
          {texteArrhes && (
            <View style={s.arrhes}>
              <Text>{t(texteArrhes)}</Text>
            </View>
          )}
        </View>

        {/* Lignes : l'en-tête (fixed) est répété en haut de chaque page où le tableau continue */}
        <View style={s.tableau}>
          <View style={s.tableauEntete} fixed>
            <Text style={s.colDesignation}>DÉSIGNATION</Text>
            <Text style={s.colQuantite}>QTÉ</Text>
            <Text style={s.colPrix}>{tauxTva > 0 ? "PRIX UNIT. HT" : "PRIX UNITAIRE"}</Text>
            <Text style={s.colTotal}>{tauxTva > 0 ? "TOTAL HT" : "TOTAL"}</Text>
          </View>
          {lignes.length === 0 ? (
            <Text style={s.vide}>Aucune ligne pour le moment.</Text>
          ) : (
            lignes.map((l, i) => (
              <View key={l.id} style={i % 2 === 1 ? [s.ligne, s.ligneAlternee] : s.ligne} wrap={false}>
                <View style={s.colDesignation}>
                  <Text style={s.libelle}>{t(l.libelle)}</Text>
                  {rempli(l.description) && <Text style={s.description}>{t(l.description.trim())}</Text>}
                  {annuelle && texteReductionLigne(l) && <Text style={s.reduction}>{t(texteReductionLigne(l))}</Text>}
                </View>
                <Text style={s.colQuantite}>{t(formatQuantite(l.quantite))}</Text>
                <Text style={s.colPrix}>{formatEurosPdf(l.prix_unitaire_centimes)}</Text>
                <Text style={[s.colTotal, s.gras]}>{formatEurosPdf(l.total_centimes)}</Text>
              </View>
            ))
          )}
        </View>

        {/* Totaux */}
        <View style={s.totaux} wrap={false}>
          <View style={s.totauxBoite}>
            {tauxTva > 0 ? (
              <>
                <View style={s.totalLigne}>
                  <Text style={s.totalLibelle}>Total HT</Text>
                  <Text style={s.totalValeur}>{formatEurosPdf(facture.total_ht_centimes)}</Text>
                </View>
                <View style={s.totalLigne}>
                  <Text style={s.totalLibelle}>{t(`TVA ${formatTaux(tauxTva)}`)}</Text>
                  <Text style={s.totalValeur}>{formatEurosPdf(facture.total_tva_centimes)}</Text>
                </View>
                <View style={s.totalFinal}>
                  <Text style={s.totalFinalLibelle}>TOTAL TTC</Text>
                  <Text style={s.totalFinalValeur}>{formatEurosPdf(facture.total_ttc_centimes)}</Text>
                </View>
              </>
            ) : (
              <>
                <View style={s.totalFinal}>
                  <Text style={s.totalFinalLibelle}>TOTAL</Text>
                  <Text style={s.totalFinalValeur}>{formatEurosPdf(facture.total_ttc_centimes)}</Text>
                </View>
                {rempli(emetteur.mention_tva) && <Text style={s.mentionTva}>{t(emetteur.mention_tva.trim())}</Text>}
              </>
            )}
          </View>
          {echeancier && echeancier.arrhes > 0 && (
            <Text style={s.reste}>
              <Text style={{ color: DISCRET }}>Arrhes versées : </Text>
              <Text style={s.gras}>{formatEurosPdf(echeancier.arrhes)}</Text>
              <Text style={{ color: DISCRET }}>{"  —  Reste à payer : "}</Text>
              <Text style={s.gras}>{formatEurosPdf(echeancier.reste)}</Text>
            </Text>
          )}
        </View>

        {/* Échéancier (facture annuelle) */}
        {echeancier && echeancier.lignes.length > 0 && (
          <View style={s.echeancier} wrap={false}>
            <View style={s.echeancierEntete}>
              <Text style={s.etiquette}>
                {echeancier.previsionnel ? "ÉCHÉANCIER PRÉVISIONNEL" : "ÉCHÉANCIER"}
              </Text>
              <Text style={s.echeancierNote}>
                {t(`${echeancier.lignes.length} échéances · un avis d'échéance chaque mois`)}
              </Text>
            </View>
            <View style={s.echeancierColonnes}>
              {[echeancier.lignes.slice(0, 5), echeancier.lignes.slice(5)].map((colonne, c) => (
                <View key={`col${c}`} style={c === 0 ? s.echeancierColonne : s.echeancierColonneDroite}>
                  <View style={s.echeancierTete}>
                    <Text style={s.colMois}>MOIS</Text>
                    <Text style={s.colDate}>ÉCHÉANCE</Text>
                    <Text style={s.colMontant}>MONTANT</Text>
                  </View>
                  {colonne.map((e) => (
                    <View key={e.periode} style={s.echeancierLigne}>
                      <Text style={s.colMois}>{t(moisCapitalise(e.periode))}</Text>
                      <Text style={s.colDate}>{t(formatDate(e.date_echeance))}</Text>
                      <Text style={[s.colMontant, s.gras]}>{formatEurosPdf(e.montant_centimes)}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Règlement */}
        <View style={annuelle ? [s.reglement, { marginTop: 12, paddingVertical: 8 }] : s.reglement} wrap={false}>
          <Text style={s.etiquette}>RÈGLEMENT</Text>
          <View style={s.reglementColonnes}>
            <View style={s.reglementGauche}>
              {echeancier ? (
                <Text style={s.reglementLigne}>
                  {t(
                    echeancier.lignes.length > 0
                      ? "Paiement selon l'échéancier ci-dessus, sur avis d'échéance mensuel."
                      : "Montant intégralement couvert par les arrhes versées.",
                  )}
                </Text>
              ) : (
                <Text style={s.reglementLigne}>
                  <Text style={s.reglementLibelle}>Échéance : </Text>
                  <Text style={s.gras}>{t(formatDate(dateEcheance))}</Text>
                </Text>
              )}
              {rempli(emetteur.conditions_paiement) && (
                <Text style={s.reglementLigne}>{t(emetteur.conditions_paiement.trim())}</Text>
              )}
              <Text style={s.reference}>
                <Text style={s.reglementLibelle}>Référence à rappeler : </Text>
                <Text style={s.gras}>
                  {t(
                    echeancier && echeancier.lignes.length > 0
                      ? `n° de l'avis (ex. ${rempli(referenceEleve) ? referenceEleve : "E1"}-${echeancier.lignes[0].periode.slice(0, 7)})`
                      : (numero ?? "attribuée à l'émission"),
                  )}
                </Text>
              </Text>
              {payee && facture.payee_le && (
                <Text style={s.acquittee}>
                  {t(
                    `Facture acquittée le ${formatDate(facture.payee_le)}${
                      rempli(facture.mode_paiement) ? ` (${facture.mode_paiement.toLowerCase()})` : ""
                    }.`,
                  )}
                </Text>
              )}
            </View>
            {(rempli(emetteur.iban) || rempli(emetteur.bic) || rempli(emetteur.titulaire_compte)) && (
              <View style={s.reglementDroite}>
                <Text style={[s.reglementLigne, s.reglementLibelle, { fontSize: 7.5, letterSpacing: 0.8 }]}>
                  COORDONNÉES BANCAIRES
                </Text>
                {rempli(emetteur.titulaire_compte) && (
                  <Text style={s.reglementLigne}>
                    <Text style={s.reglementLibelle}>Titulaire : </Text>
                    {t(emetteur.titulaire_compte.trim())}
                  </Text>
                )}
                {rempli(emetteur.iban) && (
                  <Text style={s.reglementLigne}>
                    <Text style={s.reglementLibelle}>IBAN : </Text>
                    <Text style={s.gras}>{t(emetteur.iban.trim())}</Text>
                  </Text>
                )}
                {rempli(emetteur.bic) && (
                  <Text style={s.reglementLigne}>
                    <Text style={s.reglementLibelle}>BIC : </Text>
                    <Text style={s.gras}>{t(emetteur.bic.trim())}</Text>
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>

        {/* Notes imprimées */}
        {rempli(facture.notes) && (
          <View style={s.notes} wrap={false}>
            <Text style={s.etiquette}>NOTES</Text>
            <Text style={s.notesTexte}>{t(facture.notes.trim())}</Text>
          </View>
        )}

        {/* Pied de page (chaque page) */}
        <View fixed style={s.pied}>
          {paragraphesPied.map((p, i) => (
            <Text key={`p${i}`} style={s.piedParagraphe}>
              {p}
            </Text>
          ))}
          <View style={s.piedLegal}>
            <Text style={s.piedLegalTexte}>{ligneLegale}</Text>
          </View>
        </View>
        {/* Numéro de page : élément fixe distinct, aligné sur la dernière ligne du pied */}
        <Text fixed style={s.piedPage} render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
      </Page>
    </Document>
  );
}
