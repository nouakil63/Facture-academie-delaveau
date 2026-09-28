import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  bornesMois,
  deductionArrhes,
  libelleSaison,
  ligneDeductionArrhes,
  mensualiteArrhes,
  mensuelDetaille,
  mensuelEstime,
  mensuelNet,
  saisonEnCours,
  parseQuantite,
  prixApplique,
  quantiteVersSaisie,
  situationSurMois,
  tarifFactureSurMois,
  totalLigneCentimes,
  type TarifPourCalcul,
} from "@/lib/tarifs";
import { creerBase } from "./sql/harness";

/** Tarif mensuel actif, sans dates, au prix catalogue de 450 €. */
function tarif(t: Partial<TarifPourCalcul> = {}): TarifPourCalcul {
  return {
    prix_unitaire_centimes: null,
    quantite: 1,
    recurrent: true,
    actif: true,
    date_debut: null,
    date_fin: null,
    prestation: { prix_unitaire_centimes: 45000 },
    ...t,
  };
}

describe("prixApplique", () => {
  test("prix personnalisé prioritaire, sinon prix catalogue", () => {
    expect(prixApplique(tarif())).toBe(45000);
    expect(prixApplique(tarif({ prix_unitaire_centimes: 39000 }))).toBe(39000);
    expect(prixApplique(tarif({ prix_unitaire_centimes: 0 }))).toBe(0); // gratuité : 0 n'est pas « absent »
    expect(prixApplique(tarif({ prix_unitaire_centimes: 12000, prestation: null }))).toBe(12000);
    expect(prixApplique(tarif({ prestation: null }))).toBeNull();
  });
});

describe("totalLigneCentimes", () => {
  test("cas simples", () => {
    expect(totalLigneCentimes(1, 45000)).toBe(45000);
    expect(totalLigneCentimes(2.5, 3000)).toBe(7500);
    expect(totalLigneCentimes("2.5", 3000)).toBe(7500); // numeric renvoyé en texte par PostgREST
    expect(totalLigneCentimes(0.33, 100)).toBe(33);
    expect(totalLigneCentimes(3, 0)).toBe(0);
  });

  test("arrondi au plus loin de zéro, comme round() de Postgres sur numeric", () => {
    expect(totalLigneCentimes(0.5, 1)).toBe(1); // 0,5 → 1 (et non 0 comme l'arrondi bancaire)
    expect(totalLigneCentimes(0.25, 2)).toBe(1); // 0,5 → 1
    expect(totalLigneCentimes(0.25, 6)).toBe(2); // 1,5 → 2
    expect(totalLigneCentimes(0.01, 49)).toBe(0); // 0,49 → 0
    expect(totalLigneCentimes(0.01, 50)).toBe(1); // 0,50 → 1
  });

  test("pas d'erreur de virgule flottante", () => {
    // En flottants, 1.15 × 50 = 57.49999999999999 : Math.round(q × p) donnerait 57 au lieu de 58.
    expect(Math.round(1.15 * 50)).toBe(57);
    expect(totalLigneCentimes(1.15, 50)).toBe(58); // 57,5 → 58
    expect(totalLigneCentimes(0.57, 150)).toBe(86); // 85,5 → 86
    expect(totalLigneCentimes(4.35, 50)).toBe(218); // 217,5 → 218
    expect(totalLigneCentimes(9.95, 50)).toBe(498); // 497,5 → 498
    expect(totalLigneCentimes(0.07, 150)).toBe(11); // 10,5 → 11
    expect(totalLigneCentimes(99999.99, 1)).toBe(100000);
  });
});

