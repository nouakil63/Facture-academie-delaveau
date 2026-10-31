import { dispositionContenu, erreurTexte, sessionUtilisateur } from "@/app/api/_partage/http";
import { chargerDonneesPennylane } from "@/lib/pennylane/donnees";
import { preparerFactures, produireArchive } from "@/lib/pennylane/export";
import { genererPdfFacture } from "@/lib/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Téléchargement en lecture seule, réservé aux membres, toutes académies confondues. */
export async function GET() {
  const session = await sessionUtilisateur();
  if (!session) return erreurTexte(401, "Session expirée : reconnectez-vous pour exporter les données.");

  try {
    const { data: membres, error } = await session.supabase.from("membres").select("email").limit(1);
    if (error) throw new Error("Vérification des droits impossible.");
    if (!membres?.length) return erreurTexte(403, "L'export est réservé aux membres autorisés.");

    const donnees = await chargerDonneesPennylane(session.supabase);
    const factures = preparerFactures(donnees);
    const archive = produireArchive(donnees, factures, genererPdfFacture);
    let annule = false;
    const flux = new ReadableStream<Uint8Array>({
      async pull(controleur) {
        try {
          const resultat = await archive.next();
          if (annule) return;
          if (resultat.done) controleur.close();
          else controleur.enqueue(resultat.value);
        } catch {
          console.error("Export Pennylane : génération de l'archive interrompue.");
          if (!annule) controleur.error(new Error("Export interrompu. Relancer le téléchargement."));
        }
      },
      async cancel() {
        annule = true;
        await archive.return(undefined);
      },
    });
    return new Response(flux, { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": dispositionContenu(`Reprise-Pennylane-${donnees.date_export.slice(0, 10)}.zip`, true),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    console.error("Export Pennylane : lecture ou validation des données impossible.");
    return erreurTexte(500, "Impossible de préparer l'export complet. Vérifiez les migrations de la base et relancez hors saisie. Si le problème persiste, contactez le support.");
  }
}
