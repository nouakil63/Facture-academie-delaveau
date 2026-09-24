import type { NextRequest } from "next/server";
import { chargerAcademies, chargerParametres } from "@/lib/facturation/service";
import { genererPdfFacture } from "@/lib/pdf";
import { academieExemple, donneesExemple, LIGNES_EXEMPLE, type LigneExemple } from "@/lib/pdf/exemple";
import type { Prestation } from "@/lib/types";
import { erreurTexte, reponsePdf, sessionUtilisateur } from "@/app/api/_partage/http";

/*
 * GET /api/parametres/apercu-pdf — facture fictive (brouillon, client « Exemple », 2 lignes)
 * rendue avec les paramètres réels (charte, mentions, IBAN), pour vérifier le modèle.
 * Académie : la première académie active. Les lignes reprennent les premières prestations
 * actives du catalogue, complétées par des lignes d'exemple. Rien n'est enregistré.
 *   ?telecharger=1 → téléchargement (attachment), sinon affichage (inline).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await sessionUtilisateur();
  if (!session) return erreurTexte(401, "Session expirée : reconnectez-vous pour afficher l'aperçu.");
  const { supabase } = session;

  try {
    const [parametres, academies, resPrestations] = await Promise.all([
      chargerParametres(supabase),
      chargerAcademies(supabase, true),
      supabase
        .from("prestations")
        .select("libelle, description, prix_unitaire_centimes")
        .eq("actif", true)
        .order("ordre")
        .order("libelle")
        .limit(2),
    ]);
    if (resPrestations.error) throw new Error(resPrestations.error.message);

    const prestations = (resPrestations.data ?? []) as Pick<
      Prestation,
      "libelle" | "description" | "prix_unitaire_centimes"
    >[];
    const lignes: LigneExemple[] = [
      ...prestations.map((p) => ({
        libelle: p.libelle,
        description: p.description,
        quantite: 1,
        prix_unitaire_centimes: p.prix_unitaire_centimes,
      })),
      ...LIGNES_EXEMPLE,
    ].slice(0, 2);

    const donnees = donneesExemple(parametres, { lignes, academie: academies[0] ?? academieExemple() });
    const pdf = await genererPdfFacture(donnees);
    const telecharger = request.nextUrl.searchParams.get("telecharger") === "1";
    return reponsePdf(pdf, `Apercu-facture-${parametres.prefixe_facture}.pdf`, telecharger);
  } catch (e) {
    console.error("Aperçu PDF de la facture type impossible :", e);
    return erreurTexte(500, "L'aperçu de la facture n'a pas pu être généré. Réessayez dans un instant.");
  }
}
