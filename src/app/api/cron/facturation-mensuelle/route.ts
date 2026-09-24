import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { envoyerFactures } from "@/lib/facturation/envoi";
import { genererBrouillonsMensuels, periodeAFacturer } from "@/lib/facturation/service";
import { aujourdhuiParis } from "@/lib/format";
import { creerClientAdmin } from "@/lib/supabase/admin";
import type { Entite } from "@/lib/types";

/*
 * GET /api/cron/facturation-mensuelle — tâche planifiée (Vercel Cron, chaque jour à 6 h UTC).
 *
 * Authentification : en-tête `Authorization: Bearer $CRON_SECRET` (envoyé par Vercel).
 * Pour chaque entité active avec la génération automatique et dont le jour de génération
 * est le jour du mois (heure de Paris) : crée les brouillons du mois à facturer ; si l'envoi
 * automatique est activé, émet et envoie les brouillons NOUVELLEMENT créés.
 *
 * Paramètres de test :
 *   ?date=AAAA-MM-JJ  simule l'exécution à cette date (jour du mois et période)
 *   ?apercu=1         n'enregistre rien et n'envoie rien (liste ce qui serait créé)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Envoi séquentiel des e-mails : laisser le temps de traiter tout un mois.
export const maxDuration = 300;

type EntiteCron = Pick<
  Entite,
  "id" | "nom" | "actif" | "generation_auto" | "envoi_auto" | "jour_generation" | "mois_facture"
>;

interface BilanEntite {
  id: string;
  nom: string;
  periode: string | null;
  brouillons_crees: number;
  deja_existantes: number;
  envoi_auto: boolean;
  envoyees: number;
  echecs_envoi: { facture_id: string; erreur: string }[];
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

export async function GET(request: NextRequest) {
  const acces = autorisation(request);
  if (acces === "secret-absent") {
    console.error("Cron facturation mensuelle : CRON_SECRET n'est pas défini.");
    return json(500, { ok: false, erreur: "CRON_SECRET n'est pas configuré sur le serveur." });
  }
  if (acces === "refusee") return json(401, { ok: false, erreur: "Non autorisé." });

  const parametres = request.nextUrl.searchParams;
  const dateParam = parametres.get("date");
  if (dateParam !== null && !dateValide(dateParam)) {
    return json(400, { ok: false, erreur: "Paramètre date invalide : format attendu AAAA-MM-JJ." });
  }
  const date = dateParam ?? aujourdhuiParis();
  const jour = Number(date.slice(8, 10));
  const apercu = parametres.get("apercu") === "1";

  let admin: ReturnType<typeof creerClientAdmin>;
  let entites: EntiteCron[];
  try {
    admin = creerClientAdmin();
    const { data, error } = await admin
      .from("entites")
      .select("id, nom, actif, generation_auto, envoi_auto, jour_generation, mois_facture")
      .eq("actif", true)
      .order("ordre");
    if (error) throw new Error(error.message);
    entites = (data ?? []) as EntiteCron[];
  } catch (e) {
    console.error("Cron facturation mensuelle : lecture des entités impossible :", e);
    return json(500, { ok: false, date, erreur: `Lecture des entités impossible : ${messageDe(e)}` });
  }

  const concernees = entites.filter((e) => e.generation_auto && Number(e.jour_generation) === jour);
  const bilans: BilanEntite[] = [];

  for (const entite of concernees) {
    const bilan: BilanEntite = {
      id: entite.id,
      nom: entite.nom,
      periode: null,
      brouillons_crees: 0,
      deja_existantes: 0,
      envoi_auto: entite.envoi_auto,
      envoyees: 0,
      echecs_envoi: [],
    };
    bilans.push(bilan);

    try {
      bilan.periode = periodeAFacturer(entite, date);
      const resultats = await genererBrouillonsMensuels(admin, entite.id, bilan.periode, apercu);
      const nouveaux = resultats.filter((r) => !r.deja_existante);
      bilan.brouillons_crees = nouveaux.length;
      bilan.deja_existantes = resultats.length - nouveaux.length;

      const idsAEnvoyer = nouveaux.map((r) => r.facture_id).filter((id): id is string => Boolean(id));
      if (entite.envoi_auto && !apercu && idsAEnvoyer.length > 0) {
        const envois = await envoyerFactures(admin, idsAEnvoyer);
        bilan.envoyees = envois.filter((r) => r.ok).length;
        bilan.echecs_envoi = envois
          .filter((r) => !r.ok)
          .map((r) => ({ facture_id: r.id, erreur: r.erreur ?? "Échec de l'envoi." }));
        for (const echec of bilan.echecs_envoi) {
          console.error(
            `Cron facturation mensuelle : ${entite.nom}, facture ${echec.facture_id} non envoyée : ${echec.erreur}`,
          );
        }
      }
    } catch (e) {
      bilan.erreur = messageDe(e);
      console.error(`Cron facturation mensuelle : ${entite.nom} (${entite.id}) :`, e);
    }
  }

  const enErreur = bilans.some((b) => b.erreur);
  return json(enErreur ? 500 : 200, {
    ok: !enErreur,
    date,
    jour,
    apercu,
    entites_traitees: bilans,
    entites_non_concernees: entites
      .filter((e) => !concernees.includes(e))
      .map((e) => ({
        id: e.id,
        nom: e.nom,
        raison: e.generation_auto
          ? `génération prévue le ${e.jour_generation} du mois`
          : "génération automatique désactivée",
      })),
  });
}
