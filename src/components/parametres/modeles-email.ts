/**
 * Variables des modèles d'e-mail (objet et corps) définis dans les paramètres.
 * Le remplacement réel est fait à l'envoi par `remplirModele` (@/lib/email) ;
 * ce module sert à la légende, à la validation et à l'aperçu dans les paramètres.
 */

export const VARIABLES_EMAIL = [
  { nom: "client", description: "Nom du client", exemple: "Marie Dupont" },
  { nom: "numero", description: "Numéro de la facture", exemple: "AD-2026-0042" },
  { nom: "montant", description: "Montant TTC", exemple: "450,00 €" },
  { nom: "echeance", description: "Date d'échéance", exemple: "24/10/2026" },
  { nom: "periode", description: "Mois facturé", exemple: "octobre 2026" },
  { nom: "structure", description: "Raison sociale de l'association", exemple: "Académie Delaveau" },
  { nom: "academie", description: "Académie du client", exemple: "Académie Espoir" },
  { nom: "objet", description: "Objet de la facture", exemple: "Formation et accompagnement – octobre 2026" },
] as const;

export type NomVariableEmail = (typeof VARIABLES_EMAIL)[number]["nom"];

const NOMS = new Set<string>(VARIABLES_EMAIL.map((v) => v.nom));

/** Variables entre accolades non reconnues : « {nom} » → ["nom"]. */
export function variablesInconnues(modele: string): string[] {
  const inconnues = new Set<string>();
  for (const [, nom] of modele.matchAll(/\{([^{}\s]{1,40})\}/g)) {
    if (!NOMS.has(nom)) inconnues.add(nom);
  }
  return [...inconnues];
}

/** Aperçu d'un modèle avec des valeurs d'exemple (remplacements fournis prioritaires). */
export function apercuModele(modele: string, remplacements: Partial<Record<NomVariableEmail, string>> = {}): string {
  return modele.replace(/\{([a-z]+)\}/g, (tout, nom: string) => {
    const fourni = remplacements[nom as NomVariableEmail];
    if (fourni != null) return fourni;
    const variable = VARIABLES_EMAIL.find((v) => v.nom === nom);
    return variable ? variable.exemple : tout;
  });
}
