import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, test } from "vitest";
import { appliquerMigration, commeUtilisateur, creerBase } from "./harness";

const MEMBRE = "equipe@academie-delaveau.fr";
let db: PGlite;
let ad: string; // académie Delaveau
let ae: string; // académie Espoir

async function un<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

async function client(academie: string, nom = "Martin") {
  return (await un<{ id: string }>(
    `insert into clients (academie_id, nom, prenom, email) values ($1, $2, 'Julie', 'julie@example.com') returning id`,
    [academie, nom],
  )).id;
}

async function prestation(prix: number, libelle = "Pension et entraînement") {
  return (await un<{ id: string }>(
    `insert into prestations (libelle, prix_unitaire_centimes) values ($1, $2) returning id`,
    [libelle, prix],
  )).id;
}

async function brouillon(clientId: string, lignes: [string, number, number][]) {
  const f = (await un<{ id: string }>(
    `insert into factures (client_id) values ($1) returning id`,
    [clientId],
  )).id;
  for (const [libelle, quantite, pu] of lignes) {
    await db.query(
      `insert into lignes_facture (facture_id, libelle, quantite, prix_unitaire_centimes) values ($1, $2, $3, $4)`,
      [f, libelle, quantite, pu],
    );
  }
  return f;
}

beforeEach(async () => {
  db = await creerBase();
  await db.query(`insert into membres (email) values ($1)`, [MEMBRE]);
  ad = (await un<{ id: string }>(`select id from academies where nom = 'Académie Delaveau'`)).id;
  ae = (await un<{ id: string }>(`select id from academies where nom = 'Académie Espoir'`)).id;
});

describe("données initiales", () => {
  test("paramètres de l'association et deux académies", async () => {
    const p = await un<{ raison_sociale: string; siret: string; rna: string; conditions_paiement: string }>(
      `select * from parametres`);
    expect(p.raison_sociale).toBe("Académie Delaveau");
    // Conditions cohérentes avec l'échéance à 30 jours imprimée juste au-dessus.
    expect(p.conditions_paiement).toBe("Paiement par virement bancaire au plus tard à la date d'échéance.");
    expect(p.siret).toBe("853 472 298 00019");
    expect(p.rna).toBe("W143007272");
    const rows = (await db.query<{ nom: string }>(`select nom from academies order by ordre`)).rows;
    expect(rows.map((r) => r.nom)).toEqual(["Académie Delaveau", "Académie Espoir"]);
  });

  test("les paramètres sont une ligne unique", async () => {
    await expect(db.query(`insert into parametres (raison_sociale) values ('Autre')`)).rejects.toThrow();
    await expect(db.query(`delete from parametres`)).rejects.toThrow(/supprimés/);
  });
});

describe("totaux", () => {
  test("le total HT d'un brouillon suit ses lignes", async () => {
    const c = await client(ad);
    const f = await brouillon(c, [["Pension", 1, 45000], ["Cours", 2.5, 3000]]);
    let row = await un<{ total_ht_centimes: number; total_ttc_centimes: number }>(`select * from factures where id = $1`, [f]);
    expect(row.total_ht_centimes).toBe(52500);
    expect(row.total_ttc_centimes).toBe(52500);
    await db.query(`delete from lignes_facture where facture_id = $1 and libelle = 'Cours'`, [f]);
    row = await un(`select * from factures where id = $1`, [f]);
    expect(row.total_ht_centimes).toBe(45000);
  });

  test("un nouveau taux de TVA s'applique aux brouillons, pas aux factures émises", async () => {
    const c = await client(ad);
    const emise = await brouillon(c, [["A", 1, 10000]]);
    await db.query(`select emettre_facture($1)`, [emise]);
    const f = await brouillon(c, [["B", 1, 45000]]);
    await db.query(`update parametres set taux_tva = 20`);
    const b = await un<{ taux_tva: string; total_ttc_centimes: number }>(`select * from factures where id = $1`, [f]);
    expect(Number(b.taux_tva)).toBe(20);
    expect(b.total_ttc_centimes).toBe(54000);
    const e = await un<{ taux_tva: string; total_ttc_centimes: number }>(`select * from factures where id = $1`, [emise]);
    expect(Number(e.taux_tva)).toBe(0);
    expect(e.total_ttc_centimes).toBe(10000);
  });

  test("la TVA est calculée si un taux est défini", async () => {
    await db.query(`update parametres set taux_tva = 20`);
    const c = await client(ad);
    const f = await brouillon(c, [["Pension", 1, 10000]]);
    const row = await un<{ total_tva_centimes: number; total_ttc_centimes: number }>(
      `select * from emettre_facture($1)`, [f]);
    expect(row.total_tva_centimes).toBe(2000);
    expect(row.total_ttc_centimes).toBe(12000);
  });
});

