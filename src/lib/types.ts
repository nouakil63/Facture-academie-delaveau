/**
 * Types des tables Supabase (voir supabase/migrations).
 * Montants en centimes (integer). Dates SQL `date` au format "AAAA-MM-JJ",
 * `timestamptz` au format ISO.
 */

export type StatutFacture = "brouillon" | "emise" | "envoyee" | "payee" | "annulee";
export type TypeClient = "particulier" | "professionnel";
export type MoisFacture = "courant" | "precedent";

export interface Entite {
  id: string;
  nom: string;
  prefixe_facture: string;
  couleur_primaire: string;
  couleur_secondaire: string;
  logo_url: string | null;
  raison_sociale: string;
  forme_juridique: string | null;
  adresse_ligne1: string | null;
  adresse_ligne2: string | null;
  code_postal: string | null;
  ville: string | null;
  pays: string;
  siren: string | null;
  siret: string | null;
  rna: string | null;
  numero_tva: string | null;
  objet_social: string | null;
  email_contact: string | null;
  telephone: string | null;
  site_web: string | null;
  iban: string | null;
  bic: string | null;
  titulaire_compte: string | null;
  conditions_paiement: string;
  delai_paiement_jours: number;
  taux_tva: number;
  mention_tva: string | null;
  mentions_legales: string | null;
  mentions_professionnels: string | null;
  objet_facture_mensuelle: string;
  jour_generation: number;
  mois_facture: MoisFacture;
  generation_auto: boolean;
  envoi_auto: boolean;
  email_objet: string;
  email_corps: string;
  email_copie: string | null;
  actif: boolean;
  ordre: number;
  created_at: string;
  updated_at: string;
}

export interface Prestation {
  id: string;
  entite_id: string;
  libelle: string;
  description: string | null;
  prix_unitaire_centimes: number;
  unite: string;
  recurrente: boolean;
  actif: boolean;
  ordre: number;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  entite_id: string;
  type: TypeClient;
  civilite: string | null;
  nom: string;
  prenom: string | null;
  raison_sociale: string | null;
  email: string | null;
  emails_cc: string[];
  telephone: string | null;
  adresse_ligne1: string | null;
  adresse_ligne2: string | null;
  code_postal: string | null;
  ville: string | null;
  pays: string;
  siret: string | null;
  numero_tva: string | null;
  cavaliers: string | null;
  notes: string | null;
  actif: boolean;
  created_at: string;
  updated_at: string;
}

export interface TarifClient {
  id: string;
  client_id: string;
  prestation_id: string | null;
  libelle: string | null;
  description: string | null;
  prix_unitaire_centimes: number | null;
  quantite: number;
  recurrent: boolean;
  date_debut: string | null;
  date_fin: string | null;
  actif: boolean;
  ordre: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Facture {
  id: string;
  entite_id: string;
  client_id: string;
  numero: string | null;
  annee: number | null;
  sequence: number | null;
  statut: StatutFacture;
  objet: string | null;
  periode: string | null;
  date_emission: string | null;
  date_echeance: string | null;
  taux_tva: number;
  total_ht_centimes: number;
  total_tva_centimes: number;
  total_ttc_centimes: number;
  notes: string | null;
  notes_internes: string | null;
  client_snapshot: Client | null;
  entite_snapshot: Entite | null;
  envoyee_le: string | null;
  payee_le: string | null;
  mode_paiement: string | null;
  reference_paiement: string | null;
  annulee_le: string | null;
  motif_annulation: string | null;
  generation_auto: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Ligne de la vue `factures_vue`. */
export interface FactureVue extends Facture {
  en_retard: boolean;
  client_type: TypeClient;
  client_nom: string;
  client_prenom: string | null;
  client_raison_sociale: string | null;
  client_email: string | null;
  client_cavaliers: string | null;
  entite_nom: string;
  entite_prefixe: string;
  entite_couleur: string;
}

export interface LigneFacture {
  id: string;
  facture_id: string;
  ordre: number;
  libelle: string;
  description: string | null;
  quantite: number;
  prix_unitaire_centimes: number;
  total_centimes: number;
  prestation_id: string | null;
  created_at: string;
}

export interface EnvoiEmail {
  id: string;
  facture_id: string;
  destinataires: string[];
  objet: string;
  succes: boolean;
  erreur: string | null;
  message_id: string | null;
  envoye_par: string | null;
  created_at: string;
}

/** Résultat de generer_brouillons_mensuels(). */
export interface ResultatGeneration {
  client_id: string;
  facture_id: string | null;
  nb_lignes: number;
  total_ht_centimes: number;
  deja_existante: boolean;
}

/** Facture avec tout ce qu'il faut pour l'afficher, la rendre en PDF et l'envoyer. */
export interface FactureComplete {
  facture: Facture;
  lignes: LigneFacture[];
  /** Coordonnées à imprimer : l'instantané figé si la facture est émise, sinon la fiche actuelle. */
  client: Client;
  entite: Entite;
}

/** Retour standard des Server Actions. */
export type ResultatAction<T = undefined> =
  | { ok: true; message?: string; donnees?: T }
  | { ok: false; erreur: string };
