"use client";

import Link from "next/link";
import { useEffect } from "react";
import { IconeAlerte } from "@/components/Icones";

/** Erreur inattendue dans une page de l'application (la coquille reste affichée). */
export default function ErreurApplication({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-10">
      <div role="alert" className="carte carte-corps text-center sm:p-8">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-700">
          <IconeAlerte className="h-6 w-6" />
        </span>
        <h1 className="titre-section mt-4">Une erreur est survenue</h1>
        <p className="mt-2 text-sm text-muted">
          Cette page n&apos;a pas pu être chargée. Il s&apos;agit peut-être d&apos;une coupure réseau ou d&apos;un service
          momentanément indisponible. Vos données n&apos;ont pas été modifiées.
        </p>

        {process.env.NODE_ENV === "development" && error.message && (
          <pre className="mt-4 overflow-x-auto rounded-lg bg-page px-3 py-2 text-left font-mono text-xs text-red-800">
            {error.message}
          </pre>
        )}
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
            Retour au tableau de bord
          </Link>
        </div>
      </div>
    </div>
  );
}
