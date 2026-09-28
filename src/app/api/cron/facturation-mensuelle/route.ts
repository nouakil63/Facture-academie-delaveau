import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { envoyerAvisLot } from "@/lib/facturation/avis";
import { chargerParametres, periodeAFacturer } from "@/lib/facturation/service";
import { envoyerEmail, messageErreurEmail } from "@/lib/email";
import { urlApplication } from "@/lib/env";
import {
  composerRecapitulatif,
  destinatairesRecapitulatif,
  type ClientATraiter,
} from "@/lib/facturation/recapitulatif";
import { aujourdhuiParis, nomClient } from "@/lib/format";
import { creerClientAdmin } from "@/lib/supabase/admin";
import { libelleSaison, moisAvecEcheance, saisonDePeriode } from "@/lib/tarifs";
import type { Client, EcheanceVue, Facture, Parametres } from "@/lib/types";

/*
 * GET /api/cron/facturation-mensuelle — tâche planifiée (Vercel Cron, chaque jour à 6 h UTC).
 *
 * Authentification : en-tête `Authorization: Bearer $CRON_SECRET` (envoyé par Vercel).
 * Le jour de génération (`parametres.jour_generation`, heure de Paris), pour un mois de
 * septembre à juin (mois des avis : `periodeAFacturer`, réglage « mois en cours / précédent ») :
 *   1. pour chaque client ACTIF en envoi automatique (`clients.envoi_auto`), envoie l'avis
 *      d'échéance du mois s'il existe (facture annuelle émise) et s'il est encore « à envoyer »
 *      (un avis déjà envoyé ou réglé n'est jamais renvoyé) ;
 *   2. signale les clients en envoi automatique SANS facture annuelle émise pour la saison
 *      (aucune, ou brouillon à émettre) : à traiter à la main ;
 *   3. s'il y a eu au moins un envoi tenté ou un client à traiter, adresse un récapitulatif aux
 *      membres (table `membres`) et à `parametres.email_copie`. Son échec est journalisé, sans
 *      faire échouer la tâche.
 * Plus aucune facture n'est générée ni émise automatiquement : les factures annuelles se
 * préparent et s'émettent à la main (rentrée), depuis « Facturation de l'année ».
 * Juillet et août : rien.
 *
 * Paramètres de test :
 *   ?date=AAAA-MM-JJ  simule l'exécution à cette date (jour du mois et période)
 *   ?apercu=1         n'envoie rien (ni avis ni récapitulatif) : liste ce qui partirait
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Envoi séquentiel des e-mails : laisser le temps de traiter tout un mois.
export const maxDuration = 300;

type ClientAuto = Pick<Client, "id" | "type" | "nom" | "prenom" | "raison_sociale" | "reference">;
type EcheanceAuto = Pick<EcheanceVue, "id" | "client_id" | "statut" | "numero_avis" | "montant_centimes" | "facture_statut">;
type FactureAnnuelle = Pick<Facture, "id" | "client_id" | "statut">;

/** Avis d'un client en envoi automatique (envoyé, ou à envoyer en aperçu). */
interface AvisAuto {
  echeance_id: string;
  client_id: string;
  client: string;
  numero_avis: string;
  montant_centimes: number;
}

interface EchecEnvoi {
  echeance_id: string;
  client: string;
  numero_avis: string | null;
  erreur: string;
}

interface BilanRecapitulatif {
  envoye: boolean;
  destinataires: string[];
  erreur?: string;
}

function json(statut: number, corps: unknown): Response {
  return Response.json(corps, { status: statut, headers: { "Cache-Control": "no-store" } });
}

function messageDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Compare l'en-tête reçu à `Bearer $CRON_SECRET` en temps constant (empreintes de même longueur). */
function autorisation(request: NextRequest): "ok" | "secret-absent" | "refusee" {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return "secret-absent";
  const recu = createHash("sha256")
    .update(request.headers.get("authorization") ?? "")
    .digest();
  const attendu = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(recu, attendu) ? "ok" : "refusee";
}

/** "AAAA-MM-JJ" valide (date réelle) ? */
function dateValide(valeur: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return false;
  const [a, m, j] = valeur.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

/** Clients actifs en envoi automatique, par identifiant. */
async function chargerClientsEnvoiAuto(admin: SupabaseClient): Promise<Map<string, ClientAuto>> {
  const { data, error } = await admin
    .from("clients")
    .select("id, type, nom, prenom, raison_sociale, reference")
    .eq("actif", true)
    .eq("envoi_auto", true);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as ClientAuto[]).map((c) => [c.id, c]));
}

