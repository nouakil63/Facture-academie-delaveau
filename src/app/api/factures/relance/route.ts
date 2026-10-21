import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sessionUtilisateur } from "@/app/api/_partage/http";
import { envoyerRelance } from "@/lib/facturation/envoi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  factureIds: z.array(z.uuid()).min(1).max(10),
  objet: z.string().trim().min(1).max(300).refine((s) => !/[\r\n]/.test(s)),
  corps: z.string().trim().min(1).max(20000),
  destinataireAttendu: z.email(),
  // L'aperçu ne transmet aucun e-mail. L'envoi doit être demandé explicitement.
  apercu: z.boolean().default(true),
}).strict();

/** Relance depuis la session du CRM : PDF regroupés et journal sur chaque facture. */
export async function POST(request: NextRequest) {
  const repondre = (contenu: unknown, status = 200) => Response.json(contenu, {
    status, headers: { "Cache-Control": "private, no-store" },
  });
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return repondre({ ok: false, erreur: "Origine de la demande invalide." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return repondre({ ok: false, erreur: "Une demande JSON est attendue." }, 415);
  const session = await sessionUtilisateur();
  if (!session) return repondre({ ok: false, erreur: "Session expirée : se reconnecter." }, 401);
  const validation = schema.safeParse(await request.json().catch(() => null));
  if (!validation.success) return repondre({ ok: false, erreur: "Demande de relance invalide." }, 400);

  const resultat = await envoyerRelance(session.supabase, validation.data);
  if (resultat.ok && !resultat.apercu) {
    revalidatePath("/factures");
    for (const id of validation.data.factureIds) revalidatePath(`/factures/${id}`);
  }
  return repondre(resultat, resultat.ok ? 200 : 422);
}