describe("émission et numérotation", () => {
  test("une seule série continue par année, quelle que soit l'académie", async () => {
    const c1 = await client(ad);
    const c2 = await client(ae);
    const a1 = await un<{ numero: string }>(`select * from emettre_facture($1)`, [await brouillon(c1, [["A", 1, 100]])]);
    const e1 = await un<{ numero: string; academie_id: string }>(`select * from emettre_facture($1)`, [await brouillon(c2, [["C", 1, 100]])]);
    const a2 = await un<{ numero: string }>(`select * from emettre_facture($1)`, [await brouillon(c1, [["B", 1, 100]])]);
    const annee = (await un<{ a: number }>(`select extract(year from aujourdhui_paris())::int as a`)).a;
    expect(a1.numero).toBe(`AD-${annee}-0001`);
    expect(e1.numero).toBe(`AD-${annee}-0002`);
    expect(a2.numero).toBe(`AD-${annee}-0003`);
    expect(e1.academie_id).toBe(ae);
  });

  test("le préfixe est modifiable avant la première émission, figé ensuite", async () => {
    await db.query(`update parametres set prefixe_facture = 'FA'`);
    const c = await client(ad);
    const f = await un<{ numero: string }>(`select * from emettre_facture($1)`, [await brouillon(c, [["A", 1, 100]])]);
    expect(f.numero).toMatch(/^FA-/);
    await expect(db.query(`update parametres set prefixe_facture = 'AD'`)).rejects.toThrow(/continue/);
    await db.query(`update parametres set iban = 'FR7630006000011234567890189'`);
  });

  test("l'académie de la facture suit celle du client tant qu'elle est en brouillon", async () => {
    const c = await client(ad);
    const f = await brouillon(c, [["A", 1, 100]]);
    await db.query(`update clients set academie_id = $1 where id = $2`, [ae, c]);
    await db.query(`update factures set objet = 'x' where id = $1`, [f]);
    expect((await un<{ academie_id: string }>(`select academie_id from factures where id = $1`, [f])).academie_id).toBe(ae);
    const emise = await un<{ academie_snapshot: { nom: string } }>(`select * from emettre_facture($1)`, [f]);
    expect(emise.academie_snapshot.nom).toBe("Académie Espoir");
    await db.query(`update clients set academie_id = $1 where id = $2`, [ad, c]);
    await db.query(`update factures set notes_internes = 'x' where id = $1`, [f]);
    expect((await un<{ academie_id: string }>(`select academie_id from factures where id = $1`, [f])).academie_id).toBe(ae);
  });

  test("les brouillons suivent immédiatement un changement d'académie du client", async () => {
    const c = await client(ad);
    const brouillonAvant = await brouillon(c, [["A", 1, 100]]);
    const emise = await brouillon(c, [["B", 1, 100]]);
    await db.query(`select emettre_facture($1)`, [emise]);
    await db.query(`update clients set academie_id = $1 where id = $2`, [ae, c]);
    const academie = async (id: string) =>
      (await un<{ academie_id: string }>(`select academie_id from factures where id = $1`, [id])).academie_id;
    expect(await academie(brouillonAvant)).toBe(ae);
    expect(await academie(emise)).toBe(ad);
    // Une autre modification du client ne touche pas aux factures.
    await db.query(`update clients set telephone = '0600000000' where id = $1`, [c]);
    expect(await academie(emise)).toBe(ad);
  });

  test("au-delà de 9999 factures dans l'année, le numéro s'allonge sans être tronqué", async () => {
    const annee = (await un<{ a: number }>(`select extract(year from aujourdhui_paris())::int as a`)).a;
    await db.query(`insert into compteurs_factures (annee, dernier_numero) values ($1, 9999)`, [annee]);
    const c = await client(ad);
    const f = await un<{ numero: string }>(`select * from emettre_facture($1)`, [await brouillon(c, [["A", 1, 100]])]);
    expect(f.numero).toBe(`AD-${annee}-10000`);
  });

  test("l'émission fige les coordonnées et fixe l'échéance", async () => {
    const c = await client(ad);
    const f = await brouillon(c, [["A", 1, 100]]);
    const row = await un<{ statut: string; date_emission: Date; date_echeance: Date; client_snapshot: { nom: string } }>(
      `select * from emettre_facture($1)`, [f]);
    expect(row.statut).toBe("emise");
    expect(row.client_snapshot.nom).toBe("Martin");
    const jours = (row.date_echeance.getTime() - row.date_emission.getTime()) / 86400000;
    expect(jours).toBe(30);
  });

  test("impossible d'émettre une facture vide ou déjà émise", async () => {
    const c = await client(ad);
    const vide = await brouillon(c, []);
    await expect(db.query(`select emettre_facture($1)`, [vide])).rejects.toThrow(/aucune ligne/);
    const f = await brouillon(c, [["A", 1, 100]]);
    await db.query(`select emettre_facture($1)`, [f]);
    await expect(db.query(`select emettre_facture($1)`, [f])).rejects.toThrow(/déjà émise/);
  });

  test("un échec d'émission ne consomme pas de numéro", async () => {
    const c = await client(ad);
    const vide = await brouillon(c, []);
    await expect(db.query(`select emettre_facture($1)`, [vide])).rejects.toThrow();
    const ok = await un<{ sequence: number }>(`select * from emettre_facture($1)`, [await brouillon(c, [["A", 1, 1]])]);
    expect(ok.sequence).toBe(1);
  });

  test("on ne peut pas passer un brouillon en émis sans la fonction", async () => {
    const c = await client(ad);
    const f = await brouillon(c, [["A", 1, 100]]);
    await expect(
      db.query(`update factures set statut = 'emise', numero = 'X-1', date_emission = current_date where id = $1`, [f]),
    ).rejects.toThrow(/emettre_facture/);
    await expect(db.query(`update factures set numero = 'X-1' where id = $1`, [f])).rejects.toThrow();
  });
});