describe("situation d'un tarif sur un mois", () => {
  const octobre = "2026-10-01";

  test("bornes du mois", () => {
    expect(bornesMois("2026-10-17")).toEqual({ debut: "2026-10-01", suivant: "2026-11-01" });
    expect(bornesMois("2026-12-31")).toEqual({ debut: "2026-12-01", suivant: "2027-01-01" });
  });

  test("à venir / en cours / terminé", () => {
    expect(situationSurMois({ date_debut: null, date_fin: null }, octobre)).toBe("en_cours");
    expect(situationSurMois({ date_debut: "2026-10-31", date_fin: null }, octobre)).toBe("en_cours");
    expect(situationSurMois({ date_debut: "2026-11-01", date_fin: null }, octobre)).toBe("a_venir");
    expect(situationSurMois({ date_debut: null, date_fin: "2026-10-01" }, octobre)).toBe("en_cours");
    expect(situationSurMois({ date_debut: null, date_fin: "2026-09-30" }, octobre)).toBe("termine");
  });

  test("seuls les tarifs actifs, récurrents et valides sur le mois sont facturés", () => {
    expect(tarifFactureSurMois(tarif(), octobre)).toBe(true);
    expect(tarifFactureSurMois(tarif({ actif: false }), octobre)).toBe(false);
    expect(tarifFactureSurMois(tarif({ recurrent: false }), octobre)).toBe(false);
    expect(tarifFactureSurMois(tarif({ date_debut: "2026-11-15" }), octobre)).toBe(false);
    expect(tarifFactureSurMois(tarif({ date_fin: "2026-09-15" }), octobre)).toBe(false);
  });

  test("montant mensuel estimé = somme des lignes arrondies une à une", () => {
    const tarifs = [
      tarif(), // 450,00
      tarif({ prix_unitaire_centimes: 3000, quantite: 2.5, prestation: null }), // 75,00
      tarif({ prix_unitaire_centimes: 1, quantite: 0.5 }), // 0,005 € → 1 centime
      tarif({ prix_unitaire_centimes: 1, quantite: 0.5 }), // idem (et non 1 centime pour les deux)
      tarif({ recurrent: false }), // ponctuel : exclu
      tarif({ actif: false }), // suspendu : exclu
    ];
    expect(mensuelEstime(tarifs, octobre)).toBe(45000 + 7500 + 1 + 1);
    expect(mensuelEstime([], octobre)).toBe(0);
  });
});

describe("saisie des quantités", () => {
  test("parseQuantite", () => {
    expect(parseQuantite("1")).toBe(1);
    expect(parseQuantite("2,5")).toBe(2.5);
    expect(parseQuantite(" 0.75 ")).toBe(0.75);
    expect(parseQuantite("1 000")).toBe(1000);
    expect(parseQuantite("1 000,50")).toBe(1000.5);
    for (const invalide of ["", "0", "0,00", "-1", "1,234", "abc", "1e3", "100000", null, undefined]) {
      expect(parseQuantite(invalide)).toBeNull();
    }
  });

  test("quantiteVersSaisie", () => {
    expect(quantiteVersSaisie(2.5)).toBe("2,5");
    expect(quantiteVersSaisie("1.00")).toBe("1");
    expect(quantiteVersSaisie(null)).toBe("1");
  });
});

