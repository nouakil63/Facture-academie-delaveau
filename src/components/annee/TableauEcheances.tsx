import Link from "next/link";
import { AcademieBadge } from "@/components/AcademieBadge";
import { formatDate, formatEuros, formatPeriode } from "@/lib/format";
import type { EcheanceVue } from "@/lib/types";
import { ActionsEcheance } from "./ActionsEcheance";
import { ReferenceBadge, StatutEcheanceBadge } from "./StatutEcheanceBadge";

/** Échéance affichée dans un tableau (colonnes de echeances_vue). */
export type EcheanceLigne = Pick<
  EcheanceVue,
  | "id"
  | "facture_id"
  | "client_id"
  | "rang"
  | "periode"
  | "montant_centimes"
  | "date_echeance"
  | "statut"
  | "numero_avis"
  | "envoyee_le"
  | "payee_le"
  | "mode_paiement"
  | "en_retard"
  | "facture_statut"
  | "client_reference"
  | "academie_nom"
  | "academie_couleur"
> & {
  /** Nom affiché du client (variante « mois »). */
  client?: string;
  /** Adresses du client (fiche actuelle) : envoi possible si non vide. */
  destinataires: string[];
};

/** Colonnes de echeances_vue à sélectionner pour EcheanceLigne. */
export const COLONNES_ECHEANCE =
  "id, facture_id, client_id, rang, periode, montant_centimes, date_echeance, statut, numero_avis, envoyee_le, payee_le, " +
  "mode_paiement, en_retard, facture_statut, client_reference, academie_nom, academie_couleur, client_type, client_nom, " +
  "client_prenom, client_raison_sociale, client_email, client_emails_cc";

/**
 * Tableau d'échéances avec leurs actions (PDF, envoi de l'avis, paiement).
 * - « client » : les 10 échéances d'une facture annuelle (mois, date limite, montant, statut) ;
 * - « mois » : les avis d'un mois, un par client (client, référence, académie).
 */
export function TableauEcheances({
  echeances,
  variante,
  afficherAcademie = false,
  emailConfigure,
  aujourdhui,
}: {
  echeances: EcheanceLigne[];
  variante: "client" | "mois";
  afficherAcademie?: boolean;
  emailConfigure: boolean;
  aujourdhui: string;
}) {
  const detailStatut = (e: EcheanceLigne) =>
    e.statut === "payee" && e.payee_le
      ? `le ${formatDate(e.payee_le)}${e.mode_paiement ? ` · ${e.mode_paiement}` : ""}`
      : e.envoyee_le && e.statut !== "annulee"
        ? `avis du ${formatDate(e.envoyee_le)}`
        : null;

  return (
    <div className="overflow-x-auto">
      <table className="tableau">
        <thead>
          <tr>
            {variante === "mois" ? (
              <>
                <th>Client</th>
                {afficherAcademie && <th className="hidden md:table-cell">Académie</th>}
              </>
            ) : (
              <th>Mois</th>
            )}
            <th>N° d&apos;avis</th>
            <th className="hidden sm:table-cell">Date limite</th>
            <th className="text-right">Montant</th>
            <th>Statut</th>
            <th className="text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {echeances.map((e) => {
            const annulee = e.statut === "annulee";
            const detail = detailStatut(e);
            return (
              <tr key={e.id} className={annulee ? "text-muted" : ""}>
                {variante === "mois" ? (
                  <>
                    <td className="max-w-56">
                      <Link href={`/clients/${e.client_id}`} className="block truncate font-medium text-brand hover:underline">
                        {e.client ?? "Client"}
                      </Link>
                      <span className="mt-0.5 inline-block">
                        <ReferenceBadge reference={e.client_reference} />
                      </span>
                    </td>
                    {afficherAcademie && (
                      <td className="hidden md:table-cell">
                        <AcademieBadge nom={e.academie_nom} couleur={e.academie_couleur} />
                      </td>
                    )}
                  </>
                ) : (
                  <td className="whitespace-nowrap">
                    <span className="capitalize">{formatPeriode(e.periode)}</span>
                    <span className="ml-1 text-xs text-muted">({e.rang}/10)</span>
                  </td>
                )}
                <td className="whitespace-nowrap font-mono text-xs">
                  <Link href={`/factures/${e.facture_id}`} className="hover:text-brand hover:underline" title="Voir la facture annuelle">
                    {e.numero_avis}
                  </Link>
                </td>
                <td
                  className={`hidden whitespace-nowrap tabular-nums sm:table-cell ${e.en_retard ? "font-medium text-red-700" : ""}`}
                >
                  {formatDate(e.date_echeance)}
                </td>
                <td className={`text-right font-medium whitespace-nowrap tabular-nums ${annulee ? "line-through" : ""}`}>
                  {formatEuros(e.montant_centimes)}
                </td>
                <td>
                  <StatutEcheanceBadge statut={e.statut} enRetard={e.en_retard} />
                  {detail && <div className="mt-0.5 text-xs whitespace-nowrap text-muted">{detail}</div>}
                </td>
                <td className="text-right">
                  <ActionsEcheance
                    echeance={e}
                    destinataires={e.destinataires}
                    emailConfigure={emailConfigure}
                    aujourdhui={aujourdhui}
                    factureAnnulee={e.facture_statut === "annulee"}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
