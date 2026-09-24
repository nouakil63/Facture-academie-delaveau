import type { NextRequest } from "next/server";
import { chargerFactureComplete } from "@/lib/facturation/service";
import { genererPdfFacture, nomFichierFacture } from "@/lib/pdf";
import type { FactureComplete } from "@/lib/types";
import { erreurTexte, estUuid, reponsePdf, sessionUtilisateur } from "@/app/api/_partage/http";

/*
 * GET /api/factures/[id]/pdf — PDF d'une facture (session requise).
 *   ?telecharger=1 → téléchargement (attachment), sinon affichage (inline).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await sessionUtilisateur();
  if (!session) return erreurTexte(401, "Session expirée : reconnectez-vous pour afficher cette facture.");

  if (!estUuid(id)) return erreurTexte(404, "Facture introuvable.");

  let donnees: FactureComplete | null;
  try {
    donnees = await chargerFactureComplete(session.supabase, id);
  } catch (e) {
    console.error(`PDF : chargement de la facture ${id} impossible :`, e);
    return erreurTexte(500, "La facture n'a pas pu être chargée. Réessayez dans un instant.");
  }
  if (!donnees) return erreurTexte(404, "Facture introuvable : elle a peut-être été supprimée.");

  try {
    const pdf = await genererPdfFacture(donnees);
    const telecharger = request.nextUrl.searchParams.get("telecharger") === "1";
    return reponsePdf(pdf, nomFichierFacture(donnees.facture), telecharger);
  } catch (e) {
    console.error(`PDF : génération impossible pour la facture ${id} :`, e);
    return erreurTexte(500, "Le PDF de la facture n'a pas pu être généré.");
  }
}
