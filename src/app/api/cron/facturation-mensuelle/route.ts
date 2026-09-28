import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { envoyerFactures } from "@/lib/facturation/envoi";
import {
  chargerAcademies,
  chargerParametres,
  genererBrouillonsMensuels,
  periodeAFacturer,
} from "@/lib/facturation/service";
import { envoyerEmail, messageErreurEmail } from "@/lib/email";
import { urlApplication } from "@/lib/env";
import { composerRecapitulatif, destinatairesRecapitulatif } from "@/lib/facturation/recapitulatif";
import { aujourdhuiParis, nomClient } from "@/lib/format";
import { creerClientAdmin } from "@/lib/supabase/admin";
import type { Client, Parametres, ResultatGeneration } from "@/lib/types";

/*
 * GET /api/cron/facturation-mensuelle — tâche planifiée (Vercel Cron, chaque jour à 6 h UTC).
 *
 * Authentification : en-tête `Authorization: Bearer $CRON_SECRET` (envoyé par Vercel).
 * Le jour de génération (`parametres.jour_generation`, heure de Paris), si la génération
 * automatique est activée OU si au moins un client actif est en envoi automatique :
 *   1. crée les brouillons du mois à facturer pour toutes les académies ;
 *   2. émet et envoie les brouillons mensuels de la période (nouveaux ou déjà existants) des
 *      seuls clients actifs en envoi automatique (`clients.envoi_auto`) ; les autres restent
 *      à relire à la main ;
 *   3. s'il y a eu au moins un envoi tenté, adresse un récapitulatif aux membres (table
 *      `membres`) et à `parametres.email_copie`. Son échec est journalisé, sans faire échouer
 *      la tâche.
 *
 * Paramètres de test :
 *   ?date=AAAA-MM-JJ  simule l'exécution à cette date (jour du mois et période)
 *   ?apercu=1         n'enregistre rien et n'envoie rien (ni factures ni récapitulatif) :
 *                     liste ce qui serait créé et envoyé
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Envoi séquentiel des e-mails : laisser le temps de traiter tout un mois.
export const maxDuration = 300;

interface BilanAcademie {
  id: string | null;
  nom: string;
  brouillons_crees: number;
  deja_existantes: number;
}

type ClientAuto = Pick<Client, "id" | "type" | "nom" | "prenom" | "raison_sociale">;

/** Facture mensuelle d'un client en envoi automatique (envoyée, ou à envoyer en aperçu). */
interface FactureAuto {
  /** null en aperçu pour un brouillon qui reste à créer. */
  facture_id: string | null;
  client_id: string;
  client: string;
  numero: string | null;
  /** Estimé (taux de TVA actuel) en aperçu pour un brouillon qui reste à créer. */
  montant_ttc_centimes: number;
}

interface EchecEnvoi {
  facture_id: string;
  client: string;
  numero: string | null;
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
    .select("id, type, nom, prenom, raison_sociale")
    .eq("actif", true)
    .eq("envoi_auto", true);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as ClientAuto[]).map((c) => [c.id, c]));
}

/** Brouillons mensuels de la période appartenant aux clients donnés. */
async function brouillonsMensuels(
  admin: SupabaseClient,
  periode: string,
  clientIds: string[],
): Promise<{ id: string; client_id: string; total_ttc_centimes: number }[]> {
  if (clientIds.length === 0) return [];
  const { data, error } = await admin
    .from("factures")
    .select("id, client_id, total_ttc_centimes")
    .eq("periode", periode)
    .eq("generation_auto", true)
    .eq("statut", "brouillon")
    .in("client_id", clientIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; client_id: string; total_ttc_centimes: number }[];
}

/** Adresses des membres (utilisateurs de l'application). */
async function adressesMembres(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.from("membres").select("email");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { email: string }[]).map((m) => m.email);
}

/**
 * Répartition des brouillons par académie (pour suivre Delaveau et Espoir dans le bilan).
 * Informative : en cas d'échec de lecture, le bilan est simplement omis.
 */