/** Échéances du mois des clients donnés. */
async function echeancesDuMois(admin: SupabaseClient, periode: string, clientIds: string[]): Promise<EcheanceAuto[]> {
  const { data, error } = await admin
    .from("echeances_vue")
    .select("id, client_id, statut, numero_avis, montant_centimes, facture_statut")
    .eq("periode", periode)
    .in("client_id", clientIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as EcheanceAuto[];
}

/** Factures annuelles (non annulées) de la saison des clients donnés. */
async function facturesAnnuelles(admin: SupabaseClient, saison: number, clientIds: string[]): Promise<FactureAnnuelle[]> {
  const { data, error } = await admin
    .from("factures")
    .select("id, client_id, statut")
    .eq("type_facture", "annuelle")
    .eq("saison", saison)
    .in("client_id", clientIds);
  if (error) throw new Error(error.message);
  return ((data ?? []) as FactureAnnuelle[]).filter((f) => f.statut !== "annulee");
}

/** Adresses des membres (utilisateurs de l'application). */
async function adressesMembres(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.from("membres").select("email");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { email: string }[]).map((m) => m.email);
}

const trierParClient = <T extends { client: string }>(liste: T[]) =>
  liste.sort((a, b) => a.client.localeCompare(b.client, "fr", { sensitivity: "base" }));

