import { donneesExemple, parametresExemple } from "@/lib/pdf/exemple";
import type { DonneesPennylane } from "@/lib/pennylane/donnees";

export function donneesMigration(): DonneesPennylane {
  const emetteur = parametresExemple();
  const exemple = donneesExemple(emetteur, {
    statut: "payee",
    client: { nom: "Ancien nom", actif: false, arrhes_reglees: true, arrhes_centimes: 12505, arrhes_saison: 2026 },
    facture: { numero: "F-E1-10-2026-0001", date_emission: "2026-10-01", date_echeance: "2026-10-31", payee_le: "2026-10-05", mode_paiement: "Virement" },
    lignes: [{ libelle: 'Cours ; "perfectionnement"\nOctobre', prix_unitaire_centimes: 12345, quantite: 1.5 }],
  });
  exemple.facture.client_snapshot = { ...exemple.client };
  exemple.facture.emetteur_snapshot = { ...emetteur };
  exemple.facture.academie_snapshot = { ...exemple.academie };
  return {
    date_export: "2026-10-31T12:00:00.000Z", parametres: [{ ...emetteur, raison_sociale: "Nouveau nom émetteur" }],
    academies: [exemple.academie], clients: [{ ...exemple.client, nom: "Nom corrigé" }],
    factures: [exemple.facture], lignes_facture: exemple.lignes,
    prestations: [{ id: "prestation", libelle: "Cours", description: null, prix_unitaire_centimes: 9999,
      unite: "séance", recurrente: true, actif: true, ordre: 1, created_at: "2026-10-01", updated_at: "2026-10-01" }],
    tarifs_clients: [{ id: "tarif", client_id: exemple.client.id, prestation_id: "prestation", libelle: null, description: null,
      prix_unitaire_centimes: null, quantite: 2, recurrent: true, date_debut: null, date_fin: null, actif: true,
      ordre: 1, notes: null, motif_reduction: null, created_at: "2026-10-01", updated_at: "2026-10-01" }],
    echeances: [], extras_clients: [{ id: "extra", facture_id: null, libelle: "Licence en attente" }],
    envois_email: [{ id: "envoi", succes: true }], compteurs_factures: [{ annee: 2026, dernier_numero: 1 }],
  };
}
