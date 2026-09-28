/** Pastille de la référence élève (E1…). */
export function ReferenceBadge({ reference }: { reference: string }) {
  return (
    <span className="badge bg-page font-mono text-ink ring-1 ring-line" title="Référence élève">
      {reference}
    </span>
  );
}
