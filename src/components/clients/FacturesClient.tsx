import Link from "next/link";
import { AcademieBadge } from "@/components/AcademieBadge";
import { StatutBadge } from "@/components/StatutBadge";
import { formatDate, formatEuros, formatPeriode } from "@/lib/format";
import type { FactureVue } from "@/lib/types";
import { IconeFacture, IconePlus } from "@/components/Icones";

export type FactureDuClient = Pick<
  FactureVue,
  | "id"
  | "numero"
  | "statut"
  | "objet"
  | "periode"
  | "date_emission"
  | "date_echeance"
  | "total_ttc_centimes"
  | "en_retard"
  | "created_at"
  | "academie_id"
  | "academie_nom"
  | "academie_couleur"
>;

/**
 * Section « Factures » de la fiche client (composant serveur).
 * Une facture émise garde l'académie d'origine : si le client a changé d'académie depuis,
 * l'académie de la facture est signalée par une pastille.
 */
export function FacturesClient({
  clientId,
  academieId,
  factures,
}: {
  clientId: string;
  /** Académie actuelle du client. */
  academieId: string;
  factures: FactureDuClient[];
}) {
  const lienNouvelle = `/factures/nouvelle?client=${clientId}`;

  return (
    <section className="carte" aria-labelledby="titre-factures">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="titre-factures" className="titre-section">
            Factures
          </h2>
          <p className="text-sm text-muted">
            {factures.length === 0
              ? "Aucune facture pour l'instant."
              : `${factures.length} facture${factures.length > 1 ? "s" : ""}, de la plus récente à la plus ancienne.`}
          </p>
        </div>
        <Link href={lienNouvelle} className="btn-secondaire">
          <IconePlus />
          Nouvelle facture
        </Link>
      </div>

      {factures.length === 0 ? (
        <div className="flex flex-col items-center px-5 py-10 text-center">
          <span className="rounded-full bg-brand-light p-3 text-brand">
            <IconeFacture className="size-6" />
          </span>
          <p className="mt-3 font-medium text-ink">Ce client n&apos;a pas encore été facturé</p>
          <p className="mt-1 max-w-md text-sm text-muted">
            Ses factures mensuelles seront créées lors de la facturation du mois, à partir des tarifs ci-dessus. Vous
            pouvez aussi créer une facture ponctuelle.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Numéro</th>
                  <th>Objet</th>
                  <th>Émise le</th>
                  <th>Échéance</th>
                  <th className="text-right">Montant TTC</th>
                  <th>Statut</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {factures.map((f) => (
                  <tr key={f.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/factures/${f.id}`} className="font-medium text-brand hover:underline">
                        {f.numero ?? <span className="italic">Brouillon</span>}
                      </Link>
                      <AcademieDifferente facture={f} academieId={academieId} />
                    </td>
                    <td className="max-w-72">
                      <div className="truncate">{f.objet ?? "—"}</div>
                      {f.periode && <div className="text-xs text-muted">{formatPeriode(f.periode)}</div>}
                    </td>
                    <td className="whitespace-nowrap">{formatDate(f.date_emission)}</td>
                    <td className={`whitespace-nowrap ${f.en_retard ? "font-medium text-red-700" : ""}`}>
                      {formatDate(f.date_echeance)}
                    </td>
                    <td className="text-right font-medium whitespace-nowrap tabular-nums">
                      {formatEuros(f.total_ttc_centimes)}
                    </td>
                    <td>
                      <StatutBadge statut={f.statut} enRetard={f.en_retard} />
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <a
                        href={`/api/factures/${f.id}/pdf`}
                        target="_blank"
                        rel="noopener"
                        className="btn-lien"
                        title="Ouvrir le PDF dans un nouvel onglet"
                      >
                        PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-line md:hidden">
            {factures.map((f) => (
              <li key={f.id}>
                <Link href={`/factures/${f.id}`} className="flex items-start justify-between gap-3 px-5 py-3 hover:bg-page">
                  <div className="min-w-0">
                    <div className="font-medium text-brand">
                      {f.numero ?? <span className="italic">Brouillon</span>}
                      <AcademieDifferente facture={f} academieId={academieId} />
                    </div>
                    <div className="truncate text-sm text-muted">
                      {f.objet ?? "—"}
                      {f.date_emission ? ` · ${formatDate(f.date_emission)}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-medium tabular-nums">{formatEuros(f.total_ttc_centimes)}</span>
                    <StatutBadge statut={f.statut} enRetard={f.en_retard} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Pastille de l'académie de la facture, seulement si elle diffère de l'académie actuelle du client. */
function AcademieDifferente({ facture, academieId }: { facture: FactureDuClient; academieId: string }) {
  if (facture.academie_id === academieId) return null;
  return (
    <span className="ml-2 align-middle" title="Académie de la facture (le client a changé d'académie depuis)">
      <AcademieBadge nom={facture.academie_nom} couleur={facture.academie_couleur} />
    </span>
  );
}
