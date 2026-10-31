import { dispositionContenu, erreurTexte, sessionUtilisateur } from "@/app/api/_partage/http";
import { chargerTousLesClients } from "@/lib/exports/donnees";
import { genererExcelClients } from "@/lib/exports/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await sessionUtilisateur();
  if (!session) return erreurTexte(401, "Session expirée : se reconnecter pour exporter les clients.");
  try {
    const contenu = await genererExcelClients(await chargerTousLesClients(session.supabase));
    return new Response(contenu, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": dispositionContenu("Clients-academies.xlsx", true),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (e) {
    console.error("Export clients :", e);
    return erreurTexte(500, "Impossible d'exporter les clients. Réessayer dans un instant.");
  }
}
