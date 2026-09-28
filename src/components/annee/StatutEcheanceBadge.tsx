import { LIBELLES_STATUT_ECHEANCE } from "@/lib/format";
import type { StatutEcheance } from "@/lib/types";

const COULEURS: Record<StatutEcheance, string> = {
  a_venir: "bg-slate-100 text-slate-700",
  envoyee: "bg-indigo-100 text-indigo-800",
  payee: "bg-emerald-100 text-emerald-800",
  annulee: "bg-zinc-200 text-zinc-600 line-through",
};

/** Pastille de statut d'une échéance. `enRetard` remplace l'affichage d'une échéance échue non réglée. */
export function StatutEcheanceBadge({ statut, enRetard = false }: { statut: StatutEcheance; enRetard?: boolean }) {
  if (enRetard) return <span className="badge bg-red-100 text-red-800">En retard</span>;
  return <span className={`badge ${COULEURS[statut]}`}>{LIBELLES_STATUT_ECHEANCE[statut]}</span>;
}

/** Pastille de la référence élève (E1…). */
export function ReferenceBadge({ reference }: { reference: string }) {
  return (
    <span className="badge bg-page font-mono text-ink ring-1 ring-line" title="Référence élève">
      {reference}
    </span>
  );
}
