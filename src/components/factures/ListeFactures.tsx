"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { envoyerSelection } from "@/app/(app)/factures/actions";
import { EntiteBadge } from "@/components/EntiteBadge";
import { StatutBadge } from "@/components/StatutBadge";
import { formatDate, formatEuros, formatPeriode } from "@/lib/format";
import type { FactureVue } from "@/lib/types";
import { IconeAlerte, IconeEnvoi } from "./Icones";
import { ModaleConfirmation } from "./Modale";
import { libelleNumero, nomClientFacture, pluriel, type ResultatEnvoiFacture } from "./outils";
import { ResultatsEnvoi } from "./ResultatsEnvoi";

export type FactureListe = Pick<
  FactureVue,
  | "id"
  | "numero"
  | "statut"
  | "objet"
  | "periode"
  | "date_emission"
  | "date_echeance"
  | "total_ht_centimes"
  | "total_ttc_centimes"
  | "en_retard"
  | "client_id"
  | "client_type"
  | "client_nom"
  | "client_prenom"
  | "client_raison_sociale"
  | "client_email"
  | "client_cavaliers"
  | "entite_nom"
  | "entite_couleur"
>;

const MAX_LOT = 100;

/**
 * Tableau des factures avec sélection multiple et action groupée « Émettre et envoyer ».
 * Les factures annulées ne sont pas sélectionnables.
 */
