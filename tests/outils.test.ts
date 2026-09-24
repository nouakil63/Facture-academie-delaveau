import { afterEach, describe, expect, test, vi } from "vitest";
import { resoudreAcademie } from "@/lib/academie-selectionnee";
import {
  avecArticle,
  datesGeneration,
  destinatairesFacture,
  formatDate,
  formatDateLongue,
  jourDuMois,
  nomCourtAcademie,
  pluriel,
} from "@/lib/format";
import { MOTIF_MOIS, moisVersPeriode, moisVoisin, periodeVersMois } from "@/components/factures/outils";
import { joursEntre } from "@/components/tableau-de-bord/outils";

const DELAVEAU = { id: "11111111-1111-4111-8111-111111111111", nom: "Académie Delaveau", actif: true };
const ESPOIR = { id: "22222222-2222-4222-8222-222222222222", nom: "Académie Espoir", actif: true };

describe("dates", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("formatDateLongue écrit « 1er » le premier du mois", () => {
    expect(formatDateLongue("2026-10-01")).toBe("1er octobre 2026");
    expect(formatDateLongue("2026-10-15")).toBe("15 octobre 2026");
    expect(formatDateLongue("2026-10-11")).toBe("11 octobre 2026");
    expect(formatDateLongue(null)).toBe("—");
  });

  test("une date SQL garde son jour quel que soit le fuseau du serveur", () => {
    for (const tz of ["UTC", "Europe/Paris", "Pacific/Kiritimati", "America/Los_Angeles"]) {
      vi.stubEnv("TZ", tz);
      expect(formatDate("2026-10-05")).toBe("05/10/2026");
      expect(formatDateLongue("2026-01-01")).toBe("1er janvier 2026");
    }
  });

  test("un horodatage est affiché à l'heure de Paris", () => {
    // 23 h 30 UTC le 31 décembre = 0 h 30 le 1er janvier à Paris.
    expect(formatDate("2026-12-31T23:30:00Z")).toBe("01/01/2027");
  });

  test("jourDuMois", () => {
    expect(jourDuMois(1)).toBe("1er");
    expect(jourDuMois(28)).toBe("28");
  });

  test("joursEntre", () => {
    expect(joursEntre("2026-09-24", "2026-10-01")).toBe(7);
    expect(joursEntre("2026-10-01", "2026-09-24")).toBe(-7);
    expect(joursEntre("2026-03-28", "2026-03-30")).toBe(2); // passage à l'heure d'été
  });

  test("datesGeneration : dernière (aujourd'hui compris) et prochaine (strictement après)", () => {
    expect(datesGeneration(1, "2026-09-24")).toEqual({ derniere: "2026-09-01", prochaine: "2026-10-01" });
    expect(datesGeneration(1, "2026-10-01")).toEqual({ derniere: "2026-10-01", prochaine: "2026-11-01" });
    expect(datesGeneration(25, "2026-09-24")).toEqual({ derniere: "2026-08-25", prochaine: "2026-09-25" });
    // Changement d'année dans les deux sens.
    expect(datesGeneration(5, "2026-12-20")).toEqual({ derniere: "2026-12-05", prochaine: "2027-01-05" });
    expect(datesGeneration(10, "2027-01-03")).toEqual({ derniere: "2026-12-10", prochaine: "2027-01-10" });
  });

  test("mois d'un <input type=\"month\"> ↔ période", () => {
    expect(moisVersPeriode("2026-10")).toBe("2026-10-01");
    expect(moisVersPeriode(" 2026-01 ")).toBe("2026-01-01");
    expect(moisVersPeriode("2026-13")).toBeNull();
    expect(moisVersPeriode("1999-12")).toBeNull();
    expect(moisVersPeriode("2026-10-01")).toBeNull();
    expect(moisVersPeriode("")).toBeNull();
    expect(periodeVersMois("2026-10-01")).toBe("2026-10");
    expect(periodeVersMois(null)).toBe("");
  });

  test("mois voisin et saisie d'un mois complet", () => {
    expect(moisVoisin("2026-10", 1)).toBe("2026-11");
    expect(moisVoisin("2026-12", 1)).toBe("2027-01");
    expect(moisVoisin("2026-01", -1)).toBe("2025-12");
    expect(MOTIF_MOIS.test("2026-10")).toBe(true);
    expect(["2", "2026", "2026-1", "2026-13", "2026-10-01"].some((v) => MOTIF_MOIS.test(v))).toBe(false);
  });
});

describe("textes", () => {
  test("pluriel : singulier jusqu'à 1", () => {
    expect(pluriel(0, "facture")).toBe("0 facture");
    expect(pluriel(1, "facture")).toBe("1 facture");
    expect(pluriel(2, "facture")).toBe("2 factures");
    expect(pluriel(3, "brouillon préparé", "brouillons préparés")).toBe("3 brouillons préparés");
  });

  test("nom d'académie : forme courte et article", () => {
    expect(nomCourtAcademie("Académie Delaveau")).toBe("Delaveau");
    expect(nomCourtAcademie("Autre groupe")).toBe("Autre groupe");
    expect(avecArticle("Académie Espoir")).toBe("l'Académie Espoir");
    expect(avecArticle("Groupe loisirs")).toBe("« Groupe loisirs »");
  });

  test("destinataires : e-mail principal et copies, sans vide ni doublon", () => {
    expect(destinatairesFacture({ email: "a@x.fr", emails_cc: ["b@x.fr", "a@x.fr", " "] })).toEqual(["a@x.fr", "b@x.fr"]);
    expect(destinatairesFacture({ email: null, emails_cc: ["copie@x.fr"] })).toEqual(["copie@x.fr"]);
    expect(destinatairesFacture({ email: "  ", emails_cc: [] })).toEqual([]);
  });
});

describe("filtre d'académie (cookie)", () => {
  test("cookie absent → toutes", () => {
    expect(resoudreAcademie(null, [DELAVEAU, ESPOIR])).toBeNull();
  });

  test("cookie d'une académie active → cette académie", () => {
    expect(resoudreAcademie(ESPOIR.id, [DELAVEAU, ESPOIR])).toBe(ESPOIR);
  });

  test("cookie périmé (académie supprimée ou désactivée) → toutes", () => {
    expect(resoudreAcademie("33333333-3333-4333-8333-333333333333", [DELAVEAU, ESPOIR])).toBeNull();
    expect(resoudreAcademie(ESPOIR.id, [DELAVEAU, { ...ESPOIR, actif: false }])).toBeNull();
  });

  test("liste déjà limitée aux académies actives (sans champ actif)", () => {
    const menu = [{ id: DELAVEAU.id, nom: DELAVEAU.nom }];
    expect(resoudreAcademie(DELAVEAU.id, menu)).toBe(menu[0]);
  });
});
