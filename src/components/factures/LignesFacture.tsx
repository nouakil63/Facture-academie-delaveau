import { formatEuros, formatQuantite } from "@/lib/format";
import type { LigneFacture } from "@/lib/types";

export interface Totaux {
  ht: number;
  tva: number;
  ttc: number;
  taux: number;
  mentionTva: string | null;
}

/** Récapitulatif HT / TVA / TTC d'une facture. */
export function BlocTotaux({ totaux }: { totaux: Totaux }) {
  return (
    <dl className="space-y-1 border-t border-line px-5 py-4 text-sm sm:ml-auto sm:w-80">
      <div className="flex justify-between">
        <dt className="text-muted">Total HT</dt>
        <dd className="tabular-nums">{formatEuros(totaux.ht)}</dd>
      </div>
      {totaux.taux > 0 ? (
        <div className="flex justify-between">
          <dt className="text-muted">TVA {String(totaux.taux).replace(".", ",")} %</dt>
          <dd className="tabular-nums">{formatEuros(totaux.tva)}</dd>
        </div>
      ) : (
        totaux.mentionTva && <p className="text-xs text-muted">{totaux.mentionTva}</p>
      )}
      <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
        <dt>Total TTC</dt>
        <dd className="text-brand tabular-nums">{formatEuros(totaux.ttc)}</dd>
      </div>
    </dl>
  );
}

/** Lignes d'une facture émise (lecture seule). */
export function LignesLectureSeule({ lignes, totaux }: { lignes: LigneFacture[]; totaux: Totaux }) {
  return (
    <>
      {lignes.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">Aucune ligne.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Désignation</th>
                  <th className="text-right">Qté</th>
                  <th className="text-right">Prix unitaire</th>
                  <th className="text-right">Total HT</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div className="font-medium">{l.libelle}</div>
                      {l.description && <div className="text-xs whitespace-pre-line text-muted">{l.description}</div>}
                    </td>
                    <td className="text-right tabular-nums">{formatQuantite(l.quantite)}</td>
                    <td className="text-right whitespace-nowrap tabular-nums">{formatEuros(l.prix_unitaire_centimes)}</td>
                    <td className="text-right font-medium whitespace-nowrap tabular-nums">{formatEuros(l.total_centimes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line sm:hidden">
            {lignes.map((l) => (
              <li key={l.id} className="px-5 py-3">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{l.libelle}</span>
                  <span className="shrink-0 font-medium tabular-nums">{formatEuros(l.total_centimes)}</span>
                </div>
                {l.description && <div className="text-xs whitespace-pre-line text-muted">{l.description}</div>}
                <div className="mt-1 text-xs text-muted tabular-nums">
                  {formatQuantite(l.quantite)} × {formatEuros(l.prix_unitaire_centimes)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <BlocTotaux totaux={totaux} />
    </>
  );
}
