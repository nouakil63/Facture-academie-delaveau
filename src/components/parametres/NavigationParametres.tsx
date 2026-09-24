import { SECTIONS_PARAMETRES } from "./sections";

/** Sommaire de la page Paramètres : colonne fixe sur grand écran. */
export function NavigationParametres() {
  return (
    <nav aria-label="Sections des paramètres" className="hidden lg:block">
      <ul className="sticky top-6 space-y-1 text-sm">
        {SECTIONS_PARAMETRES.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="block rounded-lg px-3 py-1.5 text-muted transition-colors hover:bg-surface hover:text-ink"
            >
              {s.titre}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Sommaire compact pour mobile et tablette : pastilles défilant horizontalement. */
export function NavigationParametresMobile() {
  return (
    <nav aria-label="Sections des paramètres" className="lg:hidden">
      <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 text-xs">
        {SECTIONS_PARAMETRES.map((s) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              className="block rounded-full border border-line bg-surface px-3 py-1.5 whitespace-nowrap text-muted transition-colors hover:border-brand hover:text-ink"
            >
              {s.titre}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
