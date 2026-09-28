import Link from "next/link";
import { IconeCalendrier, IconeFleche, IconeParametres } from "@/components/Icones";
import { formatDateLongue, formatPeriode, jourDuMois, pluriel } from "@/lib/format";
import { libelleSaison, moisAvecEcheance } from "@/lib/tarifs";
import type { EtatAnnee } from "./donnees";

/**
 * Calendrier de l'année scolaire : date du prochain envoi des avis d'échéance (réglages
 * `jour_generation`, `mois_facture` de l'association, clients en envoi automatique) et avancement
 * des factures annuelles de la saison dans le périmètre affiché.
 */
export function ProchaineFacturation({
  annee,
  nomAcademie,
}: {
  annee: EtatAnnee;
  /** Académie filtrée, ou null pour « Toutes ». */
  nomAcademie: string | null;
}) {
  const { nbClientsEnvoiAuto, jourGeneration, prochaineDate, prochainePeriode, saison, avancement } = annee;
  const reste = avancement ? Math.max(0, avancement.aFacturer - avancement.emises) : 0;
  const pourcentage =
    avancement && avancement.aFacturer > 0 ? Math.min(100, Math.round((avancement.emises / avancement.aFacturer) * 100)) : 0;
  const avecAvis = moisAvecEcheance(prochainePeriode);

  return (
    <section className="carte" aria-labelledby="titre-prochaine-facturation">
      <div className="grid gap-6 p-5 md:grid-cols-2 md:gap-0 md:divide-x md:divide-line">
        {/* Prochain envoi des avis */}
        <div className="flex gap-4 md:pr-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand">
            <IconeCalendrier className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="titre-prochaine-facturation" className="text-sm font-medium text-muted">
              Prochain envoi des avis
            </h2>
            <p className="mt-1 text-xl font-semibold tracking-tight text-ink">{formatDateLongue(prochaineDate)}</p>
            <p className="text-sm text-muted">
              {avecAvis ? `Avis d'échéance de ${formatPeriode(prochainePeriode)}` : "Juillet/août : pas d'avis d'échéance"}
            </p>
            {nbClientsEnvoiAuto > 0 ? (
              <p className="mt-3 text-xs text-muted">
                <span className="badge mr-1.5 bg-emerald-100 text-emerald-800">Automatique</span>
                <Link href="/clients" className="btn-lien text-xs">
                  {pluriel(nbClientsEnvoiAuto, "client", "clients")} en envoi automatique
                </Link>{" "}
                : avis envoyé le {jourDuMois(jourGeneration)} de chaque mois, sans relecture.
              </p>
            ) : (
              <div className="mt-3 space-y-1.5 text-xs text-amber-900">
                <span className="badge bg-amber-100 text-amber-900">Envoi manuel</span>
                <p>Aucun client en envoi automatique : envoyer les avis depuis « Facturation de l&apos;année ».</p>
                <Link href="/parametres#mensuelle" className="btn-lien text-xs">
                  <IconeParametres className="h-3.5 w-3.5" />
                  Régler l&apos;automatisation
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Factures annuelles de la saison */}
        <div className="flex flex-col md:pl-6">
          <h3 className="text-sm font-medium text-muted">
            Factures annuelles {libelleSaison(saison)}
            {nomAcademie && <span className="font-normal"> · {nomAcademie}</span>}
          </h3>
          {avancement === null ? (
            <p className="mt-1 text-sm text-muted">Avancement indisponible pour le moment : recharger la page dans un instant.</p>
          ) : avancement.aFacturer === 0 && avancement.preparees === 0 ? (
            <p className="mt-1 text-sm text-muted">Aucun élève avec des tarifs récurrents pour cette année scolaire.</p>
          ) : (
            <>
              <p className="mt-1 text-xl font-semibold tracking-tight text-ink tabular-nums">
                {avancement.emises} / {Math.max(avancement.aFacturer, avancement.emises)}
                <span className="ml-1.5 text-sm font-normal tracking-normal text-muted">
                  {avancement.emises > 1 ? "factures émises" : "facture émise"}
                </span>
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-page ring-1 ring-line" aria-hidden="true">
                <div className={`h-full rounded-full ${reste > 0 ? "bg-brand" : "bg-emerald-500"}`} style={{ width: `${pourcentage}%` }} />
              </div>
              <p className={`mt-1.5 text-xs ${reste > 0 ? "text-amber-800" : "text-emerald-700"}`}>
                {reste > 0
                  ? `${pluriel(reste, "élève", "élèves")} sans facture annuelle émise${
                      avancement.preparees > avancement.emises
                        ? ` (dont ${pluriel(avancement.preparees - avancement.emises, "brouillon", "brouillons")} à émettre)`
                        : ""
                    }`
                  : "Chaque élève a sa facture annuelle."}
              </p>
            </>
          )}
          <div className="mt-3 md:mt-auto md:pt-3">
            <Link href="/facturation-annuelle" className={reste > 0 ? "btn-primaire btn-petit" : "btn-secondaire btn-petit"}>
              Ouvrir la facturation de l&apos;année
              <IconeFleche className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
