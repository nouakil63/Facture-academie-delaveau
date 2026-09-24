import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, test } from "vitest";
import { commeUtilisateur, creerBase } from "./harness";

const MEMBRE = "equipe@academie-delaveau.fr";
let db: PGlite;
let ad: string; // entité Académie Delaveau
let ae: string; // entité Académie Espoir

async function un<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

async function client(entite: string, nom = "Martin") {
  return (await un<{ id: string }>(
    `insert into clients (entite_id, nom, prenom, email) values ($1, $2, 'Julie', 'julie@example.com') returning id`,
    [entite, nom],
  )).id;
}

async function prestation(entite: string, prix: number, libelle = "Pension et entraînement") {
  return (await un<{ id: string }>(
    `insert into prestations (entite_id, libelle, prix_unitaire_centimes) values ($1, $2, $3) returning id`,
    [entite, libelle, prix],
  )).id;
}

async function brouillon(entite: string, clientId: string, lignes: [string, number, number][]) {
  const f = (await un<{ id: string }>(
    `insert into factures (entite_id, client_id) values ($1, $2) returning id`,
    [entite, clientId],
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
  ad = (await un<{ id: string }>(`select id from entites where prefixe_facture = 'AD'`)).id;
  ae = (await un<{ id: string }>(`select id from entites where prefixe_facture = 'AE'`)).id;
});

describe("données initiales", () => {
  test("les deux entités existent avec les infos légales", async () => {
    const rows = (await db.query<{ nom: string; siret: string; rna: string }>(
      `select nom, siret, rna from entites order by ordre`,
    )).rows;
    expect(rows.map((r) => r.nom)).toEqual(["Académie Delaveau", "Académie Espoir"]);
    expect(rows[0].siret).toBe("853 472 298 00019");
    expect(rows[0].rna).toBe("W143007272");
  });
});

describe("totaux", () => {
  test("le total HT d'un brouillon suit ses lignes", async () => {
    const c = await client(ad);
    const f = await brouillon(ad, c, [["Pension", 1, 45000], ["Cours", 2.5, 3000]]);
    let row = await un<{ total_ht_centimes: number; total_ttc_centimes: number }>(`select * from factures where id = $1`, [f]);
    expect(row.total_ht_centimes).toBe(52500);
    expect(row.total_ttc_centimes).toBe(52500);
    await db.query(`delete from lignes_facture where facture_id = $1 and libelle = 'Cours'`, [f]);
    row = await un(`select * from factures where id = $1`, [f]);
    expect(row.total_ht_centimes).toBe(45000);
  });

  test("la TVA est calculée si un taux est défini", async () => {
    await db.query(`update entites set taux_tva = 20 where id = $1`, [ad]);
    const c = await client(ad);
    const f = await brouillon(ad, c, [["Pension", 1, 10000]]);
    const row = await un<{ total_tva_centimes: number; total_ttc_centimes: number }>(
      `select * from emettre_facture($1)`, [f]);
    expect(row.total_tva_centimes).toBe(2000);
    expect(row.total_ttc_centimes).toBe(12000);
  });
});

describe("émission et numérotation", () => {
  test("numéros continus par entité et par année", async () => {
    const c1 = await client(ad);
    const c2 = await client(ae);
    const a1 = await un<{ numero: string }>(`select * from emettre_facture($1)`, [await brouillon(ad, c1, [["A", 1, 100]])]);
    const a2 = await un<{ numero: string }>(`select * from emettre_facture($1)`, [await brouillon(ad, c1, [["B", 1, 100]])]);
    const e1 = await un<{ numero: string }>(`select * from emettre_facture($1)`, [await brouillon(ae, c2, [["C", 1, 100]])]);
    const annee = (await un<{ a: number }>(`select extract(year from aujourdhui_paris())::int as a`)).a;
    expect(a1.numero).toBe(`AD-${annee}-0001`);
    expect(a2.numero).toBe(`AD-${annee}-0002`);
    expect(e1.numero).toBe(`AE-${annee}-0001`);
  });

  test("l'émission fige les coordonnées et fixe l'échéance", async () => {
    const c = await client(ad);
    const f = await brouillon(ad, c, [["A", 1, 100]]);
    const row = await un<{ statut: string; date_emission: Date; date_echeance: Date; client_snapshot: { nom: string } }>(
      `select * from emettre_facture($1)`, [f]);
    expect(row.statut).toBe("emise");
    expect(row.client_snapshot.nom).toBe("Martin");
    const jours = (row.date_echeance.getTime() - row.date_emission.getTime()) / 86400000;
    expect(jours).toBe(30);
  });

  test("impossible d'émettre une facture vide ou déjà émise", async () => {
    const c = await client(ad);
    const vide = await brouillon(ad, c, []);
    await expect(db.query(`select emettre_facture($1)`, [vide])).rejects.toThrow(/aucune ligne/);
    const f = await brouillon(ad, c, [["A", 1, 100]]);
    await db.query(`select emettre_facture($1)`, [f]);
    await expect(db.query(`select emettre_facture($1)`, [f])).rejects.toThrow(/déjà émise/);
  });

  test("un échec d'émission ne consomme pas de numéro", async () => {
    const c = await client(ad);
    const vide = await brouillon(ad, c, []);
    await expect(db.query(`select emettre_facture($1)`, [vide])).rejects.toThrow();
    const ok = await un<{ sequence: number }>(`select * from emettre_facture($1)`, [await brouillon(ad, c, [["A", 1, 1]])]);
    expect(ok.sequence).toBe(1);
  });

  test("on ne peut pas passer un brouillon en émis sans la fonction", async () => {
    const c = await client(ad);
    const f = await brouillon(ad, c, [["A", 1, 100]]);
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
    f = await brouillon(ad, c, [["A", 1, 100]]);
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
    const p = await prestation(ad, 100);
    const c = await client(ad, "Durand");
    const g = await brouillon(ad, c, []);
    await db.query(`insert into lignes_facture (facture_id, libelle, prix_unitaire_centimes, prestation_id) values ($1, 'P', 100, $2)`, [g, p]);
    await db.query(`select emettre_facture($1)`, [g]);
    await db.query(`delete from prestations where id = $1`, [p]);
    const l = await un<{ prestation_id: string | null }>(`select prestation_id from lignes_facture where facture_id = $1`, [g]);
    expect(l.prestation_id).toBeNull();
  });

  test("les brouillons se suppriment avec leurs lignes", async () => {
    const c = await client(ad, "Leroy");
    const g = await brouillon(ad, c, [["A", 1, 1], ["B", 1, 1]]);
    await db.query(`delete from factures where id = $1`, [g]);
    expect((await un<{ n: number }>(`select count(*)::int as n from lignes_facture where facture_id = $1`, [g])).n).toBe(0);
  });
});

describe("tarifs clients", () => {
  test("la prestation doit appartenir à l'entité du client", async () => {
    const c = await client(ad);
    const pAe = await prestation(ae, 100);
    await expect(db.query(`insert into tarifs_clients (client_id, prestation_id) values ($1, $2)`, [c, pAe]))
      .rejects.toThrow(/entité du client/);
  });

  test("une ligne libre exige libellé et prix", async () => {
    const c = await client(ad);
    await expect(db.query(`insert into tarifs_clients (client_id, libelle) values ($1, 'x')`, [c])).rejects.toThrow();
    await db.query(`insert into tarifs_clients (client_id, libelle, prix_unitaire_centimes) values ($1, 'x', 100)`, [c]);
  });
});

describe("génération mensuelle", () => {
  test("prix personnalisé, périodes de validité, lignes ponctuelles exclues", async () => {
    const pension = await prestation(ad, 50000, "Pension");
    const cours = await prestation(ad, 4000, "Cours particulier");
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
      `select * from generer_brouillons_mensuels($1, '2026-10-15', true)`, [ad])).rows;
    expect(apercu).toHaveLength(1);
    expect(apercu[0]).toMatchObject({ client_id: martin, facture_id: null, total_ht_centimes: 64000 });
    expect((await un<{ n: number }>(`select count(*)::int as n from factures`)).n).toBe(0);

    const res = (await db.query<{ facture_id: string; deja_existante: boolean }>(
      `select * from generer_brouillons_mensuels($1, '2026-10-15')`, [ad])).rows;
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
      `select * from generer_brouillons_mensuels($1, '2026-09-01')`, [ad])).rows;
    expect(sept.find((r) => r.client_id === durand)?.total_ht_centimes).toBe(40000);
  });

  test("idempotente : relancer ne crée pas de doublon", async () => {
    const p = await prestation(ad, 1000);
    const c = await client(ad);
    await db.query(`insert into tarifs_clients (client_id, prestation_id) values ($1, $2)`, [c, p]);
    await db.query(`select * from generer_brouillons_mensuels($1, '2026-10-01')`, [ad]);
    const again = (await db.query<{ deja_existante: boolean }>(`select * from generer_brouillons_mensuels($1, '2026-10-01')`, [ad])).rows;
    expect(again[0].deja_existante).toBe(true);
    expect((await un<{ n: number }>(`select count(*)::int as n from factures`)).n).toBe(1);
    await expect(db.query(
      `insert into factures (entite_id, client_id, periode, generation_auto) values ($1, $2, '2026-10-01', true)`, [ad, c],
    )).rejects.toThrow(/factures_mensuelle_unique/);
  });

  test("une facture annulée peut être régénérée", async () => {
    const p = await prestation(ad, 1000);
    const c = await client(ad);
    await db.query(`insert into tarifs_clients (client_id, prestation_id) values ($1, $2)`, [c, p]);
    const [r] = (await db.query<{ facture_id: string }>(`select * from generer_brouillons_mensuels($1, '2026-10-01')`, [ad])).rows;
    await db.query(`select emettre_facture($1)`, [r.facture_id]);
    await db.query(`update factures set statut = 'annulee' where id = $1`, [r.facture_id]);
    const [r2] = (await db.query<{ facture_id: string; deja_existante: boolean }>(
      `select * from generer_brouillons_mensuels($1, '2026-10-01')`, [ad])).rows;
    expect(r2.deja_existante).toBe(false);
    expect(r2.facture_id).not.toBe(r.facture_id);
  });

  test("les clients d'une autre entité ne sont pas facturés", async () => {
    const p = await prestation(ae, 1000);
    const c = await client(ae);
    await db.query(`insert into tarifs_clients (client_id, prestation_id) values ($1, $2)`, [c, p]);
    expect((await db.query(`select * from generer_brouillons_mensuels($1, '2026-10-01')`, [ad])).rows).toHaveLength(0);
    expect((await db.query(`select * from generer_brouillons_mensuels($1, '2026-10-01')`, [ae])).rows).toHaveLength(1);
  });
});

