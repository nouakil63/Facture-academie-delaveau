import { formatEuros } from "@/lib/format";
import { BoutonFiltrerAcademie } from "./BoutonFiltrerAcademie";
import type { DonneesTableauDeBord } from "./donnees";
import { pluriel } from "./outils";

function Mesure({ libelle, valeur, detail, alerte = false }: { libelle: string; valeur: string; detail?: string; alerte?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{libelle}</dt>
      <dd className={`mt-0.5 text-base font-semibold tabular-nums ${alerte ? "text-red-700" : "text-ink"}`}>{valeur}</dd>
      {detail && <dd className={`text-xs ${alerte ? "text-red-700" : "text-muted"}`}>{detail}</dd>}
    </div>
  );
}

/** Indicateurs de chaque académie, côte à côte (affiché quand « Toutes » est sélectionné). */
export function RepartitionAcademies({ repartition }: { repartition: DonneesTableauDeBord["parAcademie"] }) {
  return (
    <section aria-labelledby="titre-repartition">
      <h2 id="titre-repartition" className="titre-section mb-3">
        Répartition par académie
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        {repartition.map(({ academie, indicateurs }) => (
          <article key={academie.id} className="carte overflow-hidden">
            <header
              className="flex items-center justify-between gap-3 border-b border-line border-t-4 px-5 py-3"
              style={{ borderTopColor: academie.couleur }}
            >
              <div className="min-w-0">
                <h3 className="truncate font-medium text-ink">{academie.nom}</h3>
                <p className="text-xs text-muted">{pluriel(indicateurs.clientsActifs, "client actif", "clients actifs")}</p>
              </div>
              <BoutonFiltrerAcademie academieId={academie.id} nom={academie.nom} />
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
