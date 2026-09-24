import Link from "next/link";
import type { ReactNode } from "react";
import { IconeFleche } from "@/components/Icones";

export type TonIndicateur = "neutre" | "alerte" | "succes" | "attention";

const PASTILLES: Record<TonIndicateur, string> = {
  neutre: "bg-brand-light text-brand",
  alerte: "bg-red-50 text-red-700 ring-1 ring-red-100",
  succes: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  attention: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
};

const DETAILS: Record<TonIndicateur, string> = {
  neutre: "text-muted",
  alerte: "text-red-700",
  succes: "text-muted",
  attention: "text-amber-800",
};

/** Tuile d'indicateur : libellé, valeur, détail ; cliquable si `href` est fourni. */
export function Indicateur({
  libelle,
  valeur,
  detail,
  icone,
  ton = "neutre",
  href,
  action,
}: {
  libelle: string;
  valeur: string;
  detail: ReactNode;
  icone: ReactNode;
  ton?: TonIndicateur;
  href?: string;
  /** Texte du lien affiché en bas de la tuile cliquable. */
  action?: string;
}) {
  const contenu = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{libelle}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${PASTILLES[ton]}`}>{icone}</span>
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{valeur}</p>
      <p className={`mt-1 text-xs ${DETAILS[ton]}`}>{detail}</p>
      {href && action && (
        <p className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand">
          {action}
          <IconeFleche className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </p>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="group carte carte-corps block transition-colors hover:border-brand/40 hover:bg-brand-light/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {contenu}
      </Link>
    );
  }
  return <div className="carte carte-corps">{contenu}</div>;
}
