import Link from "next/link";
import { IconeCalendrier, IconeFleche, IconeParametres } from "@/components/Icones";
import { formatPeriode } from "@/lib/format";
import type { EtatFacturationMensuelle } from "./donnees";
import { formatDateLongue, jourDuMois } from "@/lib/format";
import { pluriel } from "./outils";

/** Mois au format du paramètre ?mois= de la page Facturation mensuelle : "2026-10-01" → "2026-10". */
function paramMois(periode: string): string {
  return periode.slice(0, 7);
}

/**
 * Calendrier de la facturation mensuelle : date de la prochaine génération (réglages
 * `jour_generation`, `mois_facture`, `generation_auto` de l'association) et avancement
 * de la facturation en cours dans le périmètre affiché.
 */
export function ProchaineFacturation({
  facturation,
  nomAcademie,
}: {
  facturation: EtatFacturationMensuelle;
  /** Académie filtrée, ou null pour « Toutes ». */
  nomAcademie: string | null;
}) {
  const { generationAuto, envoiAuto, jourGeneration, prochaineDate, prochainePeriode, periodeEnCours, apercu } = facturation;
  const reste = apercu ? apercu.aFacturer - apercu.dejaFactures : 0;
  const avancement = apercu && apercu.aFacturer > 0 ? Math.round((apercu.dejaFactures / apercu.aFacturer) * 100) : 0;

  return (
    <section className="carte" aria-labelledby="titre-prochaine-facturation">
      <div className="grid gap-6 p-5 md:grid-cols-2 md:gap-0 md:divide-x md:divide-line">
        {/* Prochaine génération */}
        <div className="flex gap-4 md:pr-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand">
            <IconeCalendrier className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="titre-prochaine-facturation" className="text-sm font-medium text-muted">
              Prochaine facturation
            </h2>
            <p className="mt-1 text-xl font-semibold tracking-tight text-ink">{formatDateLongue(prochaineDate)}</p>
            <p className="text-sm text-muted">Factures de {formatPeriode(prochainePeriode)}</p>

            {generationAuto ? (
              <p className="mt-3 text-xs text-muted">
                <span className="badge mr-1.5 bg-emerald-100 text-emerald-800">Automatique</span>
                Brouillons préparés le {jourDuMois(jourGeneration)} de chaque mois
                {envoiAuto ? ", puis émis et envoyés automatiquement." : ", à vérifier puis envoyer."}
              </p>
            ) : (
              <div className="mt-3 space-y-1.5 text-xs text-amber-900">
                <span className="badge bg-amber-100 text-amber-900">Automatisation désactivée</span>
                <p>
                  Date indicative : aucun brouillon ne sera créé tout seul. Lancez la facturation vous-même, ou
                  activez l&apos;automatisation.
                </p>
                <Link href="/parametres" className="btn-lien text-xs">
                  <IconeParametres className="h-3.5 w-3.5" />
                  Régler l&apos;automatisation
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Facturation en cours */}
        <div className="flex flex-col md:pl-6">
          <h3 className="text-sm font-medium text-muted">
            Facturation de {formatPeriode(periodeEnCours)}
            {nomAcademie && <span className="font-normal"> · {nomAcademie}</span>}
          </h3>

          {apercu === null ? (
            <p className="mt-1 text-sm text-muted">Avancement indisponible pour le moment.</p>
          ) : apercu.aFacturer === 0 ? (
            <p className="mt-1 text-sm text-muted">
              Aucun client n&apos;a de tarif mensuel actif pour ce mois : rien à facturer automatiquement.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xl font-semibold tracking-tight text-ink tabular-nums">
                {apercu.dejaFactures} / {apercu.aFacturer}
                <span className="ml-1.5 text-sm font-normal tracking-normal text-muted">
                  {apercu.aFacturer > 1 ? "factures préparées" : "facture préparée"}
                </span>
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-page ring-1 ring-line" aria-hidden="true">
                <div
                  className={`h-full rounded-full ${reste > 0 ? "bg-brand" : "bg-emerald-500"}`}
                  style={{ width: `${avancement}%` }}
                />
              </div>
              <p className={`mt-1.5 text-xs ${reste > 0 ? "text-amber-800" : "text-emerald-700"}`}>
                {reste > 0
                  ? `${pluriel(reste, "client")} à facturer pour ce mois`
                  : "Chaque client a sa facture du mois (brouillons compris)."}
              </p>
            </>
          )}

          <div className="mt-3 md:mt-auto md:pt-3">
            <Link
              href={`/facturation-mensuelle?mois=${paramMois(periodeEnCours)}`}
              className={reste > 0 ? "btn-primaire btn-petit" : "btn-secondaire btn-petit"}
            >
              Ouvrir la facturation du mois
              <IconeFleche className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
