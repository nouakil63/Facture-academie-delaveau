"use client";

import Form from "next/form";
import Link from "next/link";
import { useRef } from "react";
import { IconeRecherche } from "@/components/Icones";
import { MOTIF_MOIS } from "./outils";

/**
 * Recherche et mois facturé de la liste des factures (paramètres d'URL).
 * Le statut est conservé en champ caché : il se choisit avec les onglets au-dessus.
 * Champs non contrôlés : le parent remonte le composant (key) quand les filtres de l'URL changent.
 */
export function FiltresFactures({
  q,
  mois,
  statut,
  filtresActifs,
}: {
  q: string;
  mois: string;
  statut: string;
  filtresActifs: boolean;
}) {
  const formulaire = useRef<HTMLFormElement>(null);

  return (
    <Form
      ref={formulaire}
      action="/factures"
      replace
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      role="search"
      aria-label="Filtrer les factures"
    >
      {statut && <input type="hidden" name="statut" value={statut} />}
      <div className="min-w-0 flex-1">
        <label htmlFor="recherche-factures" className="label">
          Rechercher
        </label>
        <div className="relative">
          <IconeRecherche className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            id="recherche-factures"
            type="search"
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="N° de facture, client, cavalier…"
            className="champ pl-9"
          />
        </div>
      </div>
      <div className="sm:w-48">
        <label htmlFor="mois-factures" className="label">
          Mois facturé
        </label>
        <input
          id="mois-factures"
          type="month"
          name="mois"
          defaultValue={mois}
          className="champ"
          placeholder="AAAA-MM"
          pattern="\d{4}-(0[1-9]|1[0-2])"
          onChange={(e) => {
            // Champ texte (Safari macOS, Firefox) : filtrer seulement une fois le mois complet ou effacé.
            const valeur = e.currentTarget.value;
            if (valeur === "" || MOTIF_MOIS.test(valeur)) formulaire.current?.requestSubmit();
          }}
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primaire">
          Filtrer
        </button>
        {filtresActifs && (
          <Link href="/factures" className="btn-secondaire">
            Effacer
          </Link>
        )}
      </div>
    </Form>
  );
}
