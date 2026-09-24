"use client";

import Link from "next/link";
import { useEffect } from "react";
import "./globals.css";

/**
 * Dernier recours : erreur non rattrapée par src/app/(app)/error.tsx (page de connexion,
 * disposition racine…). Remplace tout le document : ni coquille ni polices de la disposition.
 */
export default function ErreurGlobale({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="fr">
      <body className="min-h-screen bg-page font-sans antialiased">
        <title>Erreur · Académie Delaveau</title>
        <main className="flex min-h-screen items-center justify-center px-4 py-12">
          <div role="alert" className="carte carte-corps w-full max-w-md text-center sm:p-8">
            <h1 className="titre-section">Une erreur est survenue</h1>
            <p className="mt-2 text-sm text-muted">
              L&apos;application n&apos;a pas pu afficher cette page. Il s&apos;agit peut-être d&apos;une coupure réseau
              ou d&apos;un service momentanément indisponible. Si vous veniez d&apos;enregistrer, rechargez la page pour
              vérifier ce qui a été pris en compte.
            </p>
            {error.digest && (
              <p className="mt-3 text-xs text-muted">
                Référence de l&apos;erreur : <code className="font-mono">{error.digest}</code>
              </p>
            )}
            <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
              <button type="button" className="btn-primaire" onClick={() => retry()}>
                Réessayer
              </button>
              <Link href="/" className="btn-secondaire">
                Retour à l&apos;accueil
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
