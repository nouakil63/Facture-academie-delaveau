import type { Metadata } from "next";
import Link from "next/link";
import { Catalogue, type PrestationCatalogue } from "@/components/prestations/Catalogue";
import { IconeInfo } from "@/components/Icones";

import { exigerUtilisateur } from "@/lib/auth";
import type { Prestation } from "@/lib/types";
import { pluriel } from "@/lib/format";

export const metadata: Metadata = { title: "Prestations" };

/** Ligne de tarif client pointant vers une prestation du catalogue. */
type TarifReference = {
  prestation_id: string;
  client_id: string;
  prix_unitaire_centimes: number | null;
  actif: boolean;
  client: { actif: boolean } | null;
};

/** Utilisation de chaque prestation dans les tarifs clients. */
function statistiquesUtilisation(tarifs: TarifReference[]) {
  const parPrestation = new Map<string, { actifs: Set<string>; personnalises: Set<string>; tous: Set<string> }>();
  for (const t of tarifs) {
    let s = parPrestation.get(t.prestation_id);
    if (!s) {
      s = { actifs: new Set(), personnalises: new Set(), tous: new Set() };
      parPrestation.set(t.prestation_id, s);
    }
    s.tous.add(t.client_id);
    if (t.actif && t.client?.actif) {
      s.actifs.add(t.client_id);
      if (t.prix_unitaire_centimes !== null) s.personnalises.add(t.client_id);
    }
  }
  return parPrestation;
}

export default async function PagePrestations(props: PageProps<"/prestations">) {
  const { supabase } = await exigerUtilisateur();
  const parametres = await props.searchParams;
  const afficherArchivees = parametres.archivees === "1";

  // Catalogue commun à toutes les académies : le filtre d'académie de la barre latérale ne s'applique pas.
  const [resPrestations, resTarifs] = await Promise.all([
    supabase.from("prestations").select("*").order("ordre").order("libelle"),
    supabase
      .from("tarifs_clients")
      .select("prestation_id, client_id, prix_unitaire_centimes, actif, client:clients(actif)")
      .not("prestation_id", "is", null),
  ]);

  const erreur = resPrestations.error ?? resTarifs.error;
  if (erreur) {
    return (
      <div className="space-y-6">
        <h1 className="titre-page">Prestations</h1>
        <p role="alert" className="erreur">
          Impossible de charger le catalogue : {erreur.message}
        </p>
      </div>
    );
  }

  const stats = statistiquesUtilisation(resTarifs.data as unknown as TarifReference[]);
  const prestations: PrestationCatalogue[] = (resPrestations.data as Prestation[]).map((p) => {
    const s = stats.get(p.id);
    return {
      ...p,
      nbClients: s?.actifs.size ?? 0,
      nbPrixPersonnalises: s?.personnalises.size ?? 0,
      nbClientsReferences: s?.tous.size ?? 0,
    };
  });

  // Les archivées sont listées après les actives.
  const actives = prestations.filter((p) => p.actif);
  const archivees = prestations.filter((p) => !p.actif);
  const nbActives = actives.length;
  const nbArchivees = archivees.length;

  const entete = (
    <div>
      <h1 className="titre-page">Prestations</h1>
      <p className="mt-1 text-sm text-muted">
        Catalogue commun à toutes les académies · {pluriel(nbActives, "prestation active", "prestations actives")}
        {nbArchivees > 0 && (
          <>
            {" · "}
            <Link
              href={afficherArchivees ? "/prestations" : "/prestations?archivees=1"}
              className="btn-lien"
              scroll={false}
            >
              {afficherArchivees
                ? "Masquer les archivées"
                : `Afficher ${nbArchivees > 1 ? `les ${nbArchivees} archivées` : "l'archivée"}`}
            </Link>
          </>
        )}
      </p>
    </div>
  );

  return (
    <div className="space-y-6">
      <Catalogue
        entete={entete}
        prestations={afficherArchivees ? [...actives, ...archivees] : actives}
        nbArchiveesMasquees={afficherArchivees ? 0 : nbArchivees}
      />

      <aside className="carte carte-corps flex gap-3 text-sm text-muted">
        <IconeInfo className="mt-0.5 size-5 text-brand" />
        <div className="space-y-1">
          <p>
            <span className="font-medium text-ink">Prix catalogue et prix personnalisé.</span> Le prix du catalogue
            s&apos;applique à tous les clients, quelle que soit leur académie, sauf si un prix personnalisé est saisi
            dans les tarifs de la fiche client. Modifier un prix ici s&apos;applique aux prochaines factures ; les
            factures déjà créées, brouillons compris, ne sont pas modifiées.
          </p>
          <p>
            Une prestation utilisée par des clients ne peut pas être supprimée : archivez-la pour ne plus la proposer.
          </p>
        </div>
      </aside>
    </div>
  );
}
