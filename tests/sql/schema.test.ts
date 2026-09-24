import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, test } from "vitest";
import { commeUtilisateur, creerBase } from "./harness";

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
