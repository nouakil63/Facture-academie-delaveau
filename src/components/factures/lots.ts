import { unstable_rethrow } from "next/navigation";
import { pluriel } from "@/lib/format";
import type { ResultatAction } from "@/lib/types";
import { LOT_ENVOI, syntheseEnvoi, type ResultatEnvoiFacture } from "./outils";

export const MESSAGE_ENVOI_INTERROMPU =
  "Envoi interrompu : certaines factures ont pu partir. La liste a été rechargée : vérifiez leur statut avant de relancer.";

/**
 * Envoi groupé côté navigateur : appelle `envoyer` (une Server Action) par lots successifs de
 * LOT_ENVOI éléments, pour qu'aucune requête n'approche la durée maximale autorisée.
 * `apresLot` est appelé après chaque lot traité (progression, sélection).
 * Un lot en échec ou une requête interrompue arrête l'envoi (les lots suivants ne partent pas).
 */
export async function envoyerParLots<T>(
  elements: T[],
  envoyer: (lot: T[]) => Promise<ResultatAction<ResultatEnvoiFacture[]>>,
  apresLot?: (lot: T[], traites: number) => void,
): Promise<ResultatAction<ResultatEnvoiFacture[]>> {
  const resultats: ResultatEnvoiFacture[] = [];
  for (let debut = 0; debut < elements.length; debut += LOT_ENVOI) {
    const lot = elements.slice(debut, debut + LOT_ENVOI);
    let r: ResultatAction<ResultatEnvoiFacture[]>;
    try {
      r = await envoyer(lot);
    } catch (e) {
      unstable_rethrow(e);
      return { ok: false, erreur: MESSAGE_ENVOI_INTERROMPU };
    }
    if (!r.ok) {
      if (resultats.length === 0) return r;
      return {
        ok: false,
        erreur: `${r.erreur}\n${syntheseEnvoi(resultats)} (${pluriel(resultats.length, "facture traitée", "factures traitées")} avant l'arrêt.)`,
      };
    }
    resultats.push(...(r.donnees ?? []));
    apresLot?.(lot, debut + lot.length);
  }
  return { ok: true, message: syntheseEnvoi(resultats), donnees: resultats };
}