export async function GET(request: NextRequest) {
  const acces = autorisation(request);
  if (acces === "secret-absent") {
    console.error("Cron avis d'échéance : CRON_SECRET n'est pas défini.");
    return json(500, { ok: false, erreur: "CRON_SECRET n'est pas configuré sur le serveur." });
  }
  if (acces === "refusee") return json(401, { ok: false, erreur: "Non autorisé." });

  const recherche = request.nextUrl.searchParams;
  const dateParam = recherche.get("date");
  if (dateParam !== null && !dateValide(dateParam)) {
    return json(400, { ok: false, erreur: "Paramètre date invalide : format attendu AAAA-MM-JJ." });
  }
  const date = dateParam ?? aujourdhuiParis();
  const jour = Number(date.slice(8, 10));
  const apercu = recherche.get("apercu") === "1";

  let admin: SupabaseClient;
  let parametres: Parametres;
  let clientsAuto: Map<string, ClientAuto>;
  try {
    admin = creerClientAdmin();
    [parametres, clientsAuto] = await Promise.all([chargerParametres(admin), chargerClientsEnvoiAuto(admin)]);
  } catch (e) {
    console.error("Cron avis d'échéance : lecture des paramètres impossible :", e);
    return json(500, { ok: false, date, erreur: `Lecture des paramètres impossible : ${messageDe(e)}` });
  }

  const reglages = {
    jour_generation: Number(parametres.jour_generation),
    mois_facture: parametres.mois_facture,
    clients_envoi_auto: clientsAuto.size,
  };
  const sansExecution = (raison: string, complement: Record<string, unknown> = {}) =>
    json(200, { ok: true, date, jour, apercu, execute: false, ...complement, raison, reglages });

  if (clientsAuto.size === 0) return sansExecution("aucun client en envoi automatique");
  if (reglages.jour_generation !== jour) return sansExecution(`envoi des avis prévu le ${reglages.jour_generation} du mois`);

  const periode = periodeAFacturer(parametres, date);
  // Échéances de septembre à juin : rien en juillet ni en août.
  if (!moisAvecEcheance(periode)) return sansExecution("juillet/août : pas d'avis d'échéance", { periode });
  const saison = saisonDePeriode(periode);

  const idsAuto = [...clientsAuto.keys()];
  let echeances: EcheanceAuto[];
  let factures: FactureAnnuelle[];
  try {
    [echeances, factures] = await Promise.all([
      echeancesDuMois(admin, periode, idsAuto),
      facturesAnnuelles(admin, saison, idsAuto),
    ]);
  } catch (e) {
    console.error(`Cron avis d'échéance : lecture des échéances (${periode}) impossible :`, e);
    return json(500, {
      ok: false,
      date,
      jour,
      apercu,
      execute: true,
      periode,
      saison,
      reglages,
      erreur: `Lecture des échéances impossible : ${messageDe(e)}`,
    });
  }

  const nom = (clientId: string) => {
    const c = clientsAuto.get(clientId);
    return c ? nomClient(c) : "Client";
  };

  // 1. Avis à envoyer : échéances du mois « à envoyer » (facture annuelle active).
  const aEnvoyer: AvisAuto[] = trierParClient(
    echeances
      .filter((e) => e.statut === "a_venir" && e.facture_statut !== "annulee")
      .map((e) => ({
        echeance_id: e.id,
        client_id: e.client_id,
        client: nom(e.client_id),
        numero_avis: e.numero_avis,
        montant_centimes: e.montant_centimes,
      })),
  );
  const dejaEnvoyes = echeances.filter((e) => e.statut === "envoyee" || e.statut === "payee").length;

  // 2. Clients à traiter : aucune facture annuelle émise pour la saison.
  const facturesParClient = new Map<string, FactureAnnuelle[]>();
  for (const f of factures) facturesParClient.set(f.client_id, [...(facturesParClient.get(f.client_id) ?? []), f]);
  const aTraiter: (ClientATraiter & { client_id: string })[] = trierParClient(
    [...clientsAuto.values()]
      .filter((c) => !(facturesParClient.get(c.id) ?? []).some((f) => f.statut !== "brouillon"))
      .map((c) => ({
        client_id: c.id,
        client: nomClient(c),
        reference: c.reference,
        raison: (facturesParClient.get(c.id) ?? []).length > 0
          ? "facture annuelle en brouillon : à émettre"
          : `aucune facture annuelle pour ${libelleSaison(saison)}`,
      })),
  );

  const base = {
    ok: true,
    date,
    jour,
    apercu,
    execute: true,
    periode,
    saison,
    reglages,
    deja_envoyes: dejaEnvoyes,
    sans_facture_annuelle: aTraiter,
  };

  if (apercu) {
    let destinataires: string[] = [];
    if (aEnvoyer.length + aTraiter.length > 0) {
      try {
        destinataires = destinatairesRecapitulatif(await adressesMembres(admin), parametres.email_copie);
      } catch (e) {
        console.error("Cron avis d'échéance (aperçu) : lecture des membres impossible :", e);
      }
    }
    return json(200, {
      ...base,
      a_envoyer: aEnvoyer,
      envoyes: 0,
      echecs_envoi: [],
      ignores: 0,
      recapitulatif: aEnvoyer.length + aTraiter.length > 0 ? { envoye: false, destinataires } : null,
    });
  }

  // Envoi : exigerAEnvoyer → un avis envoyé ou réglé entre-temps est ignoré (jamais de doublon).
  // envoyerAvisLot ne lève pas d'exception : chaque échec est journalisé (envois_email) et listé.
  const envois =
    aEnvoyer.length > 0 ? await envoyerAvisLot(admin, aEnvoyer.map((a) => a.echeance_id), { exigerAEnvoyer: true }) : [];
  const parId = new Map(aEnvoyer.map((a) => [a.echeance_id, a]));
  const envoyes = envois.filter((r) => r.ok).map((r) => parId.get(r.id)).filter((a): a is AvisAuto => Boolean(a));
  const ignores = envois.filter((r) => !r.ok && r.ignoree).length;
  const echecsEnvoi: EchecEnvoi[] = envois
    .filter((r) => !r.ok && !r.ignoree)
    .map((r) => {
      const a = parId.get(r.id);
      return {
        echeance_id: r.id,
        client: a?.client ?? "Client",
        numero_avis: a?.numero_avis ?? null,
        erreur: r.erreur ?? "Échec de l'envoi.",
      };
    });
  for (const echec of echecsEnvoi) {
    console.error(`Cron avis d'échéance : avis ${echec.numero_avis ?? echec.echeance_id} (${echec.client}) non envoyé : ${echec.erreur}`);
  }

  // Récapitulatif aux membres : au moins un envoi tenté, ou un client à traiter.
  let recapitulatif: BilanRecapitulatif | null = null;
  if (envoyes.length + echecsEnvoi.length + aTraiter.length > 0) {
    recapitulatif = { envoye: false, destinataires: [] };
    try {
      recapitulatif.destinataires = destinatairesRecapitulatif(await adressesMembres(admin), parametres.email_copie);
      const message = composerRecapitulatif({
        periode,
        envoyes,
        echecs: echecsEnvoi,
        aTraiter,
        urlApplication: urlApplication() ?? request.nextUrl.origin,
      });
      await envoyerEmail({ a: recapitulatif.destinataires, ...message });
      recapitulatif.envoye = true;
    } catch (e) {
      recapitulatif.erreur = messageErreurEmail(e);
      console.error("Cron avis d'échéance : récapitulatif non envoyé :", e);
    }
  }

  return json(200, {
    ...base,
    a_envoyer: aEnvoyer,
    envoyes: envoyes.length,
    echecs_envoi: echecsEnvoi,
    ignores,
    recapitulatif,
  });
}
