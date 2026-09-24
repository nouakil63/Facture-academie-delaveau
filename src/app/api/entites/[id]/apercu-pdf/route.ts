import type { NextRequest } from "next/server";
import { donneesExemple, type LigneExemple } from "@/lib/pdf/exemple";
import { genererPdfFacture } from "@/lib/pdf";
import type { Entite, Prestation } from "@/lib/types";
import { erreurTexte, estUuid, reponsePdf, sessionUtilisateur } from "@/app/api/_partage/http";

/*
 * GET /api/entites/[id]/apercu-pdf — facture fictive (brouillon, client « Exemple ») rendue
 * avec les informations réelles de l'entité, pour vérifier la charte et les mentions.
 * Rien n'est enregistré. Les lignes reprennent le catalogue de l'entité quand il existe.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await sessionUtilisateur();
  if (!session) return erreurTexte(401, "Session expirée : reconnectez-vous pour afficher l'aperçu.");

  if (!estUuid(id)) return erreurTexte(404, "Entité introuvable.");

  try {
    const resEntite = await session.supabase.from("entites").select("*").eq("id", id).maybeSingle();
    if (resEntite.error) throw new Error(resEntite.error.message);
    if (!resEntite.data) return erreurTexte(404, "Entité introuvable.");
    const entite = resEntite.data as Entite;

    // Deux prestations actives du catalogue, sinon des lignes d'exemple.
    const resPrestations = await session.supabase
      .from("prestations")
      .select("libelle, description, prix_unitaire_centimes")
      .eq("entite_id", id)
      .eq("actif", true)
      .order("ordre")
      .order("libelle")
      .limit(2);
    if (resPrestations.error) throw new Error(resPrestations.error.message);
    const prestations = (resPrestations.data ?? []) as Pick<
      Prestation,
      "libelle" | "description" | "prix_unitaire_centimes"
    >[];
    const lignes: LigneExemple[] | undefined =
      prestations.length > 0
        ? prestations.map((p) => ({
            libelle: p.libelle,
            description: p.description,
            quantite: 1,
            prix_unitaire_centimes: p.prix_unitaire_centimes,
          }))
        : undefined;

    const pdf = await genererPdfFacture(donneesExemple(entite, { lignes }));
    const telecharger = request.nextUrl.searchParams.get("telecharger") === "1";
    return reponsePdf(pdf, `Apercu-facture-${entite.prefixe_facture}.pdf`, telecharger);
  } catch (e) {
    console.error(`Aperçu PDF de l'entité ${id} impossible :`, e);
    return erreurTexte(500, "L'aperçu de la facture n'a pas pu être généré. Réessayez dans un instant.");
  }
}
