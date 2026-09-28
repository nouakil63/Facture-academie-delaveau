import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { formatDate, formatEurosPdf, formatPeriode, nomClient, sansEspacesSpeciales } from "@/lib/format";
import { arrhesSurSaison, NB_ECHEANCES } from "@/lib/tarifs";
import type { Academie, Client, Echeance, Facture } from "@/lib/types";
import type { EmetteurPdf } from "./FacturePdf";
import {
  A4_HAUTEUR,
  assombrir,
  BAS_PIED,
  couleurValide,
  DISCRET,
  ENCRE,
  FILET,
  hauteurPied,
  INTERLIGNE_PIED,
  LARGEUR_NUMERO_PAGE,
  MARGE_HAUT,
  MARGE_X,
  rempli,
  ROUGE,
  styleLogo,
  t,
  TAILLE_PIED,
  teinte,
  VERT,
  villeComplete,
} from "./outils";

/*
 * Avis d'échéance (A4, même charte que la facture) : document NON FISCAL qui appelle une
 * échéance de la facture annuelle. Il ne porte pas de numéro de facture propre : son numéro
 * (E1-2026-09) est la référence de paiement à rappeler.
 */

export interface ProprietesAvisPdf {
  echeance: Echeance;
  /** Toutes les échéances de la facture annuelle (rappel : déjà réglé, reste dû). */
  echeances: Echeance[];
  facture: Pick<Facture, "numero" | "date_emission" | "total_ttc_centimes" | "saison" | "statut" | "client_snapshot">;
  client: Client;
  emetteur: EmetteurPdf;
  academie: Pick<Academie, "nom"> | null;
  logo: string | null;
  logoRatio?: number;
}

/** Montants du rappel imprimé sur l'avis. */
export interface RappelAvis {
  totalAnnuel: number;
  arrhes: number;
  /** Échéances déjà réglées (hors celle de l'avis). */
  dejaRegle: number;
  /** Reste dû une fois cette échéance réglée. */
  resteApres: number;
}

/** Rappel « Total annuel · Arrhes · Déjà réglé · Reste dû après cette échéance ». */
export function rappelAvis(
  echeance: Pick<Echeance, "id" | "montant_centimes">,
  echeances: Pick<Echeance, "id" | "montant_centimes" | "statut">[],
  totalAnnuel: number,
  arrhes: number,
): RappelAvis {
  const autres = echeances.filter((e) => e.id !== echeance.id && e.statut !== "annulee");
  const dejaRegle = autres.filter((e) => e.statut === "payee").reduce((s, e) => s + e.montant_centimes, 0);
  const resteApres = autres.filter((e) => e.statut !== "payee").reduce((s, e) => s + e.montant_centimes, 0);
  return { totalAnnuel, arrhes, dejaRegle, resteApres };
}