describe("intégrité des factures émises", () => {
  let f: string;
  beforeEach(async () => {
    const c = await client(ad);
    f = await brouillon(c, [["A", 1, 100]]);
    await db.query(`select emettre_facture($1)`, [f]);
  });

  test("contenu et lignes non modifiables", async () => {
    await expect(db.query(`update factures set notes = 'x' where id = $1`, [f])).rejects.toThrow(/ne peut plus être modifié/);
    await expect(db.query(`update lignes_facture set prix_unitaire_centimes = 1 where facture_id = $1`, [f])).rejects.toThrow();
    await expect(db.query(`insert into lignes_facture (facture_id, libelle, prix_unitaire_centimes) values ($1, 'B', 1)`, [f])).rejects.toThrow();
    await expect(db.query(`delete from lignes_facture where facture_id = $1`, [f])).rejects.toThrow();
  });

  test("suppression interdite, annulation possible et définitive", async () => {
    await expect(db.query(`delete from factures where id = $1`, [f])).rejects.toThrow(/Annulez-la/);
    await db.query(`update factures set statut = 'annulee', motif_annulation = 'Erreur' where id = $1`, [f]);
    const row = await un<{ annulee_le: Date | null }>(`select * from factures where id = $1`, [f]);
    expect(row.annulee_le).not.toBeNull();
    await expect(db.query(`update factures set statut = 'emise' where id = $1`, [f])).rejects.toThrow(/annulée/);
  });

  test("cycle envoyée → payée → retour, avec date obligatoire", async () => {
    await db.query(`update factures set statut = 'envoyee', envoyee_le = now() where id = $1`, [f]);
    await expect(db.query(`update factures set statut = 'payee' where id = $1`, [f])).rejects.toThrow(/date de paiement/);
    await db.query(`update factures set statut = 'payee', payee_le = current_date, mode_paiement = 'virement' where id = $1`, [f]);
    await db.query(`update factures set statut = 'envoyee' where id = $1`, [f]);
    const row = await un<{ payee_le: Date | null; mode_paiement: string | null }>(`select * from factures where id = $1`, [f]);
    expect(row.payee_le).toBeNull();
    expect(row.mode_paiement).toBeNull();
    await expect(db.query(`update factures set statut = 'emise' where id = $1`, [f])).rejects.toThrow(/Transition/);
  });

  test("les notes internes restent modifiables", async () => {
    await db.query(`update factures set notes_internes = 'relancé par téléphone' where id = $1`, [f]);
  });

  test("supprimer une prestation référencée par une ligne émise reste possible", async () => {
    const p = await prestation(100);
    const c = await client(ad, "Durand");
    const g = await brouillon(c, []);
    await db.query(`insert into lignes_facture (facture_id, libelle, prix_unitaire_centimes, prestation_id) values ($1, 'P', 100, $2)`, [g, p]);
    await db.query(`select emettre_facture($1)`, [g]);
    await db.query(`delete from prestations where id = $1`, [p]);
    const l = await un<{ prestation_id: string | null }>(`select prestation_id from lignes_facture where facture_id = $1`, [g]);
    expect(l.prestation_id).toBeNull();
  });

  test("les brouillons se suppriment avec leurs lignes", async () => {
    const c = await client(ad, "Leroy");
    const g = await brouillon(c, [["A", 1, 1], ["B", 1, 1]]);
    await db.query(`delete from factures where id = $1`, [g]);
    expect((await un<{ n: number }>(`select count(*)::int as n from lignes_facture where facture_id = $1`, [g])).n).toBe(0);
  });
});

describe("tarifs clients", () => {
  test("le catalogue est commun aux deux académies", async () => {
    const p = await prestation(100);
    await db.query(`insert into tarifs_clients (client_id, prestation_id) values ($1, $2)`, [await client(ad), p]);
    await db.query(`insert into tarifs_clients (client_id, prestation_id) values ($1, $2)`, [await client(ae), p]);
  });

  test("une ligne libre exige libellé et prix", async () => {
    const c = await client(ad);
    await expect(db.query(`insert into tarifs_clients (client_id, libelle) values ($1, 'x')`, [c])).rejects.toThrow();
    await db.query(`insert into tarifs_clients (client_id, libelle, prix_unitaire_centimes) values ($1, 'x', 100)`, [c]);
  });
});

describe("génération mensuelle", () => {
  test("prix personnalisé, périodes de validité, lignes ponctuelles exclues", async () => {
    const pension = await prestation(50000, "Pension");
    const cours = await prestation(4000, "Cours particulier");
    const martin = await client(ad, "Martin");
    const durand = await client(ad, "Durand");
    const inactif = await client(ad, "Inactif");
    await db.query(`update clients set actif = false where id = $1`, [inactif]);

    // Martin : tarif catalogue + 4 cours à prix négocié
    await db.query(`insert into tarifs_clients (client_id, prestation_id, ordre) values ($1, $2, 1)`, [martin, pension]);
    await db.query(`insert into tarifs_clients (client_id, prestation_id, quantite, prix_unitaire_centimes, ordre) values ($1, $2, 4, 3500, 2)`, [martin, cours]);
    // Durand : prix réduit, mais tarif terminé fin septembre + une ligne ponctuelle
    await db.query(`insert into tarifs_clients (client_id, prestation_id, prix_unitaire_centimes, date_fin) values ($1, $2, 40000, '2026-09-30')`, [durand, pension]);
    await db.query(`insert into tarifs_clients (client_id, libelle, prix_unitaire_centimes, recurrent) values ($1, 'Stage été', 20000, false)`, [durand]);
    await db.query(`insert into tarifs_clients (client_id, prestation_id) values ($1, $2)`, [inactif, pension]);

    const apercu = (await db.query<{ client_id: string; facture_id: string | null; total_ht_centimes: number }>(
      `select * from generer_brouillons_mensuels('2026-10-15', null, true)`)).rows;
    expect(apercu).toHaveLength(1);
    expect(apercu[0]).toMatchObject({ client_id: martin, facture_id: null, total_ht_centimes: 64000 });
    expect((await un<{ n: number }>(`select count(*)::int as n from factures`)).n).toBe(0);

    const res = (await db.query<{ facture_id: string; deja_existante: boolean }>(
      `select * from generer_brouillons_mensuels('2026-10-15')`)).rows;
    expect(res).toHaveLength(1);
    const f = await un<{ objet: string; periode: Date; total_ht_centimes: number; statut: string }>(
      `select * from factures where id = $1`, [res[0].facture_id]);
    expect(f.statut).toBe("brouillon");
    expect(f.total_ht_centimes).toBe(64000);
    expect(f.objet).toBe("Formation et accompagnement – octobre 2026");
    const lignes = (await db.query<{ libelle: string; prix_unitaire_centimes: number; quantite: string }>(
      `select * from lignes_facture where facture_id = $1 order by ordre`, [res[0].facture_id])).rows;
    expect(lignes.map((l) => [l.libelle, l.prix_unitaire_centimes, Number(l.quantite)])).toEqual([
      ["Pension", 50000, 1],
      ["Cours particulier", 3500, 4],
    ]);

    // Septembre : Durand est facturé au prix réduit
    const sept = (await db.query<{ client_id: string; total_ht_centimes: number }>(
      `select * from generer_brouillons_mensuels('2026-09-01')`)).rows;
    expect(sept.find((r) => r.client_id === durand)?.total_ht_centimes).toBe(40000);
  });

  test("idempotente : relancer ne crée pas de doublon", async () => {
    const p = await prestation(1000);
    const c = await client(ad);
    await db.query(`insert into tarifs_clients (client_id, prestation_id) values ($1, $2)`, [c, p]);
    await db.query(`select * from generer_brouillons_mensuels('2026-10-01')`);
    const again = (await db.query<{ deja_existante: boolean }>(`select * from generer_brouillons_mensuels('2026-10-01')`)).rows;
    expect(again[0].deja_existante).toBe(true);
    expect((await un<{ n: number }>(`select count(*)::int as n from factures`)).n).toBe(1);
    await expect(db.query(
      `insert into factures (client_id, periode, generation_auto) values ($1, '2026-10-01', true)`, [c],
    )).rejects.toThrow(/factures_mensuelle_unique/);
  });

  test("une facture annulée peut être régénérée", async () => {
    const p = await prestation(1000);
    const c = await client(ad);
    await db.query(`insert into tarifs_clients (client_id, prestation_id) values ($1, $2)`, [c, p]);
    const [r] = (await db.query<{ facture_id: string }>(`select * from generer_brouillons_mensuels('2026-10-01')`)).rows;
    await db.query(`select emettre_facture($1)`, [r.facture_id]);
    await db.query(`update factures set statut = 'annulee' where id = $1`, [r.facture_id]);
    const [r2] = (await db.query<{ facture_id: string; deja_existante: boolean }>(
      `select * from generer_brouillons_mensuels('2026-10-01')`)).rows;
    expect(r2.deja_existante).toBe(false);
    expect(r2.facture_id).not.toBe(r.facture_id);
  });

  test("filtre optionnel par académie", async () => {
    const p = await prestation(1000);
    const c = await client(ae);
    await db.query(`insert into tarifs_clients (client_id, prestation_id) values ($1, $2)`, [c, p]);
    await db.query(`insert into tarifs_clients (client_id, prestation_id) values ($1, $2)`, [await client(ad, "Durand"), p]);
    expect((await db.query(`select * from generer_brouillons_mensuels('2026-10-01', $1, true)`, [ad])).rows).toHaveLength(1);
    const espoir = (await db.query<{ client_id: string }>(`select * from generer_brouillons_mensuels('2026-10-01', $1)`, [ae])).rows;
    expect(espoir.map((r) => r.client_id)).toEqual([c]);
    expect((await db.query(`select * from generer_brouillons_mensuels('2026-10-01', null, true)`)).rows).toHaveLength(2);
  });
});

