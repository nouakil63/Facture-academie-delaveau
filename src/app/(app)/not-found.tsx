import Link from "next/link";

/**
 * 404 affichée dans la coquille (la barre latérale reste disponible) quand une page de
 * l'application appelle notFound() : facture, client ou prestation introuvable, identifiant
 * invalide, ou URL inconnue (route attrape-tout src/app/(app)/[...inconnu]).
 */
export default function IntrouvableApplication() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="carte carte-corps text-center sm:p-8">
        <p className="font-display text-5xl font-medium tracking-wide text-brand">404</p>
        <h1 className="titre-page mt-2">Élément introuvable</h1>
        <p className="mt-2 text-sm text-muted">
          La page ou l&apos;élément demandé n&apos;existe pas ou plus : le lien est peut-être incorrect, ou
          l&apos;élément a été supprimé.
        </p>
        <div className="mt-6 flex flex-col flex-wrap justify-center gap-2 sm:flex-row">
          <Link href="/" className="btn-primaire">
            Retour au tableau de bord
          </Link>
          <Link href="/factures" className="btn-secondaire">
            Voir les factures
          </Link>
          <Link href="/clients" className="btn-secondaire">
            Voir les clients
          </Link>
        </div>
      </div>
    </div>
  );
}
