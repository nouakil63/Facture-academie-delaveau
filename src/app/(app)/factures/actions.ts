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
  syntheseEnvoi,
  texteFacultatif,
} from "@/components/factures/serveur";
import type { ResultatEnvoiFacture } from "@/components/factures/outils";
import { exigerUtilisateur } from "@/lib/auth";
import type { Client, ResultatAction } from "@/lib/types";

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
    const resClient = await supabase.from("clients").select("id, actif").eq("id", saisie.data.client_id).maybeSingle();
    if (resClient.error) return { ok: false, erreur: "Impossible de vérifier le client. Réessayez." };
    const client = resClient.data as Pick<Client, "id" | "actif"> | null;
    if (!client) return { ok: false, erreur: "Client introuvable : il a peut-être été supprimé." };
    if (!client.actif) {
      return { ok: false, erreur: "Ce client est archivé : réactivez sa fiche avant de lui créer une facture." };
    }

    const resultat = await creerBrouillon(supabase, {
      clientId: client.id,
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

const schemaSelection = z
  .array(schemaId, { error: "Sélection invalide." })
  .min(1, { error: "Sélectionnez au moins une facture." })
  .max(100, { error: "100 factures au maximum par envoi groupé : procédez en plusieurs fois." })
  .transform((ids) => [...new Set(ids)]);

/**
 * Action groupée « Émettre et envoyer » : émet les brouillons sélectionnés puis envoie
 * chaque facture par e-mail (les factures déjà émises sont renvoyées, les payées partent
 * en duplicata, les annulées sont ignorées). Renvoie un résultat par facture.
 */
export async function envoyerSelection(ids: string[]): Promise<ResultatAction<ResultatEnvoiFacture[]>> {
  const { supabase } = await exigerUtilisateur();

  const selection = schemaSelection.safeParse(ids);
  if (!selection.success) return { ok: false, erreur: messagesValidation(selection.error) };

  try {
    const resultat = await envoyerLot(supabase, selection.data);
    revaliderFactures();
    if (!resultat.ok) return resultat;
    return { ok: true, message: syntheseEnvoi(resultat.donnees ?? []), donnees: resultat.donnees };
  } catch (e) {
    console.error("Envoi groupé impossible :", e);
    revaliderFactures();
    return { ok: false, erreur: "L'envoi groupé a été interrompu. Consultez l'historique de chaque facture avant de relancer." };
  }
}
