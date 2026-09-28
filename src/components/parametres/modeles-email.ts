/**
 * Variables des modèles d'e-mail (objet et corps) définis dans les paramètres : e-mail d'une
 * facture (email_objet, email_corps) et e-mail d'un avis d'échéance (email_avis_objet,
 * email_avis_corps). Le remplacement réel est fait à l'envoi par `remplirModele` et
 * `remplirModeleAvis` (@/lib/email) ; ce module sert à la légende, à la validation et à l'aperçu.
 */

export interface VariableEmail {
  nom: string;
  description: string;
  exemple: string;
}

export const VARIABLES_EMAIL = [
  { nom: "client", description: "Nom du client", exemple: "Marie Dupont" },
  { nom: "numero", description: "Numéro de la facture", exemple: "AD-2026-0042" },
  { nom: "montant", description: "Montant TTC", exemple: "13 200,00 €" },
  { nom: "echeance", description: "Date d'échéance", exemple: "24/10/2026" },
  { nom: "periode", description: "Mois facturé (ou année scolaire)", exemple: "2026-2027" },
  { nom: "structure", description: "Raison sociale de l'association", exemple: "Académie Delaveau" },
  { nom: "academie", description: "Académie du client", exemple: "Académie Espoir" },
  { nom: "objet", description: "Objet de la facture", exemple: "Formation et accompagnement – saison 2026-2027" },
  { nom: "reference", description: "Référence élève", exemple: "E1" },
] as const satisfies readonly VariableEmail[];

/** Variables de l'e-mail d'un avis d'échéance. */
export const VARIABLES_AVIS = [
  { nom: "client", description: "Nom du client", exemple: "Marie Dupont" },
  { nom: "numero", description: "Numéro de l'avis", exemple: "E1-2026-10" },
  { nom: "montant", description: "Montant de l'échéance", exemple: "924,00 €" },
  { nom: "echeance", description: "Date limite de paiement", exemple: "31/10/2026" },
  { nom: "periode", description: "Mois de l'échéance", exemple: "octobre 2026" },
  { nom: "facture", description: "Numéro de la facture annuelle", exemple: "AD-2026-0001" },
  { nom: "structure", description: "Raison sociale de l'association", exemple: "Académie Delaveau" },
  { nom: "academie", description: "Académie du client", exemple: "Académie Espoir" },
  { nom: "reference", description: "Référence élève", exemple: "E1" },
] as const satisfies readonly VariableEmail[];

export type NomVariableEmail = (typeof VARIABLES_EMAIL)[number]["nom"] | (typeof VARIABLES_AVIS)[number]["nom"];

/** Variables entre accolades non reconnues : « {nom} » → ["nom"]. */
export function variablesInconnues(modele: string, variables: readonly VariableEmail[] = VARIABLES_EMAIL): string[] {
  const noms = new Set<string>(variables.map((v) => v.nom));
  const inconnues = new Set<string>();
  for (const [, nom] of modele.matchAll(/\{([^{}\s]{1,40})\}/g)) {
    if (!noms.has(nom)) inconnues.add(nom);
  }
  return [...inconnues];
}

/** Aperçu d'un modèle avec des valeurs d'exemple (remplacements fournis prioritaires). */
export function apercuModele(
  modele: string,
  remplacements: Partial<Record<NomVariableEmail, string>> = {},
  variables: readonly VariableEmail[] = VARIABLES_EMAIL,
): string {
  return modele.replace(/\{([a-z]+)\}/g, (tout, nom: string) => {
    const fourni = remplacements[nom as NomVariableEmail];
    if (fourni != null) return fourni;
    const variable = variables.find((v) => v.nom === nom);
    return variable ? variable.exemple : tout;
  });
}
