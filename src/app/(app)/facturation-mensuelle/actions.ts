"use server";

import { z } from "zod";
import { LOT_ENVOI_MAX, syntheseEnvoi, type ResultatEnvoiFacture } from "@/components/factures/outils";
import {
  envoyerLot,
  messageException,
  messagesValidation,
  revaliderFactures,
  schemaId,
  schemaMoisObligatoire,
  traduireErreur,
} from "@/components/factures/serveur";
import { exigerUtilisateur } from "@/lib/auth";
import { genererBrouillonsMensuels } from "@/lib/facturation/service";
import { formatPeriode } from "@/lib/format";
import type { ResultatAction } from "@/lib/types";

/*
 * Server Actions de la facturation mensuelle : génération des brouillons du mois
 * et envoi groupé. Toutes valident leurs entrées (zod), vérifient la session et
 * renvoient un ResultatAction (jamais d'exception vers le navigateur).
 */

/** Académie ciblée (null = toutes) et mois ("AAAA-MM"). */
const schemaCible = z.object({
  academieId: schemaId.nullable(),
  periode: schemaMoisObligatoire,
});

/**
 * Crée les brouillons mensuels manquants d'un mois, pour une académie ou pour toutes
 * (`academieId` null). Idempotent : les clients déjà facturés ce mois-ci sont ignorés.
 */
export async function genererBrouillons(
  academieId: string | null,
  mois: string,
): Promise<ResultatAction<{ crees: number }>> {
  const { supabase } = await exigerUtilisateur();
  const cible = schemaCible.safeParse({ academieId, periode: mois });
  if (!cible.success) return { ok: false, erreur: messagesValidation(cible.error) };

  let crees: number;
  try {
    const resultats = await genererBrouillonsMensuels(supabase, cible.data.periode, {
      academieId: cible.data.academieId,
    });
    crees = resultats.filter((r) => !r.deja_existante).length;
  } catch (e) {
    console.error("Génération mensuelle impossible :", e);
    return { ok: false, erreur: messageException(e, "Génération impossible") };
  }
  revaliderFactures();
  const mot = formatPeriode(cible.data.periode);
  return {
    ok: true,
    message:
      crees === 0
        ? `Aucun nouveau brouillon : toutes les factures de ${mot} étaient déjà générées.`
        : `${crees} brouillon${crees > 1 ? "s" : ""} créé${crees > 1 ? "s" : ""} pour ${mot}. Relisez-les ci-dessous avant l'envoi.`,
    donnees: { crees },
  };
}

const schemaEnvoi = schemaCible.extend({
  ids: z
    .array(schemaId, { error: "Sélection invalide." })
    .min(1, { error: "Aucun brouillon à envoyer." })
    .max(LOT_ENVOI_MAX, { error: `${LOT_ENVOI_MAX} factures au maximum par appel : procédez en plusieurs fois.` })
    .transform((ids) => [...new Set(ids)]),
});

/**
 * Émet et envoie les brouillons mensuels confirmés par l'utilisateur. Seuls les brouillons
 * générés automatiquement pour ce mois (et cette académie si elle est précisée) sont
 * traités : les autres sont ignorés, de même qu'un brouillon émis entre-temps par un autre
 * envoi (autre onglet, autre utilisatrice, tâche planifiée) : jamais d'e-mail en double.
 * Le navigateur appelle cette action par petits lots (LOT_ENVOI).
 */
export async function envoyerBrouillonsMensuels(
  academieId: string | null,
  mois: string,
  ids: string[],
): Promise<ResultatAction<ResultatEnvoiFacture[]>> {
  const { supabase } = await exigerUtilisateur();
  const saisie = schemaEnvoi.safeParse({ academieId, periode: mois, ids });
  if (!saisie.success) return { ok: false, erreur: messagesValidation(saisie.error) };
  const { academieId: academie, periode, ids: demandes } = saisie.data;

  try {
    let requete = supabase
      .from("factures")
      .select("id")
      .in("id", demandes)
      .eq("periode", periode)
      .eq("generation_auto", true);
    if (academie) requete = requete.eq("academie_id", academie);
    const resValides = await requete;
    if (resValides.error) return { ok: false, erreur: traduireErreur(resValides.error) };
    const valides = new Set((resValides.data as { id: string }[]).map((f) => f.id));

    const resultat = await envoyerLot(
      supabase,
      demandes,
      (f) =>
        !valides.has(f.id)
          ? "Ignorée : n'appartient pas à la facturation de ce mois."
          : f.statut !== "brouillon"
            ? "Ignorée : déjà émise entre-temps. Si elle est restée « Émise », envoyez-la depuis sa fiche."
            : null,
      { exigerBrouillon: true },
    );
    revaliderFactures();
    if (!resultat.ok) return resultat;
    return { ok: true, message: syntheseEnvoi(resultat.donnees ?? []), donnees: resultat.donnees };
  } catch (e) {
    console.error("Envoi mensuel impossible :", e);
    revaliderFactures();
    return {
      ok: false,
      erreur: "L'envoi a été interrompu. Rechargez la page pour voir les factures déjà envoyées avant de relancer.",
    };
  }
}