describe("vue factures_vue", () => {
  test("signale les factures en retard", async () => {
    const c = await client(ad);
    const f = await brouillon(c, [["A", 1, 100]]);
    await db.query(`update parametres set delai_paiement_jours = 0`);
    await db.query(`select emettre_facture($1)`, [f]);
    await db.query(`update clients set emails_cc = '{copie@example.com}' where id = $1`, [c]);
    let row = await un<{ en_retard: boolean; client_nom: string; academie_nom: string; client_emails_cc: string[] }>(
      `select * from factures_vue where id = $1`,
      [f],
    );
    expect(row.en_retard).toBe(false);
    expect(row.academie_nom).toBe("Académie Delaveau");
    expect(row.client_emails_cc).toEqual(["copie@example.com"]);
    // échéance dépassée : on simule en contournant le trigger (test uniquement)
    await db.exec(`alter table factures disable trigger b_factures_proteger`);
    await db.query(`update factures set date_echeance = date_emission - 1 where id = $1`, [f]);
    await db.exec(`alter table factures enable trigger b_factures_proteger`);
    row = await un(`select * from factures_vue where id = $1`, [f]);
    expect(row.en_retard).toBe(true);
  });
});

describe("envoi automatique par client", () => {
  const MIGRATION = "20260928000000_envoi_auto_clients.sql";

  test("colonne clients.envoi_auto, fausse par défaut ; plus de réglage global", async () => {
    const c = await client(ad);
    const row = await un<{ envoi_auto: boolean }>(`select envoi_auto from clients where id = $1`, [c]);
    expect(row.envoi_auto).toBe(false);
    await db.query(`update clients set envoi_auto = true where id = $1`, [c]);
    expect((await un<{ envoi_auto: boolean }>(`select envoi_auto from clients where id = $1`, [c])).envoi_auto).toBe(true);
    await expect(db.query(`update clients set envoi_auto = null where id = $1`, [c])).rejects.toThrow(/null/);

    const colonne = await un<{ is_nullable: string; column_default: string }>(
      `select is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'clients' and column_name = 'envoi_auto'`,
    );
    expect(colonne).toMatchObject({ is_nullable: "NO", column_default: "false" });
    const globale = await db.query(
      `select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'parametres' and column_name = 'envoi_auto'`,
    );
    expect(globale.rows).toHaveLength(0);
  });

  test("migration : l'envoi automatique global activé passe à tous les clients", async () => {
    const ancienne = await creerBase({ arreterAvant: MIGRATION });
    const idAcademie = (await ancienne.query<{ id: string }>(`select id from academies order by ordre limit 1`)).rows[0].id;
    await ancienne.query(`insert into clients (academie_id, nom) values ($1, 'Martin'), ($1, 'Durand')`, [idAcademie]);
    await ancienne.query(`update clients set actif = false where nom = 'Durand'`);
    await ancienne.query(`update parametres set generation_auto = true, envoi_auto = true`);
    await appliquerMigration(ancienne, MIGRATION);
    const rows = (await ancienne.query<{ nom: string; envoi_auto: boolean }>(`select nom, envoi_auto from clients order by nom`)).rows;
    expect(rows).toEqual([
      { nom: "Durand", envoi_auto: true },
      { nom: "Martin", envoi_auto: true },
    ]);
    await ancienne.close();
  });

  test("migration : l'envoi automatique global désactivé laisse les clients en relecture", async () => {
    const ancienne = await creerBase({ arreterAvant: MIGRATION });
    const idAcademie = (await ancienne.query<{ id: string }>(`select id from academies order by ordre limit 1`)).rows[0].id;
    await ancienne.query(`insert into clients (academie_id, nom) values ($1, 'Martin')`, [idAcademie]);
    await appliquerMigration(ancienne, MIGRATION);
    const rows = (await ancienne.query<{ envoi_auto: boolean }>(`select envoi_auto from clients`)).rows;
    expect(rows).toEqual([{ envoi_auto: false }]);
    await ancienne.close();
  });

  test("l'émission fige l'envoi automatique dans l'instantané client sans erreur", async () => {
    const c = await client(ad);
    await db.query(`update clients set envoi_auto = true where id = $1`, [c]);
    const f = await brouillon(c, [["A", 1, 100]]);
    await db.query(`select emettre_facture($1)`, [f]);
    const row = await un<{ client_snapshot: { envoi_auto: boolean }; emetteur_snapshot: Record<string, unknown> }>(
      `select client_snapshot, emetteur_snapshot from factures where id = $1`,
      [f],
    );
    expect(row.client_snapshot.envoi_auto).toBe(true);
    expect(row.emetteur_snapshot).not.toHaveProperty("envoi_auto");
  });
});