describe("arrhes", () => {
  const arrhes = (arrhes_centimes: number | null, arrhes_saison: number | null = 2026, arrhes_reglees = true) => ({
    arrhes_reglees,
    arrhes_centimes,
    arrhes_saison,
  });

  test("saison en cours (heure de Paris) et libellé", () => {
    expect(saisonEnCours("2026-09-28")).toBe(2026);
    expect(saisonEnCours("2026-07-01")).toBe(2026);
    expect(saisonEnCours("2026-06-30")).toBe(2025);
    expect(saisonEnCours("2027-01-15")).toBe(2026);
    expect(libelleSaison(2026)).toBe("2026-2027");
  });

  test("déduction : dixième de septembre à mai, reste en juin, rien en juillet/août ni hors saison", () => {
    const a = arrhes(100005); // 1 000,05 €
    expect(deductionArrhes(a, "2026-09-01")).toBe(10000);
    expect(deductionArrhes(a, "2026-12-15")).toBe(10000);
    expect(deductionArrhes(a, "2027-05-01")).toBe(10000);
    expect(deductionArrhes(a, "2027-06-30")).toBe(10005);
    const total = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]
      .map((m) => deductionArrhes(a, `${m}-01`))
      .reduce((s, d) => s + d, 0);
    expect(total).toBe(100005); // total exact sur 10 mois
    for (const hors of ["2026-07-01", "2026-08-01", "2027-07-01", "2027-08-01", "2026-06-01", "2027-09-01", "2025-10-01"]) {
      expect(deductionArrhes(a, hors)).toBe(0);
    }
    expect(deductionArrhes(arrhes(100005, 2026, false), "2026-10-01")).toBe(0); // non réglées
    expect(deductionArrhes(arrhes(null), "2026-10-01")).toBe(0);
    expect(deductionArrhes(arrhes(0), "2026-10-01")).toBe(0);
    expect(deductionArrhes(arrhes(100005, null), "2026-10-01")).toBe(0);
    expect(deductionArrhes(arrhes(9), "2026-10-01")).toBe(0); // arrondi : tout en juin
    expect(deductionArrhes(arrhes(9), "2027-06-01")).toBe(9);
    expect(mensualiteArrhes(45000)).toBe(4500);
  });

  test("application : ligne de quantité 1 de plus grand total, première en cas d'égalité", () => {
    const tarifs = [
      tarif({ prix_unitaire_centimes: 30000, ordre: 1 }),
      tarif({ prix_unitaire_centimes: 50000, ordre: 3 }),
      tarif({ prix_unitaire_centimes: 50000, ordre: 2 }), // égalité : ordre 2 avant ordre 3
      tarif({ prix_unitaire_centimes: 20000, quantite: 4, ordre: 0 }), // quantité 4 : jamais retenue
    ];
    expect(ligneDeductionArrhes(tarifs, 4500, "2026-10-01")).toBe(2);
    const d = mensuelDetaille(tarifs, arrhes(45000), "2026-10-01");
    expect(d).toMatchObject({ brut: 210000, deduction: 4500, appliquee: 4500, net: 205500, nonAppliquee: false, ligne: 2 });
    // Hors saison : pas de déduction, pas d'alerte.
    expect(mensuelDetaille(tarifs, arrhes(45000), "2026-07-01")).toMatchObject({ net: 210000, nonAppliquee: false });
    // Aucune ligne adéquate (prix < déduction, ou seulement quantité > 1) : aucune déduction, alerte.
    expect(mensuelDetaille([tarif({ prix_unitaire_centimes: 4000 })], arrhes(45000), "2026-10-01")).toMatchObject({
      brut: 4000,
      appliquee: 0,
      net: 4000,
      nonAppliquee: true,
      ligne: null,
    });
    expect(mensuelDetaille([tarif({ quantite: 4 })], arrhes(45000), "2026-10-01")).toMatchObject({
      net: 180000,
      nonAppliquee: true,
    });
    // Ligne inactive ou hors période : ignorée.
    expect(ligneDeductionArrhes([tarif({ actif: false }), tarif({ prix_unitaire_centimes: 5000 })], 4500, "2026-10-01")).toBe(1);
    // Sans arrhes : strictement le mensuel estimé.
    expect(mensuelNet(tarifs, arrhes(null, null, false), "2026-10-01")).toBe(mensuelEstime(tarifs, "2026-10-01"));
  });
});

