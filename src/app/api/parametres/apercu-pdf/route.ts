import type { NextRequest } from "next/server";
import { chargerAcademies, chargerParametres } from "@/lib/facturation/service";
import { genererPdfAvis, genererPdfFacture } from "@/lib/pdf";
import {
  academieExemple,
  avisExemple,
  donneesAnnuellesExemple,
  donneesExemple,
  LIGNES_EXEMPLE,
  type LigneExemple,
} from "@/lib/pdf/exemple";
import { saisonEnCours } from "@/lib/tarifs";
import type { Prestation } from "@/lib/types";
import { erreurTexte, reponsePdf, sessionUtilisateur } from "@/app/api/_partage/http";

/*
 * GET /api/parametres/apercu-pdf — facture fictive (brouillon, client « Exemple », 2 lignes)
 * rendue avec les paramètres réels (charte, mentions, IBAN), pour vérifier le modèle.
 * Académie : la première académie active. Les lignes reprennent les premières prestations
 * actives du catalogue, complétées par des lignes d'exemple. Rien n'est enregistré.
 *   ?modele=annuelle → facture annuelle émise fictive (échéancier, arrhes) ;
 *   ?modele=avis     → avis d'échéance fictif (octobre) ;
 *   ?telecharger=1 → téléchargement (attachment), sinon affichage (inline).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await sessionUtilisateur();
  if (!session) return erreurTexte(401, "Session expirée : se reconnecter pour afficher l'aperçu.");
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

    const telecharger = request.nextUrl.searchParams.get("telecharger") === "1";
    const modele = request.nextUrl.searchParams.get("modele");
    const academie = academies[0] ?? academieExemple();
    if (modele === "annuelle" || modele === "avis") {
      // Enseignement 1 320 €/mois → 13 200 €/an, arrhes 3 960 € : 10 échéances de 924 €.
      const saison = saisonEnCours();
      const options = {
        saison,
        academie,
        lignes: [{ libelle: `${lignes[0]?.libelle ?? "Enseignement"} – ${saison}-${saison + 1}`, quantite: 1, prix_unitaire_centimes: 1320000 }],
        client: { arrhes_reglees: true, arrhes_centimes: 396000, arrhes_saison: saison },
        facture: { date_emission: `${saison}-09-01`, numero: `${parametres.prefixe_facture}-${saison}-0001` },
      };
      if (modele === "avis") {
        const pdf = await genererPdfAvis(avisExemple(parametres, 2, options));
        return reponsePdf(pdf, "Apercu-avis-echeance.pdf", telecharger);
      }
      const pdf = await genererPdfFacture(donneesAnnuellesExemple(parametres, options));
      return reponsePdf(pdf, `Apercu-facture-annuelle-${parametres.prefixe_facture}.pdf`, telecharger);
    }

    const donnees = donneesExemple(parametres, { lignes, academie });
    const pdf = await genererPdfFacture(donnees);
    return reponsePdf(pdf, `Apercu-facture-${parametres.prefixe_facture}.pdf`, telecharger);
  } catch (e) {
    console.error("Aperçu PDF de la facture type impossible :", e);
    return erreurTexte(500, "Impossible de générer l'aperçu de la facture. Réessayer dans un instant.");
  }
}
