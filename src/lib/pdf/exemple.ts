import { aujourdhuiParis, formatPeriode, premierDuMois } from "@/lib/format";
import type { Client, Entite, Facture, FactureComplete, LigneFacture, StatutFacture } from "@/lib/types";

/*
 * Facture fictive, pour prévisualiser la charte d'un émetteur (Paramètres) et pour les tests.
 * Rien n'est enregistré en base.
 */

export interface LigneExemple {
  libelle: string;
  description?: string | null;
  quantite?: number;
  prix_unitaire_centimes: number;
}

export const LIGNES_EXEMPLE: LigneExemple[] = [
  {
    libelle: "Pension et formation du cheval",
    description: "Hébergement au box, travail monté 5 jours / 7, soins quotidiens",
    quantite: 1,
    prix_unitaire_centimes: 65000,
  },
  { libelle: "Cours particuliers", quantite: 4, prix_unitaire_centimes: 4500 },
];

const ID_EXEMPLE = "00000000-0000-4000-8000-000000000000";

export interface OptionsExemple {
  statut?: StatutFacture;
  lignes?: LigneExemple[];
  client?: Partial<Client>;
  facture?: Partial<Facture>;
}

/** Construit une facture complète fictive pour l'émetteur donné (totaux calculés comme en base). */
export function donneesExemple(entite: Entite, options: OptionsExemple = {}): FactureComplete {
  const maintenant = new Date().toISOString();
  const periode = premierDuMois(aujourdhuiParis());
  const tauxTva = Number(entite.taux_tva) || 0;

  const lignes: LigneFacture[] = (options.lignes ?? LIGNES_EXEMPLE).map((l, i) => {
    const quantite = l.quantite ?? 1;
    return {
      id: `${ID_EXEMPLE.slice(0, -4)}${String(i + 1).padStart(4, "0")}`,
      facture_id: ID_EXEMPLE,
      ordre: i + 1,
      libelle: l.libelle,
      description: l.description ?? null,
      quantite,
      prix_unitaire_centimes: l.prix_unitaire_centimes,
      total_centimes: Math.round(quantite * l.prix_unitaire_centimes),
      prestation_id: null,
      created_at: maintenant,
    };
  });

  const totalHt = lignes.reduce((somme, l) => somme + l.total_centimes, 0);
  const totalTva = Math.round((totalHt * tauxTva) / 100);

  const client: Client = {
    id: "00000000-0000-4000-8000-00000000c11e",
    entite_id: entite.id,
    type: "particulier",
    civilite: null,
    nom: "Exemple",
    prenom: "Client",
    raison_sociale: null,
    email: "client@exemple.fr",
    emails_cc: [],
    telephone: null,
    adresse_ligne1: "12 rue des Écuries",
    adresse_ligne2: null,
    code_postal: "14000",
    ville: "Caen",
    pays: "France",
    siret: null,
    numero_tva: null,
    cavaliers: "Léa Exemple",
    notes: null,
    actif: true,
    created_at: maintenant,
    updated_at: maintenant,
    ...options.client,
  };

  const facture: Facture = {
    id: ID_EXEMPLE,
    entite_id: entite.id,
    client_id: client.id,
    numero: null,
    annee: null,
    sequence: null,
    statut: "brouillon",
    objet: `${entite.objet_facture_mensuelle} – ${formatPeriode(periode)}`,
    periode,
    date_emission: null,
    date_echeance: null,
    taux_tva: tauxTva,
    total_ht_centimes: totalHt,
    total_tva_centimes: totalTva,
    total_ttc_centimes: totalHt + totalTva,
    notes: null,
    notes_internes: null,
    client_snapshot: null,
    entite_snapshot: null,
    envoyee_le: null,
    payee_le: null,
    mode_paiement: null,
    reference_paiement: null,
    annulee_le: null,
    motif_annulation: null,
    generation_auto: false,
    created_by: null,
    created_at: maintenant,
    updated_at: maintenant,
    ...options.facture,
    ...(options.statut ? { statut: options.statut } : {}),
  };

  return { facture, lignes, client, entite };
}
