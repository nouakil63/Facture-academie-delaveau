"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { IconeFermer, IconeMenu } from "./Icones";

/**
 * Barre supérieure et menu repliable (écrans < lg).
 * Le menu se referme seul au changement de page : il n'est ouvert que pour le chemin
 * sur lequel on l'a ouvert.
 */
export function MenuMobile({ logo, children }: { logo: ReactNode; children: ReactNode }) {
  const chemin = usePathname();
  const [ouvertSur, setOuvertSur] = useState<string | null>(null);
  const ouvert = ouvertSur === chemin;

  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOuvertSur(null);
    };
    const debordement = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", surTouche);
    return () => {
      document.body.style.overflow = debordement;
      document.removeEventListener("keydown", surTouche);
    };
  }, [ouvert]);

  return (
    <>
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
        {logo}
        <button
          type="button"
          className="btn-secondaire px-2.5"
          aria-expanded={ouvert}
          aria-controls="menu-mobile"
          onClick={() => setOuvertSur(ouvert ? null : chemin)}
        >
          {ouvert ? <IconeFermer /> : <IconeMenu />}
          <span className="sr-only">{ouvert ? "Fermer le menu" : "Ouvrir le menu"}</span>
        </button>
      </header>

      {ouvert && (
        <>
          <div className="fixed inset-0 top-16 z-30 bg-ink/30 lg:hidden" aria-hidden="true" onClick={() => setOuvertSur(null)} />
          <div
            id="menu-mobile"
            className="fixed inset-x-0 top-16 z-40 flex max-h-[calc(100dvh-4rem)] flex-col overflow-y-auto border-b border-line bg-surface shadow-lg lg:hidden"
            // Un clic sur un lien referme le menu, y compris vers la page déjà affichée.
            onClickCapture={(e) => {
              if ((e.target as HTMLElement).closest("a")) setOuvertSur(null);
            }}
          >
            {children}
          </div>
        </>
      )}
    </>
  );
}
