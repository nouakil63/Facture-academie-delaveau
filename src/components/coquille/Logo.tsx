import Image from "next/image";

/** Proportions du fichier /brand/logo-delaveau.png (1895 × 783). */
const RATIO = 783 / 1895;

/**
 * Logo de l'Académie Delaveau. `largeur` = largeur affichée en pixels : elle sert
 * aussi à next/image pour choisir une résolution adaptée (et non le fichier d'origine).
 */
export function Logo({ largeur = 150, className = "", prioritaire = false }: { largeur?: number; className?: string; prioritaire?: boolean }) {
  return (
    <Image
      src="/brand/logo-delaveau.png"
      alt="Académie Delaveau"
      width={largeur}
      height={Math.round(largeur * RATIO)}
      loading={prioritaire ? "eager" : undefined}
      className={`h-auto select-none ${className}`}
      style={{ width: largeur }}
    />
  );
}
