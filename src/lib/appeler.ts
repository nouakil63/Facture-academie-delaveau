import { unstable_rethrow } from "next/navigation";
import type { ResultatAction } from "@/lib/types";

/*
 * Appel d'une Server Action depuis le navigateur. Une Server Action ne lève jamais d'exception
 * métier (elle renvoie un ResultatAction), mais la requête elle-même peut échouer (coupure
 * réseau, délai dépassé, réponse inattendue) : sans ce garde-fou, l'erreur remonterait à
 * l'error boundary et la saisie serait perdue.
 */

export const MESSAGE_REQUETE_INTERROMPUE =
  "La requête n'a pas abouti. Vérifiez la connexion, puis rechargez la page pour voir ce qui a été enregistré.";

/**
 * Attend le résultat d'une Server Action ; une exception devient un échec lisible.
 * Les redirections (redirect(), session expirée → /connexion) sont relancées pour que Next les exécute.
 */
export async function appeler<T>(action: Promise<ResultatAction<T>>): Promise<ResultatAction<T>> {
  try {
    return await action;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, erreur: MESSAGE_REQUETE_INTERROMPUE };
  }
}
