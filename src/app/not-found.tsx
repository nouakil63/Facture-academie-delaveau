import Link from "next/link";
import { Logo } from "@/components/coquille/Logo";

/** Page 404 hors coquille (secours) : les pages de l'application ont leur propre 404, src/app/(app)/not-found.tsx. */
export default function PageIntrouvable() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-12">
      <div className="w-full max-w-md text-center">
        <Link href="/" className="inline-block rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
          <Logo largeur={180} />
        </Link>

        <div className="carte carte-corps mt-8 sm:p-8">
          <p className="font-display text-5xl font-medium tracking-wide text-brand">404</p>
          <h1 className="titre-page mt-2">Page introuvable</h1>
          <p className="mt-2 text-sm text-muted">
            La page demandée n&apos;existe pas ou plus. Le lien est peut-être incorrect, ou l&apos;élément a été supprimé.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Link href="/" className="btn-primaire">
              Retour au tableau de bord
            </Link>
            <Link href="/factures" className="btn-secondaire">
              Voir les factures
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