describe("arrhes par client", () => {
  const MIGRATION = "20260929000000_arrhes_clients.sql";

  /** Client avec arrhes réglées (saison 2026 : septembre 2026 → juin 2027). */
  async function clientArrhes(montant: number | null, nom = "Martin", reglees = true, saison: number | null = 2026) {
    const id = await client(ad, nom);
    await db.query(
      `update clients set arrhes_reglees = $2, arrhes_centimes = $3, arrhes_saison = $4 where id = $1`,
      [id, reglees, montant, saison],
    );
    return id;
  }

  async function tarifLibre(clientId: string, libelle: string, prix: number, quantite = 1, ordre = 0) {
    await db.query(
      `insert into tarifs_clients (client_id, libelle, prix_unitaire_centimes, quantite, ordre) values ($1, $2, $3, $4, $5)`,
      [clientId, libelle, prix, quantite, ordre],
    );
  }

  async function generer(periode: string, clientId: string, apercu = false) {
    return un<{ facture_id: string | null; total_ht_centimes: number; deja_existante: boolean }>(
      `select * from generer_brouillons_mensuels($1, null, $2) where client_id = $3`,
      [periode, apercu, clientId],
    );
  }

  async function lignes(factureId: string) {
    return (await db.query<{ libelle: string; prix_unitaire_centimes: number; total_centimes: number }>(
      `select libelle, prix_unitaire_centimes, total_centimes from lignes_facture where facture_id = $1 order by ordre`,
      [factureId],
    )).rows.map((l) => [l.libelle, l.prix_unitaire_centimes]);
  }

  async function totalFacture(factureId: string) {
    return (await un<{ total_ht_centimes: number }>(`select total_ht_centimes from factures where id = $1`, [factureId]))
      .total_ht_centimes;
  }

  test("colonnes, défauts neutres et contrôles", async () => {
    const colonnes = (await db.query<{ column_name: string; is_nullable: string; column_default: string | null; data_type: string }>(
      `select column_name, is_nullable, column_default, data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'clients' and column_name like 'arrhes%' order by column_name`,
    )).rows;
    expect(colonnes).toEqual([
      { column_name: "arrhes_centimes", is_nullable: "YES", column_default: null, data_type: "integer" },
      { column_name: "arrhes_reglees", is_nullable: "NO", column_default: "false", data_type: "boolean" },
      { column_name: "arrhes_saison", is_nullable: "YES", column_default: null, data_type: "integer" },
    ]);
    const c = await client(ad);
    expect(await un(`select arrhes_reglees, arrhes_centimes, arrhes_saison from clients where id = $1`, [c])).toEqual({
      arrhes_reglees: false,
      arrhes_centimes: null,
      arrhes_saison: null,
    });
    await expect(db.query(`update clients set arrhes_centimes = -1 where id = $1`, [c])).rejects.toThrow(/clients_arrhes_montant/);
    await expect(db.query(`update clients set arrhes_saison = 1999 where id = $1`, [c])).rejects.toThrow(/clients_arrhes_saison/);
    await expect(db.query(`update clients set arrhes_saison = 2101 where id = $1`, [c])).rejects.toThrow(/clients_arrhes_saison/);
    await expect(db.query(`update clients set arrhes_reglees = null where id = $1`, [c])).rejects.toThrow(/null/);
    await db.query(`update clients set arrhes_reglees = true, arrhes_centimes = 0, arrhes_saison = 2100 where id = $1`, [c]);
  });

  test("génération : déduction sur la ligne de quantité 1 la plus chère ; client sans arrhes inchangé", async () => {
    const avec = await clientArrhes(396000); // 3 960 € → 396 € par mois
    await tarifLibre(avec, "Enseignement", 132000, 1, 1);
    await tarifLibre(avec, "Cours", 4000, 4, 2);
    await tarifLibre(avec, "Licence", 2000, 1, 3);
    const sans = await client(ad, "Durand");
    await tarifLibre(sans, "Enseignement", 132000, 1, 1);

    const f = (await generer("2026-10-15", avec)).facture_id!;
    expect(await lignes(f)).toEqual([["Enseignement", 132000 - 39600], ["Cours", 4000], ["Licence", 2000]]);
    expect(await totalFacture(f)).toBe(132000 - 39600 + 16000 + 2000);
    const objet = await un<{ objet: string; generation_auto: boolean }>(`select objet, generation_auto from factures where id = $1`, [f]);
    expect(objet).toEqual({ objet: "Formation et accompagnement – octobre 2026", generation_auto: true });

    const g = (await generer("2026-10-15", sans)).facture_id!;
    expect(await lignes(g)).toEqual([["Enseignement", 132000]]);
    expect(await totalFacture(g)).toBe(132000);
  });

  test("juin reçoit le reste : total déduit exact sur 10 mois", async () => {
    const c = await clientArrhes(100007); // 10 000 par mois, 10 007 en juin
    await tarifLibre(c, "Enseignement", 50000);
    let deduit = 0;
    for (const mois of ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]) {
      const f = (await generer(`${mois}-01`, c)).facture_id!;
      deduit += 50000 - (await totalFacture(f));
    }
    expect(deduit).toBe(100007);
    const juin = (await generer("2027-06-01", c)).facture_id!;
    expect(await totalFacture(juin)).toBe(50000 - 10007);
  });

  test("hors saison (juillet, août, autre saison) ou arrhes non réglées : aucune déduction", async () => {
    const c = await clientArrhes(45000);
    await tarifLibre(c, "Enseignement", 50000);
    for (const periode of ["2026-07-01", "2026-08-01", "2027-07-01", "2027-08-01", "2027-09-01", "2026-06-01"]) {
      const r = await generer(periode, c);
      expect({ periode, total: await totalFacture(r.facture_id!) }).toEqual({ periode, total: 50000 });
    }
    const nonReglees = await clientArrhes(45000, "Durand", false);
    await tarifLibre(nonReglees, "Enseignement", 50000);
    expect(await totalFacture((await generer("2026-10-01", nonReglees)).facture_id!)).toBe(50000);
    const sansSaison = await clientArrhes(45000, "Petit", true, null);
    await tarifLibre(sansSaison, "Enseignement", 50000);
    expect(await totalFacture((await generer("2026-10-01", sansSaison)).facture_id!)).toBe(50000);
  });

  test("une ligne de quantité 4 n'absorbe jamais la déduction ; égalité : la première dans l'ordre", async () => {
    const c = await clientArrhes(45000);
    await tarifLibre(c, "Cours", 90000, 4, 1); // plus grand total, mais quantité 4
    await tarifLibre(c, "Pension A", 30000, 1, 2);
    await tarifLibre(c, "Pension B", 30000, 1, 3);
    const f = (await generer("2026-10-01", c)).facture_id!;
    expect(await lignes(f)).toEqual([["Cours", 90000], ["Pension A", 30000 - 4500], ["Pension B", 30000]]);
  });

  test("aucune ligne adéquate : pas de déduction (jamais de prix négatif)", async () => {
    const c = await clientArrhes(450000); // 45 000 par mois
    await tarifLibre(c, "Cours", 90000, 4, 1); // quantité 4
    await tarifLibre(c, "Licence", 40000, 1, 2); // prix < déduction
    const apercu = await generer("2026-10-01", c, true);
    expect(apercu.total_ht_centimes).toBe(360000 + 40000);
    const f = (await generer("2026-10-01", c)).facture_id!;
    expect(await lignes(f)).toEqual([["Cours", 90000], ["Licence", 40000]]);
    expect(await totalFacture(f)).toBe(400000);
    // Prix égal à la déduction : ligne à 0, jamais négative.
    const d = await clientArrhes(450000, "Durand");
    await tarifLibre(d, "Enseignement", 45000);
    expect(await lignes((await generer("2026-10-01", d)).facture_id!)).toEqual([["Enseignement", 0]]);
  });

  test("l'aperçu donne le montant réel (déjà générée comprise)", async () => {
    const c = await clientArrhes(396000);
    await tarifLibre(c, "Enseignement", 132000, 1, 1);
    await tarifLibre(c, "Cours", 3333, 2.5, 2);
    const apercu = await generer("2026-11-01", c, true);
    expect(apercu.facture_id).toBeNull();
    const f = (await generer("2026-11-01", c)).facture_id!;
    expect(apercu.total_ht_centimes).toBe(await totalFacture(f));
    expect(apercu.total_ht_centimes).toBe(132000 - 39600 + 8333);
    const deja = await generer("2026-11-01", c, true);
    expect(deja).toMatchObject({ facture_id: f, deja_existante: true, total_ht_centimes: 132000 - 39600 + 8333 });
  });

  test("idempotence conservée : relancer ne crée ni doublon ni seconde déduction", async () => {
    const c = await clientArrhes(45000);
    await tarifLibre(c, "Enseignement", 50000);
    const f = (await generer("2026-10-01", c)).facture_id!;
    const r = await generer("2026-10-01", c);
    expect(r).toMatchObject({ facture_id: f, deja_existante: true, total_ht_centimes: 45500 });
    expect((await un<{ n: number }>(`select count(*)::int as n from factures`)).n).toBe(1);
    expect(await lignes(f)).toEqual([["Enseignement", 45500]]);
  });

  test("l'émission fige les arrhes dans l'instantané client", async () => {
    const c = await clientArrhes(45000);
    await tarifLibre(c, "Enseignement", 50000);
    const f = (await generer("2026-10-01", c)).facture_id!;
    await db.query(`select emettre_facture($1)`, [f]);
    await db.query(`update clients set arrhes_reglees = false, arrhes_centimes = null where id = $1`, [c]);
    const row = await un<{ client_snapshot: Record<string, unknown> }>(`select client_snapshot from factures where id = $1`, [f]);
    expect(row.client_snapshot).toMatchObject({ arrhes_reglees: true, arrhes_centimes: 45000, arrhes_saison: 2026 });
  });

  test("migration : brouillons et factures existants inchangés, génération identique sans arrhes", async () => {
    const ancienne = await creerBase({ arreterAvant: MIGRATION });
    try {
      const q = async <T>(sql: string, params: unknown[] = []) => (await ancienne.query<T>(sql, params)).rows;
      const idAcademie = (await q<{ id: string }>(`select id from academies order by ordre limit 1`))[0].id;
      const [martin] = await q<{ id: string }>(`insert into clients (academie_id, nom) values ($1, 'Martin') returning id`, [idAcademie]);
      const [durand] = await q<{ id: string }>(`insert into clients (academie_id, nom) values ($1, 'Durand') returning id`, [idAcademie]);
      for (const c of [martin.id, durand.id]) {
        await q(`insert into tarifs_clients (client_id, libelle, prix_unitaire_centimes, ordre) values ($1, 'Enseignement', 132000, 1)`, [c]);
        await q(`insert into tarifs_clients (client_id, libelle, prix_unitaire_centimes, quantite, ordre) values ($1, 'Cours', 4000, 4, 2)`, [c]);
      }
      const [emise] = await q<{ facture_id: string }>(`select * from generer_brouillons_mensuels('2026-09-01') where client_id = $1`, [martin.id]);
      await q(`select emettre_facture($1)`, [emise.facture_id]);
      await q(`select * from generer_brouillons_mensuels('2026-10-01')`);
      const avantMensuel = await q(`select * from generer_brouillons_mensuels('2026-11-01', null, true) order by client_id`);

      // Colonnes ajoutées par la migration : nulles sur l'existant, le reste strictement identique.
      const NOUVELLES = ["prix_catalogue_centimes", "motif_reduction", "deduction_arrhes_centimes"];
      const anciennes = (rows: Record<string, unknown>[]) =>
        rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !NOUVELLES.includes(k))));
      const instantane = async () => ({
        factures: await q<Record<string, unknown>>(`select * from factures order by id`),
        lignes: anciennes(await q<Record<string, unknown>>(`select * from lignes_facture order by id`)),
        tarifs: anciennes(await q<Record<string, unknown>>(`select * from tarifs_clients order by id`)),
      });
      const avant = await instantane();
      expect(avant.lignes.length).toBeGreaterThan(0);
      await appliquerMigration(ancienne, MIGRATION);
      expect(await instantane()).toEqual(avant);
      expect(await q(`select distinct prix_catalogue_centimes, motif_reduction, deduction_arrhes_centimes from lignes_facture`)).toEqual([
        { prix_catalogue_centimes: null, motif_reduction: null, deduction_arrhes_centimes: null },
      ]);
      expect(await q(`select distinct motif_reduction from tarifs_clients`)).toEqual([{ motif_reduction: null }]);

      const clients = await q(`select arrhes_reglees, arrhes_centimes, arrhes_saison from clients`);
      expect(clients).toEqual([
        { arrhes_reglees: false, arrhes_centimes: null, arrhes_saison: null },
        { arrhes_reglees: false, arrhes_centimes: null, arrhes_saison: null },
      ]);
      // Même aperçu et mêmes lignes qu'avant la migration pour des clients sans arrhes.
      expect(await q(`select * from generer_brouillons_mensuels('2026-11-01', null, true) order by client_id`)).toEqual(avantMensuel);
      const [nov] = await q<{ facture_id: string }>(`select * from generer_brouillons_mensuels('2026-11-01') where client_id = $1`, [martin.id]);
      expect(
        (await q<{ libelle: string; prix_unitaire_centimes: number }>(
          `select libelle, prix_unitaire_centimes from lignes_facture where facture_id = $1 order by ordre`, [nov.facture_id],
        )).map((l) => [l.libelle, l.prix_unitaire_centimes]),
      ).toEqual([["Enseignement", 132000], ["Cours", 4000]]);
      // Droits inchangés : pas d'accès anonyme.
      await ancienne.exec(`set role anon`);
      await expect(ancienne.query(`select * from generer_brouillons_mensuels('2026-10-01', null, true)`)).rejects.toThrow(/permission/);
      await ancienne.exec(`reset role`);
    } finally {
      await ancienne.close();
    }
  });
});

