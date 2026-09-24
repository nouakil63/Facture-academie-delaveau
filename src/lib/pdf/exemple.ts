import { aujourdhuiParis, formatPeriode, premierDuMois } from "@/lib/format";
import type { Academie, Client, Facture, FactureComplete, LigneFacture, Parametres, StatutFacture } from "@/lib/types";

/*
 * Facture fictive, pour prévisualiser la charte (Paramètres → « Aperçu d'une facture type »)
 * et pour les tests. Rien n'est enregistré en base.
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
const DATE_EXEMPLE = "2026-09-24T08:00:00Z";

/** Paramètres fictifs (tests) : informations de l'association Académie Delaveau, modèles d'e-mail par défaut. */
export function parametresExemple(modifications: Partial<Parametres> = {}): Parametres {
  return {
    id: true,
    prefixe_facture: "AD",
    couleur_primaire: "#0050A0",
    couleur_secondaire: "#DADADA",
    logo_url: null,
    raison_sociale: "Académie Delaveau",
    forme_juridique: "Association déclarée",
    adresse_ligne1: "5 chemin du Foyer",
    adresse_ligne2: null,
    code_postal: "14800",
    ville: "Vauville",
    pays: "France",
    siren: "853 472 298",
    siret: "853 472 298 00019",
    rna: "W143007272",
    numero_tva: null,
    objet_social: "Formation de jeunes cavaliers vers le haut niveau à travers le double projet sportif et scolaire.",
    email_contact: "contact@academiedelaveau.com",
    telephone: null,
    site_web: null,
    iban: null,
    bic: null,
    titulaire_compte: null,
    conditions_paiement: "Paiement par virement bancaire au plus tard à la date d'échéance.",
    delai_paiement_jours: 30,
    taux_tva: 0,
    mention_tva: "TVA non applicable, art. 293 B du CGI",
    mentions_legales: null,
    mentions_professionnels:
      "En cas de retard de paiement : pénalités au taux de trois fois le taux d'intérêt légal et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 et D441-5 du Code de commerce). Pas d'escompte pour paiement anticipé.",
    objet_facture_mensuelle: "Formation et accompagnement",
    jour_generation: 1,
    mois_facture: "courant",
    generation_auto: false,
    envoi_auto: false,
    email_objet: "Facture {numero} – {structure}",
    email_corps:
      "Bonjour {client},\n\nVeuillez trouver ci-joint la facture {numero} d'un montant de {montant}, à régler avant le {echeance}.\n\nNous restons à votre disposition pour toute question.\n\nCordialement,\n{structure}",
    email_copie: null,
    created_at: DATE_EXEMPLE,
    updated_at: DATE_EXEMPLE,
    ...modifications,
  };
}

/** Académie fictive (tests, ou aperçu quand aucune académie n'est active). */
export function academieExemple(modifications: Partial<Academie> = {}): Academie {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    nom: "Académie Delaveau",
    couleur: "#0050A0",
    actif: true,
    ordre: 1,
    created_at: DATE_EXEMPLE,
    updated_at: DATE_EXEMPLE,
    ...modifications,
  };
}

export interface OptionsExemple {
  statut?: StatutFacture;
  lignes?: LigneExemple[];
  client?: Partial<Client>;
  facture?: Partial<Facture>;
  /** Académie du client (complétée par academieExemple). */
  academie?: Partial<Academie>;
}

/** Construit une facture complète fictive avec les paramètres donnés (totaux calculés comme en base). */
export function donneesExemple(emetteur: Parametres, options: OptionsExemple = {}): FactureComplete {
  const maintenant = new Date().toISOString();
  const periode = premierDuMois(aujourdhuiParis());
  const tauxTva = Number(emetteur.taux_tva) || 0;
  const academie = academieExemple(options.academie);

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
    academie_id: academie.id,
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
    client_id: client.id,
    academie_id: academie.id,
    numero: null,
    annee: null,
    sequence: null,
    statut: "brouillon",
    objet: `${emetteur.objet_facture_mensuelle} – ${formatPeriode(periode)}`,
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
    emetteur_snapshot: null,
    academie_snapshot: null,
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

  return { facture, lignes, client, emetteur, academie };
}
