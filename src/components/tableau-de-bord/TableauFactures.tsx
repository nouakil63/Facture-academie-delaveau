import Link from "next/link";
import { AcademieBadge } from "@/components/AcademieBadge";
import { StatutBadge } from "@/components/StatutBadge";
import { formatDate, formatEuros, nomClient, pluriel } from "@/lib/format";
import type { FactureResumee } from "./donnees";
import { joursEntre } from "./outils";

function client(f: FactureResumee): string {
  return nomClient({ type: f.client_type, nom: f.client_nom, prenom: f.client_prenom, raison_sociale: f.client_raison_sociale });
}

function LienFacture({ facture }: { facture: FactureResumee }) {
  return (
    <Link
      href={`/factures/${facture.id}`}
      className={`font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        facture.numero ? "text-brand" : "text-muted italic"
      }`}
    >
      {facture.numero ?? "Brouillon"}
    </Link>
  );
}

/**
 * Tableau compact de factures.
 * - « retard » : échéance et ancienneté du retard ;
 * - « recent » : date d'émission (ou de création pour un brouillon) et statut.
 * Sur mobile, le client (et l'académie) passent sous le numéro ; les colonnes secondaires sont masquées.
 */
export function TableauFactures({
  factures,
  variante,
  afficherAcademie,
  aujourdhui,
}: {
  factures: FactureResumee[];
  variante: "retard" | "recent";
  afficherAcademie: boolean;
  aujourdhui: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="tableau">
        <thead>
          <tr>
            <th scope="col">Facture</th>
            <th scope="col" className="hidden sm:table-cell">
              Client
            </th>
            {afficherAcademie && (
              <th scope="col" className="hidden md:table-cell">
                Académie
              </th>
            )}
            <th scope="col" className={variante === "recent" ? "hidden sm:table-cell" : undefined}>
              {variante === "retard" ? "Échéance" : "Date"}
            </th>
            <th scope="col" className="text-right">
              Montant TTC
            </th>
            {variante === "recent" && <th scope="col">Statut</th>}
          </tr>
        </thead>
        <tbody>
          {factures.map((f) => {
            const retard = f.date_echeance ? joursEntre(f.date_echeance, aujourdhui) : 0;
            return (
              <tr key={f.id}>
                <td>
                  <LienFacture facture={f} />
                  <p className="mt-0.5 max-w-[12rem] truncate text-xs text-muted sm:hidden">{client(f)}</p>
                  {afficherAcademie && (
                    <p className="mt-1 md:hidden">
                      <AcademieBadge nom={f.academie_nom} couleur={f.academie_couleur} />
                    </p>
                  )}
                </td>
                <td className="hidden sm:table-cell">
                  <p className="max-w-[16rem] truncate">{client(f)}</p>
                  {f.objet && <p className="max-w-[16rem] truncate text-xs text-muted">{f.objet}</p>}
                </td>
                {afficherAcademie && (
                  <td className="hidden md:table-cell">
                    <AcademieBadge nom={f.academie_nom} couleur={f.academie_couleur} />
                  </td>
                )}
                {variante === "retard" ? (
                  <td className="whitespace-nowrap">
                    <p className="tabular-nums">{formatDate(f.date_echeance)}</p>
                    {retard > 0 && <p className="text-xs font-medium text-red-700">{pluriel(retard, "jour")} de retard</p>}
                  </td>
                ) : (
                  <td className="hidden whitespace-nowrap tabular-nums sm:table-cell">
                    {formatDate(f.date_emission ?? f.created_at)}
                  </td>
                )}
                <td className="text-right font-medium whitespace-nowrap tabular-nums">{formatEuros(f.total_ttc_centimes)}</td>
                {variante === "recent" && (
                  <td>
                    <StatutBadge statut={f.statut} enRetard={f.en_retard} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
