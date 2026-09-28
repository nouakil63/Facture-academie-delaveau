import { aujourdhuiParis, premierDuMois } from "@/lib/format";
import type { Client, Prestation, TarifClient } from "@/lib/types";

/**
 * Calculs purs sur les tarifs clients, utilisables partout (pages serveur,
 * composants client, Server Actions, tâche planifiée, tests).
 * Ils reproduisent EXACTEMENT la base de données :
 *   prix  = coalesce(tarif.prix_unitaire_centimes, prestation.prix_unitaire_centimes)
 *   ligne = round(quantite × prix)          (arrondi « au plus loin de zéro » de Postgres ;
 *                                            même formule que lignes_facture.total_centimes)
 *   retenu (generer_brouillons_mensuels) si tarif actif, récurrent,
 *   date_debut ≤ dernier jour du mois et date_fin ≥ premier jour du mois.
 *   arrhes (deductionArrhes, mensuelDetaille) : même règle que public.deduction_arrhes et
 *   la déduction appliquée par generer_brouillons_mensuels (migration 20260929000000).
 * Le catalogue de prestations est commun aux deux académies.
 * Voir tests/tarifs.test.ts (comparaison directe avec Postgres).
 */

/** Prestation du catalogue jointe à un tarif (null pour une ligne libre). */
export type PrestationDuTarif = Pick<
  Prestation,
  "id" | "libelle" | "description" | "prix_unitaire_centimes" | "unite" | "recurrente" | "actif"
>;

export type TarifAvecPrestation = TarifClient & { prestation: PrestationDuTarif | null };

/**
 * Champs nécessaires au calcul du montant mensuel. `ordre` et `created_at` (facultatifs)
 * départagent, comme en base, les lignes candidates à la déduction des arrhes ; sans eux,
 * l'ordre du tableau fait foi.
 */
export type TarifPourCalcul = Pick<
  TarifClient,
  "prix_unitaire_centimes" | "quantite" | "recurrent" | "actif" | "date_debut" | "date_fin"
> &
  Partial<Pick<TarifClient, "ordre" | "created_at">> & { prestation: Pick<Prestation, "prix_unitaire_centimes"> | null };

/** Sélection PostgREST des champs de TarifPourCalcul (à placer dans un `select` sur tarifs_clients). */
export const CHAMPS_TARIF_POUR_CALCUL =
  "prix_unitaire_centimes, quantite, recurrent, actif, date_debut, date_fin, ordre, created_at, prestation:prestations(prix_unitaire_centimes)";

/** Champs d'un client utiles au calcul des arrhes. */
export type ArrhesClient = Pick<Client, "arrhes_reglees" | "arrhes_centimes" | "arrhes_saison">;

/** Prix unitaire appliqué : prix personnalisé, sinon prix catalogue (null si aucun). */
export function prixApplique(
  t: Pick<TarifClient, "prix_unitaire_centimes"> & { prestation: Pick<Prestation, "prix_unitaire_centimes"> | null },
): number | null {
  return t.prix_unitaire_centimes ?? t.prestation?.prix_unitaire_centimes ?? null;
}

/**
 * Total d'une ligne en centimes : round(quantite × prix), calculé en entiers
 * (quantité ramenée à 2 décimales, comme la colonne numeric(10,2)) pour éviter
 * toute erreur d'arrondi flottant. Exact tant que |quantité × 100 × prix| < 2^53,
 * c'est-à-dire bien au-delà de ce qu'accepte la base (total en `integer`).
 */
export function totalLigneCentimes(quantite: number | string, prixCentimes: number): number {
  const centiemes = Math.round(Number(quantite) * 100);
  const produit = Math.abs(centiemes * prixCentimes); // en centièmes de centime
  const arrondi = (produit + 50 - ((produit + 50) % 100)) / 100;
  return centiemes * prixCentimes < 0 ? -arrondi : arrondi;
}

/** Bornes du mois contenant `periode` : premier jour et premier jour du mois suivant. */
export function bornesMois(periode: string = premierDuMois()): { debut: string; suivant: string } {
  return { debut: premierDuMois(periode), suivant: premierDuMois(periode, 1) };
}

/** Situation d'un tarif par rapport au mois : « a_venir », « termine » ou « en_cours ». */
export function situationSurMois(
  t: Pick<TarifClient, "date_debut" | "date_fin">,
  periode?: string,
): "a_venir" | "termine" | "en_cours" {
  const { debut, suivant } = bornesMois(periode);
  if (t.date_debut && t.date_debut.slice(0, 10) >= suivant) return "a_venir";
  if (t.date_fin && t.date_fin.slice(0, 10) < debut) return "termine";
  return "en_cours";
}

/** Le tarif est-il repris dans la facture mensuelle du mois de `periode` ? */
export function tarifFactureSurMois(t: TarifPourCalcul, periode?: string): boolean {
  return t.actif && t.recurrent && situationSurMois(t, periode) === "en_cours";
}