describe("réduction motivée et informations figées sur les lignes générées", () => {
  test("colonnes nulles par défaut et contrôles", async () => {
    const colonnes = (await db.query<{ table_name: string; column_name: string; is_nullable: string; data_type: string }>(
      `select table_name, column_name, is_nullable, data_type from information_schema.columns
        where table_schema = 'public'
          and ((table_name = 'tarifs_clients' and column_name = 'motif_reduction')
            or (table_name = 'lignes_facture' and column_name in ('prix_catalogue_centimes', 'motif_reduction', 'deduction_arrhes_centimes')))
        order by table_name, column_name`,
    )).rows;
    expect(colonnes).toEqual([
      { table_name: "lignes_facture", column_name: "deduction_arrhes_centimes", is_nullable: "YES", data_type: "integer" },
      { table_name: "lignes_facture", column_name: "motif_reduction", is_nullable: "YES", data_type: "text" },
      { table_name: "lignes_facture", column_name: "prix_catalogue_centimes", is_nullable: "YES", data_type: "integer" },
      { table_name: "tarifs_clients", column_name: "motif_reduction", is_nullable: "YES", data_type: "text" },
    ]);
    const c = await client(ad);
    const f = await brouillon(c, [["A", 1, 100]]);
    const l = await un<Record<string, unknown>>(`select * from lignes_facture where facture_id = $1`, [f]);
    expect(l).toMatchObject({ prix_catalogue_centimes: null, motif_reduction: null, deduction_arrhes_centimes: null });
    await expect(db.query(`update lignes_facture set prix_catalogue_centimes = -1 where facture_id = $1`, [f]))
      .rejects.toThrow(/lignes_facture_prix_catalogue/);
    await expect(db.query(`update lignes_facture set deduction_arrhes_centimes = -1 where facture_id = $1`, [f]))
      .rejects.toThrow(/lignes_facture_deduction_arrhes/);
  });

  test("la génération recopie prix catalogue, motif et déduction d'arrhes sur chaque ligne", async () => {
    const academicien = await prestation(240000, "Académicien Delaveau");
    const licence = await prestation(2000, "Licence");
    const c = await client(ad);
    await db.query(`update clients set arrhes_reglees = true, arrhes_centimes = 396000, arrhes_saison = 2026 where id = $1`, [c]);
    await db.query(
      `insert into tarifs_clients (client_id, prestation_id, prix_unitaire_centimes, motif_reduction, ordre)
       values ($1, $2, 210000, 'Prise en charge 50 % location cheval', 1)`,
      [c, academicien],
    );
    await db.query(`insert into tarifs_clients (client_id, prestation_id, ordre) values ($1, $2, 2)`, [c, licence]);
    await db.query(
      `insert into tarifs_clients (client_id, libelle, prix_unitaire_centimes, quantite, ordre) values ($1, 'Cours', 4000, 2, 3)`,
      [c],
    );
    const [r] = (await db.query<{ facture_id: string; total_ht_centimes: number }>(
      `select * from generer_brouillons_mensuels('2026-10-01')`)).rows;
    const lignes = (await db.query(
      `select libelle, prix_unitaire_centimes, prix_catalogue_centimes, motif_reduction, deduction_arrhes_centimes
         from lignes_facture where facture_id = $1 order by ordre`,
      [r.facture_id],
    )).rows;
    expect(lignes).toEqual([
      {
        libelle: "Académicien Delaveau",
        prix_unitaire_centimes: 210000 - 39600,
        prix_catalogue_centimes: 240000,
        motif_reduction: "Prise en charge 50 % location cheval",
        deduction_arrhes_centimes: 39600,
      },
      { libelle: "Licence", prix_unitaire_centimes: 2000, prix_catalogue_centimes: 2000, motif_reduction: null, deduction_arrhes_centimes: null },
      { libelle: "Cours", prix_unitaire_centimes: 4000, prix_catalogue_centimes: null, motif_reduction: null, deduction_arrhes_centimes: null },
    ]);
    // Le total ne dépend que des lignes.
    expect(r.total_ht_centimes).toBe(210000 - 39600 + 2000 + 8000);
    expect((await un<{ total_ht_centimes: number }>(`select total_ht_centimes from factures where id = $1`, [r.facture_id]))
      .total_ht_centimes).toBe(r.total_ht_centimes);
  });

  test("immutabilité conservée : lignes émises figées, suppression d'une prestation toujours possible", async () => {
    const p = await prestation(240000, "Académicien Delaveau");
    const c = await client(ad);
    await db.query(`update clients set arrhes_reglees = true, arrhes_centimes = 396000, arrhes_saison = 2026 where id = $1`, [c]);
    await db.query(
      `insert into tarifs_clients (client_id, prestation_id, prix_unitaire_centimes, motif_reduction) values ($1, $2, 210000, 'Motif')`,
      [c, p],
    );
    const [r] = (await db.query<{ facture_id: string }>(`select * from generer_brouillons_mensuels('2026-10-01')`)).rows;
    await db.query(`select emettre_facture($1)`, [r.facture_id]);
    for (const maj of ["motif_reduction = 'Autre'", "prix_catalogue_centimes = 1", "deduction_arrhes_centimes = 0"]) {
      await expect(db.query(`update lignes_facture set ${maj} where facture_id = $1`, [r.facture_id])).rejects.toThrow(/émise/);
    }
    await db.query(`delete from tarifs_clients where client_id = $1`, [c]);
    await db.query(`delete from prestations where id = $1`, [p]);
    const l = await un<Record<string, unknown>>(`select * from lignes_facture where facture_id = $1`, [r.facture_id]);
    expect(l).toMatchObject({
      prestation_id: null,
      prix_catalogue_centimes: 240000,
      motif_reduction: "Motif",
      deduction_arrhes_centimes: 39600,
    });
  });
});

