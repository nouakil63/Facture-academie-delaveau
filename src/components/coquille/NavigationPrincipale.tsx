"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  IconeCalendrier,
  IconeClients,
  IconeFacture,
  IconeParametres,
  IconePrestations,
  IconeTableauDeBord,
} from "./Icones";

const LIENS: { href: string; libelle: string; Icone: ComponentType<{ className?: string }> }[] = [
  { href: "/", libelle: "Tableau de bord", Icone: IconeTableauDeBord },
  { href: "/factures", libelle: "Factures", Icone: IconeFacture },
  { href: "/facturation-mensuelle", libelle: "Facturation mensuelle", Icone: IconeCalendrier },
  { href: "/clients", libelle: "Clients", Icone: IconeClients },
  { href: "/prestations", libelle: "Prestations", Icone: IconePrestations },
  { href: "/parametres", libelle: "Paramètres", Icone: IconeParametres },
];

function estActif(href: string, chemin: string): boolean {
  if (href === "/") return chemin === "/";
  return chemin === href || chemin.startsWith(`${href}/`);
}

export function NavigationPrincipale() {
  const chemin = usePathname();

  return (
    <nav aria-label="Navigation principale">
      <ul className="space-y-1">
        {LIENS.map(({ href, libelle, Icone }) => {
          const actif = estActif(href, chemin);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={actif ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  actif ? "bg-brand-light text-brand" : "text-ink/80 hover:bg-page hover:text-ink"
                }`}
              >
                <Icone
                  className={`h-5 w-5 shrink-0 ${actif ? "text-brand" : "text-muted group-hover:text-ink"}`}
                />
                {libelle}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
