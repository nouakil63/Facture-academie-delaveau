import type { Metadata } from "next";
import Link from "next/link";
import { FormulaireClient } from "@/components/clients/FormulaireClient";
import { IconeRetour } from "@/components/Icones";
import { academieSelectionnee, resoudreAcademie } from "@/lib/academie-selectionnee";
import { exigerUtilisateur } from "@/lib/auth";
import { chargerAcademies } from "@/lib/facturation/service";
import type { Academie } from "@/lib/types";

export const metadata: Metadata = { title: "Nouveau client" };

export default async function PageNouveauClient() {
  const { supabase } = await exigerUtilisateur();

  let academies: Academie[] = [];
  let selection: string | null = null;
  let erreur: string | null = null;
  try {
    [academies, selection] = await Promise.all([chargerAcademies(supabase, true), academieSelectionnee()]);
  } catch (e) {
    erreur = e instanceof Error ? e.message : String(e);
  }
  // Par défaut : l'académie affichée dans le filtre, sinon la première.
  const academieParDefaut = resoudreAcademie(selection, academies)?.id ?? academies[0]?.id ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/clients" className="btn-lien text-muted hover:text-brand">
          <IconeRetour />
          Clients
        </Link>
        <h1 className="titre-page mt-2">Nouveau client</h1>
        <p className="mt-1 text-sm text-muted">
          Le client est le payeur de la facture (parent, entreprise, sponsor). Vous ajouterez ses tarifs juste après.
        </p>
      </div>

      {erreur ? (
        <p role="alert" className="erreur">
          Impossible de charger les académies : {erreur}
        </p>
      ) : academies.length === 0 ? (
        <p className="avertissement">
          Aucune académie active : activez l&apos;Académie Delaveau ou l&apos;Académie Espoir dans{" "}
          <Link href="/parametres#academies" className="font-medium underline">
            Paramètres
          </Link>{" "}
          avant de créer un client.
        </p>
      ) : (
        <div className="carte carte-corps sm:p-6">
          <FormulaireClient academies={academies} academieParDefaut={academieParDefaut} />
        </div>
      )}
    </div>
  );
}
