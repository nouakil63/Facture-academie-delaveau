import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, test } from "vitest";
import { commeUtilisateur, creerBase } from "./harness";

/*
 * Migration 20261001000000_retour_mensuel_numerotation : retour aux factures mensuelles,
 * numéro F-<référence élève>-<MM>-<AAAA>-<n°> attribué par emettre_facture.
 */

const MEMBRE = "equipe@academie-delaveau.fr";
let db: PGlite;
let ad: string; // Académie Delaveau
let ae: string; // Académie Espoir

async function un<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows[0];
}

async function client(academie: string, nom: string, prenom = "Julie") {
  return (await un<{ id: string }>(
    `insert into clients (academie_id, nom, prenom, email) values ($1, $2, $3, 'famille@example.com') returning id`,
    [academie, nom, prenom],
  )).id;
}

/** Brouillon saisi à la main, avec ou sans mois facturé. */
async function brouillon(clientId: string, periode: string | null = null, prix = 10000) {
  const f = (await un<{ id: string }>(`insert into factures (client_id, periode) values ($1, $2) returning id`, [clientId, periode])).id;
  await db.query(`insert into lignes_facture (facture_id, libelle, prix_unitaire_centimes) values ($1, 'Pension', $2)`, [f, prix]);
  return f;
}

async function emettre(factureId: string) {
  return un<{ numero: string; annee: number; sequence: number; total_ttc_centimes: number; client_snapshot: { reference: string } }>(
    `select * from emettre_facture($1)`,
    [factureId],
  );
}

async function compteur(): Promise<number | null> {
  const r = await un<{ dernier_numero: number }>(
    `select dernier_numero from compteurs_factures where annee = extract(year from aujourdhui_paris())::int`,
  );
  return r?.dernier_numero ?? null;
}

/** Mois de la date d'émission (aujourd'hui, Paris) : « MM-AAAA ». */
async function moisEmission() {
  return (await un<{ m: string }>(`select to_char(aujourdhui_paris(), 'MM-YYYY') as m`)).m;
}

beforeEach(async () => {
  db = await creerBase();
  await db.query(`insert into membres (email) values ($1)`, [MEMBRE]);
  ad = (await un<{ id: string }>(`select id from academies where nom = 'Académie Delaveau'`)).id;
  ae = (await un<{ id: string }>(`select id from academies where nom = 'Académie Espoir'`)).id;
});

describe("numérotation F-<référence>-<MM>-<AAAA>-<n°>", () => {
  test("facture mensuelle : mois facturé ; ponctuelle sans période : mois d'émission", async () => {
    const c = await client(ad, "Martin");
    const mensuelle = await emettre(await brouillon(c, "2026-10-01"));
    expect(mensuelle.numero).toBe("F-E1-10-2026-0001");
    const ponctuelle = await emettre(await brouillon(c));
    expect(ponctuelle.numero).toBe(`F-E1-${await moisEmission()}-0002`);
    // Année et séquence : compteur de l'année d'émission (inchangés).
    expect(ponctuelle.sequence).toBe(2);
  });

  test("compteur global continu, partagé entre élèves et académies", async () => {
    const e1 = await client(ad, "Martin");
    const e2 = await client(ae, "Durand");
    expect((await emettre(await brouillon(e1, "2026-10-01"))).numero).toBe("F-E1-10-2026-0001");
    expect((await emettre(await brouillon(e2, "2026-10-01"))).numero).toBe("F-E2-10-2026-0002");
    expect((await emettre(await brouillon(e1, "2026-11-01"))).numero).toBe("F-E1-11-2026-0003");
    expect(await compteur()).toBe(3);
  });

  test("4 chiffres minimum, jamais tronqué au-delà de 9999", async () => {
    await db.query(`insert into compteurs_factures (annee, dernier_numero)
                    values (extract(year from aujourdhui_paris())::int, 9999)`);
    const c = await client(ad, "Martin");
    expect((await emettre(await brouillon(c, "2027-03-01"))).numero).toBe("F-E1-03-2027-10000");
  });

  test("référence modifiée après l'émission : numéro émis inchangé, nouvelle référence ensuite", async () => {
    const c = await client(ad, "Martin");
    const f = await brouillon(c, "2026-10-01");
    const emise = await emettre(f);
    expect(emise.numero).toBe("F-E1-10-2026-0001");
    expect(emise.client_snapshot.reference).toBe("E1");

    await db.query(`update clients set reference = 'e 42' where id = $1`, [c]);
    const apres = await un<{ numero: string; client_snapshot: { reference: string } }>(
      `select numero, client_snapshot from factures where id = $1`, [f]);
    expect(apres).toEqual({ numero: "F-E1-10-2026-0001", client_snapshot: expect.objectContaining({ reference: "E1" }) });
    expect((await emettre(await brouillon(c, "2026-11-01"))).numero).toBe("F-E42-11-2026-0002");
  });

  test("le numéro n'est attribué qu'à l'émission", async () => {
    const c = await client(ad, "Martin");
    const f = await brouillon(c, "2026-10-01");
    await expect(db.query(`update factures set numero = 'F-E1-10-2026-0001' where id = $1`, [f])).rejects.toThrow(
      /attribué uniquement à l'émission/,
    );
    expect((await un<{ numero: string | null }>(`select numero from factures where id = $1`, [f])).numero).toBeNull();
  });

  test("une émission en échec ne consomme aucun numéro", async () => {
    const c = await client(ad, "Martin");
    // Brouillon sans ligne : refusé avant le compteur.
    const vide = (await un<{ id: string }>(`insert into factures (client_id) values ($1) returning id`, [c])).id;
    await expect(emettre(vide)).rejects.toThrow(/aucune ligne/);
    expect(await compteur()).toBeNull();

    expect((await emettre(await brouillon(c, "2026-10-01"))).numero).toBe("F-E1-10-2026-0001");

    // Échec APRÈS l'incrément du compteur (numéro déjà pris : compteur effacé à la main) :
    // toute l'émission est annulée, compteur compris.
    await db.query(`delete from compteurs_factures`);
    const doublon = await brouillon(c, "2026-10-01");
    await expect(emettre(doublon)).rejects.toThrow(/F-E1-10-2026-0001 déjà attribué/);
    expect(await compteur()).toBeNull();
    expect((await un<{ statut: string; numero: string | null }>(`select statut, numero from factures where id = $1`, [doublon])))
      .toEqual({ statut: "brouillon", numero: null });

    await db.query(`insert into compteurs_factures (annee, dernier_numero)
                    values (extract(year from aujourdhui_paris())::int, 1)`);
    expect((await emettre(doublon)).numero).toBe("F-E1-10-2026-0002");
  });

  test("un membre émet via RLS ; un non-membre est refusé", async () => {
    const c = await client(ad, "Martin");
    const f = await brouillon(c, "2026-10-01");
    await commeUtilisateur(db, "intrus@example.com", async () => {
      await expect(db.query(`select emettre_facture($1)`, [f])).rejects.toThrow(/Accès refusé/);
    });
    const numero = await commeUtilisateur(db, MEMBRE, async () => (await emettre(f)).numero);
    expect(numero).toBe("F-E1-10-2026-0001");
  });

  test("droits : exécution réservée aux utilisateurs authentifiés et au service", async () => {
    const droits = await un<{ anon: boolean; authentifie: boolean; service: boolean }>(
      `select has_function_privilege('anon', 'public.emettre_facture(uuid)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.emettre_facture(uuid)', 'execute') as authentifie,
              has_function_privilege('service_role', 'public.emettre_facture(uuid)', 'execute') as service`,
    );
    expect(droits).toEqual({ anon: false, authentifie: true, service: true });
  });
});