/** Montant mensuel estimé (HT, centimes) : somme des lignes facturées sur le mois. */
export function mensuelEstime(tarifs: TarifPourCalcul[], periode?: string): number {
  return tarifs
    .filter((t) => tarifFactureSurMois(t, periode))
    .reduce((somme, t) => somme + totalLigneCentimes(t.quantite, prixApplique(t) ?? 0), 0);
}

// -----------------------------------------------------------------------------
// Arrhes (même règle exacte que public.deduction_arrhes et generer_brouillons_mensuels)
// -----------------------------------------------------------------------------

/** Saison en cours à une date ("AAAA-MM-JJ", Paris) : année courante à partir de juillet, sinon année − 1. */
export function saisonEnCours(date: string = aujourdhuiParis()): number {
  const [a, m] = date.split("-").map(Number);
  return m >= 7 ? a : a - 1;
}

/** Saison 2026 → « 2026-2027 ». */
export function libelleSaison(saison: number): string {
  return `${saison}-${saison + 1}`;
}

/**
 * Déduction des arrhes (centimes, ≥ 0) sur la facture mensuelle du mois de `periode` :
 * floor(arrhes / 10) de septembre à mai, le reste en juin (arrhes − 9 × floor(arrhes / 10)),
 * 0 hors saison (juillet, août, autre saison), si les arrhes ne sont pas réglées ou nulles.
 */
export function deductionArrhes(client: ArrhesClient, periode: string = premierDuMois()): number {
  const montant = client.arrhes_centimes ?? 0;
  if (!client.arrhes_reglees || montant <= 0 || client.arrhes_saison == null) return 0;
  const debut = premierDuMois(periode);
  const saison = client.arrhes_saison;
  const premier = `${String(saison).padStart(4, "0")}-09-01`;
  const dernier = `${String(saison + 1).padStart(4, "0")}-06-01`;
  if (debut < premier || debut > dernier) return 0;
  const mensuelle = Math.floor(montant / 10);
  return debut.slice(5, 7) === "06" ? montant - 9 * mensuelle : mensuelle;
}

/** Mensualité type des arrhes (septembre → mai) : floor(arrhes / 10). */
export function mensualiteArrhes(arrhesCentimes: number): number {
  return Math.floor(Math.max(0, arrhesCentimes) / 10);
}

/**
 * Index (dans `tarifs`) de la ligne qui absorbe la déduction sur le mois de `periode` :
 * parmi les lignes facturées ce mois-ci de quantité 1, celle de plus grand total (égalité :
 * la première dans l'ordre des lignes — `ordre`, puis `created_at`, puis ordre du tableau),
 * si son prix est ≥ `deduction`. null si aucune ligne ne convient (ou déduction nulle).
 */
export function ligneDeductionArrhes(tarifs: TarifPourCalcul[], deduction: number, periode?: string): number | null {
  if (deduction <= 0) return null;
  const candidates = tarifs
    .map((t, index) => ({ t, index, prix: prixApplique(t) ?? 0 }))
    .filter(({ t }) => tarifFactureSurMois(t, periode) && Number(t.quantite) === 1)
    .sort(
      (a, b) =>
        b.prix - a.prix ||
        (a.t.ordre ?? 0) - (b.t.ordre ?? 0) ||
        (a.t.created_at ?? "").localeCompare(b.t.created_at ?? "") ||
        a.index - b.index,
    );
  const meilleure = candidates[0];
  return meilleure && meilleure.prix >= deduction ? meilleure.index : null;
}

/** Détail de la facture mensuelle d'un client sur un mois, arrhes comprises (HT, centimes). */
export interface MensuelDetaille {
  /** Somme des lignes, sans les arrhes. */
  brut: number;
  /** Déduction prévue pour ce mois (0 hors saison ou sans arrhes réglées). */
  deduction: number;
  /** Déduction réellement appliquée (0 si aucune ligne de quantité 1 ne peut l'absorber). */
  appliquee: number;
  /** Montant facturé : brut − appliquée (identique à generer_brouillons_mensuels). */
  net: number;
  /** Déduction prévue mais impossible : aucune ligne de quantité 1 de prix suffisant. */
  nonAppliquee: boolean;
  /** Index de la ligne qui porte la déduction (null si aucune). */
  ligne: number | null;
}

export function mensuelDetaille(tarifs: TarifPourCalcul[], client: ArrhesClient, periode?: string): MensuelDetaille {
  const brut = mensuelEstime(tarifs, periode);
  const deduction = deductionArrhes(client, periode);
  const ligne = ligneDeductionArrhes(tarifs, deduction, periode);
  const appliquee = ligne === null ? 0 : deduction;
  return { brut, deduction, appliquee, net: brut - appliquee, nonAppliquee: deduction > 0 && ligne === null, ligne };
}

/** Montant mensuel net estimé (HT, centimes) : lignes du mois moins la déduction des arrhes appliquée. */
export function mensuelNet(tarifs: TarifPourCalcul[], client: ArrhesClient, periode?: string): number {
  return mensuelDetaille(tarifs, client, periode).net;
}

