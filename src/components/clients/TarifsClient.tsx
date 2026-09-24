"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deplacerTarif, supprimerTarif } from "@/app/(app)/clients/actions";
import { formatDate, formatEuros, formatPeriode, formatQuantite } from "@/lib/format";
import { FormulaireTarif } from "./FormulaireTarif";
import { IconeCorbeille, IconeCrayon, IconeFlecheBas, IconeFlecheHaut, IconePlus } from "./Icones";
import { Modale, ModaleConfirmation } from "./Modale";
import {
  mensuelEstime,
  prixApplique,
  situationSurMois,
  tarifFactureSurMois,
  totalLigneCentimes,
  type PrestationDuTarif,
  type TarifAvecPrestation,
} from "./tarifs";

/** Section « Tarifs appliqués » de la fiche client. */
export function TarifsClient({
  clientId,
  clientActif,
  tarifs,
  prestations,
  periode,
}: {
  clientId: string;
  clientActif: boolean;
  /** Tarifs du client, triés par ordre. */
  tarifs: TarifAvecPrestation[];
  /** Prestations actives du catalogue de l'entité du client. */
  prestations: PrestationDuTarif[];
  /** Premier jour du mois courant ("AAAA-MM-01"), calculé côté serveur (heure de Paris). */
  periode: string;
}) {
  const [edition, setEdition] = useState<TarifAvecPrestation | "nouveau" | null>(null);
  const [aSupprimer, setASupprimer] = useState<TarifAvecPrestation | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [deplacement, demarrerDeplacement] = useTransition();

  const total = mensuelEstime(tarifs, periode);
  const nbFactures = tarifs.filter((t) => tarifFactureSurMois(t, periode)).length;
  const mois = formatPeriode(periode);

  function ouvrir(cible: TarifAvecPrestation | "nouveau") {
    setMessage(null);
    setEdition(cible);
  }

  function deplacer(t: TarifAvecPrestation, sens: "haut" | "bas") {
    setMessage(null);
    demarrerDeplacement(async () => {
      const r = await deplacerTarif(t.id, sens);
      if (!r.ok) setMessage({ ok: false, texte: r.erreur });
    });
  }

  const tarifEdite = edition && edition !== "nouveau" ? edition : null;
  const optionsPrestations =
    tarifEdite?.prestation && !prestations.some((p) => p.id === tarifEdite.prestation?.id)
      ? [...prestations, tarifEdite.prestation]
      : prestations;

  return (
    <section className="carte" aria-labelledby="titre-tarifs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="titre-tarifs" className="titre-section">
            Tarifs appliqués
          </h2>
          <p className="text-sm text-muted">Lignes reprises dans la facture mensuelle, dans cet ordre.</p>
        </div>
        <button type="button" className="btn-primaire" onClick={() => ouvrir("nouveau")}>
          <IconePlus />
          Ajouter une ligne
        </button>
      </div>

      {message && (
        <div className="px-5 pt-4">
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "succes" : "erreur"}>
            {message.texte}
          </p>
        </div>
      )}

      {tarifs.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="font-medium text-ink">Aucun tarif pour ce client</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Ajoutez les prestations facturées chaque mois (pension, coaching, scolarité…), avec un prix
            personnalisé si besoin. Elles alimenteront automatiquement la facture mensuelle.
          </p>
          {prestations.length === 0 && (
            <p className="mx-auto mt-3 max-w-md text-xs text-muted">
              Le catalogue de l&apos;entité est vide :{" "}
              <Link href="/prestations" className="btn-lien text-xs">
                créer des prestations
              </Link>{" "}
              ou utiliser une ligne libre.
            </p>
          )}
          <button type="button" className="btn-secondaire mt-5" onClick={() => ouvrir("nouveau")}>
            <IconePlus />
            Ajouter la première ligne
          </button>
        </div>
      ) : (
        <>
          {/* Écrans larges : tableau */}
          <div className="hidden overflow-x-auto md:block">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th className="text-right">Prix catalogue</th>
                  <th className="text-right">Prix appliqué</th>
                  <th className="text-right">Qté</th>
                  <th className="text-right">Total</th>
                  <th>Facturation</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tarifs.map((t, i) => {
                  const l = decrireLigne(t, periode);
                  return (
                    <tr key={t.id} className={l.facture ? "" : "text-muted"}>
                      <td className="min-w-48">
                        <div className={`font-medium ${l.facture ? "text-ink" : ""}`}>{l.libelle}</div>
                        {l.description && <div className="text-xs text-muted">{l.description}</div>}
                        {!t.prestation && <span className="badge mt-1 bg-slate-100 text-slate-700">Ligne libre</span>}
                        {t.prestation && !t.prestation.actif && (
                          <span className="badge mt-1 bg-amber-100 text-amber-900">Retirée du catalogue</span>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap tabular-nums">
                        {t.prestation ? (
                          <>
                            {formatEuros(t.prestation.prix_unitaire_centimes)}
                            <span className="block text-xs text-muted">/ {t.prestation.unite}</span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap tabular-nums">
                        {l.prix != null ? formatEuros(l.prix) : "—"}
                        {l.personnalise && (
                          <span className="mt-1 block">
                            <span className="badge bg-brand-light text-brand-dark">Tarif personnalisé</span>
                          </span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{formatQuantite(t.quantite)}</td>
                      <td className="text-right font-medium whitespace-nowrap tabular-nums">
                        {l.total != null ? formatEuros(l.total) : "—"}
                      </td>
                      <td>
                        <Facturation t={t} l={l} />
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <ActionsLigne
                          premier={i === 0}
                          dernier={i === tarifs.length - 1}
                          desactive={deplacement}
                          onMonter={() => deplacer(t, "haut")}
                          onDescendre={() => deplacer(t, "bas")}
                          onModifier={() => ouvrir(t)}
                          onSupprimer={() => setASupprimer(t)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile : cartes */}
          <ul className="divide-y divide-line md:hidden">
            {tarifs.map((t, i) => {
              const l = decrireLigne(t, periode);
              return (
                <li key={t.id} className={`space-y-2 px-5 py-4 ${l.facture ? "" : "text-muted"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className={`font-medium ${l.facture ? "text-ink" : ""}`}>{l.libelle}</div>
                      {l.description && <div className="text-xs text-muted">{l.description}</div>}
                    </div>
                    <div className="text-right font-semibold whitespace-nowrap tabular-nums">
                      {l.total != null ? formatEuros(l.total) : "—"}
                    </div>
                  </div>
                  <div className="text-sm tabular-nums">
                    {formatQuantite(t.quantite)} × {l.prix != null ? formatEuros(l.prix) : "—"}
                    {l.personnalise && t.prestation && (
                      <span className="text-muted"> (catalogue : {formatEuros(t.prestation.prix_unitaire_centimes)})</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!t.prestation && <span className="badge bg-slate-100 text-slate-700">Ligne libre</span>}
                    {l.personnalise && <span className="badge bg-brand-light text-brand-dark">Tarif personnalisé</span>}
                  </div>
                  <Facturation t={t} l={l} />
                  <div className="flex justify-end">
                    <ActionsLigne
                      premier={i === 0}
                      dernier={i === tarifs.length - 1}
                      desactive={deplacement}
                      onMonter={() => deplacer(t, "haut")}
                      onDescendre={() => deplacer(t, "bas")}
                      onModifier={() => ouvrir(t)}
                      onSupprimer={() => setASupprimer(t)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line bg-page/60 px-5 py-4">
            <div className="text-sm text-muted">
              Total mensuel estimé — {mois}
              <span className="block text-xs">
                {nbFactures > 1
                  ? `${nbFactures} lignes mensuelles actives sur ce mois`
                  : `${nbFactures} ligne mensuelle active sur ce mois`}
                , montant hors taxes{clientActif ? "" : " · client archivé : aucune facture générée"}
              </span>
            </div>
            <div className={`text-xl font-semibold tabular-nums ${clientActif ? "text-brand" : "text-muted line-through"}`}>
              {formatEuros(total)}
            </div>
          </div>
        </>
      )}

      <Modale
        ouverte={edition !== null}
        onFermer={() => setEdition(null)}
        titre={edition === "nouveau" ? "Nouvelle ligne de tarif" : "Modifier la ligne de tarif"}
        largeur="max-w-2xl"
      >
        {edition !== null && (
          <FormulaireTarif
            key={tarifEdite?.id ?? "nouveau"}
            clientId={clientId}
            tarif={tarifEdite}
            prestations={optionsPrestations}
            onAnnuler={() => setEdition(null)}
            onTermine={(texte) => {
              setEdition(null);
              if (texte) setMessage({ ok: true, texte });
            }}
          />
        )}
      </Modale>

      <ModaleConfirmation
        ouverte={aSupprimer !== null}
        onFermer={() => setASupprimer(null)}
        titre="Supprimer cette ligne ?"
        libelleConfirmer="Supprimer la ligne"
        danger
        onConfirmer={() => (aSupprimer ? supprimerTarif(aSupprimer.id) : Promise.resolve(undefined))}
        onSucces={(texte) => texte && setMessage({ ok: true, texte })}
      >
        <p>
          La ligne <strong>{aSupprimer ? decrireLigne(aSupprimer, periode).libelle : ""}</strong> ne sera plus
          proposée pour ce client.
        </p>
        <p className="text-muted">
          Les factures déjà créées ne sont pas modifiées. Pour suspendre la ligne sans la perdre, modifiez-la et
          décochez « Ligne active ».
        </p>
      </ModaleConfirmation>
    </section>
  );
}

type DescriptionLigne = ReturnType<typeof decrireLigne>;

function decrireLigne(t: TarifAvecPrestation, periode: string) {
  const prix = prixApplique(t);
  return {
    libelle: t.libelle ?? t.prestation?.libelle ?? "Ligne sans libellé",
    description: t.description ?? t.prestation?.description ?? null,
    prix,
    total: prix != null ? totalLigneCentimes(t.quantite, prix) : null,
    personnalise:
      t.prestation != null &&
      t.prix_unitaire_centimes != null &&
      t.prix_unitaire_centimes !== t.prestation.prix_unitaire_centimes,
    facture: tarifFactureSurMois(t, periode),
    situation: situationSurMois(t, periode),
  };
}

function Facturation({ t, l }: { t: TarifAvecPrestation; l: DescriptionLigne }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {t.recurrent ? (
          <span className="badge bg-brand-light text-brand-dark">Mensuel</span>
        ) : (
          <span className="badge bg-slate-100 text-slate-700">Ponctuel</span>
        )}
        {!t.actif && <span className="badge bg-zinc-200 text-zinc-600">Inactif</span>}
        {t.actif && t.recurrent && l.situation === "a_venir" && (
          <span className="badge bg-amber-100 text-amber-900">À venir</span>
        )}
        {t.actif && t.recurrent && l.situation === "termine" && (
          <span className="badge bg-zinc-200 text-zinc-600">Terminé</span>
        )}
      </div>
      <div className="text-xs text-muted">{periodeValidite(t)}</div>
    </div>
  );
}

function periodeValidite(t: Pick<TarifAvecPrestation, "date_debut" | "date_fin">): string {
  if (t.date_debut && t.date_fin) return `Du ${formatDate(t.date_debut)} au ${formatDate(t.date_fin)}`;
  if (t.date_debut) return `À partir du ${formatDate(t.date_debut)}`;
  if (t.date_fin) return `Jusqu'au ${formatDate(t.date_fin)}`;
  return "Sans limite de durée";
}

function ActionsLigne({
  premier,
  dernier,
  desactive,
  onMonter,
  onDescendre,
  onModifier,
  onSupprimer,
}: {
  premier: boolean;
  dernier: boolean;
  desactive: boolean;
  onMonter: () => void;
  onDescendre: () => void;
  onModifier: () => void;
  onSupprimer: () => void;
}) {
  const icone = "rounded-md p-1.5 text-muted hover:bg-page hover:text-ink disabled:cursor-not-allowed disabled:opacity-30";
  return (
    <div className="inline-flex items-center gap-0.5">
      <button type="button" className={icone} onClick={onMonter} disabled={premier || desactive} aria-label="Monter la ligne" title="Monter">
        <IconeFlecheHaut />
      </button>
      <button
        type="button"
        className={icone}
        onClick={onDescendre}
        disabled={dernier || desactive}
        aria-label="Descendre la ligne"
        title="Descendre"
      >
        <IconeFlecheBas />
      </button>
      <button type="button" className={icone} onClick={onModifier} aria-label="Modifier la ligne" title="Modifier">
        <IconeCrayon />
      </button>
      <button
        type="button"
        className="rounded-md p-1.5 text-muted hover:bg-red-50 hover:text-red-700"
        onClick={onSupprimer}
        aria-label="Supprimer la ligne"
        title="Supprimer"
      >
        <IconeCorbeille />
      </button>
    </div>
  );
}
