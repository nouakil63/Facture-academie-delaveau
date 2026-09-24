import { LIBELLES_STATUT } from "@/lib/format";
import type { StatutFacture } from "@/lib/types";

const COULEURS: Record<StatutFacture, string> = {
  brouillon: "bg-slate-100 text-slate-700",
  emise: "bg-sky-100 text-sky-800",
  envoyee: "bg-indigo-100 text-indigo-800",
  payee: "bg-emerald-100 text-emerald-800",
  annulee: "bg-zinc-200 text-zinc-600 line-through",
};

/** Pastille de statut. `enRetard` remplace l'affichage d'une facture émise/envoyée échue. */
export function StatutBadge({ statut, enRetard = false }: { statut: StatutFacture; enRetard?: boolean }) {
  if (enRetard) {
    return <span className="badge bg-red-100 text-red-800">En retard</span>;
  }
  return <span className={`badge ${COULEURS[statut]}`}>{LIBELLES_STATUT[statut]}</span>;
}
