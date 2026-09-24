import type { Client, StatutFacture } from "./types";

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

/** 123456 → « 1 234,56 € » (espaces insécables, pour l'écran). */
export function formatEuros(centimes: number): string {
  return euros.format(centimes / 100);
}

/**
 * Variante pour le PDF : les polices standard du PDF (Helvetica) ne contiennent pas
 * l'espace fine insécable U+202F utilisée par Intl → on la remplace par une espace simple.
 */
export function formatEurosPdf(centimes: number): string {
  return sansEspacesSpeciales(formatEuros(centimes));
}

export function sansEspacesSpeciales(texte: string): string {
  return texte.replace(/[  ]/g, " ");
}

/** Quantité : 1 → « 1 », 2.5 → « 2,5 ». */
export function formatQuantite(q: number | string): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(Number(q));
}

/**
 * Saisie utilisateur → centimes. Accepte « 1 234,56 », « 1234.56 », « 450 », « 450 € ».
 * Retourne null si la saisie est invalide ou négative.
 */
export function parseEurosEnCentimes(saisie: string | null | undefined): number | null {
  if (saisie == null) return null;
  const nettoye = String(saisie).replace(/[\s  €]/g, "").replace(",", ".");
  if (nettoye === "" || !/^\d+(\.\d{0,2})?$/.test(nettoye)) return null;
  return Math.round(Number(nettoye) * 100);
}

/** Centimes → valeur d'un champ de saisie : 45000 → « 450,00 ». */
export function centimesVersSaisie(centimes: number | null | undefined): string {
  if (centimes == null) return "";
  return (centimes / 100).toFixed(2).replace(".", ",");
}

/** Crée une Date locale à partir de "AAAA-MM-JJ" sans décalage de fuseau. */
function dateSql(d: string): Date {
  const [a, m, j] = d.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, j);
}

/** "2026-10-05" ou ISO → « 05/10/2026 ». */
export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = d.length === 10 ? dateSql(d) : new Date(d);
  return date.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
}

/** "2026-10-05" → « 5 octobre 2026 ». */
export function formatDateLongue(d: string | null | undefined): string {
  if (!d) return "—";
  const date = d.length === 10 ? dateSql(d) : new Date(d);
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
}

/** Horodatage → « 05/10/2026 à 14:32 ». */
export function formatDateHeure(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  return `${date.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} à ${date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  })}`;
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** "2026-10-01" → « octobre 2026 ». */
export function formatPeriode(periode: string | null | undefined): string {
  if (!periode) return "—";
  const [a, m] = periode.split("-").map(Number);
  return `${MOIS[m - 1]} ${a}`;
}

/** Date du jour à Paris au format "AAAA-MM-JJ". */
export function aujourdhuiParis(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

/** Premier jour du mois ("AAAA-MM-01"), décalé de `decalage` mois. */
export function premierDuMois(dateIso: string = aujourdhuiParis(), decalage = 0): string {
  const [a, m] = dateIso.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + decalage, 1));
  return d.toISOString().slice(0, 10);
}

/** Nom affiché d'un client : raison sociale pour un professionnel, « Prénom Nom » sinon. */
export function nomClient(c: Pick<Client, "type" | "nom" | "prenom" | "raison_sociale">): string {
  if (c.type === "professionnel" && c.raison_sociale) return c.raison_sociale;
  return [c.prenom, c.nom].filter(Boolean).join(" ");
}

export const LIBELLES_STATUT: Record<StatutFacture, string> = {
  brouillon: "Brouillon",
  emise: "Émise",
  envoyee: "Envoyée",
  payee: "Payée",
  annulee: "Annulée",
};

export const MODES_PAIEMENT = ["Virement", "Chèque", "Prélèvement", "Espèces", "Carte bancaire", "Autre"] as const;