async function repartitionParAcademie(
  admin: SupabaseClient,
  resultats: ResultatGeneration[],
): Promise<BilanAcademie[] | null> {
  if (resultats.length === 0) return [];
  try {
    const [academies, clients] = await Promise.all([
      chargerAcademies(admin),
      admin
        .from("clients")
        .select("id, academie_id")
        .in(
          "id",
          resultats.map((r) => r.client_id),
        ),
    ]);
    if (clients.error) throw new Error(clients.error.message);
    const academieDuClient = new Map(
      ((clients.data ?? []) as { id: string; academie_id: string }[]).map((c) => [c.id, c.academie_id]),
    );

    const bilans = new Map<string | null, BilanAcademie>(
      academies.map((a) => [a.id, { id: a.id, nom: a.nom, brouillons_crees: 0, deja_existantes: 0 }]),
    );
    for (const r of resultats) {
      const id = academieDuClient.get(r.client_id) ?? null;
      let bilan = bilans.get(id);
      if (!bilan) {
        bilan = { id, nom: "Académie inconnue", brouillons_crees: 0, deja_existantes: 0 };
        bilans.set(id, bilan);
      }
      if (r.deja_existante) bilan.deja_existantes += 1;
      else bilan.brouillons_crees += 1;
    }
    return [...bilans.values()].filter((b) => b.brouillons_crees + b.deja_existantes > 0);
  } catch (e) {
    console.error("Cron facturation mensuelle : répartition par académie impossible :", e);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const acces = autorisation(request);
  if (acces === "secret-absent") {
    console.error("Cron facturation mensuelle : CRON_SECRET n'est pas défini.");
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
    console.error("Cron facturation mensuelle : lecture des paramètres impossible :", e);
    return json(500, { ok: false, date, erreur: `Lecture des paramètres impossible : ${messageDe(e)}` });
  }

  const reglages = {
    generation_auto: parametres.generation_auto,
    jour_generation: Number(parametres.jour_generation),
    mois_facture: parametres.mois_facture,
    clients_envoi_auto: clientsAuto.size,
  };
  // Des clients en envoi automatique : la génération a lieu même si la case globale est décochée.
  const actif = parametres.generation_auto || clientsAuto.size > 0;

  if (!actif || reglages.jour_generation !== jour) {
    return json(200, {
      ok: true,
      date,
      jour,
      apercu,
      execute: false,
      raison: actif
        ? `génération prévue le ${reglages.jour_generation} du mois`
        : "génération automatique désactivée et aucun client en envoi automatique",
      reglages,
    });
  }

  const periode = periodeAFacturer(parametres, date);
  let resultats: ResultatGeneration[];
  try {
    resultats = await genererBrouillonsMensuels(admin, periode, { apercu });
  } catch (e) {
    console.error(`Cron facturation mensuelle : génération des brouillons (${periode}) impossible :`, e);
    return json(500, {
      ok: false,
      date,
      jour,
      apercu,
      execute: true,
      periode,
      reglages,
      erreur: `Génération des brouillons impossible : ${messageDe(e)}`,
    });
  }

  const nouveaux = resultats.filter((r) => !r.deja_existante);
  const bilanGeneration = {
    brouillons_crees: nouveaux.length,
    deja_existantes: resultats.length - nouveaux.length,
  };

  // Brouillons mensuels de la période des clients en envoi automatique (nouveaux ET existants).
  const nom = (clientId: string) => {
    const c = clientsAuto.get(clientId);
    return c ? nomClient(c) : "Client";
  };
  let aEnvoyer: FactureAuto[];
  try {
    aEnvoyer = (await brouillonsMensuels(admin, periode, [...clientsAuto.keys()])).map((f) => ({
      facture_id: f.id,
      client_id: f.client_id,
      client: nom(f.client_id),
      numero: null,
      montant_ttc_centimes: f.total_ttc_centimes,
    }));
  } catch (e) {
    console.error(`Cron facturation mensuelle : lecture des brouillons à envoyer (${periode}) impossible :`, e);
    return json(500, {
      ok: false,
      date,
      jour,
      apercu,
      execute: true,
      periode,
      reglages,
      ...bilanGeneration,
      erreur: `Lecture des brouillons à envoyer impossible : ${messageDe(e)}`,
    });
  }
  if (apercu) {
    // Aperçu : les brouillons qui restent à créer seraient envoyés aussi (montant TTC estimé).
    for (const r of nouveaux) {
      if (!clientsAuto.has(r.client_id)) continue;
      const ht = r.total_ht_centimes ?? 0;
      aEnvoyer.push({
        facture_id: null,
        client_id: r.client_id,
        client: nom(r.client_id),
        numero: null,
        montant_ttc_centimes: ht + Math.round((ht * Number(parametres.taux_tva)) / 100),
      });
    }
  }
  aEnvoyer.sort((a, b) => a.client.localeCompare(b.client, "fr", { sensitivity: "base" }));

  const parAcademie = await repartitionParAcademie(admin, resultats);
  const base = {
    ok: true,
    date,
    jour,
    apercu,
    execute: true,
    periode,
    reglages,
    ...bilanGeneration,
    ...(parAcademie ? { par_academie: parAcademie } : {}),
  };

  if (apercu) {
    let destinataires: string[] = [];
    if (aEnvoyer.length > 0) {
      try {
        destinataires = destinatairesRecapitulatif(await adressesMembres(admin), parametres.email_copie);
      } catch (e) {
        console.error("Cron facturation mensuelle (aperçu) : lecture des membres impossible :", e);
      }
    }
    return json(200, {
      ...base,
      a_envoyer: aEnvoyer,
      envoyees: 0,
      echecs_envoi: [],
      ignorees: 0,
      recapitulatif: aEnvoyer.length > 0 ? { envoye: false, destinataires } : null,
    });
  }

  // Envoi : exigerBrouillon → un brouillon émis entre-temps (envoi manuel simultané) est ignoré.
  // envoyerFactures ne lève pas d'exception : chaque échec est journalisé (envois_email) et listé.
  const idsAEnvoyer = aEnvoyer.map((f) => f.facture_id).filter((id): id is string => Boolean(id));
  const envois = idsAEnvoyer.length > 0 ? await envoyerFactures(admin, idsAEnvoyer, { exigerBrouillon: true }) : [];
  const idsEnvoyees = new Set(envois.filter((r) => r.ok).map((r) => r.id));
  const ignorees = envois.filter((r) => !r.ok && r.ignoree).length;

  // Numéros attribués à l'émission (et montant émis) : relus pour le bilan et le récapitulatif.
  const facturesTentees = envois.filter((r) => r.ok || !r.ignoree).map((r) => r.id);
  const emises = new Map<string, { numero: string | null; total_ttc_centimes: number }>();
  if (facturesTentees.length > 0) {
    const { data, error } = await admin
      .from("factures")
      .select("id, numero, total_ttc_centimes")
      .in("id", facturesTentees);
    if (error) console.error("Cron facturation mensuelle : relecture des numéros impossible :", error.message);
    for (const f of (data ?? []) as { id: string; numero: string | null; total_ttc_centimes: number }[]) {
      emises.set(f.id, { numero: f.numero, total_ttc_centimes: f.total_ttc_centimes });
    }
  }
  const complete = (f: FactureAuto): FactureAuto => {
    const relue = f.facture_id ? emises.get(f.facture_id) : undefined;
    return relue ? { ...f, numero: relue.numero, montant_ttc_centimes: relue.total_ttc_centimes } : f;
  };

  const envoyees = aEnvoyer.filter((f) => f.facture_id && idsEnvoyees.has(f.facture_id)).map(complete);
  const parId = new Map(aEnvoyer.map((f) => [f.facture_id, f]));
  const echecsEnvoi: EchecEnvoi[] = envois
    .filter((r) => !r.ok && !r.ignoree)
    .map((r) => {
      const f = complete(parId.get(r.id) ?? { facture_id: r.id, client_id: "", client: "Client", numero: null, montant_ttc_centimes: 0 });
      return { facture_id: r.id, client: f.client, numero: f.numero, erreur: r.erreur ?? "Échec de l'envoi." };
    });
  for (const echec of echecsEnvoi) {
    console.error(`Cron facturation mensuelle : facture ${echec.facture_id} (${echec.client}) non envoyée : ${echec.erreur}`);
  }

  // Récapitulatif aux membres, seulement si au moins un envoi a été tenté.
  let recapitulatif: BilanRecapitulatif | null = null;
  if (envoyees.length + echecsEnvoi.length > 0) {
    recapitulatif = { envoye: false, destinataires: [] };
    try {
      recapitulatif.destinataires = destinatairesRecapitulatif(await adressesMembres(admin), parametres.email_copie);
      const message = composerRecapitulatif({
        periode,
        envoyees,
        echecs: echecsEnvoi,
        urlApplication: urlApplication() ?? request.nextUrl.origin,
      });
      await envoyerEmail({ a: recapitulatif.destinataires, ...message });
      recapitulatif.envoye = true;
    } catch (e) {
      recapitulatif.erreur = messageErreurEmail(e);
      console.error("Cron facturation mensuelle : récapitulatif non envoyé :", e);
    }
  }

  return json(200, {
    ...base,
    a_envoyer: aEnvoyer.map(complete),
    envoyees: envoyees.length,
    echecs_envoi: echecsEnvoi,
    ignorees,
    recapitulatif,
  });
}
