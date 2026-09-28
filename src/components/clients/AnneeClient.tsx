import Link from "next/link";
import { StatutBadge } from "@/components/StatutBadge";
import { SupprimerAnciensBrouillons } from "@/components/annee/ActionsAnnuelles";
import { lienAnnee } from "@/components/annee/outils";
import { TableauEcheances, type EcheanceLigne } from "@/components/annee/TableauEcheances";
import { IconeAlerte, IconeCalendrier } from "@/components/Icones";
import { formatDate, formatEuros, pluriel } from "@/lib/format";
import { libelleSaison } from "@/lib/tarifs";
import type { FactureVue } from "@/lib/types";

export type FactureAnnuelleClient = Pick<
  FactureVue,
  | "id"
  | "numero"
  | "statut"
  | "date_emission"
  | "total_ttc_centimes"
  | "en_retard"
  | "echeances_actives"
  | "echeances_payees"
  | "echeances_reste_centimes"
>;

/**
 * Section « Année 2026-2027 » de la fiche client (composant serveur) : facture annuelle (lien,
 * statut, avancement) et tableau de ses 10 échéances (avis : envoi, paiement, PDF), ou invitation
 * à la préparer. Signale les anciens brouillons mensuels de la saison (double facturation).
 */
export function AnneeClient({
  clientActif,
  clientId,
  academieId,
  saison,
  facture,
  echeances,
  annuelEstime,
  nbAnciensBrouillons,
  emailConfigure,
  aujourdhui,
}: {
  clientActif: boolean;
  clientId: string;
  academieId: string;
  saison: number;
  /** Facture annuelle non annulée de la saison, s'il y en a une. */
  facture: FactureAnnuelleClient | null;
  echeances: EcheanceLigne[];
  /** Montant HT estimé d'après les tarifs (sans facture). */
  annuelEstime: number;
  nbAnciensBrouillons: number;
  emailConfigure: boolean;
  aujourdhui: string;
}) {
  const annee = libelleSaison(saison);
  return (
    <section className="carte overflow-hidden" aria-labelledby="titre-annee" id="annee">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="titre-annee" className="titre-section">
            Année {annee}
          </h2>
          <p className="text-sm text-muted">Facture annuelle et avis d&apos;échéance mensuels (septembre à juin).</p>
        </div>
        <Link href={lienAnnee({ academie: academieId, saison })} className="btn-secondaire btn-petit">
          <IconeCalendrier className="size-3.5" />
          Facturation de l&apos;année
        </Link>
      </div>

      {nbAnciensBrouillons > 0 && (
        <div role="alert" className="avertissement mx-5 mt-4">
          <p className="flex items-start gap-2 font-medium">
            <IconeAlerte className="mt-0.5 size-4 shrink-0 text-amber-600" />
            {pluriel(nbAnciensBrouillons, "ancien brouillon mensuel", "anciens brouillons mensuels")} {annee} encore présent
            {nbAnciensBrouillons > 1 ? "s" : ""} : à supprimer pour éviter une double facturation avec la facture annuelle.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <SupprimerAnciensBrouillons saison={saison} clientId={clientId} nombre={nbAnciensBrouillons} libelle="de ce client" />
            <a href="#titre-factures" className="btn-lien text-xs">
              Voir les factures
            </a>
          </div>
        </div>
      )}

      {facture ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Facture annuelle</span>
              <Link href={`/factures/${facture.id}`} className="font-medium text-brand hover:underline">
                {facture.numero ?? "Brouillon"}
              </Link>
              <StatutBadge statut={facture.statut} enRetard={facture.en_retard} />
              {facture.date_emission && <span className="text-muted">émise le {formatDate(facture.date_emission)}</span>}
            </div>
            <div className="text-right text-sm">
              <span className="font-semibold tabular-nums">{formatEuros(facture.total_ttc_centimes)}</span>
              <span className="text-muted"> TTC</span>
              {facture.echeances_actives > 0 && (
                <span className="block text-xs text-muted">
                  {facture.echeances_payees}/{facture.echeances_actives} échéances payées · reste{" "}
                  {formatEuros(facture.echeances_reste_centimes)}
                </span>
              )}
            </div>
          </div>
          {facture.statut === "brouillon" ? (
            <p className="border-t border-line px-5 py-4 text-sm text-muted">
              Brouillon : échéances créées à l&apos;émission.{" "}
              <Link href={`/factures/${facture.id}`} className="btn-lien text-sm">
                Relire et émettre
              </Link>
            </p>
          ) : echeances.length === 0 ? (
            <p className="border-t border-line px-5 py-4 text-sm text-muted">
              Aucune échéance : montant couvert par les arrhes.
            </p>
          ) : (
            <div className="border-t border-line">
              <TableauEcheances echeances={echeances} variante="client" emailConfigure={emailConfigure} aujourdhui={aujourdhui} />
            </div>
          )}
        </>
      ) : (
        <div className="px-5 py-8 text-center">
          <p className="font-medium text-ink">Aucune facture annuelle {annee}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {!clientActif
              ? "Client archivé : pas de facture annuelle."
              : annuelEstime > 0
                ? `Montant estimé d'après les tarifs : ${formatEuros(annuelEstime)} HT. À préparer depuis la facturation de l'année.`
                : "Aucun tarif récurrent sur la saison : ajouter des tarifs ci-dessus, ou créer une facture ponctuelle."}
          </p>
          {clientActif && annuelEstime > 0 && (
            <Link href={lienAnnee({ academie: academieId, saison })} className="btn-primaire btn-petit mt-4">
              Préparer la facture annuelle
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
