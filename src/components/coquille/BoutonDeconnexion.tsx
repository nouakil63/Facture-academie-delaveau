"use client";

import { useActionState } from "react";
import { seDeconnecter } from "@/app/(app)/actions-session";
import type { ResultatAction } from "@/lib/types";
import { IconeDeconnexion } from "./Icones";

export function BoutonDeconnexion() {
  const [etat, deconnecter, enCours] = useActionState<ResultatAction | null>(seDeconnecter, null);

  return (
    <form action={deconnecter}>
      <button
        type="submit"
        disabled={enCours}
        className="btn-secondaire btn-petit w-full"
      >
        <IconeDeconnexion className="h-4 w-4" />
        {enCours ? "Déconnexion…" : "Déconnexion"}
      </button>
      {etat && !etat.ok && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {etat.erreur}
        </p>
      )}
    </form>
  );
}
