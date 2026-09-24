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
import type { Client, Entite, Facture, LigneFacture } from "@/lib/types";

/*
 * Mise en page A4 d'une facture (@react-pdf/renderer, police Helvetica intégrée au PDF).
 *
 * Helvetica (police standard du PDF, encodage WinAnsi) ne connaît pas certains caractères
 * Unicode — notamment l'espace fine insécable U+202F produite par Intl pour les montants.
 * Tout texte affiché passe donc par `t()` (→ sansEspacesSpeciales) ou formatEurosPdf.
 */

/** Informations de la structure émettrice imprimées sur la facture. */
export type EmetteurPdf = Pick<
  Entite,
  | "raison_sociale"
  | "forme_juridique"
  | "adresse_ligne1"
  | "adresse_ligne2"
  | "code_postal"
  | "ville"
  | "pays"
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
>;

export interface ProprietesFacturePdf {
  facture: Facture;
  lignes: LigneFacture[];
  client: Client;
  emetteur: EmetteurPdf;
  /** Logo : data URI ou URL http(s) ; null → pas de logo. */
  logo: string | null;
  /** Proportions connues du logo (largeur / hauteur) ; absent → logo ajusté dans un cadre. */
  logoRatio?: number;
}

// Pas de césure automatique : react-pdf applique des règles anglaises (« vétéri-naire »).
Font.registerHyphenationCallback((mot) => [mot]);

// -----------------------------------------------------------------------------
// Outils de texte et de couleur
// -----------------------------------------------------------------------------

/** Texte compatible Helvetica/WinAnsi : espaces spéciales → espace simple, caractères invisibles retirés. */
function t(valeur: string | number | null | undefined): string {
  if (valeur == null) return "";
  return sansEspacesSpeciales(String(valeur))
    .replace(/[ -   　]/g, " ")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/[‐‑−]/g, "-")
    .replace(/\r\n?/g, "\n");
}

