import Link from "next/link";
import { AcademieBadge } from "@/components/AcademieBadge";
import { formatDate, formatEuros, nomClient, pluriel } from "@/lib/format";
import type { EcheanceResumee } from "./donnees";
import { joursEntre } from "./outils";

/** Tableau compact des avis d'échéance en retard (date limite, ancienneté du retard, montant). */
export function TableauAvisRetard({
  echeances,
  afficherAcademie,
  aujourdhui,
}: {
  echeances: EcheanceResumee[];
  afficherAcademie: boolean;
  aujourdhui: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="tableau">
        <thead>
          <tr>
            <th scope="col">Avis</th>
            <th scope="col" className="hidden sm:table-cell">
              Client
            </th>
            {afficherAcademie && (
              <th scope="col" className="hidden md:table-cell">
                Académie
              </th>
            )}
            <th scope="col">Date limite</th>
            <th scope="col" className="text-right">
              Montant
            </th>
          </tr>
        </thead>
        <tbody>
          {echeances.map((e) => {
            const client = nomClient({ type: e.client_type, nom: e.client_nom, prenom: e.client_prenom, raison_sociale: e.client_raison_sociale });
            const retard = joursEntre(e.date_echeance, aujourdhui);
            return (
              <tr key={e.id}>
                <td>
                  <Link href={`/clients/${e.client_id}`} className="font-mono text-xs font-medium text-brand hover:underline">
                    {e.numero_avis}
                  </Link>
                  <p className="mt-0.5 max-w-[12rem] truncate text-xs text-muted sm:hidden">{client}</p>
                </td>
                <td className="hidden sm:table-cell">
                  <p className="max-w-[16rem] truncate">{client}</p>
                  <p className="text-xs text-muted">Réf. {e.client_reference}</p>
                </td>
                {afficherAcademie && (
                  <td className="hidden md:table-cell">
                    <AcademieBadge nom={e.academie_nom} couleur={e.academie_couleur} />
                  </td>
                )}
                <td className="whitespace-nowrap">
                  <p className="tabular-nums">{formatDate(e.date_echeance)}</p>
                  {retard > 0 && <p className="text-xs font-medium text-red-700">{pluriel(retard, "jour")} de retard</p>}
                </td>
                <td className="text-right font-medium whitespace-nowrap tabular-nums">{formatEuros(e.montant_centimes)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
