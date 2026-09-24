import { premierDuMois } from "@/lib/format";
import type { Prestation, TarifClient } from "@/lib/types";

/**
 * Calculs sur les tarifs clients, utilisables côté serveur comme côté client.
 * Ils reproduisent EXACTEMENT la fonction SQL `generer_brouillons_mensuels` :
 *   prix  = coalesce(tarif.prix_unitaire_centimes, prestation.prix_unitaire_centimes)
 *   ligne = round(quantite × prix)          (arrondi « au plus loin de zéro » de Postgres)
 *   retenu si tarif actif, récurrent, date_debut ≤ fin du mois et date_fin ≥ début du mois.
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

/** Prix unitaire appliqué : prix personnalisé, sinon prix catalogue (null si aucun). */
export function prixApplique(
  t: Pick<TarifClient, "prix_unitaire_centimes"> & { prestation: Pick<Prestation, "prix_unitaire_centimes"> | null },
): number | null {
  return t.prix_unitaire_centimes ?? t.prestation?.prix_unitaire_centimes ?? null;
}

/**
 * Total d'une ligne en centimes : round(quantite × prix), calculé en entiers
 * (quantité à 2 décimales) pour éviter toute erreur d'arrondi flottant.
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
