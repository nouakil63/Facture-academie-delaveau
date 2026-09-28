import { nomClient } from "@/lib/format";
import type { FactureVue, StatutFacture } from "@/lib/types";

/*
 * Outils du module Factures utilisables côté serveur comme côté navigateur
 * (aucun accès à la base ici).
 */

/** Nom affiché du client d'une ligne de `factures_vue`. */
export function nomClientFacture(
  f: Pick<FactureVue, "client_type" | "client_nom" | "client_prenom" | "client_raison_sociale">,
): string {
  return nomClient({ type: f.client_type, nom: f.client_nom, prenom: f.client_prenom, raison_sociale: f.client_raison_sociale });
}

/** Numéro de la facture, ou « Brouillon » tant qu'elle n'est pas émise. */
export function libelleNumero(numero: string | null | undefined): string {
  return numero ?? "Brouillon";
}

// -----------------------------------------------------------------------------
// Mois / période
// -----------------------------------------------------------------------------

/** Mois complet « AAAA-MM » (saisie d'un <input type="month">, champ texte sur Safari macOS / Firefox). */
export const MOTIF_MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-10" + 1 → "2026-11" ; "2026-01" - 1 → "2025-12". */
export function moisVoisin(mois: string, decalage: number): string {
  const [annee, m] = mois.split("-").map(Number);
  const total = annee * 12 + (m - 1) + decalage;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** "2026-10" (valeur d'un <input type="month">) → "2026-10-01", ou null si invalide. */
export function moisVersPeriode(mois: string | null | undefined): string | null {
  if (!mois) return null;
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mois.trim());
  if (!m) return null;
  const annee = Number(m[1]);
  if (annee < 2000 || annee > 2100) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** "2026-10-01" → "2026-10" (valeur d'un <input type="month">). */
export function periodeVersMois(periode: string | null | undefined): string {
  return periode ? periode.slice(0, 7) : "";
}

// -----------------------------------------------------------------------------
// Académie (facturation mensuelle)
// -----------------------------------------------------------------------------

/** Valeur du paramètre d'URL `academie` pour « toutes les académies ». */
export const ACADEMIE_TOUTES = "toutes";

// -----------------------------------------------------------------------------
// Lignes
// -----------------------------------------------------------------------------

// Quantités, prix appliqués et totaux de ligne : voir @/lib/tarifs (parseQuantite,
// quantiteVersSaisie, totalLigneCentimes, prixApplique), identiques à la base.

/** Montant maximal d'une ligne (la colonne est un entier 32 bits). */
export const MAX_TOTAL_LIGNE_CENTIMES = 2_000_000_000;

/** Ligne saisie dans un formulaire (montants en texte, tels que tapés). */
export interface LigneSaisie {
  /** Clé React stable. */
  cle: string;
  prestation_id: string | null;
  libelle: string;
  description: string;
  quantite: string;
  prix: string;
}

// -----------------------------------------------------------------------------
// Filtres de la liste
// -----------------------------------------------------------------------------

export type FiltreStatut = StatutFacture | "en_retard";

export const FILTRES_STATUT: { valeur: FiltreStatut; libelle: string }[] = [
  { valeur: "brouillon", libelle: "Brouillons" },
  { valeur: "emise", libelle: "Émises" },
  { valeur: "envoyee", libelle: "Envoyées" },
  { valeur: "en_retard", libelle: "En retard" },
  { valeur: "payee", libelle: "Payées" },
  { valeur: "annulee", libelle: "Annulées" },
];

export function estFiltreStatut(v: unknown): v is FiltreStatut {
  return typeof v === "string" && FILTRES_STATUT.some((f) => f.valeur === v);
}

// -----------------------------------------------------------------------------
// Envois groupés
// -----------------------------------------------------------------------------

/**
 * Envoi groupé : le navigateur appelle la Server Action par lots de LOT_ENVOI factures
 * (PDF + SMTP : quelques secondes chacune), loin de la durée maximale d'une requête.
 * LOT_ENVOI_MAX : plafond accepté par les Server Actions pour un appel.
 */
export const LOT_ENVOI = 10;
export const LOT_ENVOI_MAX = 20;

/** Résultat de l'envoi d'une facture dans un lot (liste des factures, facturation mensuelle). */
export interface ResultatEnvoiFacture {
  id: string;
  /** Numéro après envoi (attribué si le brouillon a été émis), sinon null. */
  numero: string | null;
  client: string;
  ok: boolean;
  /** true : la facture n'a pas été traitée (annulée, sans destinataire…). */
  ignoree?: boolean;
  erreur?: string;
}

/** Phrase de synthèse d'un lot envoyé. */
export function syntheseEnvoi(resultats: ResultatEnvoiFacture[]): string {
  const envoyees = resultats.filter((r) => r.ok).length;
  const echecs = resultats.filter((r) => !r.ok && !r.ignoree).length;
  const ignorees = resultats.filter((r) => r.ignoree).length;
  const morceaux = [`${envoyees} facture${envoyees > 1 ? "s" : ""} envoyée${envoyees > 1 ? "s" : ""}`];
  if (echecs > 0) morceaux.push(`${echecs} en échec`);
  if (ignorees > 0) morceaux.push(`${ignorees} ignorée${ignorees > 1 ? "s" : ""}`);
  return `${morceaux.join(", ")}.`;
}