describe("vue factures_vue", () => {
  test("signale les factures en retard", async () => {
    const c = await client(ad);
    const f = await brouillon(ad, c, [["A", 1, 100]]);
    await db.query(`update entites set delai_paiement_jours = 0 where id = $1`, [ad]);
    await db.query(`select emettre_facture($1)`, [f]);
    let row = await un<{ en_retard: boolean; client_nom: string; entite_nom: string }>(`select * from factures_vue where id = $1`, [f]);
    expect(row.en_retard).toBe(false);
    expect(row.entite_nom).toBe("Académie Delaveau");
    // échéance dépassée : on simule en contournant le trigger (test uniquement)
    await db.exec(`alter table factures disable trigger a_factures_proteger`);
    await db.query(`update factures set date_echeance = date_emission - 1 where id = $1`, [f]);
    await db.exec(`alter table factures enable trigger a_factures_proteger`);
    row = await un(`select * from factures_vue where id = $1`, [f]);
    expect(row.en_retard).toBe(true);
  });
});

describe("sécurité (RLS)", () => {
  test("un membre voit et modifie les données", async () => {
    const n = await commeUtilisateur(db, MEMBRE, async () => {
      await db.query(`insert into clients (entite_id, nom) values ($1, 'Via RLS')`, [ad]);
      return (await un<{ n: number }>(`select count(*)::int as n from clients`)).n;
    });
    expect(n).toBe(1);
  });

  test("un membre peut émettre (fonction security definer)", async () => {
    const c = await client(ad);
    const f = await brouillon(ad, c, [["A", 1, 100]]);
    const numero = await commeUtilisateur(db, MEMBRE, async () =>
      (await un<{ numero: string }>(`select * from emettre_facture($1)`, [f])).numero);
    expect(numero).toMatch(/^AD-\d{4}-0001$/);
  });

  test("un utilisateur authentifié non membre ne voit rien et ne peut rien faire", async () => {
    const c = await client(ad);
    const f = await brouillon(ad, c, [["A", 1, 100]]);
    await commeUtilisateur(db, "intrus@example.com", async () => {
      expect((await db.query(`select * from entites`)).rows).toHaveLength(0);
      expect((await db.query(`select * from factures_vue`)).rows).toHaveLength(0);
      await expect(db.query(`insert into clients (entite_id, nom) values ($1, 'X')`, [ad])).rejects.toThrow();
      await expect(db.query(`select emettre_facture($1)`, [f])).rejects.toThrow(/Accès refusé/);
    });
  });

  test("les compteurs ne sont pas modifiables directement", async () => {
    await commeUtilisateur(db, MEMBRE, async () => {
      await expect(db.query(`insert into compteurs_factures values ($1, 2026, 5)`, [ad])).rejects.toThrow();
    });
  });

  test("anon n'a pas accès aux fonctions", async () => {
    await db.exec(`set role anon`);
    try {
      await expect(db.query(`select * from generer_brouillons_mensuels($1, '2026-10-01', true)`, [ad])).rejects.toThrow(/permission/);
    } finally {
      await db.exec(`reset role`);
    }
  });
});