/** Texte du rappel : « Total annuel : … · Arrhes versées : … · Déjà réglé : … · Reste dû après cette échéance : … ». */
export function texteRappelAvis(r: RappelAvis): string {
  return sansEspacesSpeciales(
    [
      `Total annuel : ${formatEurosPdf(r.totalAnnuel)}`,
      r.arrhes > 0 ? `Arrhes versées : ${formatEurosPdf(r.arrhes)}` : null,
      `Déjà réglé : ${formatEurosPdf(r.dejaRegle)}`,
      `Reste dû après cette échéance : ${formatEurosPdf(r.resteApres)}`,
    ]
      .filter(Boolean)
      .join(" · "),
  );
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
    filigraneConteneur: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
    filigrane: { fontFamily: "Helvetica-Bold", fontSize: 80, letterSpacing: 5, transform: "rotate(-38deg)" },

    entete: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    enteteGauche: { width: 200, paddingTop: 2 },
    enteteDroite: { alignItems: "flex-end", maxWidth: 300 },
    titre: { fontFamily: "Helvetica-Bold", fontSize: 22, letterSpacing: 2.5, color: primaire, lineHeight: 1.1 },
    numero: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 4 },
    facture: { fontSize: 8.5, color: DISCRET, marginTop: 2 },
    meta: { marginTop: 9, borderTopWidth: 0.75, borderTopColor: secondaire, paddingTop: 6 },
    metaLigne: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 1.5 },
    metaLibelle: { color: DISCRET, fontSize: 8.5, width: 92, textAlign: "right", marginRight: 10 },
    metaValeur: { fontFamily: "Helvetica-Bold", fontSize: 8.5, width: 72, textAlign: "right" },
    filet: { marginTop: 16, height: 2.5, backgroundColor: primaire },
    filetFin: { height: 0.75, backgroundColor: secondaire, marginTop: 1.5 },

    bandeau: {
      marginTop: 12,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderLeftWidth: 3,
      flexDirection: "row",
      alignItems: "center",
    },
    bandeauTitre: { fontFamily: "Helvetica-Bold", fontSize: 11, letterSpacing: 1.5, marginRight: 12 },
    bandeauTexte: { fontSize: 8.5 },

    parties: { flexDirection: "row", marginTop: 18 },
    emetteur: { flex: 1, paddingRight: 18, paddingTop: 10 },
    destinataire: {
      flex: 1,
      backgroundColor: fondDoux,
      borderLeftWidth: 2.5,
      borderLeftColor: primaire,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    etiquette: { fontFamily: "Helvetica-Bold", fontSize: 7.5, letterSpacing: 1.2, color: primaire, marginBottom: 4 },
    nomPartie: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginBottom: 1.5 },
    lignePartie: { fontSize: 8.5 },
    lignePartieDiscrete: { fontSize: 8, color: DISCRET },
    cavaliers: { fontSize: 8.5, marginTop: 5 },
    academie: { fontSize: 7.5, color: DISCRET, marginTop: 2, letterSpacing: 0.3 },
    gras: { fontFamily: "Helvetica-Bold" },

    // Montant à payer
    appel: {
      marginTop: 22,
      flexDirection: "row",
      borderWidth: 0.75,
      borderColor: secondaire,
      borderLeftWidth: 3,
      borderLeftColor: primaire,
    },
    appelGauche: { flex: 1.3, paddingVertical: 14, paddingHorizontal: 14 },
    appelDroite: {
      flex: 1,
      paddingVertical: 14,
      paddingHorizontal: 14,
      backgroundColor: fond,
      alignItems: "flex-end",
      justifyContent: "center",
    },
    appelTitre: { fontFamily: "Helvetica-Bold", fontSize: 12, color: ENCRE },
    appelDetail: { fontSize: 8.5, color: DISCRET, marginTop: 3 },
    appelLibelle: { fontFamily: "Helvetica-Bold", fontSize: 7.5, letterSpacing: 1.2, color: primaire },
    appelMontant: { fontFamily: "Helvetica-Bold", fontSize: 26, color: primaire, marginTop: 2, lineHeight: 1.15 },
    appelLimite: { fontSize: 9, marginTop: 3 },

    rappel: {
      marginTop: 10,
      paddingVertical: 5,
      paddingHorizontal: 8,
      borderLeftWidth: 2,
      borderLeftColor: primaire,
      backgroundColor: teinte(primaire, 0.06),
      fontSize: 8.2,
      color: DISCRET,
    },

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
      paddingVertical: 4,
      paddingHorizontal: 8,
      fontSize: 9.5,
    },
    reglee: { marginTop: 6, fontSize: 8.5, color: VERT, fontFamily: "Helvetica-Bold" },

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
    piedNonFiscal: {
      fontSize: 7.2,
      lineHeight: INTERLIGNE_PIED,
      color: ENCRE,
      fontFamily: "Helvetica-Bold",
      marginBottom: 2.5,
    },
    piedLegal: { marginTop: 1, paddingRight: LARGEUR_NUMERO_PAGE + 8 },
    piedLegalTexte: { fontSize: 7.2, lineHeight: INTERLIGNE_PIED, color: assombrir(primaire, 0.15), fontFamily: "Helvetica-Bold" },
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

