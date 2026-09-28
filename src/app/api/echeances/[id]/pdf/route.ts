import type { NextRequest } from "next/server";
import { chargerAvisComplet } from "@/lib/facturation/service";
import { genererPdfAvis, nomFichierAvis } from "@/lib/pdf";
import type { AvisComplet } from "@/lib/types";
import { erreurTexte, estUuid, reponsePdf, sessionUtilisateur } from "@/app/api/_partage/http";

/*
 * GET /api/echeances/[id]/pdf — PDF d'un avis d'échéance (session requise).
 *   ?telecharger=1 → téléchargement (attachment), sinon affichage (inline).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await sessionUtilisateur();
  if (!session) return erreurTexte(401, "Session expirée : se reconnecter pour afficher cet avis.");

  if (!estUuid(id)) return erreurTexte(404, "Avis d'échéance introuvable.");

  let donnees: AvisComplet | null;
  try {
    donnees = await chargerAvisComplet(session.supabase, id);
  } catch (e) {
    console.error(`PDF : chargement de l'avis ${id} impossible :`, e);
    return erreurTexte(500, "Impossible de charger l'avis d'échéance. Réessayer dans un instant.");
  }
  if (!donnees) return erreurTexte(404, "Avis d'échéance introuvable.");

  try {
    const pdf = await genererPdfAvis(donnees);
    const telecharger = request.nextUrl.searchParams.get("telecharger") === "1";
    return reponsePdf(pdf, nomFichierAvis(donnees.echeance), telecharger);
  } catch (e) {
    console.error(`PDF : génération impossible pour l'avis ${id} :`, e);
    return erreurTexte(500, "Impossible de générer le PDF de l'avis. Réessayer dans un instant.");
  }
}