describe("égalité avec la base de données", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = new PGlite();
  });
  afterAll(async () => {
    await pg.close();
  });

  test("totalLigneCentimes = round(quantite × prix) de Postgres, sur un large échantillon", async () => {
    // Quantités à 2 décimales (numeric(10,2)) × prix en centimes (integer), dont de nombreux cas « ,5 ».
    const quantites = ["0.01", "0.05", "0.07", "0.25", "0.29", "0.33", "0.5", "0.57", "0.67", "0.75", "0.99", "1",
      "1.13", "1.15", "1.5", "2.25", "2.5", "3.33", "4.35", "7.77", "9.95", "10.01", "12.5", "99.99", "365.25",
      "1234.56", "99999.99"];
    const prix = [0, 1, 3, 7, 30, 49, 50, 70, 99, 101, 150, 333, 999, 1234, 3000, 4999, 12345, 45000, 99999, 123457];
    const couples = quantites.flatMap((q) => prix.map((p) => [q, p] as const));

    // Résultat lu en texte (valeur exacte) : certains produits dépassent volontairement la plage `integer`.
    const { rows } = await pg.query<{ q: string; p: number; total: string }>(
      `select c.q, c.p, round(c.q::numeric(10,2) * c.p::integer)::text as total
         from jsonb_to_recordset($1::jsonb) as c(q text, p integer)`,
      [JSON.stringify(couples.map(([q, p]) => ({ q, p })))],
    );
    expect(rows).toHaveLength(couples.length);
    for (const r of rows) {
      expect({ q: r.q, p: r.p, total: totalLigneCentimes(r.q, r.p) }).toEqual({ q: r.q, p: r.p, total: Number(r.total) });
    }
  });

  test("identique à la colonne générée lignes_facture.total_centimes et à generer_brouillons_mensuels", async () => {
    const db = await creerBase();
    try {
      const un = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
      const academie = (await un<{ id: string }>(`select id from academies order by ordre limit 1`)).id;
      const client = (await un<{ id: string }>(
        `insert into clients (academie_id, nom) values ($1, 'Martin') returning id`,
        [academie],
      )).id;
      const pension = (await un<{ id: string }>(
        `insert into prestations (libelle, prix_unitaire_centimes) values ('Pension', 45000) returning id`,
      )).id;
      const cours = (await un<{ id: string }>(
        `insert into prestations (libelle, prix_unitaire_centimes) values ('Cours', 3333) returning id`,
      )).id;

      // Tarifs du client (même données côté SQL et côté TypeScript).
      const tarifs: (TarifPourCalcul & { prestation_id: string | null; libelle: string | null })[] = [
        { ...tarif(), prestation_id: pension, libelle: null },
        { ...tarif({ prix_unitaire_centimes: 39050, quantite: 1 }), prestation_id: pension, libelle: null },
        { ...tarif({ quantite: 2.5, prestation: { prix_unitaire_centimes: 3333 } }), prestation_id: cours, libelle: null },
        { ...tarif({ prix_unitaire_centimes: 1, quantite: 0.5, prestation: null }), prestation_id: null, libelle: "Frais" },
        { ...tarif({ prix_unitaire_centimes: 7, quantite: 0.07, prestation: null }), prestation_id: null, libelle: "Divers" },
        { ...tarif({ recurrent: false }), prestation_id: pension, libelle: null },
        { ...tarif({ actif: false }), prestation_id: pension, libelle: null },
        { ...tarif({ date_debut: "2026-11-01" }), prestation_id: pension, libelle: null },
        { ...tarif({ date_fin: "2026-09-30" }), prestation_id: pension, libelle: null },
        { ...tarif({ date_debut: "2026-10-31", date_fin: "2026-10-31" }), prestation_id: pension, libelle: null },
      ];
      for (const t of tarifs) {
        await db.query(
          `insert into tarifs_clients (client_id, prestation_id, libelle, prix_unitaire_centimes, quantite, recurrent, actif, date_debut, date_fin)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [client, t.prestation_id, t.libelle, t.prix_unitaire_centimes, t.quantite, t.recurrent, t.actif, t.date_debut, t.date_fin],
        );
      }

      const attendu = mensuelEstime(tarifs, "2026-10-01");
      expect(attendu).toBe(45000 + 39050 + 8333 + 1 + 0 + 45000); // 2,5 × 33,33 € = 83,325 € → 83,33 €

      // Aperçu (dry run) de la génération mensuelle.
      const apercu = await un<{ total_ht_centimes: number; nb_lignes: number }>(
        `select * from generer_brouillons_mensuels('2026-10-15', null, true) where client_id = $1`,
        [client],
      );
      expect(apercu.nb_lignes).toBe(tarifs.filter((t) => tarifFactureSurMois(t, "2026-10-01")).length);
      expect(apercu.total_ht_centimes).toBe(attendu);

      // Génération réelle : lignes créées (colonne générée total_centimes) et total HT de la facture.
      const genere = await un<{ facture_id: string }>(
        `select * from generer_brouillons_mensuels('2026-10-15') where client_id = $1`,
        [client],
      );
      const facture = await un<{ total_ht_centimes: number }>(`select total_ht_centimes from factures where id = $1`, [
        genere.facture_id,
      ]);
      expect(facture.total_ht_centimes).toBe(attendu);
      const lignes = (
        await db.query<{ quantite: string; prix_unitaire_centimes: number; total_centimes: number }>(
          `select quantite, prix_unitaire_centimes, total_centimes from lignes_facture where facture_id = $1`,
          [genere.facture_id],
        )
      ).rows;
      for (const l of lignes) {
        expect(totalLigneCentimes(l.quantite, l.prix_unitaire_centimes)).toBe(l.total_centimes);
      }
    } finally {
      await db.close();
    }
  });

  test("deductionArrhes = public.deduction_arrhes, sur un large échantillon", async () => {
    const db = await creerBase();
    try {
      const academie = (await db.query<{ id: string }>(`select id from academies order by ordre limit 1`)).rows[0].id;
      const cas: { reglees: boolean; montant: number | null; saison: number | null }[] = [];
      for (const montant of [null, 0, 1, 9, 10, 11, 45000, 45005, 99999, 123456789]) {
        for (const saison of [null, 2025, 2026]) {
          cas.push({ reglees: true, montant, saison });
        }
      }
      cas.push({ reglees: false, montant: 45000, saison: 2026 });
      const periodes = ["2025-08-01", "2025-09-01", "2026-05-01", "2026-06-15", "2026-07-01", "2026-08-01", "2026-09-01",
        "2026-12-01", "2027-02-01", "2027-06-01", "2027-07-01", "2027-09-01"];
      for (const [i, c] of cas.entries()) {
        const { rows } = await db.query<{ periode: string; d: number }>(
          `with c as (
             insert into clients (academie_id, nom, arrhes_reglees, arrhes_centimes, arrhes_saison)
             values ($1, $2, $3, $4, $5) returning *
           )
           select p.periode::text as periode, deduction_arrhes(c, p.periode::date) as d
             from c, unnest($6::text[]) as p(periode)`,
          [academie, `Client ${i}`, c.reglees, c.montant, c.saison, periodes],
        );
        for (const r of rows) {
          const client = { arrhes_reglees: c.reglees, arrhes_centimes: c.montant, arrhes_saison: c.saison };
          expect({ ...c, periode: r.periode, d: deductionArrhes(client, r.periode) }).toEqual({ ...c, periode: r.periode, d: r.d });
        }
      }
    } finally {
      await db.close();
    }
  });

  test("mensuelDetaille = generer_brouillons_mensuels (aperçu, lignes créées, total) avec arrhes", async () => {
    const db = await creerBase();
    try {
      const un = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
      const academie = (await un<{ id: string }>(`select id from academies order by ordre limit 1`)).id;
      const pension = (await un<{ id: string }>(
        `insert into prestations (libelle, prix_unitaire_centimes) values ('Pension', 45000) returning id`,
      )).id;

      type Scenario = { nom: string; arrhes: number | null; reglees: boolean; tarifs: TarifPourCalcul[] };
      const scenarios: Scenario[] = [
        {
          nom: "Arrondi",
          arrhes: 100007,
          reglees: true,
          tarifs: [
            tarif({ ordre: 1 }), // 450,00 (catalogue)
            tarif({ prix_unitaire_centimes: 60000, ordre: 2 }), // 600,00 : porte la déduction
            tarif({ prix_unitaire_centimes: 60000, ordre: 3 }), // égalité : la première (ordre 2)
            tarif({ prix_unitaire_centimes: 90000, quantite: 4, ordre: 4 }), // quantité 4 : ignorée
          ],
        },
        { nom: "Quantité 4 seule", arrhes: 45000, reglees: true, tarifs: [tarif({ quantite: 4, ordre: 1 })] },
        {
          nom: "Prix insuffisant",
          arrhes: 450000,
          reglees: true,
          tarifs: [tarif({ prix_unitaire_centimes: 40000, ordre: 1 }), tarif({ prix_unitaire_centimes: 100000, quantite: 2, ordre: 2 })],
        },
        { nom: "Non réglées", arrhes: 45000, reglees: false, tarifs: [tarif({ ordre: 1 })] },
        { nom: "Prix égal", arrhes: 450000, reglees: true, tarifs: [tarif({ ordre: 1 })] }, // 45 000 = déduction : net 0
      ];
      const ids = new Map<string, Scenario>();
      for (const s of scenarios) {
        const id = (await un<{ id: string }>(
          `insert into clients (academie_id, nom, arrhes_reglees, arrhes_centimes, arrhes_saison)
           values ($1, $2, $3, $4, 2026) returning id`,
          [academie, s.nom, s.reglees, s.arrhes],
        )).id;
        ids.set(id, s);
        for (const t of s.tarifs) {
          await db.query(
            `insert into tarifs_clients (client_id, prestation_id, prix_unitaire_centimes, quantite, ordre)
             values ($1, $2, $3, $4, $5)`,
            [id, pension, t.prix_unitaire_centimes, t.quantite, t.ordre],
          );
        }
      }

      for (const periode of ["2026-08-01", "2026-09-01", "2027-01-01", "2027-06-01", "2027-07-01"]) {
        const apercu = (await db.query<{ client_id: string; total_ht_centimes: number }>(
          `select * from generer_brouillons_mensuels($1, null, true)`, [periode])).rows;
        const genere = (await db.query<{ client_id: string; facture_id: string; total_ht_centimes: number }>(
          `select * from generer_brouillons_mensuels($1)`, [periode])).rows;
        expect(apercu).toHaveLength(scenarios.length);
        for (const r of genere) {
          const s = ids.get(r.client_id)!;
          const detail = mensuelDetaille(s.tarifs, { arrhes_reglees: s.reglees, arrhes_centimes: s.arrhes, arrhes_saison: 2026 }, periode);
          const contexte = `${s.nom} ${periode}`;
          expect({ contexte, total: r.total_ht_centimes }).toEqual({ contexte, total: detail.net });
          expect({ contexte, apercu: apercu.find((a) => a.client_id === r.client_id)?.total_ht_centimes }).toEqual({
            contexte,
            apercu: detail.net,
          });
          const f = await un<{ total_ht_centimes: number }>(`select total_ht_centimes from factures where id = $1`, [r.facture_id]);
          expect({ contexte, facture: f.total_ht_centimes }).toEqual({ contexte, facture: detail.net });
          // Prix ligne par ligne : seule la ligne choisie porte la déduction.
          const prix = (await db.query<{ prix_unitaire_centimes: number }>(
            `select prix_unitaire_centimes from lignes_facture where facture_id = $1 order by ordre`, [r.facture_id])).rows
            .map((l) => l.prix_unitaire_centimes);
          const attendus = s.tarifs.map((t, i) => (prixApplique(t) ?? 0) - (i === detail.ligne ? detail.appliquee : 0));
          expect({ contexte, prix }).toEqual({ contexte, prix: attendus });
        }
      }
    } finally {
      await db.close();
    }
  });
});
