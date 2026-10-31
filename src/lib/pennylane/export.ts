import "server-only";
import { strToU8, Zip, ZipPassThrough } from "fflate";
import type { Client, Facture, FactureComplete } from "@/lib/types";
import type { DonneesPennylane } from "./donnees";

type Cellule = string | number | boolean | null | undefined;

/** UTF-8 avec BOM pour Excel ; guillemets RFC 4180 et protection des formules. */
export function csv(entetes: string[], lignes: Cellule[][]): string {
  const cellule = (valeur: Cellule) => {
    let texte = valeur == null ? "" : String(valeur);
    if (typeof valeur === "string" && /^[\s]*[=+\-@\t\r]/.test(texte) && !/^-?\d+(?:[.,]\d+)?$/.test(texte)) texte = `'${texte}`;
    return `"${texte.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [entetes, ...lignes].map((ligne) => ligne.map(cellule).join(";")).join("\r\n") + "\r\n";
}

function euros(centimes: number): string {
  if (!Number.isSafeInteger(centimes)) throw new Error("Montant en centimes invalide dans l'export.");
  return (centimes / 100).toFixed(2).replace(".", ",");
}

export function codePays(pays: string | null | undefined): string {
  const valeur = (pays ?? "").trim();
  if (/^[a-z]{2}$/i.test(valeur)) return valeur.toUpperCase();
  return /^(france|france métropolitaine)$/i.test(valeur) ? "FR" : "";
}

function nomClient(c: Client): string {
  return c.type === "professionnel" ? (c.raison_sociale || c.nom) : [c.prenom, c.nom].filter(Boolean).join(" ");
}

/** Un UUID final évite toute collision de noms, y compris après nettoyage du numéro. */
export function cheminPdf(f: Facture): string {
  const dossier = f.statut === "brouillon" ? "archives/brouillons" : f.statut === "annulee" ? "archives/annulees" : "factures-a-importer";
  const nom = (f.numero || "Brouillon").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${dossier}/${nom}-${f.id}.pdf`;
}

/** Assemble les PDF depuis le même jeu de données que les CSV, avec les instantanés d'émission. */
export function preparerFactures(d: DonneesPennylane): FactureComplete[] {
  const clients = new Map(d.clients.map((c) => [c.id, c]));
  const academies = new Map(d.academies.map((a) => [a.id, a]));
  const lignes = new Map<string, typeof d.lignes_facture>();
  for (const l of d.lignes_facture) {
    const groupe = lignes.get(l.facture_id) ?? [];
    groupe.push(l);
    lignes.set(l.facture_id, groupe);
  }
  return d.factures.map((facture) => {
    const clientActuel = clients.get(facture.client_id);
    const academieActuelle = academies.get(facture.academie_id);
    const emise = facture.statut !== "brouillon";
    const client = emise ? { ...clientActuel, ...facture.client_snapshot } : clientActuel;
    const academie = emise ? { ...academieActuelle, ...facture.academie_snapshot } : academieActuelle;
    if (!client?.id || !academie?.id || !d.parametres[0]) throw new Error(`Coordonnées incomplètes pour la facture ${facture.numero || facture.id}.`);
    const details = (lignes.get(facture.id) ?? []).toSorted((a, b) => a.ordre - b.ordre || a.id.localeCompare(b.id));
    if (emise && (!facture.numero || !facture.date_emission || !details.length)) {
      throw new Error(`Facture émise incomplète : ${facture.numero || facture.id}.`);
    }
    if (details.reduce((s, l) => s + l.total_centimes, 0) !== facture.total_ht_centimes ||
      facture.total_ht_centimes + facture.total_tva_centimes !== facture.total_ttc_centimes) {
      throw new Error(`Totaux incohérents pour la facture ${facture.numero || facture.id}. Relancer l'export hors saisie.`);
    }
    return {
      facture,
      lignes: details.map((l) => ({ ...l, quantite: Number(l.quantite) })),
      client: client as Client,
      academie: academie as FactureComplete["academie"],
      emetteur: { ...d.parametres[0], ...(emise ? facture.emetteur_snapshot : null) },
    };
  });
}

export function fichiersTabulaires(d: DonneesPennylane): Record<string, string> {
  const academies = new Map(d.academies.map((a) => [a.id, a.nom]));
  const clients = new Map(d.clients.map((c) => [c.id, c]));
  const prestations = new Map(d.prestations.map((p) => [p.id, p]));
  const factures = new Map(d.factures.map((f) => [f.id, f]));
  const controles: Cellule[][] = [];
  const fichiers: Record<string, string> = {};
  for (const type of ["particulier", "professionnel"] as const) {
    const selection = d.clients.filter((c) => c.type === type);
    fichiers[`clients-${type === "particulier" ? "particuliers" : "entreprises"}.csv`] = csv([
      "Référence client", "Nom", "Prénom", "Dénomination", "Adresse e-mail", "Téléphone",
      "Adresse", "Complément d'adresse", "Code postal", "Ville", "Code pays", "SIREN", "SIRET",
      "Numéro de TVA", "Académie", "Actif", "Identifiant source", "E-mails en copie", "Cavaliers",
    ], selection.map((c) => [c.reference, c.nom, c.prenom, c.raison_sociale, c.email, c.telephone,
      c.adresse_ligne1, c.adresse_ligne2, c.code_postal, c.ville, codePays(c.pays),
      c.siret?.replace(/\D/g, "").slice(0, 9), c.siret?.replace(/\D/g, ""), c.numero_tva,
      academies.get(c.academie_id), c.actif, c.id, c.emails_cc.join(", "), c.cavaliers]));
  }
  for (const c of d.clients) {
    const manques = [!c.nom.trim() && "nom", c.type === "particulier" && !c.prenom?.trim() && "prénom",
      !c.email?.trim() && "e-mail", !codePays(c.pays) && "code pays ISO à renseigner",
      c.type === "professionnel" && !c.raison_sociale?.trim() && "dénomination"].filter(Boolean);
    if (manques.length) controles.push(["Client à compléter", c.reference, c.id, manques.join(", ")]);
  }
  fichiers["produits.csv"] = csv(["Identifiant", "Libellé", "Description", "Prix unitaire HT (EUR)", "Taux de TVA (%)", "Unité", "Actif"],
    d.prestations.map((p) => [p.id, p.libelle, p.description, euros(p.prix_unitaire_centimes), Number(d.parametres[0].taux_tva), p.unite, p.actif]));
  fichiers["archives/tarifs-clients.csv"] = csv(["Identifiant source", "Référence client", "Client", "Identifiant produit source", "Libellé", "Description",
    "Prix unitaire HT effectif (EUR)", "Quantité", "Récurrent", "Début", "Fin", "Actif", "Motif de réduction"],
  d.tarifs_clients.map((t) => {
    const p = t.prestation_id ? prestations.get(t.prestation_id) : undefined;
    const c = clients.get(t.client_id);
    const prix = t.prix_unitaire_centimes ?? p?.prix_unitaire_centimes;
    return [t.id, c?.reference, c && nomClient(c), t.prestation_id, t.libelle ?? p?.libelle,
      t.description ?? p?.description, prix == null ? null : euros(prix), Number(t.quantite),
      t.recurrent, t.date_debut, t.date_fin, t.actif, t.motif_reduction];
  }));
  fichiers["archives/arrhes-clients.csv"] = csv(["Identifiant client source", "Référence client", "Client", "Arrhes réglées", "Montant arrhes (EUR)", "Saison de rentrée"],
    d.clients.filter((c) => c.arrhes_reglees || c.arrhes_centimes != null).map((c) => [c.id, c.reference, nomClient(c), c.arrhes_reglees,
      c.arrhes_centimes == null ? null : euros(c.arrhes_centimes), c.arrhes_saison]));
  fichiers["suivi-factures-et-reglements.csv"] = csv(["Identifiant facture source", "Numéro de facture", "Référence client", "Client à l'émission", "Académie",
    "Statut source", "À importer dans Ventes", "Émission", "Échéance", "HT (EUR)", "TVA (EUR)", "TTC (EUR)", "Taux TVA (%)",
    "Payée le", "Mode de paiement", "Référence paiement", "Type de facture", "Saison", "Annulée le", "Motif annulation", "Fichier PDF"],
  d.factures.map((f) => {
    const c = f.client_snapshot ?? clients.get(f.client_id);
    if (f.type_facture === "annuelle") controles.push(["Facture annuelle", f.numero, f.id, "Reprendre les échéances et les arrhes ; ne pas déduire un solde du seul statut de la facture."]);
    if (f.statut === "annulee") controles.push(["Facture annulée", f.numero, f.id, "Archivée à part. Traitement comptable à vérifier ; aucun avoir inventé."]);
    return [f.id, f.numero, c?.reference, c && nomClient(c), f.academie_snapshot?.nom ?? academies.get(f.academie_id), f.statut,
      f.statut !== "brouillon" && f.statut !== "annulee", f.date_emission, f.date_echeance, euros(f.total_ht_centimes),
      euros(f.total_tva_centimes), euros(f.total_ttc_centimes), Number(f.taux_tva), f.payee_le, f.mode_paiement,
      f.reference_paiement, f.type_facture, f.saison, f.annulee_le, f.motif_annulation, cheminPdf(f)];
  }));
  fichiers["archives/lignes-factures.csv"] = csv(["Identifiant source", "Facture source", "Numéro de facture", "Ordre", "Libellé", "Description", "Quantité", "Prix unitaire HT (EUR)", "Total HT (EUR)", "Déduction arrhes (EUR)"],
    d.lignes_facture.map((l) => [l.id, l.facture_id, factures.get(l.facture_id)?.numero, l.ordre, l.libelle, l.description,
      Number(l.quantite), euros(l.prix_unitaire_centimes), euros(l.total_centimes), l.deduction_arrhes_centimes == null ? null : euros(l.deduction_arrhes_centimes)]));
  fichiers["archives/echeances.csv"] = csv(["Identifiant source", "Facture source", "Numéro facture", "Client source", "Numéro avis", "Échéance", "Montant (EUR)", "Statut", "Payée le", "Mode de paiement", "Référence paiement"],
    d.echeances.map((e) => [String(e.id), String(e.facture_id), factures.get(String(e.facture_id))?.numero, String(e.client_id),
      String(e.numero_avis), String(e.date_echeance), euros(Number(e.montant_centimes)), String(e.statut),
      e.payee_le as string | null, e.mode_paiement as string | null, e.reference_paiement as string | null]));
  fichiers["controles-avant-import.csv"] = csv(["Contrôle", "Référence", "Identifiant source", "Détail"], controles);
  fichiers["archives/donnees-source.json"] = JSON.stringify(d, null, 2);
  fichiers["bilan.json"] = JSON.stringify({ date_export: d.date_export, perimetre: "Toutes les académies, tous les clients, tout l'historique",
    nombres: Object.fromEntries(Object.entries(d).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length])),
    factures_par_statut: Object.fromEntries(["brouillon", "emise", "envoyee", "payee", "annulee"].map((s) => [s, d.factures.filter((f) => f.statut === s).length])),
    total_ttc_a_importer_centimes: d.factures.filter((f) => f.statut !== "brouillon" && f.statut !== "annulee").reduce((s, f) => s + f.total_ttc_centimes, 0),
    controles: controles.length,
  }, null, 2);
  fichiers["LIRE-MOI.txt"] = GUIDE_IMPORT;
  return fichiers;
}

