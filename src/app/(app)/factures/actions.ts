"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  champ,
  creerBrouillon,
  envoyerLot,
  messagesValidation,
  revaliderFactures,
  schemaId,
  schemaLigne,
  schemaPeriode,
  texteFacultatif,
} from "@/components/factures/serveur";
import { LOT_ENVOI_MAX, syntheseEnvoi, type ResultatEnvoiFacture } from "@/components/factures/outils";
import { exigerUtilisateur } from "@/lib/auth";
import type { ResultatAction, StatutFacture } from "@/lib/types";

/*
 * Server Actions de la liste des factures et de la création d'une facture.
 * Toutes valident leurs entrées (zod), vérifient la session et renvoient un
 * ResultatAction (jamais d'exception vers le navigateur).
 */

const schemaNouvelleFacture = z.object({
  client_id: z.guid({ error: "Choisissez le client à facturer." }),
  objet: texteFacultatif(200, "Objet"),
  periode: schemaPeriode,
  notes: texteFacultatif(2000, "Notes imprimées"),
  lignes: z
    .string()
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Lignes illisibles : rechargez la page." });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .array(schemaLigne, { error: "Lignes illisibles : rechargez la page." })
        .min(1, { error: "Ajoutez au moins une ligne à la facture." })
        .max(100, { error: "100 lignes au maximum par facture." }),
    ),
});

/** Crée une facture brouillon puis ouvre sa fiche. */
export async function creerFacture(_precedent: ResultatAction | null, formData: FormData): Promise<ResultatAction> {
  const { supabase } = await exigerUtilisateur();

  const saisie = schemaNouvelleFacture.safeParse({
    client_id: champ(formData, "client_id"),
    objet: champ(formData, "objet"),
    periode: champ(formData, "periode"),
    notes: champ(formData, "notes"),
    lignes: champ(formData, "lignes") || "[]",
  });
  if (!saisie.success) return { ok: false, erreur: messagesValidation(saisie.error) };

  let factureId: string;
  try {
    // Client introuvable ou archivé : refusé par creerBrouillon.
    const resultat = await creerBrouillon(supabase, {
      clientId: saisie.data.client_id,
      objet: saisie.data.objet,
      periode: saisie.data.periode,
      notes: saisie.data.notes,
      lignes: saisie.data.lignes,
    });
    if (!resultat.ok) return resultat;
    factureId = resultat.donnees!.id;
  } catch (e) {
    console.error("Création de facture impossible :", e);
    return { ok: false, erreur: "La facture n'a pas pu être créée. Vérifiez la connexion puis réessayez." };
  }

  revaliderFactures();
  // redirect() lève une exception de contrôle : à appeler hors du try.
  redirect(`/factures/${factureId}`);
}

const STATUTS = ["brouillon", "emise", "envoyee", "payee", "annulee"] as const satisfies readonly StatutFacture[];

const schemaSelection = z
  .array(z.object({ id: schemaId, statut: z.enum(STATUTS, { error: "Sélection invalide." }) }), {
    error: "Sélection invalide.",
  })
  .min(1, { error: "Sélectionnez au moins une facture." })
  .max(LOT_ENVOI_MAX, { error: `${LOT_ENVOI_MAX} factures au maximum par appel : procédez en plusieurs fois.` })
  .transform((factures) => new Map(factures.map((f) => [f.id, f.statut])));

/** Un renvoi groupé récent (même facture) est ignoré : protège contre une relance après une coupure. */
const DELAI_RENVOI_MS = 15 * 60 * 1000;

/**
 * Action groupée « Émettre et envoyer » : émet les brouillons sélectionnés puis envoie
 * chaque facture par e-mail (les factures déjà émises sont renvoyées, les payées partent
 * en duplicata, les annulées sont ignorées). Renvoie un résultat par facture.
 * Chaque facture est accompagnée du statut vu par l'utilisateur à la confirmation : si elle a
 * changé depuis (envoyée par une tentative précédente, payée…), elle est ignorée, de même
 * qu'une facture envoyée il y a moins de 15 minutes. Le navigateur appelle cette action par
 * petits lots (LOT_ENVOI) pour rester loin de la durée maximale d'une requête.
 */
export async function envoyerSelection(
  factures: { id: string; statut: StatutFacture }[],
): Promise<ResultatAction<ResultatEnvoiFacture[]>> {
  const { supabase } = await exigerUtilisateur();

  const selection = schemaSelection.safeParse(factures);
  if (!selection.success) return { ok: false, erreur: messagesValidation(selection.error) };
  const statutsVus = selection.data;

  try {
    const maintenant = Date.now();
    const resultat = await envoyerLot(supabase, [...statutsVus.keys()], (f) =>
      statutsVus.get(f.id) !== f.statut
        ? "Ignorée : statut modifié entre-temps (déjà envoyée ?). Rechargez la page avant de relancer."
        : f.envoyee_le && maintenant - Date.parse(f.envoyee_le) < DELAI_RENVOI_MS
          ? "Ignorée : déjà envoyée il y a moins de 15 minutes."
          : null,
    );
    revaliderFactures();
    if (!resultat.ok) return resultat;
    return { ok: true, message: syntheseEnvoi(resultat.donnees ?? []), donnees: resultat.donnees };
  } catch (e) {
    console.error("Envoi groupé impossible :", e);
    revaliderFactures();
    return { ok: false, erreur: "L'envoi groupé a été interrompu. Consultez l'historique de chaque facture avant de relancer." };
  }
}
