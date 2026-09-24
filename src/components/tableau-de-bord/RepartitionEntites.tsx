import { EntiteBadge } from "@/components/EntiteBadge";
import { formatEuros } from "@/lib/format";
import { BoutonFiltrerEntite } from "./BoutonFiltrerEntite";
import type { DonneesTableauDeBord } from "./donnees";
import { pluriel } from "./outils";

function Mesure({ libelle, valeur, detail, alerte = false }: { libelle: string; valeur: string; detail?: string; alerte?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{libelle}</dt>
      <dd className={`mt-0.5 text-base font-semibold ${alerte ? "text-red-700" : "text-ink"}`}>{valeur}</dd>
      {detail && <dd className={`text-xs ${alerte ? "text-red-700" : "text-muted"}`}>{detail}</dd>}
    </div>
  );
}

/** Indicateurs de chaque entité, côte à côte (affiché quand « Toutes » est sélectionné). */
export function RepartitionEntites({ repartition }: { repartition: DonneesTableauDeBord["parEntite"] }) {
  return (
    <section aria-labelledby="titre-repartition">
      <h2 id="titre-repartition" className="titre-section mb-3">
        Répartition par entité
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        {repartition.map(({ entite, indicateurs }) => (
          <article key={entite.id} className="carte">
            <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <EntiteBadge nom={entite.prefixe_facture} couleur={entite.couleur_primaire} />
                <h3 className="truncate font-medium text-ink">{entite.nom}</h3>
              </div>
              <BoutonFiltrerEntite entiteId={entite.id} nom={entite.nom} />
            </header>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-4">
              <Mesure
                libelle="À encaisser"
                valeur={formatEuros(indicateurs.aEncaisser.centimes)}
                detail={pluriel(indicateurs.aEncaisser.nombre, "facture")}
              />
              <Mesure
                libelle="En retard"
                valeur={formatEuros(indicateurs.enRetard.centimes)}
                detail={pluriel(indicateurs.enRetard.nombre, "facture")}
                alerte={indicateurs.enRetard.nombre > 0}
              />
              <Mesure
                libelle="Encaissé ce mois-ci"
                valeur={formatEuros(indicateurs.encaisseMois.centimes)}
                detail={pluriel(indicateurs.encaisseMois.nombre, "paiement")}
              />
              <Mesure libelle="Brouillons à valider" valeur={String(indicateurs.brouillons)} />
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