describe("sécurité (RLS)", () => {
  test("un membre voit et modifie les données", async () => {
    const n = await commeUtilisateur(db, MEMBRE, async () => {
      await db.query(`insert into clients (academie_id, nom) values ($1, 'Via RLS')`, [ad]);
      return (await un<{ n: number }>(`select count(*)::int as n from clients`)).n;
    });
    expect(n).toBe(1);
  });

  test("un membre peut émettre (fonction security definer)", async () => {
    const c = await client(ad);
    const f = await brouillon(c, [["A", 1, 100]]);
    const numero = await commeUtilisateur(db, MEMBRE, async () =>
      (await un<{ numero: string }>(`select * from emettre_facture($1)`, [f])).numero);
    expect(numero).toMatch(/^AD-\d{4}-0001$/);
  });

  test("un utilisateur authentifié non membre ne voit rien et ne peut rien faire", async () => {
    const c = await client(ad);
    const f = await brouillon(c, [["A", 1, 100]]);
    await commeUtilisateur(db, "intrus@example.com", async () => {
      expect((await db.query(`select * from parametres`)).rows).toHaveLength(0);
      expect((await db.query(`select * from academies`)).rows).toHaveLength(0);
      expect((await db.query(`select * from factures_vue`)).rows).toHaveLength(0);
      await expect(db.query(`insert into clients (academie_id, nom) values ($1, 'X')`, [ad])).rejects.toThrow();
      await expect(db.query(`select emettre_facture($1)`, [f])).rejects.toThrow(/Accès refusé/);
    });
  });

  test("un membre ne peut créer qu'un brouillon sans numéro (la numérotation reste intacte)", async () => {
    const c = await client(ad);
    const legitime = await brouillon(c, [["A", 1, 100]]);
    await commeUtilisateur(db, MEMBRE, async () => {
      await expect(db.query(
        `insert into factures (client_id, statut, numero, annee, sequence, date_emission, total_ht_centimes, emetteur_snapshot)
         values ($1, 'emise', 'AD-2026-0001', 2026, 1, current_date, 123456, '{"iban":"FR76 AUTRE"}')`, [c],
      )).rejects.toThrow(/créée en brouillon/);
      await expect(db.query(`insert into factures (client_id, annee, sequence) values ($1, 2026, 7)`, [c]))
        .rejects.toThrow(/créée en brouillon/);
      await expect(db.query(`insert into factures (client_id, statut, payee_le) values ($1, 'payee', current_date)`, [c]))
        .rejects.toThrow(/créée en brouillon/);
      // Champs sans objet pour un brouillon : ignorés.
      const f = await un<{ payee_le: Date | null; date_echeance: Date | null; created_by: string }>(
        `insert into factures (client_id, payee_le, date_echeance, created_by)
         values ($1, current_date, current_date, '00000000-0000-0000-0000-00000000dead') returning *`, [c]);
      expect(f.payee_le).toBeNull();
      expect(f.date_echeance).toBeNull();
      expect(f.created_by).toBe("00000000-0000-0000-0000-000000000001");
      const emise = await un<{ numero: string; sequence: number }>(`select * from emettre_facture($1)`, [legitime]);
      expect(emise.sequence).toBe(1);
    });
  });

  test("les compteurs ne sont pas modifiables directement", async () => {
    await commeUtilisateur(db, MEMBRE, async () => {
      await expect(db.query(`insert into compteurs_factures values (2026, 5)`)).rejects.toThrow();
    });
  });

  test("anon n'a pas accès aux fonctions", async () => {
    await db.exec(`set role anon`);
    try {
      await expect(db.query(`select * from generer_brouillons_mensuels('2026-10-01', null, true)`)).rejects.toThrow(/permission/);
    } finally {
      await db.exec(`reset role`);
    }
  });
});
