"use client";

import Form from "next/form";
import Link from "next/link";
import { IconeRecherche } from "@/components/Icones";

/**
 * Barre de recherche de la liste des clients (formulaire GET : ?q=…&archives=1).
 * La case « archivés » relance la recherche immédiatement.
 */
export function RechercheClients({ q, archives }: { q: string; archives: boolean }) {
  return (
    // key : champs non contrôlés, remis à jour quand la recherche de l'URL change (lien « Effacer »…).
    <Form key={`${q}|${archives}`} action="/clients" className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <label htmlFor="recherche-clients" className="sr-only">
          Rechercher un client
        </label>
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">
          <IconeRecherche />
        </span>
        <input
          id="recherche-clients"
          type="search"
          name="q"
          defaultValue={q}
          maxLength={100}
          placeholder="Nom, raison sociale, e-mail, cavalier…"
          className="champ pl-9"
        />
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-start">
        <label className="flex cursor-pointer items-center gap-2 text-sm whitespace-nowrap text-ink">
          <input
            type="checkbox"
            name="archives"
            value="1"
            defaultChecked={archives}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="size-4 accent-brand"
          />
          Afficher les archivés
        </label>
        <div className="flex items-center gap-2">
          {q && (
            <Link href={archives ? "/clients?archives=1" : "/clients"} className="btn-lien">
              Effacer
            </Link>
          )}
          <button type="submit" className="btn-secondaire">
            Rechercher
          </button>
        </div>
      </div>
    </Form>
  );
}
