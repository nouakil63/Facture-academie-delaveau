import { redirect } from "next/navigation";

/**
 * Ancienne page « Facturation de l'année » (modèle facture annuelle + avis d'échéance, abandonné) :
 * redirige vers la facturation mensuelle en conservant l'académie et le mois.
 */
export default async function PageFacturationAnnuelle(props: PageProps<"/facturation-annuelle">) {
  const parametres = await props.searchParams;
  const conserves = new URLSearchParams();
  for (const nom of ["academie", "mois"]) {
    const valeur = parametres[nom];
    if (typeof valeur === "string" && valeur) conserves.set(nom, valeur);
  }
  const chaine = conserves.toString();
  redirect(chaine ? `/facturation-mensuelle?${chaine}` : "/facturation-mensuelle");
}
