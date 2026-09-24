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

/**
 * Date SQL "AAAA-MM-JJ" → Date à minuit UTC, formatée ensuite en UTC : le jour affiché
 * est toujours celui de la base, quel que soit le fuseau du serveur ou du navigateur.
 */
function dateSql(d: string): Date {
  const [a, m, j] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j));
}

/** Date SQL (jour seul) ou horodatage ISO → Date + fuseau d'affichage. */
function dateEtFuseau(d: string): { date: Date; timeZone: string } {
  return d.length === 10 ? { date: dateSql(d), timeZone: "UTC" } : { date: new Date(d), timeZone: "Europe/Paris" };
}

/** "2026-10-05" ou ISO → « 05/10/2026 ». */
export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const { date, timeZone } = dateEtFuseau(d);
  return date.toLocaleDateString("fr-FR", { timeZone });
}

/** "2026-10-05" → « 5 octobre 2026 » ; "2026-10-01" → « 1er octobre 2026 ». */
export function formatDateLongue(d: string | null | undefined): string {
  if (!d) return "—";
  const { date, timeZone } = dateEtFuseau(d);
  return date
    .toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone })
    .replace(/^1 /, "1er ");
}

/** Jour du mois à la française : 1 → « 1er », 15 → « 15 ». */
export function jourDuMois(jour: number): string {
  return jour === 1 ? "1er" : String(jour);
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

/** « Académie Delaveau » → « Delaveau » (pastilles, sélecteurs, colonnes étroites). */
export function nomCourtAcademie(nom: string): string {
  return nom.replace(/^Académie\s+/i, "");
}

/**
 * Nom d'académie précédé de l'article élidé quand il commence par une voyelle ou un h :
 * « Académie Espoir » → « l'Académie Espoir » ; un autre nom est cité entre guillemets.
 */
export function avecArticle(nom: string): string {
  return /^[aeiouyhàâäéèêëîïôöùûüœ]/i.test(nom) ? `l'${nom}` : `«\u00a0${nom}\u00a0»`;
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
