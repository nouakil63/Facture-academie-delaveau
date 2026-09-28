import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, test } from "vitest";
import { appliquerMigration, commeUtilisateur, creerBase } from "./harness";

/*
 * Facture annuelle par élève, avis d'échéance et référence élève
 * (migration 20260930000000_facture_annuelle_echeances.sql).
 */

const MIGRATION = "20260930000000_facture_annuelle_echeances.sql";
const MEMBRE = "equipe@academie-delaveau.fr";
let db: PGlite;
let ad: string; // Académie Delaveau
let ae: string; // Académie Espoir

async function un<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows[0];
}
async function tous<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

async function client(nom: string, academie = ae, reference: string | null = null) {
  return (
    await un<{ id: string }>(
      `insert into clients (academie_id, nom, prenom, email, reference) values ($1, $2, 'Asma', 'famille@example.com', $3) returning id`,
      [academie, nom, reference],
    )
  ).id;
}

async function tarif(clientId: string, libelle: string, prix: number, options: { quantite?: number; ordre?: number; debut?: string | null; fin?: string | null; prestation?: string | null; motif?: string | null; recurrent?: boolean } = {}) {
  await db.query(
    `insert into tarifs_clients (client_id, libelle, prix_unitaire_centimes, quantite, ordre, date_debut, date_fin, prestation_id, motif_reduction, recurrent)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [clientId, libelle, prix, options.quantite ?? 1, options.ordre ?? 0, options.debut ?? null, options.fin ?? null, options.prestation ?? null, options.motif ?? null, options.recurrent ?? true],
  );
}

async function arrhes(clientId: string, montant: number, saison = 2026, reglees = true) {
  await db.query(`update clients set arrhes_reglees = $2, arrhes_centimes = $3, arrhes_saison = $4 where id = $1`, [clientId, reglees, montant, saison]);
}

async function generer(saison = 2026, academie: string | null = null, apercu = false) {
  return tous<{ client_id: string; facture_id: string | null; nb_lignes: number; total_ht_centimes: number; deja_existante: boolean }>(
    `select * from generer_factures_annuelles($1, $2, $3)`,
    [saison, academie, apercu],
  );
}

async function echeances(factureId: string) {
  return tous<{ id: string; rang: number; periode: Date; montant_centimes: number; date_echeance: Date; statut: string; numero_avis: string }>(
    `select * from echeances where facture_id = $1 order by rang`,
    [factureId],
  );
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function payer(echeanceId: string, date = "2026-09-20", mode = "Virement") {
  await db.query(`update echeances set statut = 'payee', payee_le = $2, mode_paiement = $3 where id = $1`, [echeanceId, date, mode]);
}

async function facture(id: string) {
  return un<{ statut: string; payee_le: Date | null; mode_paiement: string | null; numero: string; date_echeance: Date; date_emission: Date; total_ttc_centimes: number }>(
    `select * from factures where id = $1`,
    [id],
  );
}

beforeEach(async () => {
  db = await creerBase();
  await db.query(`insert into membres (email) values ($1)`, [MEMBRE]);
  ad = (await un<{ id: string }>(`select id from academies where nom = 'Académie Delaveau'`)).id;
  ae = (await un<{ id: string }>(`select id from academies where nom = 'Académie Espoir'`)).id;
});

describe("référence élève", () => {
  test("attribuée automatiquement (prochain numéro libre), une seule série pour les deux académies", async () => {
    const a = await client("Dos Santos", ae);
    const b = await client("Martin", ad);
    const refs = await tous<{ reference: string }>(`select reference from clients where id in ($1, $2) order by created_at, id`, [a, b]);
    expect(new Set(refs.map((r) => r.reference))).toEqual(new Set(["E1", "E2"]));
    expect((await un<{ reference: string }>(`select reference from clients where id = $1`, [a])).reference).toBe("E1");

    // Référence saisie : normalisée ; la suivante repart après le plus grand numéro « E<n> ».
    const c = await client("Petit", ad, " e12 ");
    expect((await un<{ reference: string }>(`select reference from clients where id = $1`, [c])).reference).toBe("E12");
    const d = await client("Leroy", ad, "");
    expect((await un<{ reference: string }>(`select reference from clients where id = $1`, [d])).reference).toBe("E13");
    const e = await client("Hors série", ad, "SPONSOR-1");
    expect((await un<{ reference: string }>(`select reference from clients where id = $1`, [e])).reference).toBe("SPONSOR-1");
    expect((await un<{ r: string }>(`select prochaine_reference_client() as r`)).r).toBe("E14");
  });

  test("modifiable, unique, format contrôlé ; vide à la modification : inchangée", async () => {
    const a = await client("Dos Santos");
    const b = await client("Martin");
    await db.query(`update clients set reference = 'e7' where id = $1`, [a]);
    expect((await un<{ reference: string }>(`select reference from clients where id = $1`, [a])).reference).toBe("E7");
    await expect(db.query(`update clients set reference = 'E7' where id = $1`, [b])).rejects.toThrow(/clients_reference_unique/);
    await expect(db.query(`update clients set reference = 'E 8?' where id = $1`, [b])).rejects.toThrow(/clients_reference_format/);
    await db.query(`update clients set reference = '' where id = $1`, [b]);
    expect((await un<{ reference: string }>(`select reference from clients where id = $1`, [b])).reference).toBe("E2");
  });

  test("migration : les clients existants reçoivent E1, E2… dans l'ordre de création, rien d'autre ne change", async () => {
    const ancienne = await creerBase({ arreterAvant: MIGRATION });
    try {
      const q = async <T>(sql: string, params: unknown[] = []) => (await ancienne.query<T>(sql, params)).rows;
      const [academie] = await q<{ id: string }>(`select id from academies order by ordre limit 1`);
      // Créés dans le désordre alphabétique, à des dates distinctes.
      await q(`insert into clients (academie_id, nom, created_at) values ($1, 'Zola', '2026-01-01'), ($1, 'Abel', '2026-03-01'), ($1, 'Martin', '2026-02-01')`, [academie.id]);
      const [martin] = await q<{ id: string }>(`select id from clients where nom = 'Martin'`);
      await q(`insert into tarifs_clients (client_id, libelle, prix_unitaire_centimes) values ($1, 'Enseignement', 132000)`, [martin.id]);
      const [sept] = await q<{ facture_id: string }>(`select * from generer_brouillons_mensuels('2026-09-01') where client_id = $1`, [martin.id]);
      await q(`select emettre_facture($1)`, [sept.facture_id]);
      await q(`select * from generer_brouillons_mensuels('2026-10-01')`);

      const instantane = async () => ({
        clients: await q<Record<string, unknown>>(`select * from clients order by id`),
        factures: await q<Record<string, unknown>>(`select * from factures order by id`),
        lignes: await q<Record<string, unknown>>(`select * from lignes_facture order by id`),
        tarifs: await q<Record<string, unknown>>(`select * from tarifs_clients order by id`),
        vue: await q<Record<string, unknown>>(`select * from factures_vue order by id`),
      });
      const avant = await instantane();
      await appliquerMigration(ancienne, MIGRATION);
      const apres = await instantane();

      expect(await q(`select nom, reference from clients order by created_at`)).toEqual([
        { nom: "Zola", reference: "E1" },
        { nom: "Martin", reference: "E2" },
        { nom: "Abel", reference: "E3" },
      ]);
      const sans = (rows: Record<string, unknown>[], colonnes: string[]) =>
        rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !colonnes.includes(k))));
      // Clients : seule la référence est ajoutée (updated_at inchangé).
      expect(sans(apres.clients, ["reference"])).toEqual(avant.clients);
      // Factures : type « ponctuelle », sans saison ; le reste est identique (brouillon mensuel compris).
      expect(sans(apres.factures, ["type_facture", "saison"])).toEqual(avant.factures);
      expect(new Set(apres.factures.map((f) => `${f.type_facture}/${f.saison}`))).toEqual(new Set(["ponctuelle/null"]));
      expect(apres.lignes).toEqual(avant.lignes);
      expect(apres.tarifs).toEqual(avant.tarifs);
      // Vue : mêmes colonnes et valeurs pour l'existant, plus les nouvelles.
      expect(sans(apres.vue, ["type_facture", "saison", "client_reference", "echeances_actives", "echeances_payees", "echeances_reste_centimes"])).toEqual(avant.vue);
      // Nouveau client après la migration : E4.
      await q(`insert into clients (academie_id, nom) values ($1, 'Nouveau')`, [academie.id]);
      expect(await q(`select reference from clients where nom = 'Nouveau'`)).toEqual([{ reference: "E4" }]);
    } finally {
      await ancienne.close();
    }
  });
});

describe("génération des factures annuelles", () => {
  test("brouillon annuel : une ligne par tarif, prix mensuel × 10, catalogue × 10, motif, objet ; idempotente", async () => {
    const academicien = (await un<{ id: string }>(`insert into prestations (libelle, prix_unitaire_centimes) values ('Académicien Delaveau', 240000) returning id`)).id;
    const c = await client("Dos Santos");
    await tarif(c, "Enseignement", 210000, { prestation: academicien, motif: "Prise en charge 50 % location cheval", ordre: 1 });
    await tarif(c, "Cours", 4000, { quantite: 2, ordre: 2 });
    await tarif(c, "Stage", 20000, { recurrent: false, ordre: 3 }); // ponctuel : exclu

    const apercu = await generer(2026, null, true);
    expect(apercu).toEqual([{ client_id: c, facture_id: null, nb_lignes: 2, total_ht_centimes: 2100000 + 80000, deja_existante: false }]);
    expect((await un<{ n: number }>(`select count(*)::int as n from factures`)).n).toBe(0);

    const [r] = await generer(2026);
    expect(r).toMatchObject({ client_id: c, nb_lignes: 2, total_ht_centimes: 2180000, deja_existante: false });
    const f = await un<Record<string, unknown>>(`select * from factures where id = $1`, [r.facture_id]);
    expect(f).toMatchObject({
      statut: "brouillon",
      type_facture: "annuelle",
      saison: 2026,
      periode: null,
      generation_auto: true,
      objet: "Formation et accompagnement – saison 2026-2027",
      total_ht_centimes: 2180000,
    });
    expect(await tous(`select libelle, quantite::float as quantite, prix_unitaire_centimes, prix_catalogue_centimes, motif_reduction, deduction_arrhes_centimes, total_centimes
                         from lignes_facture where facture_id = $1 order by ordre`, [r.facture_id])).toEqual([
      { libelle: "Enseignement – 2026-2027", quantite: 1, prix_unitaire_centimes: 2100000, prix_catalogue_centimes: 2400000, motif_reduction: "Prise en charge 50 % location cheval", deduction_arrhes_centimes: null, total_centimes: 2100000 },
      { libelle: "Cours – 2026-2027", quantite: 2, prix_unitaire_centimes: 40000, prix_catalogue_centimes: null, motif_reduction: null, deduction_arrhes_centimes: null, total_centimes: 80000 },
    ]);

    // Relancer : aucun doublon (aperçu compris), même pour une facture annuelle déjà émise.
    const [encore] = await generer(2026);
    expect(encore).toMatchObject({ facture_id: r.facture_id, deja_existante: true, total_ht_centimes: 2180000 });
    await db.query(`select emettre_facture($1)`, [r.facture_id]);
    expect(await generer(2026, null, true)).toMatchObject([{ facture_id: r.facture_id, deja_existante: true }]);
    expect((await un<{ n: number }>(`select count(*)::int as n from factures`)).n).toBe(1);
    await expect(db.query(`insert into factures (client_id, type_facture, saison) values ($1, 'annuelle', 2026)`, [c])).rejects.toThrow(/factures_annuelle_unique/);
    // Autre saison : autre facture.
    expect(await generer(2027, null, true)).toMatchObject([{ facture_id: null, deja_existante: false }]);
  });

  test("tarif valide une partie de la saison : prix × nombre de mois ; clients inactifs ou sans tarif valide exclus ; filtre d'académie", async () => {
    const partiel = await client("Arrivée", ae);
    await tarif(partiel, "Enseignement", 100000, { debut: "2026-11-15" }); // novembre → juin : 8 mois
    await tarif(partiel, "Licence", 1000, { fin: "2026-08-31" }); // terminé avant la saison : exclu
    const delaveau = await client("Martin", ad);
    await tarif(delaveau, "Pension", 50000);
    const inactif = await client("Parti", ae);
    await tarif(inactif, "Pension", 50000);
    await db.query(`update clients set actif = false where id = $1`, [inactif]);
    const tarifInactif = await client("Sans", ae);
    await tarif(tarifInactif, "Pension", 50000);
    await db.query(`update tarifs_clients set actif = false where client_id = $1`, [tarifInactif]);

    expect((await generer(2026, ad, true)).map((r) => r.client_id)).toEqual([delaveau]);
    const espoir = await generer(2026, ae);
    expect(espoir.map((r) => r.client_id)).toEqual([partiel]);
    expect(espoir[0].total_ht_centimes).toBe(800000);
    expect(await tous(`select libelle, prix_unitaire_centimes from lignes_facture where facture_id = $1`, [espoir[0].facture_id])).toEqual([
      { libelle: "Enseignement – 2026-2027 (8 mois)", prix_unitaire_centimes: 800000 },
    ]);
    await expect(db.query(`select * from generer_factures_annuelles(1999)`)).rejects.toThrow(/Saison invalide/);
  });

  test("une facture annuelle annulée peut être régénérée", async () => {
    const c = await client("Dos Santos");
    await tarif(c, "Enseignement", 132000);
    const [r] = await generer();
    await db.query(`select emettre_facture($1)`, [r.facture_id]);
    await db.query(`update factures set statut = 'annulee', motif_annulation = 'Erreur' where id = $1`, [r.facture_id]);
    const [r2] = await generer();
    expect(r2.deja_existante).toBe(false);
    expect(r2.facture_id).not.toBe(r.facture_id);
  });
});

describe("échéances créées à l'émission", () => {
  async function asmaDosSantos() {
    // Cas réel : Académie Espoir, E1, 1 320 €/mois → 13 200 €/an, arrhes 3 960 € → 10 × 924 €.
    const c = await client("Dos Santos");
    await tarif(c, "Enseignement", 132000);
    await arrhes(c, 396000);
    const [r] = await generer();
    return { c, factureId: r.facture_id! };
  }

  test("cas réel : 13 200 € − 3 960 € d'arrhes = 10 × 924 €, numéros d'avis E1-AAAA-MM, dates au jour de génération + délai", async () => {
    const { factureId } = await asmaDosSantos();
    await db.query(`update parametres set jour_generation = 5, delai_paiement_jours = 10`);
    // Les brouillons n'ont pas d'échéance.
    expect(await echeances(factureId)).toEqual([]);
    const f = await un<{ numero: string; total_ttc_centimes: number; date_echeance: Date; date_emission: Date }>(`select * from emettre_facture($1)`, [factureId]);
    expect(f.numero).toMatch(/^AD-\d{4}-0001$/);
    expect(f.total_ttc_centimes).toBe(1320000);

    const liste = await echeances(factureId);
    expect(liste.map((e) => e.montant_centimes)).toEqual(Array(10).fill(92400));
    expect(liste.reduce((s, e) => s + e.montant_centimes, 0)).toBe(1320000 - 396000);
    expect(liste.map((e) => e.numero_avis)).toEqual([
      "E1-2026-09", "E1-2026-10", "E1-2026-11", "E1-2026-12", "E1-2027-01",
      "E1-2027-02", "E1-2027-03", "E1-2027-04", "E1-2027-05", "E1-2027-06",
    ]);
    expect(liste.map((e) => iso(e.periode))).toEqual([
      "2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01",
      "2027-02-01", "2027-03-01", "2027-04-01", "2027-05-01", "2027-06-01",
    ]);
    expect(new Set(liste.map((e) => e.statut))).toEqual(new Set(["a_venir"]));
    // Date d'échéance : 5 du mois + 10 jours, jamais avant la date d'émission (+ délai).
    const emission = iso(f.date_emission);
    for (const e of liste) {
      const [a, m] = iso(e.periode).split("-").map(Number);
      const theorique = new Date(Date.UTC(a, m - 1, 5));
      const depart = theorique.toISOString().slice(0, 10) < emission ? new Date(`${emission}T00:00:00Z`) : theorique;
      depart.setUTCDate(depart.getUTCDate() + 10);
      expect(iso(e.date_echeance)).toBe(depart.toISOString().slice(0, 10));
    }
    // Échéance de la facture annuelle = celle de juin.
    expect(iso(f.date_echeance)).toBe(iso(liste[9].date_echeance));
    // La vue indique l'avancement.
    expect(await un(`select echeances_actives, echeances_payees, echeances_reste_centimes, client_reference from factures_vue where id = $1`, [factureId])).toEqual({
      echeances_actives: 10, echeances_payees: 0, echeances_reste_centimes: 924000, client_reference: "E1",
    });
  });

  test("juin reçoit le reste (total exact) ; arrhes d'une autre saison ou non réglées : pas de déduction ; TVA comprise", async () => {
    const c = await client("Reste");
    await tarif(c, "Enseignement", 100007); // 1 000 070 par an
    await arrhes(c, 45000, 2025); // autre saison : ignorées
    const [r] = await generer();
    await db.query(`select emettre_facture($1)`, [r.facture_id]);
    const liste = await echeances(r.facture_id!);
    expect(liste.slice(0, 9).map((e) => e.montant_centimes)).toEqual(Array(9).fill(100007));
    expect(liste[9].montant_centimes).toBe(1000070 - 9 * 100007);
    expect(liste.reduce((s, e) => s + e.montant_centimes, 0)).toBe(1000070);

    const nonReglees = await client("Non réglées");
    await tarif(nonReglees, "Enseignement", 10000);
    await arrhes(nonReglees, 5000, 2026, false);
    await db.query(`update parametres set taux_tva = 20`);
    const [r2] = (await generer()).filter((x) => x.client_id === nonReglees);
    await db.query(`select emettre_facture($1)`, [r2.facture_id]);
    const liste2 = await echeances(r2.facture_id!);
    expect(liste2.reduce((s, e) => s + e.montant_centimes, 0)).toBe(120000); // TTC
    expect(liste2[0].numero_avis).toBe("E2-2026-09");
  });

  test("arrhes ≥ total : aucune échéance ; facture ponctuelle : aucune échéance", async () => {
    const c = await client("Tout payé");
    await tarif(c, "Enseignement", 1000);
    await arrhes(c, 10000);
    const [r] = await generer();
    await db.query(`select emettre_facture($1)`, [r.facture_id]);
    expect(await echeances(r.facture_id!)).toEqual([]);

    const ponctuelle = (await un<{ id: string }>(`insert into factures (client_id) values ($1) returning id`, [c])).id;
    await db.query(`insert into lignes_facture (facture_id, libelle, prix_unitaire_centimes) values ($1, 'Stage', 20000)`, [ponctuelle]);
    const f = await un<{ date_echeance: Date; date_emission: Date; type_facture: string }>(`select * from emettre_facture($1)`, [ponctuelle]);
    expect(f.type_facture).toBe("ponctuelle");
    expect((f.date_echeance.getTime() - f.date_emission.getTime()) / 86400000).toBe(30);
    expect(await echeances(ponctuelle)).toEqual([]);
  });

  test("numéro d'avis déjà utilisé par une facture annulée : suffixe", async () => {
    const { factureId } = await asmaDosSantos();
    await db.query(`select emettre_facture($1)`, [factureId]);
    const [premiere] = await echeances(factureId);
    await payer(premiere.id);
    await db.query(`update factures set statut = 'annulee', motif_annulation = 'Tarif erroné' where id = $1`, [factureId]);
    const [r] = await generer();
    await db.query(`select emettre_facture($1)`, [r.facture_id]);
    const nouvelles = await echeances(r.facture_id!);
    expect(nouvelles[0].numero_avis).toBe("E1-2026-09-2");
    expect(nouvelles[1].numero_avis).toBe("E1-2026-10-2");
  });

  test("échéances protégées : création hors émission, suppression, montants et transitions", async () => {
    const { factureId, c } = await asmaDosSantos();
    await db.query(`select emettre_facture($1)`, [factureId]);
    const [e] = await echeances(factureId);
    await expect(
      db.query(`insert into echeances (facture_id, client_id, rang, periode, montant_centimes, date_echeance, numero_avis) values ($1, $2, 1, '2026-09-01', 1, '2026-10-01', 'X-1')`, [factureId, c]),
    ).rejects.toThrow(/émission/);
    await expect(db.query(`delete from echeances where id = $1`, [e.id])).rejects.toThrow(/supprimée/);
    await expect(db.query(`update echeances set montant_centimes = 1 where id = $1`, [e.id])).rejects.toThrow(/figés/);
    await expect(db.query(`update echeances set numero_avis = 'Z' where id = $1`, [e.id])).rejects.toThrow(/figés/);
    await expect(db.query(`update echeances set statut = 'payee' where id = $1`, [e.id])).rejects.toThrow(/date de paiement/);
    await expect(db.query(`update echeances set statut = 'annulee' where id = $1`, [e.id])).rejects.toThrow(/avec sa facture/);
    await db.query(`update echeances set statut = 'envoyee', envoyee_le = now() where id = $1`, [e.id]);
    await expect(db.query(`update echeances set statut = 'a_venir' where id = $1`, [e.id])).rejects.toThrow(/interdite/);
    // Annulation du paiement : retour à « envoyée », informations de paiement effacées.
    await payer(e.id);
    await db.query(`update echeances set statut = 'envoyee' where id = $1`, [e.id]);
    expect(await un(`select statut, payee_le, mode_paiement from echeances where id = $1`, [e.id])).toEqual({ statut: "envoyee", payee_le: null, mode_paiement: null });
    // Contenu de la facture annuelle émise figé, type et saison compris.
    await expect(db.query(`update factures set saison = 2027 where id = $1`, [factureId])).rejects.toThrow(/ne peut plus être modifié/);
    await expect(db.query(`update factures set type_facture = 'ponctuelle' where id = $1`, [factureId])).rejects.toThrow(/ne peut plus être modifié/);
  });
});

describe("arrhes lues à l'émission et recalcul d'un brouillon depuis les tarifs", () => {
  test("arrhes modifiées après la préparation du brouillon : prises en compte à l'émission, sans rien refaire", async () => {
    const c = await client("Dos Santos");
    await tarif(c, "Enseignement", 132000);
    const [r] = await generer(); // brouillon préparé sans arrhes
    // Arrhes saisies ensuite sur la fiche : 3 960 €.
    await arrhes(c, 396000);
    await db.query(`select emettre_facture($1)`, [r.facture_id]);
    expect((await echeances(r.facture_id!)).map((e) => e.montant_centimes)).toEqual(Array(10).fill(92400));
    // Arrhes modifiées APRÈS l'émission : échéancier figé.
    await arrhes(c, 100000);
    expect((await echeances(r.facture_id!)).reduce((s, e) => s + e.montant_centimes, 0)).toBe(924000);
    const f = await un<{ client_snapshot: Record<string, unknown> }>(`select client_snapshot from factures where id = $1`, [r.facture_id]);
    expect(f.client_snapshot).toMatchObject({ arrhes_reglees: true, arrhes_centimes: 396000, arrhes_saison: 2026, reference: "E1" });
  });

  test("brouillon annuel : lignes remplacées par les tarifs et réductions actuels ; facture émise refusée", async () => {
    const p = (await un<{ id: string }>(`insert into prestations (libelle, prix_unitaire_centimes) values ('Académicien', 240000) returning id`)).id;
    const c = await client("Dos Santos");
    await tarif(c, "Enseignement", 132000, { prestation: p, ordre: 1 });
    const [r] = await generer();
    const f = r.facture_id!;
    // Modification à la main, puis changement de tarif (réduction motivée) et nouvelle ligne.
    await db.query(`insert into lignes_facture (facture_id, libelle, prix_unitaire_centimes, ordre) values ($1, 'Ajout manuel', 5000, 9)`, [f]);
    await db.query(`update tarifs_clients set prix_unitaire_centimes = 210000, motif_reduction = 'Prise en charge 50 % location cheval' where client_id = $1`, [c]);
    await tarif(c, "Licence", 500, { ordre: 2 });
    expect((await un<{ n: number }>(`select recalculer_brouillon($1) as n`, [f])).n).toBe(2);
    expect(await tous(`select libelle, prix_unitaire_centimes, prix_catalogue_centimes, motif_reduction from lignes_facture where facture_id = $1 order by ordre`, [f])).toEqual([
      { libelle: "Enseignement – 2026-2027", prix_unitaire_centimes: 2100000, prix_catalogue_centimes: 2400000, motif_reduction: "Prise en charge 50 % location cheval" },
      { libelle: "Licence – 2026-2027", prix_unitaire_centimes: 5000, prix_catalogue_centimes: null, motif_reduction: null },
    ]);
    expect((await facture(f)).total_ttc_centimes).toBe(2105000);
    // Aucun tarif valide : refus, lignes conservées.
    await db.query(`update tarifs_clients set actif = false where client_id = $1`, [c]);
    await expect(db.query(`select recalculer_brouillon($1)`, [f])).rejects.toThrow(/rien à recalculer/);
    expect((await un<{ n: number }>(`select count(*)::int as n from lignes_facture where facture_id = $1`, [f])).n).toBe(2);
    await db.query(`update tarifs_clients set actif = true where client_id = $1`, [c]);
    // Facture émise : refus.
    await db.query(`select emettre_facture($1)`, [f]);
    await expect(db.query(`select recalculer_brouillon($1)`, [f])).rejects.toThrow(/Seul un brouillon/);
    // Brouillon saisi à la main : refus.
    const manuel = (await un<{ id: string }>(`insert into factures (client_id) values ($1) returning id`, [c])).id;
    await expect(db.query(`select recalculer_brouillon($1)`, [manuel])).rejects.toThrow(/saisi à la main/);
  });

  test("ancien brouillon mensuel : recalculé comme generer_brouillons_mensuels (arrhes déduites), sans changer de type", async () => {
    const c = await client("Martin");
    await tarif(c, "Enseignement", 132000, { ordre: 1 });
    await tarif(c, "Cours", 4000, { quantite: 2, ordre: 2 });
    const [m] = (await tous<{ facture_id: string }>(`select * from generer_brouillons_mensuels('2026-10-01') where client_id = $1`, [c]));
    const avant = await tous(`select ordre, libelle, quantite, prix_unitaire_centimes, prestation_id, prix_catalogue_centimes, motif_reduction, deduction_arrhes_centimes from lignes_facture where facture_id = $1 order by ordre`, [m.facture_id]);
    // Recalcul sans changement : lignes identiques à la génération.
    await db.query(`select recalculer_brouillon($1)`, [m.facture_id]);
    expect(await tous(`select ordre, libelle, quantite, prix_unitaire_centimes, prestation_id, prix_catalogue_centimes, motif_reduction, deduction_arrhes_centimes from lignes_facture where facture_id = $1 order by ordre`, [m.facture_id])).toEqual(avant);
    // Arrhes ajoutées : déduction appliquée sur la ligne de quantité 1 la plus chère.
    await arrhes(c, 396000);
    await db.query(`select recalculer_brouillon($1)`, [m.facture_id]);
    expect(await tous(`select libelle, prix_unitaire_centimes, deduction_arrhes_centimes from lignes_facture where facture_id = $1 order by ordre`, [m.facture_id])).toEqual([
      { libelle: "Enseignement", prix_unitaire_centimes: 132000 - 39600, deduction_arrhes_centimes: 39600 },
      { libelle: "Cours", prix_unitaire_centimes: 4000, deduction_arrhes_centimes: null },
    ]);
    // Même résultat qu'une génération neuve pour un autre client identique.
    const d = await client("Durand");
    await tarif(d, "Enseignement", 132000, { ordre: 1 });
    await tarif(d, "Cours", 4000, { quantite: 2, ordre: 2 });
    await arrhes(d, 396000);
    const [g] = await tous<{ facture_id: string; total_ht_centimes: number }>(`select * from generer_brouillons_mensuels('2026-10-01') where client_id = $1`, [d]);
    expect((await facture(m.facture_id)).total_ttc_centimes).toBe(g.total_ht_centimes);
    expect(await un(`select type_facture, periode::text as periode from factures where id = $1`, [m.facture_id])).toEqual({ type_facture: "ponctuelle", periode: "2026-10-01" });
  });
});

describe("paiement et annulation de la facture annuelle", () => {
  async function emise() {
    const c = await client("Dos Santos");
    await tarif(c, "Enseignement", 132000);
    await arrhes(c, 396000);
    const [r] = await generer();
    await db.query(`select emettre_facture($1)`, [r.facture_id]);
    await db.query(`update factures set statut = 'envoyee', envoyee_le = now() where id = $1`, [r.facture_id]);
    return r.facture_id!;
  }

  test("payée automatiquement quand toutes les échéances le sont (date du dernier paiement), rouverte si un paiement est annulé", async () => {
    const f = await emise();
    const liste = await echeances(f);
    // Paiement manuel de la facture refusé tant que des échéances restent dues.
    await expect(db.query(`update factures set statut = 'payee', payee_le = current_date where id = $1`, [f])).rejects.toThrow(/échéances/);
    for (const [i, e] of liste.entries()) {
      await payer(e.id, `2026-${String(9 + Math.min(i, 3)).padStart(2, "0")}-1${i % 10}`, "Virement");
      const attendu = i < liste.length - 1 ? "envoyee" : "payee";
      expect((await facture(f)).statut).toBe(attendu);
    }
    const payee = await facture(f);
    expect(iso(payee.payee_le!)).toBe("2026-12-19");
    expect(payee.mode_paiement).toBe("Virement");
    expect(await un(`select echeances_payees, echeances_reste_centimes, en_retard from factures_vue where id = $1`, [f])).toEqual({
      echeances_payees: 10, echeances_reste_centimes: 0, en_retard: false,
    });
    // Rouvrir la facture sans passer par une échéance : refusé.
    await expect(db.query(`update factures set statut = 'envoyee' where id = $1`, [f])).rejects.toThrow(/annuler le paiement d'une échéance/);
    // Annulation du paiement d'une échéance : la facture redevient « envoyée ».
    await db.query(`update echeances set statut = 'envoyee' where id = $1`, [liste[9].id]);
    expect(await facture(f)).toMatchObject({ statut: "envoyee", payee_le: null, mode_paiement: null });
    // Modes différents : « Échéancier ».
    await payer(liste[9].id, "2027-06-10", "Chèque");
    expect(await facture(f)).toMatchObject({ statut: "payee", mode_paiement: "Échéancier" });
  });

  test("facture annulée : échéances non payées annulées, paiements reçus conservés, plus aucune modification", async () => {
    const f = await emise();
    const liste = await echeances(f);
    await payer(liste[0].id);
    await db.query(`update echeances set statut = 'envoyee', envoyee_le = now() where id = $1`, [liste[1].id]);
    await db.query(`update factures set statut = 'annulee', motif_annulation = 'Départ' where id = $1`, [f]);
    const apres = await echeances(f);
    expect(apres.map((e) => e.statut)).toEqual(["payee", ...Array(9).fill("annulee")]);
    expect((await un<{ annulee_le: Date | null }>(`select annulee_le from echeances where id = $1`, [liste[5].id])).annulee_le).not.toBeNull();
    await expect(db.query(`update echeances set statut = 'a_venir' where id = $1`, [liste[0].id])).rejects.toThrow(/annulée/);
    await expect(db.query(`update echeances set statut = 'payee', payee_le = current_date where id = $1`, [liste[5].id])).rejects.toThrow(/réactivée/);
  });

  test("retards : échéance échue non payée → échéance et facture annuelle en retard", async () => {
    const f = await emise();
    const [premiere] = await echeances(f);
    expect(await un(`select en_retard from factures_vue where id = $1`, [f])).toEqual({ en_retard: false });
    await db.exec(`alter table echeances disable trigger a_echeances_proteger`);
    await db.query(`update echeances set date_echeance = current_date - 3 where id = $1`, [premiere.id]);
    await db.exec(`alter table echeances enable trigger a_echeances_proteger`);
    expect(await un(`select en_retard from echeances_vue where id = $1`, [premiere.id])).toEqual({ en_retard: true });
    expect(await un(`select en_retard from factures_vue where id = $1`, [f])).toEqual({ en_retard: true });
    await payer(premiere.id);
    expect(await un(`select en_retard from factures_vue where id = $1`, [f])).toEqual({ en_retard: false });
    // La vue des échéances donne la facture, le client et l'académie figée.
    expect(await un(`select facture_numero is not null as n, saison, client_reference, academie_nom from echeances_vue where id = $1`, [premiere.id])).toEqual({
      n: true, saison: 2026, client_reference: "E1", academie_nom: "Académie Espoir",
    });
  });
});

describe("journal, paramètres et sécurité", () => {
  test("modèles d'e-mail des avis par défaut ; envoi d'avis journalisé avec l'échéance", async () => {
    const p = await un<{ email_avis_objet: string; email_avis_corps: string }>(`select email_avis_objet, email_avis_corps from parametres`);
    expect(p.email_avis_objet).toBe("Avis d'échéance {numero} – {structure}");
    expect(p.email_avis_corps).toContain("Bonjour {client},");
    expect(p.email_avis_corps).toContain("l'avis d'échéance {numero} de {montant} à régler avant le {echeance}");

    const c = await client("Dos Santos");
    await tarif(c, "Enseignement", 132000);
    const [r] = await generer();
    await db.query(`select emettre_facture($1)`, [r.facture_id]);
    const [e] = await echeances(r.facture_id!);
    await db.query(`insert into envois_email (facture_id, echeance_id, destinataires, objet, succes) values ($1, $2, '{a@b.fr}', 'Avis', true)`, [r.facture_id, e.id]);
    expect(await un(`select count(*)::int as n from envois_email where echeance_id = $1`, [e.id])).toEqual({ n: 1 });
  });

  test("RLS : un membre génère, émet et règle ; un non-membre ne voit ni échéances ni vues ; anon n'a pas accès", async () => {
    const c = await client("Dos Santos");
    await tarif(c, "Enseignement", 132000);
    const factureId = await commeUtilisateur(db, MEMBRE, async () => {
      const [r] = await generer();
      await db.query(`select emettre_facture($1)`, [r.facture_id]);
      const [e] = await echeances(r.facture_id!);
      await payer(e.id);
      expect((await un<{ n: number }>(`select count(*)::int as n from echeances_vue`)).n).toBe(10);
      return r.facture_id!;
    });
    expect((await echeances(factureId))[0].statut).toBe("payee");
    await commeUtilisateur(db, "intrus@example.com", async () => {
      expect(await tous(`select * from echeances`)).toHaveLength(0);
      expect(await tous(`select * from echeances_vue`)).toHaveLength(0);
      expect(await tous(`select * from factures_vue`)).toHaveLength(0);
      expect(await tous(`update echeances set statut = 'envoyee' returning id`)).toHaveLength(0);
      await expect(db.query(`select * from generer_factures_annuelles(2026, null, true)`)).rejects.toThrow(/Paramètres/);
    });
    await db.exec(`set role anon`);
    try {
      await expect(db.query(`select * from generer_factures_annuelles(2026, null, true)`)).rejects.toThrow(/permission/);
      await expect(db.query(`select prochaine_reference_client()`)).rejects.toThrow(/permission/);
    } finally {
      await db.exec(`reset role`);
    }
  });
});
