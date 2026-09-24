import type { ReactNode } from "react";

/**
 * Pictogrammes au trait (24 × 24, couleur du texte courant).
 * Utilisables dans les composants serveur comme client.
 */
type PropsIcone = { className?: string };

function Icone({ className = "h-5 w-5", children }: PropsIcone & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconeTableauDeBord(p: PropsIcone) {
  return (
    <Icone {...p}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Icone>
  );
}

export function IconeFacture(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6M9 9h1" />
    </Icone>
  );
}

export function IconeCalendrier(p: PropsIcone) {
  return (
    <Icone {...p}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="m9 15.5 2 2 4-4" />
    </Icone>
  );
}

export function IconeClients(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Icone>
  );
}

export function IconeNouveauClient(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </Icone>
  );
}

export function IconePrestations(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </Icone>
  );
}

export function IconeParametres(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    </Icone>
  );
}

export function IconeMenu(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icone>
  );
}

export function IconeFermer(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icone>
  );
}

export function IconeDeconnexion(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </Icone>
  );
}

export function IconeAlerte(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </Icone>
  );
}

export function IconeBillet(p: PropsIcone) {
  return (
    <Icone {...p}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </Icone>
  );
}

export function IconeHorloge(p: PropsIcone) {
  return (
    <Icone {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icone>
  );
}

export function IconeValide(p: PropsIcone) {
  return (
    <Icone {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </Icone>
  );
}

export function IconeCoche(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M20 6 9 17l-5-5" />
    </Icone>
  );
}

export function IconeCrayon(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Icone>
  );
}

export function IconePlus(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M12 5v14M5 12h14" />
    </Icone>
  );
}

export function IconeFleche(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icone>
  );
}

export function IconeOeil(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </Icone>
  );
}

export function IconeOeilBarre(p: PropsIcone) {
  return (
    <Icone {...p}>
      <path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M14.1 14.1a3 3 0 0 1-4.2-4.2M2 2l20 20" />
    </Icone>
  );
}
