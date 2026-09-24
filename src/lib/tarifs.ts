import { premierDuMois } from "@/lib/format";
import type { Prestation, TarifClient } from "@/lib/types";

/**
 * Calculs purs sur les tarifs clients, utilisables partout (pages serveur,
 * composants client, Server Actions, tâche planifiée, tests).
 * Ils reproduisent EXACTEMENT la base de données :
 *   prix  = coalesce(tarif.prix_unitaire_centimes, prestation.prix_unitaire_centimes)
 *   ligne = round(quantite × prix)          (arrondi « au plus loin de zéro » de Postgres ;
 *                                            même formule que lignes_facture.total_centimes)
 *   retenu (generer_brouillons_mensuels) si tarif actif, récurrent,
 *   date_debut ≤ dernier jour du mois et date_fin ≥ premier jour du mois.
 * Le catalogue de prestations est commun aux deux académies.
 * Voir tests/tarifs.test.ts (comparaison directe avec Postgres).
 */

/** Prestation du catalogue jointe à un tarif (null pour une ligne libre). */
export type PrestationDuTarif = Pick<
  Prestation,
  "id" | "libelle" | "description" | "prix_unitaire_centimes" | "unite" | "recurrente" | "actif"
>;

export type TarifAvecPrestation = TarifClient & { prestation: PrestationDuTarif | null };

/** Champs nécessaires au calcul du montant mensuel. */
export type TarifPourCalcul = Pick<
  TarifClient,
  "prix_unitaire_centimes" | "quantite" | "recurrent" | "actif" | "date_debut" | "date_fin"
> & { prestation: Pick<Prestation, "prix_unitaire_centimes"> | null };

/** Sélection PostgREST des champs de TarifPourCalcul (à placer dans un `select` sur tarifs_clients). */
export const CHAMPS_TARIF_POUR_CALCUL =
  "prix_unitaire_centimes, quantite, recurrent, actif, date_debut, date_fin, prestation:prestations(prix_unitaire_centimes)";

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
