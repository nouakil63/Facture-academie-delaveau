import type { Metadata } from "next";
import Link from "next/link";
import { FormulaireClient } from "@/components/clients/FormulaireClient";
import { IconeRetour } from "@/components/clients/Icones";
import { exigerUtilisateur } from "@/lib/auth";
import { entiteSelectionnee } from "@/lib/entite-selectionnee";
import type { Entite } from "@/lib/types";

export const metadata: Metadata = { title: "Nouveau client" };

export default async function PageNouveauClient() {
  const { supabase } = await exigerUtilisateur();
  const [selection, resEntites] = await Promise.all([
    entiteSelectionnee(),
    supabase.from("entites").select("id, nom").eq("actif", true).order("ordre"),
  ]);
  const entites = (resEntites.data ?? []) as Pick<Entite, "id" | "nom">[];
  const entiteParDefaut = entites.some((e) => e.id === selection) ? selection : (entites[0]?.id ?? null);

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

      {resEntites.error ? (
        <p role="alert" className="erreur">
          Impossible de charger les entités : {resEntites.error.message}
        </p>
      ) : entites.length === 0 ? (
        <p className="avertissement">
          Aucune entité active : activez l&apos;Académie Delaveau ou l&apos;Académie Espoir dans{" "}
          <Link href="/parametres" className="font-medium underline">
            Paramètres
          </Link>{" "}
          avant de créer un client.
        </p>
      ) : (
        <div className="carte carte-corps sm:p-6">
          <FormulaireClient entites={entites} entiteParDefaut={entiteParDefaut} />
        </div>
      )}
    </div>
  );
}
