/**
 * Sections de la page Paramètres (ancres #id), dans l'ordre d'affichage.
 * Module neutre : utilisé par la navigation (serveur) et le formulaire (client).
 */
export const SECTIONS_PARAMETRES = [
  { id: "charte", titre: "Identité & charte" },
  { id: "legal", titre: "Informations légales" },
  { id: "coordonnees", titre: "Coordonnées" },
  { id: "paiement", titre: "Paiement" },
  { id: "tva", titre: "TVA et mentions" },
  { id: "mensuelle", titre: "Facturation mensuelle" },
  { id: "emails", titre: "E-mails" },
  { id: "academies", titre: "Académies" },
  { id: "envoi-emails", titre: "Envoi des e-mails" },
  { id: "utilisateurs", titre: "Utilisateurs autorisés" },
] as const;

export type IdSectionParametres = (typeof SECTIONS_PARAMETRES)[number]["id"];

/** Titre d'une section (identique dans la navigation et dans la page). */
export function titreSection(id: IdSectionParametres): string {
  return SECTIONS_PARAMETRES.find((s) => s.id === id)?.titre ?? id;
}