export function ListeFactures({
  factures,
  afficherEntite,
  envoiPossible,
}: {
  factures: FactureListe[];
  afficherEntite: boolean;
  /** false si l'envoi d'e-mails (SMTP) n'est pas configuré. */
  envoiPossible: boolean;
}) {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState(false);
  const [compteRendu, setCompteRendu] = useState<{ resultats: ResultatEnvoiFacture[]; synthese?: string } | null>(null);

  const selectionnables = useMemo(() => factures.filter((f) => f.statut !== "annulee"), [factures]);
  // Les factures sélectionnées qui ont disparu de la liste (filtre, envoi) ne comptent plus.
  const choisies = useMemo(() => factures.filter((f) => selection.has(f.id)), [factures, selection]);
  const toutesChoisies = selectionnables.length > 0 && choisies.length === selectionnables.length;

  const nonAnnulees = factures.filter((f) => f.statut !== "annulee");
  const totalHt = nonAnnulees.reduce((s, f) => s + f.total_ht_centimes, 0);
  const totalTtc = nonAnnulees.reduce((s, f) => s + f.total_ttc_centimes, 0);
  const nbAnnulees = factures.length - nonAnnulees.length;

  function basculer(id: string) {
    setSelection((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      return apres;
    });
  }

  function basculerTout() {
    setSelection(toutesChoisies ? new Set() : new Set(selectionnables.map((f) => f.id)));
  }

  // Détail de la sélection pour la confirmation.
  const brouillons = choisies.filter((f) => f.statut === "brouillon");
  const brouillonsSansEmail = brouillons.filter((f) => !f.client_email);
  const aRenvoyer = choisies.filter((f) => f.statut === "emise" || f.statut === "envoyee");
  const payees = choisies.filter((f) => f.statut === "payee");
  const totalSelection = choisies.reduce((s, f) => s + f.total_ttc_centimes, 0);
  const tropNombreuses = choisies.length > MAX_LOT;

  return (
    <div className="space-y-4">
      {compteRendu && (
        <ResultatsEnvoi
          resultats={compteRendu.resultats}
          synthese={compteRendu.synthese}
          onFermer={() => setCompteRendu(null)}
        />
      )}

      {choisies.length > 0 && (
        <div className="sticky top-18 z-20 flex flex-col gap-3 rounded-xl lg:top-2 border border-brand/30 bg-brand-light px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink">
            <span className="font-semibold">{pluriel(choisies.length, "facture sélectionnée", "factures sélectionnées")}</span>
            <span className="text-muted"> · {formatEuros(totalSelection)} TTC</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondaire btn-petit" onClick={() => setSelection(new Set())}>
              Tout désélectionner
            </button>
            <button
              type="button"
              className="btn-primaire btn-petit"
              onClick={() => setConfirmation(true)}
              disabled={tropNombreuses || !envoiPossible}
              title={
                !envoiPossible
                  ? "L'envoi d'e-mails n'est pas configuré (Paramètres)"
                  : tropNombreuses
                    ? `${MAX_LOT} factures au maximum par envoi`
                    : undefined
              }
            >
              <IconeEnvoi className="size-3.5" />
              Émettre et envoyer
            </button>
          </div>
        </div>
      )}
      {choisies.length > 0 && !envoiPossible && (
        <p className="avertissement">
          L&apos;envoi d&apos;e-mails n&apos;est pas configuré (serveur SMTP) : l&apos;envoi groupé est indisponible.{" "}
          <Link href="/parametres" className="font-medium underline">
            Paramètres
          </Link>
        </p>
      )}
      {tropNombreuses && (
        <p className="avertissement">
          {MAX_LOT} factures au maximum par envoi groupé : réduisez la sélection et procédez en plusieurs fois.
        </p>
      )}

      <div className="carte overflow-hidden">
        {/* Écrans larges : tableau */}
        <div className="hidden overflow-x-auto lg:block">
          <table className="tableau">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Sélectionner toutes les factures affichées"
                    className="size-4 accent-brand"
                    checked={toutesChoisies}
                    disabled={selectionnables.length === 0}
                    onChange={basculerTout}
                  />
                </th>
                <th>N°</th>
                <th>Client</th>
                {afficherEntite && <th>Entité</th>}
                <th>Objet / période</th>
                <th>Émise le</th>
                <th>Échéance</th>
                <th className="text-right">Montant TTC</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {factures.map((f) => {
                const annulee = f.statut === "annulee";
                const choisie = selection.has(f.id);
                return (
                  <tr key={f.id} className={`${annulee ? "text-muted" : ""} ${choisie ? "bg-brand-light/50" : ""}`}>
                    <td>
                      <input
                        type="checkbox"
                        className="size-4 accent-brand"
                        aria-label={`Sélectionner ${libelleNumero(f.numero)} – ${nomClientFacture(f)}`}
                        checked={choisie}
                        disabled={annulee}
                        title={annulee ? "Facture annulée : ne peut plus être envoyée" : undefined}
                        onChange={() => basculer(f.id)}
                      />
                    </td>
                    <td className="whitespace-nowrap">
                      <Link
                        href={`/factures/${f.id}`}
                        className={`font-medium hover:underline ${f.numero ? "text-brand" : "text-muted italic"}`}
                      >
                        {libelleNumero(f.numero)}
                      </Link>
                    </td>
                    <td className="max-w-56">
                      <Link href={`/factures/${f.id}`} className="block truncate font-medium text-ink hover:text-brand">
                        {nomClientFacture(f)}
                      </Link>
                      {f.client_cavaliers && <div className="truncate text-xs text-muted">{f.client_cavaliers}</div>}
                    </td>
                    {afficherEntite && (
                      <td>
                        <EntiteBadge nom={f.entite_nom} couleur={f.entite_couleur} />
                      </td>
                    )}
                    <td className="max-w-64">
                      <span className="line-clamp-1" title={f.objet ?? undefined}>
                        {f.objet ?? <span className="text-muted">—</span>}
                      </span>
                      {f.periode && <div className="text-xs text-muted">{formatPeriode(f.periode)}</div>}
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{formatDate(f.date_emission)}</td>
                    <td className={`whitespace-nowrap tabular-nums ${f.en_retard ? "font-medium text-red-700" : ""}`}>
                      {formatDate(f.date_echeance)}
                    </td>
                    <td className={`text-right font-medium whitespace-nowrap tabular-nums ${annulee ? "line-through" : ""}`}>
                      {formatEuros(f.total_ttc_centimes)}
                    </td>
                    <td>
                      <StatutBadge statut={f.statut} enRetard={f.en_retard} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-page/60">
                <td />
                <td colSpan={afficherEntite ? 6 : 5} className="px-4 py-3 text-sm text-muted">
                  {pluriel(factures.length, "facture")}
                  {nbAnnulees > 0 && ` · totaux hors ${pluriel(nbAnnulees, "annulée")}`}
                  <span className="ml-2 text-xs">(HT : {formatEuros(totalHt)})</span>
                </td>
                <td className="px-4 py-3 text-right font-semibold whitespace-nowrap text-brand tabular-nums">
                  {formatEuros(totalTtc)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile et tablette : liste */}
        <ul className="divide-y divide-line lg:hidden">
          <li className="flex items-center gap-3 bg-page/60 px-4 py-2.5">
            <input
              id="tout-selectionner-mobile"
              type="checkbox"
              className="size-4 accent-brand"
              checked={toutesChoisies}
              disabled={selectionnables.length === 0}
              onChange={basculerTout}
            />
            <label htmlFor="tout-selectionner-mobile" className="text-xs font-medium tracking-wide text-muted uppercase">
              Tout sélectionner
            </label>
          </li>
          {factures.map((f) => {
            const annulee = f.statut === "annulee";
            return (
              <li key={f.id} className={`flex items-start gap-3 px-4 py-3 ${selection.has(f.id) ? "bg-brand-light/50" : ""}`}>
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-brand"
                  aria-label={`Sélectionner ${libelleNumero(f.numero)} – ${nomClientFacture(f)}`}
                  checked={selection.has(f.id)}
                  disabled={annulee}
                  onChange={() => basculer(f.id)}
                />
                <Link href={`/factures/${f.id}`} className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className={`font-medium ${annulee ? "text-muted" : "text-ink"}`}>{nomClientFacture(f)}</div>
                      <div className="truncate text-xs text-muted">
                        {libelleNumero(f.numero)}
                        {f.periode ? ` · ${formatPeriode(f.periode)}` : f.objet ? ` · ${f.objet}` : ""}
                      </div>
                    </div>
                    <div className={`shrink-0 text-right text-sm font-medium tabular-nums ${annulee ? "text-muted line-through" : ""}`}>
                      {formatEuros(f.total_ttc_centimes)}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <StatutBadge statut={f.statut} enRetard={f.en_retard} />
                    {afficherEntite && <EntiteBadge nom={f.entite_nom} couleur={f.entite_couleur} />}
                    {f.date_echeance && (
                      <span className={f.en_retard ? "font-medium text-red-700" : ""}>
                        Échéance {formatDate(f.date_echeance)}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
          <li className="flex items-center justify-between bg-page/60 px-4 py-3 text-sm">
            <span className="text-muted">
              Total TTC{nbAnnulees > 0 ? " (hors annulées)" : ""}
            </span>
            <span className="font-semibold text-brand tabular-nums">{formatEuros(totalTtc)}</span>
          </li>
        </ul>
      </div>

      <ModaleConfirmation
        ouverte={confirmation}
        onFermer={() => setConfirmation(false)}
        titre={`Émettre et envoyer ${pluriel(choisies.length, "facture")}`}
        libelleConfirmer={`Émettre et envoyer (${choisies.length})`}
        libelleEnCours="Envoi en cours…"
        desactiver={choisies.length === 0 || tropNombreuses}
        onConfirmer={() => envoyerSelection(choisies.map((f) => f.id))}
        onSucces={(r) => {
          setCompteRendu({ resultats: r.donnees ?? [], synthese: r.message });
          setSelection(new Set());
        }}
      >
        <p>
          Montant total : <strong>{formatEuros(totalSelection)} TTC</strong>. Chaque facture est envoyée par e-mail au
          client (adresse principale et copies), avec le PDF en pièce jointe.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {brouillons.length > 0 && (
            <li>
              <strong>{pluriel(brouillons.length, "brouillon")}</strong> recevr{brouillons.length > 1 ? "ont" : "a"} un
              numéro définitif et ne pourr{brouillons.length > 1 ? "ont" : "a"} plus être modifié
              {brouillons.length > 1 ? "s" : ""}.
            </li>
          )}
          {aRenvoyer.length > 0 && (
            <li>
              <strong>{pluriel(aRenvoyer.length, "facture déjà émise", "factures déjà émises")}</strong> ser
              {aRenvoyer.length > 1 ? "ont" : "a"} envoyée{aRenvoyer.length > 1 ? "s" : ""} (ou renvoyée
              {aRenvoyer.length > 1 ? "s" : ""}).
            </li>
          )}
          {payees.length > 0 && (
            <li>
              <strong>{pluriel(payees.length, "facture payée", "factures payées")}</strong> partir
              {payees.length > 1 ? "ont" : "a"} en duplicata (statut inchangé).
            </li>
          )}
        </ul>
        {brouillonsSansEmail.length > 0 && (
          <p className="avertissement flex gap-2">
            <IconeAlerte className="mt-0.5 size-4 text-amber-600" />
            <span>
              {brouillonsSansEmail.length === 1
                ? "1 brouillon concerne un client sans adresse e-mail : il sera ignoré (ni émis, ni envoyé)."
                : `${brouillonsSansEmail.length} brouillons concernent des clients sans adresse e-mail : ils seront ignorés (ni émis, ni envoyés).`}
            </span>
          </p>
        )}
        {choisies.length > 10 && (
          <p className="text-xs text-muted">L&apos;envoi est séquentiel : comptez quelques secondes par facture.</p>
        )}
      </ModaleConfirmation>
    </div>
  );
}
