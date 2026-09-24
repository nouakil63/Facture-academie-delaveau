/** Pastille d'académie (Académie Delaveau / Académie Espoir). */
export function AcademieBadge({ nom, couleur }: { nom: string; couleur?: string | null }) {
  return (
    <span className="badge border" style={{ borderColor: couleur ?? "#0050A0", color: couleur ?? "#0050A0" }}>
      {nom.replace(/^Académie\s+/i, "")}
    </span>
  );
}