/** ZIP diffusé progressivement ; un seul PDF en mémoire, pas de limite de réponse tamponnée. */
export async function* produireArchive(
  d: DonneesPennylane,
  factures: FactureComplete[],
  rendrePdf: (f: FactureComplete) => Promise<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const morceaux: Uint8Array[] = [];
  const archive = new Zip((erreur, morceau) => {
    if (erreur) throw erreur;
    morceaux.push(morceau);
  });
  const ajouter = (nom: string, contenu: Uint8Array) => {
    const entree = new ZipPassThrough(nom);
    archive.add(entree);
    entree.push(contenu, true);
  };
  try {
    for (const [nom, contenu] of Object.entries(fichiersTabulaires(d))) {
      ajouter(nom, strToU8(contenu));
      while (morceaux.length) yield morceaux.shift()!;
    }
    for (const f of factures) {
      ajouter(cheminPdf(f.facture), await rendrePdf(f));
      while (morceaux.length) yield morceaux.shift()!;
    }
    archive.end();
    while (morceaux.length) yield morceaux.shift()!;
  } finally {
    archive.terminate();
  }
}

const GUIDE_IMPORT = `REPRISE COMPLÈTE VERS PENNYLANE

1. Ouvrir controles-avant-import.csv et compléter les clients signalés dans les CSV.
   Pays : code ISO à deux lettres (FR pour France). Aucun pays étranger n'est deviné.
2. Dans Ventes > Clients, importer clients-particuliers.csv puis clients-entreprises.csv.
   Associer les colonnes aux champs correspondants. Référence client = référence élève.
   Identifiant source est l'UUID de l'ancien logiciel, PAS un identifiant Pennylane.
   Garder la correspondance entre UUID source, référence et identifiant Pennylane.
   Les clients inactifs sont inclus. Leur statut, académie, cavaliers et copies sont
   conservés dans les fichiers ; seuls les champs mappés seront importés.
3. Dans Ventes > Produits, importer produits.csv en associant Identifiant à Identifiant.
   Contrôler l'unité, le prix HT et le régime de TVA proposé par Pennylane.
   À 0 %, choisir le régime adapté à l'association ; l'export n'invente pas de code fiscal.
4. Dans Ventes > Factures clients, importer les PDF de factures-a-importer uniquement.
   Il s'agit de factures EXISTANTES, à ne pas réémettre ni renuméroter.
   Vérifier les numéros, clients, dates, TVA et montants reconnus par Pennylane.
5. Utiliser suivi-factures-et-reglements.csv pour reprendre les paiements et leurs dates.
   Le dépôt des PDF ne garantit pas la reprise des statuts d'encaissement.
   Le logiciel source ne suit pas les paiements partiels des factures ponctuelles :
   ne pas assimiler un statut non payé à une preuve de solde intégralement dû.
   Les anciennes factures annuelles ont leurs échéances dans archives/echeances.csv
   et les arrhes dans archives/arrhes-clients.csv. Ne pas les compter deux fois.
6. Comparer les nombres et le total TTC à bilan.json, puis vérifier des factures payées,
   impayées et annuelles. Conserver ce dossier et la correspondance des identifiants.

ARCHIVES ET REPRISE MANUELLE
- archives/brouillons et archives/annulees : conservés, à ne pas déposer comme ventes.
  Les annulations nécessitent un traitement comptable à confirmer avec le cabinet.
- archives/tarifs-clients.csv : prix personnalisés effectifs, récurrence et dates.
  Les abonnements Pennylane nécessitent ensuite les identifiants clients et produits
  Pennylane. Ce fichier n'est pas une trame d'import direct d'abonnements.
- archives/donnees-source.json : toutes les données métier lues, dont extras en attente,
  paramètres de facturation, compteurs et historique des envois. Ni utilisateurs
  d'authentification, ni mots de passe, ni relevés bancaires ne font partie de cet export.
  Les PDF sont régénérés avec le moteur de l'application et les coordonnées figées
  à l'émission quand elles existent ; ce ne sont pas des fichiers originaux stockés.

Avant la bascule définitive, arrêter la saisie pendant l'export et convenir d'une
date de bascule pour les factures automatiques de l'ancien logiciel. L'export ne
désactive pas les automatismes. Il ne constitue pas un FEC et n'invente aucune
écriture comptable. Si un FEC a déjà été importé sur la même période, convenir du
traitement avec le cabinet pour éviter de comptabiliser les mêmes ventes deux fois.
Les CSV sont en UTF-8 avec séparateur point-virgule et montants en euros décimaux.
Pour conserver les zéros initiaux, importer codes postaux et identifiants comme texte.
Les textes pouvant être interprétés comme formules sont préfixés d'une apostrophe ;
les valeurs originales restent disponibles dans le JSON source.

Documentation Pennylane consultée pour cet export :
https://help.pennylane.com/fr/articles/18764-importer-et-exporter-des-clients
https://help.pennylane.com/fr/articles/18763-importer-et-exporter-des-produits
https://help.pennylane.com/fr/articles/185113-importer-une-facture-depuis-l-ordinateur-ou-le-mobile
https://help.pennylane.com/fr/articles/18720-importer-des-abonnements-en-masse
`;
