import { erreurTexte, sessionUtilisateur } from "@/app/api/_partage/http";
import { chargerToutesLesFactures } from "@/lib/exports/donnees";

export const dynamic = "force-dynamic";

/** Manifeste complet ; les PDF sont téléchargés séparément pour éviter un long traitement serveur. */
export async function GET() {
  const session = await sessionUtilisateur();
  if (!session) return erreurTexte(401, "Session expirée : se reconnecter pour exporter les factures.");
  try {
    return Response.json(await chargerToutesLesFactures(session.supabase), {
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    console.error("Export factures :", e);
    return erreurTexte(500, "Impossible de charger la liste complète des factures.");
  }
}
