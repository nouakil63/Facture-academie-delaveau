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
import { aujourdhuiParis } from "@/lib/format";
import { creerClientAdmin } from "@/lib/supabase/admin";
import type { Parametres, ResultatGeneration } from "@/lib/types";

/*
 * GET /api/cron/facturation-mensuelle — tâche planifiée (Vercel Cron, chaque jour à 6 h UTC).
 *
 * Authentification : en-tête `Authorization: Bearer $CRON_SECRET` (envoyé par Vercel).
 * Si la génération automatique est activée dans les paramètres et que le jour de génération
 * est le jour du mois (heure de Paris) : crée les brouillons du mois à facturer pour toutes
 * les académies ; si l'envoi automatique est activé, émet et envoie les brouillons
 * NOUVELLEMENT créés (jamais ceux qui existaient déjà).
 *
 * Paramètres de test :
 *   ?date=AAAA-MM-JJ  simule l'exécution à cette date (jour du mois et période)
 *   ?apercu=1         n'enregistre rien et n'envoie rien (liste ce qui serait créé)
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

interface EchecEnvoi {
  facture_id: string;
  erreur: string;
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
  try {
    admin = creerClientAdmin();
    parametres = await chargerParametres(admin);
  } catch (e) {
    console.error("Cron facturation mensuelle : lecture des paramètres impossible :", e);
    return json(500, { ok: false, date, erreur: `Lecture des paramètres impossible : ${messageDe(e)}` });
  }

  const reglages = {
    generation_auto: parametres.generation_auto,
    jour_generation: Number(parametres.jour_generation),
    mois_facture: parametres.mois_facture,
    envoi_auto: parametres.envoi_auto,
  };

  if (!parametres.generation_auto || reglages.jour_generation !== jour) {
    return json(200, {
      ok: true,
      date,
      jour,
      apercu,
      execute: false,
      raison: parametres.generation_auto
        ? `génération prévue le ${reglages.jour_generation} du mois`
        : "génération automatique désactivée",
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
  const idsAEnvoyer = nouveaux.map((r) => r.facture_id).filter((id): id is string => Boolean(id));

  // Envoi automatique : uniquement les brouillons créés par cette exécution
  // (envoyerFactures ne lève pas d'exception : chaque échec est journalisé et listé).
  let envoyees = 0;
  let echecsEnvoi: EchecEnvoi[] = [];
  if (parametres.envoi_auto && !apercu && idsAEnvoyer.length > 0) {
    // exigerBrouillon : un brouillon émis entre-temps (envoi manuel lancé en même temps) n'est pas renvoyé.
    const envois = await envoyerFactures(admin, idsAEnvoyer, { exigerBrouillon: true });
    envoyees = envois.filter((r) => r.ok).length;
    echecsEnvoi = envois
      .filter((r) => !r.ok)
      .map((r) => ({ facture_id: r.id, erreur: r.erreur ?? "Échec de l'envoi." }));
    for (const echec of echecsEnvoi) {
      console.error(`Cron facturation mensuelle : facture ${echec.facture_id} non envoyée : ${echec.erreur}`);
    }
  }

  const parAcademie = await repartitionParAcademie(admin, resultats);

  return json(200, {
    ok: true,
    date,
    jour,
    apercu,
    execute: true,
    periode,
    reglages,
    brouillons_crees: nouveaux.length,
    deja_existantes: resultats.length - nouveaux.length,
    ...(parAcademie ? { par_academie: parAcademie } : {}),
    envoi_auto: parametres.envoi_auto,
    envoyees,
    echecs_envoi: echecsEnvoi,
  });
}