describe("génération mensuelle et arrhes (inchangées)", () => {
  test("cas réel : Asma Dos Santos, E1, Espoir, 1 320 €/mois, arrhes 3 960 € → 924 € en octobre, F-E1-10-2026-0001", async () => {
    const c = await client(ae, "Dos Santos", "Asma");
    await db.query(
      `update clients set arrhes_reglees = true, arrhes_centimes = 396000, arrhes_saison = 2026 where id = $1`,
      [c],
    );
    await db.query(
      `insert into tarifs_clients (client_id, libelle, prix_unitaire_centimes) values ($1, 'Enseignement', 132000)`,
      [c],
    );

    const apercu = await un<{ facture_id: string | null; total_ht_centimes: number }>(
      `select * from generer_brouillons_mensuels('2026-10-01', null, true) where client_id = $1`, [c]);
    expect(apercu).toMatchObject({ facture_id: null, total_ht_centimes: 92400 });

    const r = await un<{ facture_id: string; total_ht_centimes: number }>(
      `select * from generer_brouillons_mensuels('2026-10-01') where client_id = $1`, [c]);
    expect(r.total_ht_centimes).toBe(92400);
    const ligne = await un<{ prix_unitaire_centimes: number; deduction_arrhes_centimes: number }>(
      `select prix_unitaire_centimes, deduction_arrhes_centimes from lignes_facture where facture_id = $1`, [r.facture_id]);
    expect(ligne).toEqual({ prix_unitaire_centimes: 92400, deduction_arrhes_centimes: 39600 });

    // Brouillon généré : recalculable depuis les tarifs (même résultat).
    expect((await un<{ n: number }>(`select recalculer_brouillon($1) as n`, [r.facture_id])).n).toBe(1);

    const emise = await emettre(r.facture_id);
    expect(emise.numero).toBe("F-E1-10-2026-0001");
    expect(emise.total_ttc_centimes).toBe(92400);
    expect(emise.client_snapshot.reference).toBe("E1");
    // Facture mensuelle : aucune échéance (avis) créée.
    expect((await un<{ n: number }>(`select count(*)::int as n from echeances`)).n).toBe(0);

    // Idempotente : pas de second brouillon pour le même mois.
    const encore = await un<{ deja_existante: boolean }>(
      `select * from generer_brouillons_mensuels('2026-10-01') where client_id = $1`, [c]);
    expect(encore.deja_existante).toBe(true);

    // Juin : reste des arrhes (396 000 − 9 × 39 600 = 39 600).
    const juin = await un<{ total_ht_centimes: number }>(
      `select * from generer_brouillons_mensuels('2027-06-01', null, true) where client_id = $1`, [c]);
    expect(juin.total_ht_centimes).toBe(92400);
    // Juillet : pas de déduction.
    const juillet = await un<{ total_ht_centimes: number }>(
      `select * from generer_brouillons_mensuels('2027-07-01', null, true) where client_id = $1`, [c]);
    expect(juillet.total_ht_centimes).toBe(132000);
  });
});
