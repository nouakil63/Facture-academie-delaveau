import { BoutonDeconnexion } from "./BoutonDeconnexion";
import type { AcademieMenu } from "./donnees";
import { NavigationPrincipale } from "./NavigationPrincipale";
import { SelecteurAcademie } from "./SelecteurAcademie";

/** Contenu commun à la barre latérale (ordinateur) et au menu repliable (mobile). */
export function PanneauNavigation({
  academies,
  academieCourante,
  email,
}: {
  academies: AcademieMenu[];
  /** Académie filtrée, ou null pour « Toutes ». */
  academieCourante: string | null;
  email: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {academies.length > 0 && (
        <div className="px-4 pt-4 pb-2">
          <SelecteurAcademie academies={academies} valeur={academieCourante} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <NavigationPrincipale />
      </div>

      <div className="border-t border-line p-4">
        <div className="mb-3 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light font-display text-sm font-semibold text-brand uppercase"
          >
            {email.charAt(0) || "?"}
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted">Connecté avec</p>
            <p className="truncate text-sm font-medium text-ink" title={email}>
              {email || "Adresse inconnue"}
            </p>
          </div>
        </div>
        <BoutonDeconnexion />
      </div>
    </div>
  );
}