function rempli(valeur: string | null | undefined): valeur is string {
  return valeur != null && valeur.trim() !== "";
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

function couleurValide(couleur: string | null | undefined, defaut: string): string {
  return couleur && HEX.test(couleur) ? couleur : defaut;
}

/** Mélange une couleur avec du blanc : proportion 0 → blanc, 1 → couleur d'origine. */
function teinte(hex: string, proportion: number): string {
  const canaux = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${canaux
    .map((c) => Math.round(255 + (c - 255) * proportion))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Assombrit une couleur : proportion 0 → couleur d'origine, 1 → noir. */
function assombrir(hex: string, proportion: number): string {
  const canaux = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${canaux
    .map((c) => Math.round(c * (1 - proportion)))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** "2026-09-24" + 30 → "2026-10-24". */
function ajouterJours(dateIso: string, jours: number): string {
  const [a, m, j] = dateIso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j + jours)).toISOString().slice(0, 10);
}

/** « FR7612345… » → « FR76 1234 5… » */
function formatIban(iban: string): string {
  return iban
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, "$1 ");
}

function formatTaux(taux: number): string {
  return `${formatQuantite(taux)} %`;
}

function villeComplete(codePostal: string | null, ville: string | null): string {
  return [codePostal, ville].filter(rempli).join(" ");
}

// -----------------------------------------------------------------------------
// Mise en page
// -----------------------------------------------------------------------------

const A4_LARGEUR = 595.28;
const MARGE_X = 42;
const MARGE_HAUT = 38;
const LARGEUR_UTILE = A4_LARGEUR - 2 * MARGE_X;
const BAS_PIED = 22;
const TAILLE_PIED = 6.8;
const INTERLIGNE_PIED = 1.4;
const LARGEUR_NUMERO_PAGE = 34;

const ENCRE = "#1C2430";
const DISCRET = "#5B6573";
const FILET = "#E3E7ED";
const ROUGE = "#B42318";

/**
 * Hauteur (en points) réservée au pied de page fixe. Estimation prudente (largeur moyenne
 * d'un caractère Helvetica ≈ 0,5 em ; on compte 0,55 em) : mieux vaut un peu de marge
 * qu'un chevauchement du contenu.
 */
function hauteurPied(paragraphes: string[], ligneLegale: string): number {
  const hauteurLigne = TAILLE_PIED * INTERLIGNE_PIED;
  const caracteresParLigne = Math.floor(LARGEUR_UTILE / (TAILLE_PIED * 0.55));
  const lignes = (texte: string, largeurCar: number) =>
    texte.split("\n").reduce((n, para) => n + Math.max(1, Math.ceil(para.length / largeurCar)), 0);

  let hauteur = 9; // filet + marge haute
  for (const p of paragraphes) hauteur += lignes(p, caracteresParLigne) * hauteurLigne + 2.5;
  hauteur += lignes(ligneLegale, Math.floor((LARGEUR_UTILE - LARGEUR_NUMERO_PAGE - 8) / (7.2 * 0.6))) * (7.2 * INTERLIGNE_PIED) + 3;
  return hauteur;
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
      fontSize: 92,
      letterSpacing: 8,
      transform: "rotate(-35deg)",
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
    emetteur: { flex: 1, paddingRight: 18 },
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
    gras: { fontFamily: "Helvetica-Bold" },

    // Objet et période
    objet: {
      marginTop: 18,
      marginBottom: 10,
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "flex-end",
    },
    objetBloc: { marginRight: 26, marginBottom: 2 },
    objetLibelle: { fontSize: 7.5, color: DISCRET, letterSpacing: 0.8 },
    objetValeur: { fontFamily: "Helvetica-Bold", fontSize: 10 },

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
      paddingVertical: 6.5,
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
    acquittee: { marginTop: 6, fontSize: 8.5, color: "#067647", fontFamily: "Helvetica-Bold" },

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
    piedPage: {
      position: "absolute",
      right: MARGE_X,
      bottom: BAS_PIED,
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
  logo,
  logoRatio,
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

  // --- Émetteur
  const lignesEmetteur = [
    emetteur.adresse_ligne1,
    emetteur.adresse_ligne2,
    villeComplete(emetteur.code_postal, emetteur.ville),
    rempli(emetteur.pays) && emetteur.pays.trim().toLowerCase() !== "france" ? emetteur.pays : null,
  ].filter(rempli);
  const identifiantsEmetteur = [
    rempli(emetteur.siret) ? `SIRET : ${emetteur.siret}` : null,
    rempli(emetteur.rna) ? `RNA : ${emetteur.rna}` : null,
    rempli(emetteur.numero_tva) ? `N° TVA : ${emetteur.numero_tva}` : null,
  ].filter(rempli);
  const contactsEmetteur = [emetteur.email_contact, emetteur.telephone, emetteur.site_web].filter(rempli);

  // --- Client
  const nom = nomClient(client);
  const nomAffiche = !professionnel && rempli(client.civilite) ? `${client.civilite} ${nom}` : nom;
  const contactPro = professionnel
    ? [client.civilite, client.prenom, client.nom].filter(rempli).join(" ")
    : "";
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

  // --- Pied de page
  const paragraphesPied = [
    tauxTva > 0 ? emetteur.mention_tva : null, // à 0 % la mention figure déjà sous le total
    emetteur.mentions_legales,
    professionnel ? emetteur.mentions_professionnels : null,
  ]
    .filter(rempli)
    .map((p) => t(p.trim()));
  const ligneLegale = t(
    [
      emetteur.raison_sociale,
      emetteur.forme_juridique,
      rempli(emetteur.siret) ? `SIRET ${emetteur.siret}` : null,
      rempli(emetteur.rna) ? `RNA ${emetteur.rna}` : null,
    ]
      .filter(rempli)
      .join(" – "),
  );
  const paddingBas = BAS_PIED + hauteurPied(paragraphesPied, ligneLegale) + 16;

  const titreDocument = brouillon ? "Brouillon de facture" : `Facture ${numero ?? ""}`.trim();
  const rappelSuite = brouillon ? "Brouillon de facture (suite)" : `Facture ${numero ?? ""} (suite)`;

  // --- Logo
  const styleLogo = logoRatio
    ? { width: 150, height: 150 / logoRatio }
    : { width: 170, height: 62, objectFit: "contain" as const, objectPositionX: 0 };

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
            <Text
              style={[
                s.filigrane,
                { color: annulee ? ROUGE : primaire, opacity: annulee ? 0.1 : 0.075 },
              ]}
            >
              {filigrane}
            </Text>
          </View>
        )}

        <Text fixed style={s.suite} render={({ pageNumber }) => (pageNumber > 1 ? t(rappelSuite) : "")} />

        {/* En-tête : logo, titre, numéro et dates */}
        <View style={s.entete}>
          <View style={s.enteteGauche}>{logo ? <Image src={logo} style={styleLogo} /> : null}</View>
          <View style={s.enteteDroite}>
            {brouillon ? (
              <>
                <Text style={s.titreBrouillon}>BROUILLON</Text>
                <Text style={s.sousTitreBrouillon}>— non valable comme facture</Text>
              </>
            ) : (
              <>
                <Text style={s.titre}>FACTURE</Text>
                <Text style={s.numero}>{t(`N° ${numero ?? ""}`)}</Text>
              </>
            )}
            <View style={s.meta}>
              <View style={s.metaLigne}>
                <Text style={s.metaLibelle}>{brouillon ? "Date (provisoire)" : "Date d'émission"}</Text>
                <Text style={s.metaValeur}>{t(formatDate(dateEmission))}</Text>
              </View>
              <View style={s.metaLigne}>
                <Text style={s.metaLibelle}>Échéance</Text>
                <Text style={s.metaValeur}>{t(formatDate(dateEcheance))}</Text>
              </View>
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
        <View style={s.parties}>
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
            {rempli(contactPro) && contactPro !== nom && (
              <Text style={s.lignePartieDiscrete}>{t(`À l'attention de ${contactPro}`)}</Text>
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
          </View>
        </View>

        {/* Objet et période — minPresenceAhead : jamais seul en bas de page, sans le début du tableau */}
        <View style={s.objet} minPresenceAhead={70}>
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
        </View>

        {/* Lignes : l'en-tête (fixed) est répété en haut de chaque page où le tableau continue */}
        <View style={s.tableau}>
          <View style={s.tableauEntete} fixed>
            <Text style={s.colDesignation}>DÉSIGNATION</Text>
            <Text style={s.colQuantite}>QTÉ</Text>
            <Text style={s.colPrix}>PRIX UNITAIRE</Text>
            <Text style={s.colTotal}>TOTAL</Text>
          </View>
          {lignes.length === 0 ? (
            <Text style={s.vide}>Aucune ligne pour le moment.</Text>
          ) : (
            lignes.map((l, i) => (
              <View key={l.id} style={i % 2 === 1 ? [s.ligne, s.ligneAlternee] : s.ligne} wrap={false}>
                <View style={s.colDesignation}>
                  <Text style={s.libelle}>{t(l.libelle)}</Text>
                  {rempli(l.description) && <Text style={s.description}>{t(l.description.trim())}</Text>}
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
        </View>

        {/* Règlement */}
        <View style={s.reglement} wrap={false}>
          <Text style={s.etiquette}>RÈGLEMENT</Text>
          <View style={s.reglementColonnes}>
            <View style={s.reglementGauche}>
              <Text style={s.reglementLigne}>
                <Text style={s.reglementLibelle}>Échéance : </Text>
                <Text style={s.gras}>{t(formatDate(dateEcheance))}</Text>
              </Text>
              {rempli(emetteur.conditions_paiement) && (
                <Text style={s.reglementLigne}>{t(emetteur.conditions_paiement.trim())}</Text>
              )}
              <Text style={s.reference}>
                <Text style={s.reglementLibelle}>Référence à rappeler : </Text>
                <Text style={s.gras}>{t(numero ?? "attribuée à l'émission")}</Text>
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
                    <Text style={s.gras}>{t(formatIban(emetteur.iban))}</Text>
                  </Text>
                )}
                {rempli(emetteur.bic) && (
                  <Text style={s.reglementLigne}>
                    <Text style={s.reglementLibelle}>BIC : </Text>
                    <Text style={s.gras}>{t(emetteur.bic.replace(/\s+/g, "").toUpperCase())}</Text>
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
        {/* Numéro de page : élément fixe distinct (un texte dynamique imbriqué est mal positionné) */}
        <Text fixed style={s.piedPage} render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
      </Page>
    </Document>
  );
}
