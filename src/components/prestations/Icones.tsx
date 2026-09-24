/**
 * Pictogrammes au trait des modules Prestations et Paramètres
 * (24 × 24, couleur du texte courant, utilisables côté serveur comme client).
 */

type Props = { className?: string };

function Svg({ className = "size-4", children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

export function IconePlus(p: Props) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconeCrayon(p: Props) {
  return (
    <Svg {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}

export function IconeCorbeille(p: Props) {
  return (
    <Svg {...p}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </Svg>
  );
}

export function IconeArchive(p: Props) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
    </Svg>
  );
}

export function IconeRestaurer(p: Props) {
  return (
    <Svg {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </Svg>
  );
}

export function IconeAlerte(p: Props) {
  return (
    <Svg {...p}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  );
}

export function IconeInfo(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </Svg>
  );
}

export function IconeCoche(p: Props) {
  return (
    <Svg {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function IconeCatalogue(p: Props) {
  return (
    <Svg {...p}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </Svg>
  );
}

export function IconeUtilisateurs(p: Props) {
  return (
    <Svg {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </Svg>
  );
}

export function IconeEnveloppe(p: Props) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6 8.5-6" />
    </Svg>
  );
}

export function IconeRetour(p: Props) {
  return (
    <Svg {...p}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  );
}

export function IconeFleche(p: Props) {
  return (
    <Svg {...p}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  );
}

export function IconeLienExterne(p: Props) {
  return (
    <Svg {...p}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </Svg>
  );
}

export function IconeDocument(p: Props) {
  return (
    <Svg {...p}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </Svg>
  );
}

export function IconeCadenas(p: Props) {
  return (
    <Svg {...p}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Svg>
  );
}

export function IconeRepeter(p: Props) {
  return (
    <Svg {...p}>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" />
      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </Svg>
  );
}