/**
 * Saisie d'une quantité : « 1 », « 2,5 », « 0.75 ». Strictement positive,
 * 2 décimales au plus, inférieure à 100 000. Retourne null si invalide.
 */
export function parseQuantite(saisie: string | null | undefined): number | null {
  if (saisie == null) return null;
  const nettoye = String(saisie).replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{0,2})?$/.test(nettoye)) return null;
  const q = Number(nettoye);
  return q > 0 && q < 100000 ? q : null;
}

/** Quantité → valeur d'un champ de saisie : 2.5 → « 2,5 ». */
export function quantiteVersSaisie(q: number | string | null | undefined): string {
  if (q == null || q === "") return "1";
  return String(Number(q)).replace(".", ",");
}

// -----------------------------------------------------------------------------
// Année scolaire : facture annuelle et échéances (même règle exacte que
// generer_factures_annuelles et emettre_facture, migration 20260930000000)
// -----------------------------------------------------------------------------

/** Nombre d'échéances d'une saison (septembre → juin). */
export const NB_ECHEANCES = 10;

/** Les 10 mois d'une saison : 2026 → "2026-09-01", "2026-10-01" … "2027-06-01". */
export function moisSaison(saison: number): string[] {
  return Array.from({ length: NB_ECHEANCES }, (_, k) => premierDuMois(`${saison}-09-01`, k));
}

/** Saison d'un mois : septembre → décembre : l'année ; janvier → août : l'année précédente. */
export function saisonDePeriode(periode: string): number {
  const [a, m] = periode.split("-").map(Number);
  return m >= 9 ? a : a - 1;
}

/** Mois d'échéance (septembre à juin) ? Juillet et août : non. */
export function moisAvecEcheance(periode: string): boolean {
  return !["07", "08"].includes(periode.slice(5, 7));
}

/** Nombre de mois de la saison (0 à 10) sur lesquels le tarif est facturé (actif, récurrent, dates). */
export function nbMoisSurSaison(t: TarifPourCalcul, saison: number): number {
  if (!t.actif || !t.recurrent) return 0;
  return moisSaison(saison).filter((m) => situationSurMois(t, m) === "en_cours").length;
}

/** Prix unitaire annuel d'un tarif : prix mensuel appliqué × nombre de mois facturés sur la saison. */
export function prixAnnuel(t: TarifPourCalcul, saison: number): number {
  return (prixApplique(t) ?? 0) * nbMoisSurSaison(t, saison);
}

/** Total HT estimé de la facture annuelle d'un client (somme des lignes, arrondi identique à la base). */
export function annuelEstime(tarifs: TarifPourCalcul[], saison: number): number {
  return tarifs
    .filter((t) => nbMoisSurSaison(t, saison) > 0)
    .reduce((somme, t) => somme + totalLigneCentimes(t.quantite, prixAnnuel(t, saison)), 0);
}

/** Arrhes à déduire de la facture annuelle de `saison` : montant si réglées pour cette saison, sinon 0. */
export function arrhesSurSaison(client: ArrhesClient, saison: number): number {
  const montant = client.arrhes_centimes ?? 0;
  return client.arrhes_reglees && client.arrhes_saison === saison && montant > 0 ? montant : 0;
}

/**
 * Montants des 10 échéances pour un reste à payer : floor(reste / 10) de septembre à mai,
 * le reste en juin (total exact). Reste ≤ 0 : aucune échéance.
 */
export function montantsEcheances(resteCentimes: number): number[] {
  if (resteCentimes <= 0) return [];
  const mensuel = Math.floor(resteCentimes / NB_ECHEANCES);
  return Array.from({ length: NB_ECHEANCES }, (_, k) =>
    k === NB_ECHEANCES - 1 ? resteCentimes - (NB_ECHEANCES - 1) * mensuel : mensuel,
  );
}

/** Échéancier d'une facture annuelle : arrhes déduites du total TTC, reste et montants. */
export function echeancierAnnuel(
  totalTtcCentimes: number,
  client: ArrhesClient,
  saison: number,
): { arrhes: number; reste: number; montants: number[] } {
  const arrhes = arrhesSurSaison(client, saison);
  const reste = Math.max(0, totalTtcCentimes - arrhes);
  return { arrhes, reste, montants: montantsEcheances(reste) };
}

/**
 * Date d'échéance d'un avis (comme emettre_facture) : jour de génération du mois de l'échéance,
 * sans partir d'avant la date d'émission, plus le délai de paiement. Dates "AAAA-MM-JJ".
 */
export function dateEcheanceAvis(periode: string, jourGeneration: number, delaiJours: number, dateEmission: string): string {
  const [a, m] = periode.split("-").map(Number);
  const jour = new Date(Date.UTC(a, m - 1, jourGeneration)).toISOString().slice(0, 10);
  const depart = jour < dateEmission.slice(0, 10) ? dateEmission.slice(0, 10) : jour;
  const [da, dm, dj] = depart.split("-").map(Number);
  return new Date(Date.UTC(da, dm - 1, dj + delaiJours)).toISOString().slice(0, 10);
}
