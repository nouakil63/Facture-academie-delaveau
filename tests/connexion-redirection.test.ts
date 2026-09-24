import { describe, expect, it } from "vitest";
import { cheminDeRetour } from "@/app/connexion/redirection";

/** Où le navigateur irait réellement après une redirection vers `chemin` depuis l'application. */
const ORIGINE = "https://facturation.academie-delaveau.test";
function destination(chemin: string): URL {
  return new URL(chemin, `${ORIGINE}/connexion`);
}

describe("cheminDeRetour — chemins internes acceptés", () => {
  it.each([
    "/",
    "/factures",
    "/factures/3f2b1c9e-8a1d-4c55-9d0e-7f6a5b4c3d2e",
    "/factures?statut=en_retard",
    "/factures?statut=brouillon&mois=2026-10",
    "/facturation-mensuelle?mois=2026-10",
    "/clients/nouveau",
    "/parametres#academies",
    "/clients?q=%C3%A9l%C3%A8ve",
    "/clients?q=élève",
    "/connexions", // autre route que la page de connexion
    "/a/connexion", // « connexion » ailleurs dans le chemin
  ])("conserve %s", (suite) => {
    expect(cheminDeRetour(suite)).toBe(suite);
  });

  it("conserve la chaîne de requête produite par le proxy (chemin + search)", () => {
    // Le proxy encode `chemin + search` dans ?suite= ; la page le reçoit décodé.
    const suite = decodeURIComponent(encodeURIComponent("/factures?statut=en_retard&q=Dupont"));
    expect(cheminDeRetour(suite)).toBe("/factures?statut=en_retard&q=Dupont");
  });
});

describe("cheminDeRetour — valeurs absentes ou d'un mauvais type", () => {
  it.each([undefined, null, 42, true, {}, ["/factures"], ""])("renvoie « / » pour %j", (suite) => {
    expect(cheminDeRetour(suite)).toBe("/");
  });

  it("refuse un chemin démesuré (plus de 2048 caractères)", () => {
    const long = `/factures?q=${"a".repeat(2048)}`;
    expect(cheminDeRetour(long)).toBe("/");
    const limite = `/${"a".repeat(2047)}`;
    expect(limite).toHaveLength(2048);
    expect(cheminDeRetour(limite)).toBe(limite);
  });
});

describe("cheminDeRetour — redirections ouvertes refusées", () => {
  const malveillants = [
    "https://pirate.example",
    "http://pirate.example/factures",
    "HTTPS://pirate.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "pirate.example",
    "factures",
    " /factures", // espace initiale
    "//pirate.example",
    "//pirate.example/factures",
    "///pirate.example",
    "/\\pirate.example",
    "\\\\pirate.example",
    "\\/pirate.example",
    "/factures\\..\\..\\pirate", // barre oblique inverse n'importe où
    "/\t/pirate.example", // tabulation supprimée par les navigateurs → //pirate.example
    "/\n/pirate.example",
    "/\r\n/pirate.example",
    "/\u0000/pirate.example",
    "/\u001f/pirate.example",
    "/\u007f/pirate.example",
    // Segments « . » / « .. » (même encodés) : la forme normalisée commence par « // ».
    "/.//pirate.example",
    "/%2e//pirate.example",
    "/%2e%2e//pirate.example",
    "/x/..//pirate.example",
    "/a/%2E%2E/%2e//pirate.example/factures",
  ];

  it.each(malveillants)("renvoie « / » pour %j", (suite) => {
    expect(cheminDeRetour(suite)).toBe("/");
  });

  it("ne quitte jamais l'origine de l'application", () => {
    const essais = [
      ...malveillants,
      "/%2F%2Fpirate.example", // barres obliques encodées : restent un chemin
      "/%5Cpirate.example",
      "/.//pirate.example",
      "/../../pirate.example",
      "/@pirate.example",
      "/factures?suite=//pirate.example",
      "/ /pirate.example",
    ];
    for (const suite of essais) {
      const url = destination(cheminDeRetour(suite));
      expect(url.origin, `suite = ${JSON.stringify(suite)}`).toBe(ORIGINE);
      // Next resérialise l'URL (chemin + recherche + ancre) puis la résout de nouveau.
      const reserialisee = destination(url.pathname + url.search + url.hash);
      expect(reserialisee.origin, `suite resérialisée = ${JSON.stringify(suite)}`).toBe(ORIGINE);
    }
  });
});

describe("cheminDeRetour — pas de boucle vers la page de connexion", () => {
  it.each([
    "/connexion",
    "/connexion/",
    "/connexion?suite=/factures",
    "/connexion?suite=%2Fconnexion",
    "/connexion#formulaire",
    "/connexion/autre",
    "/./connexion",
    "/x/../connexion?suite=/factures",
  ])("renvoie « / » pour %s", (suite) => {
    expect(cheminDeRetour(suite)).toBe("/");
  });
});