/** Construit le document PDF d'un avis d'échéance (fonction pure, appelée directement). */
export function AvisEcheancePdf({
  echeance,
  echeances,
  facture,
  client,
  emetteur,
  academie,
  logo,
  logoRatio,
}: ProprietesAvisPdf): ReactElement<DocumentProps> {
  const primaire = couleurValide(emetteur.couleur_primaire, "#0050A0");
  const secondaire = couleurValide(emetteur.couleur_secondaire, "#DADADA");
  const s = creerStyles(primaire, secondaire);

  const annule = echeance.statut === "annulee";
  const paye = echeance.statut === "payee";
  const saison = facture.saison ?? Number(echeance.periode.slice(0, 4));
  const nbEcheances = Math.max(NB_ECHEANCES, echeances.length);
  const numeroFacture = facture.numero ?? "";
  const reference = facture.client_snapshot?.reference ?? client.reference;

  // Arrhes figées à l'émission de la facture annuelle.
  const snapshot = facture.client_snapshot;
  const arrhes = snapshot
    ? arrhesSurSaison(
        {
          arrhes_reglees: snapshot.arrhes_reglees ?? false,
          arrhes_centimes: snapshot.arrhes_centimes ?? null,
          arrhes_saison: snapshot.arrhes_saison ?? null,
        },
        saison,
      )
    : 0;
  const rappel = rappelAvis(echeance, echeances, Number(facture.total_ttc_centimes), arrhes);

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
  ].filter(rempli);
  const contactsEmetteur = [emetteur.email_contact, emetteur.telephone, emetteur.site_web].filter(rempli);

  // --- Élève / famille
  const professionnel = client.type === "professionnel";
  const nom = nomClient(client);
  const nomAffiche = !professionnel && rempli(client.civilite) ? `${client.civilite} ${nom}` : nom;
  const lignesClient = [
    client.adresse_ligne1,
    client.adresse_ligne2,
    villeComplete(client.code_postal, client.ville),
    rempli(client.pays) && client.pays.trim().toLowerCase() !== "france" ? client.pays : null,
  ].filter(rempli);
  const nomAcademie = academie?.nom?.trim() ?? "";

  // --- Pied
  const mentionNonFiscale = t(
    `Document non fiscal — la facture est la facture annuelle n° ${numeroFacture}${
      facture.date_emission ? ` du ${formatDate(facture.date_emission)}` : ""
    }.`,
  );
  const paragraphesPied = [emetteur.mentions_legales].filter(rempli).map((p) => t(p.trim()));
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
  const paddingBas = BAS_PIED + hauteurPied([mentionNonFiscale, ...paragraphesPied], ligneLegale) + 16;

  const mois = formatPeriode(echeance.periode);
  const titreDocument = `Avis d'échéance ${echeance.numero_avis}`;

  return (
    <Document
      title={t(titreDocument)}
      author={t(emetteur.raison_sociale)}
      subject={t(`Échéance de ${mois} – facture ${numeroFacture}`)}
      creator={t(emetteur.raison_sociale)}
      producer="Facturation Académie Delaveau"
      language="fr-FR"
    >
      <Page size="A4" style={[s.page, { paddingBottom: paddingBas }]}>
        {annule && (
          <View fixed style={s.filigraneConteneur}>
            <Text style={[s.filigrane, { color: ROUGE, opacity: 0.1 }]}>ANNULÉ</Text>
          </View>
        )}

        {/* En-tête */}
        <View style={s.entete}>
          <View style={s.enteteGauche}>
            {logo ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- composant Image de react-pdf : pas d'attribut alt en PDF
              <Image src={logo} style={styleLogo(logoRatio)} />
            ) : null}
          </View>
          <View style={s.enteteDroite}>
            <Text style={s.titre}>AVIS D&apos;ÉCHÉANCE</Text>
            <Text style={s.numero}>{t(`N° ${echeance.numero_avis}`)}</Text>
            <Text style={s.facture}>
              {t(
                `Facture n° ${numeroFacture}${facture.date_emission ? ` du ${formatDate(facture.date_emission)}` : ""}`,
              )}
            </Text>
            <View style={s.meta}>
              <View style={s.metaLigne}>
                <Text style={s.metaLibelle}>Réf. élève</Text>
                <Text style={s.metaValeur}>{t(reference)}</Text>
              </View>
              <View style={s.metaLigne}>
                <Text style={s.metaLibelle}>Date limite</Text>
                <Text style={s.metaValeur}>{t(formatDate(echeance.date_echeance))}</Text>
              </View>
            </View>
          </View>
        </View>
        <View style={s.filet} />
        <View style={s.filetFin} />

        {annule && (
          <View style={[s.bandeau, { backgroundColor: "#FDECEA", borderLeftColor: ROUGE }]}>
            <Text style={[s.bandeauTitre, { color: ROUGE }]}>ANNULÉ</Text>
            <Text style={[s.bandeauTexte, { color: "#7A271A" }]}>
              {t(`Échéance annulée avec la facture n° ${numeroFacture} : rien à régler.`)}
            </Text>
          </View>
        )}

        {/* Émetteur et élève */}
        <View style={s.parties}>
          <View style={s.emetteur}>
            <Text style={s.etiquette}>ÉMETTEUR</Text>
            <Text style={s.nomPartie}>{t(emetteur.raison_sociale)}</Text>
            {rempli(emetteur.forme_juridique) && <Text style={s.lignePartieDiscrete}>{t(emetteur.forme_juridique)}</Text>}
            {lignesEmetteur.map((l, i) => (
              <Text key={`e${i}`} style={s.lignePartie}>
                {t(l)}
              </Text>
            ))}
            {identifiantsEmetteur.length > 0 && (
              <Text style={[s.lignePartieDiscrete, { marginTop: 4 }]}>{t(identifiantsEmetteur.join("  ·  "))}</Text>
            )}
            {contactsEmetteur.length > 0 && <Text style={s.lignePartieDiscrete}>{t(contactsEmetteur.join("  ·  "))}</Text>}
          </View>

          <View style={s.destinataire}>
            <Text style={s.etiquette}>ÉLÈVE / FAMILLE</Text>
            <Text style={s.nomPartie}>{t(nomAffiche)}</Text>
            <Text style={[s.lignePartie, { marginBottom: 2 }]}>
              <Text style={s.gras}>Réf. élève : </Text>
              {t(reference)}
            </Text>
            {lignesClient.map((l, i) => (
              <Text key={`c${i}`} style={s.lignePartie}>
                {t(l)}
              </Text>
            ))}
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

        {/* Montant à payer */}
        <View style={s.appel} wrap={false}>
          <View style={s.appelGauche}>
            <Text style={s.appelTitre}>{t(`Échéance de ${mois} (${echeance.rang}/${nbEcheances})`)}</Text>
            <Text style={s.appelDetail}>
              {t(`Année scolaire ${saison}-${saison + 1} · facture annuelle n° ${numeroFacture}`)}
            </Text>
          </View>
          <View style={s.appelDroite}>
            <Text style={s.appelLibelle}>{annule ? "ÉCHÉANCE ANNULÉE" : paye ? "MONTANT RÉGLÉ" : "MONTANT À PAYER"}</Text>
            <Text style={s.appelMontant}>{formatEurosPdf(echeance.montant_centimes)}</Text>
            <Text style={s.appelLimite}>
              <Text style={{ color: DISCRET }}>avant le </Text>
              <Text style={s.gras}>{t(formatDate(echeance.date_echeance))}</Text>
            </Text>
          </View>
        </View>

        <View style={s.rappel}>
          <Text>{t(texteRappelAvis(rappel))}</Text>
        </View>

        {/* Règlement */}
        <View style={s.reglement} wrap={false}>
          <Text style={s.etiquette}>RÈGLEMENT</Text>
          <View style={s.reglementColonnes}>
            <View style={s.reglementGauche}>
              <Text style={s.reglementLigne}>
                <Text style={s.reglementLibelle}>Date limite : </Text>
                <Text style={s.gras}>{t(formatDate(echeance.date_echeance))}</Text>
              </Text>
              {rempli(emetteur.conditions_paiement) && (
                <Text style={s.reglementLigne}>{t(emetteur.conditions_paiement.trim())}</Text>
              )}
              <Text style={s.reference}>
                <Text style={s.reglementLibelle}>Référence à rappeler : </Text>
                <Text style={s.gras}>{t(echeance.numero_avis)}</Text>
              </Text>
              {paye && echeance.payee_le && (
                <Text style={s.reglee}>
                  {t(
                    `Échéance réglée le ${formatDate(echeance.payee_le)}${
                      rempli(echeance.mode_paiement) ? ` (${echeance.mode_paiement.toLowerCase()})` : ""
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

        {/* Pied de page */}
        <View fixed style={s.pied}>
          <Text style={s.piedNonFiscal}>{mentionNonFiscale}</Text>
          {paragraphesPied.map((p, i) => (
            <Text key={`p${i}`} style={s.piedParagraphe}>
              {p}
            </Text>
          ))}
          <View style={s.piedLegal}>
            <Text style={s.piedLegalTexte}>{ligneLegale}</Text>
          </View>
        </View>
        <Text fixed style={s.piedPage} render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
      </Page>
    </Document>
  );
}
