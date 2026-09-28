import Link from "next/link";
import { IconeAlerte, IconeFermer, IconeValide } from "@/components/Icones";
import { libelleNumero, type ResultatEnvoiFacture } from "./outils";

/** Compte rendu d'un envoi groupé : une ligne par facture (succès, échec ou ignorée). */
export function ResultatsEnvoi({
  resultats,
  synthese,
  onFermer,
}: {
  resultats: ResultatEnvoiFacture[];
  synthese?: string;
  onFermer?: () => void;
}) {
  const echecs = resultats.filter((r) => !r.ok).length;
  return (
    <section
      aria-live="polite"
      aria-label="Résultat de l'envoi"
      className={`carte overflow-hidden ${echecs > 0 ? "border-amber-300" : "border-emerald-300"}`}
    >
      <div
        className={`flex items-start justify-between gap-3 border-b px-5 py-3 ${
          echecs > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"
        }`}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          {echecs > 0 ? (
            <IconeAlerte className="size-4 text-amber-600" />
          ) : (
            <IconeValide className="size-4 text-emerald-600" />
          )}
          <span className={echecs > 0 ? "text-amber-900" : "text-emerald-900"}>
            {synthese ?? "Envoi terminé."}
          </span>
        </div>
        {onFermer && (
          <button
            type="button"
            onClick={onFermer}
            className="-m-1 rounded-md p-1 text-muted hover:bg-white/60 hover:text-ink"
            aria-label="Fermer le compte rendu"
          >
            <IconeFermer className="size-4" />
          </button>
        )}
      </div>
      <ul className="max-h-80 divide-y divide-line overflow-y-auto">
        {resultats.map((r) => (
          <li key={r.id} className="flex flex-col gap-1 px-5 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-4">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {r.ok ? (
                <IconeValide className="size-4 text-emerald-600" />
              ) : r.ignoree ? (
                <IconeAlerte className="size-4 text-muted" />
              ) : (
                <IconeFermer className="size-4 text-red-600" />
              )}
              <Link href={`/factures/${r.id}`} className="font-medium text-brand hover:underline">
                {libelleNumero(r.numero)}
              </Link>
              <span className="truncate text-ink">{r.client}</span>
            </span>
            <span
              className={`text-xs sm:max-w-[55%] sm:text-right ${
                r.ok ? "text-emerald-700" : r.ignoree ? "text-muted" : "text-red-700"
              }`}
            >
              {r.ok ? (r.erreur ? `Envoyée · ${r.erreur}` : "Envoyée") : r.erreur}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
