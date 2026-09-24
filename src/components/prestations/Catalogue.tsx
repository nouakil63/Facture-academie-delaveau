"use client";

import { useState, useTransition } from "react";
import { changerArchivagePrestation, supprimerPrestation } from "@/app/(app)/prestations/actions";
import { formatEuros } from "@/lib/format";
import type { Entite, Prestation, ResultatAction } from "@/lib/types";
import { FormulairePrestation } from "./FormulairePrestation";
import {
  IconeArchive,
  IconeCatalogue,
  IconeCorbeille,
  IconeCrayon,
  IconePlus,
  IconeRepeter,
  IconeRestaurer,
} from "./Icones";
import { Modale } from "./Modale";
import { pluriel, suffixeUnite } from "./unites";

export type EntiteCatalogue = Pick<Entite, "id" | "nom" | "prefixe_facture" | "couleur_primaire" | "actif">;

/** Prestation et son utilisation dans les tarifs clients. */
export type PrestationCatalogue = Prestation & {
  /** Clients actifs ayant un tarif actif sur cette prestation. */
  nbClients: number;
  /** … dont ceux dont le tarif fixe un prix personnalisé. */
  nbPrixPersonnalises: number;
  /** Clients (archivés compris) ayant une ligne de tarif, active ou non : bloque la suppression. */
  nbClientsReferences: number;
};

export type GroupeCatalogue = {
  entite: EntiteCatalogue;
  /** Prestations affichées (sans les archivées si elles sont masquées). */
  prestations: PrestationCatalogue[];
  /** Nombre de prestations archivées masquées. */
  nbArchiveesMasquees: number;
};

type Edition = { prestation: PrestationCatalogue } | { entiteId: string | null } | null;
type Message = { ok: boolean; texte: string } | null;

/** Catalogue des prestations, groupé par entité, avec création / modification / archivage / suppression. */
export function Catalogue({
  entete,
  groupes,
  entites,
  entiteParDefaut,
}: {
  /** Titre de la page (rendu côté serveur). */
  entete: React.ReactNode;
  groupes: GroupeCatalogue[];
  /** Entités proposées dans le formulaire (actives). */
  entites: Pick<Entite, "id" | "nom">[];
  /** Entité sélectionnée dans la barre latérale (préremplie à la création). */
  entiteParDefaut: string | null;
}) {
  const [edition, setEdition] = useState<Edition>(null);
  const [aSupprimer, setASupprimer] = useState<PrestationCatalogue | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [archivageEnCours, demarrerArchivage] = useTransition();

  function ouvrir(cible: Edition) {
    setMessage(null);
    setEdition(cible);
  }

  function archiver(p: PrestationCatalogue, archiverOuNon: boolean) {
    setMessage(null);
    demarrerArchivage(async () => {
      const r = await changerArchivagePrestation(p.id, archiverOuNon);
      setMessage(r.ok ? { ok: true, texte: r.message ?? "Prestation mise à jour." } : { ok: false, texte: r.erreur });
    });
  }

  const prestationEditee = edition && "prestation" in edition ? edition.prestation : null;
  // Une prestation d'une entité désactivée reste modifiable : on garde son entité dans la liste.
  const entitesFormulaire =
    prestationEditee && !entites.some((e) => e.id === prestationEditee.entite_id)
      ? [
          ...entites,
          ...groupes.filter((g) => g.entite.id === prestationEditee.entite_id).map((g) => g.entite),
        ]
      : entites;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {entete}
        <button
          type="button"
          className="btn-primaire"
          onClick={() => ouvrir({ entiteId: entiteParDefaut })}
          disabled={entites.length === 0}
        >
          <IconePlus />
          Nouvelle prestation
        </button>
      </div>

      {message && (
        <p role={message.ok ? "status" : "alert"} className={`${message.ok ? "succes" : "erreur"} whitespace-pre-line`}>
          {message.texte}
        </p>
      )}

      {groupes.length === 0 && (
        <p className="carte carte-corps text-sm text-muted">Aucune entité active à afficher.</p>
      )}

      {groupes.map((g) => (
        <GroupeEntite
          key={g.entite.id}
          groupe={g}
          desactive={archivageEnCours}
          onAjouter={() => ouvrir({ entiteId: g.entite.id })}
          onModifier={(p) => ouvrir({ prestation: p })}
          onArchiver={archiver}
          onSupprimer={(p) => {
            setMessage(null);
            setASupprimer(p);
          }}
        />
      ))}

      <Modale
        ouverte={edition !== null}
        onFermer={() => setEdition(null)}
        titre={prestationEditee ? "Modifier la prestation" : "Nouvelle prestation"}
        sousTitre={prestationEditee ? prestationEditee.libelle : "Ajout au catalogue de l'entité choisie"}
        largeur="max-w-xl"
      >
        {edition !== null && (
          <FormulairePrestation
            key={prestationEditee?.id ?? "nouvelle"}
            prestation={prestationEditee ?? undefined}
            entites={entitesFormulaire}
            entiteParDefaut={"entiteId" in edition ? edition.entiteId : null}
            entiteVerrouillee={(prestationEditee?.nbClientsReferences ?? 0) > 0}
            nbClientsPrixCatalogue={prestationEditee ? prestationEditee.nbClients - prestationEditee.nbPrixPersonnalises : 0}
            onAnnuler={() => setEdition(null)}
            onSucces={(texte) => {
              setEdition(null);
              setMessage({ ok: true, texte: texte ?? "Prestation enregistrée." });
            }}
          />
        )}
      </Modale>

      <ConfirmationSuppression
        prestation={aSupprimer}
        onFermer={() => setASupprimer(null)}
        onTermine={(texte) => {
          setASupprimer(null);
          setMessage({ ok: true, texte });
        }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Groupe d'une entité
// -----------------------------------------------------------------------------

type ActionsLigne = {
  desactive: boolean;
  onModifier: (p: PrestationCatalogue) => void;
  onArchiver: (p: PrestationCatalogue, archiver: boolean) => void;
  onSupprimer: (p: PrestationCatalogue) => void;
};

function GroupeEntite({
  groupe,
  onAjouter,
  ...actions
}: ActionsLigne & { groupe: GroupeCatalogue; onAjouter: () => void }) {
  const { entite, prestations, nbArchiveesMasquees } = groupe;
  const actives = prestations.filter((p) => p.actif);
  const mensuelles = actives.filter((p) => p.recurrente).length;
  const idTitre = `catalogue-${entite.id}`;

  return (
    <section className="carte overflow-hidden" aria-labelledby={idTitre}>
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"
        style={{ boxShadow: `inset 4px 0 0 ${entite.couleur_primaire}` }}
      >
        <div className="min-w-0">
          <h2 id={idTitre} className="titre-section flex flex-wrap items-center gap-2">
            {entite.nom}
            <span
              className="badge border font-sans text-[11px] tracking-wider"
              style={{ borderColor: entite.couleur_primaire, color: entite.couleur_primaire }}
              title="Préfixe des numéros de facture"
            >
              {entite.prefixe_facture}
            </span>
            {!entite.actif && <span className="badge bg-zinc-200 font-sans text-zinc-600">Entité désactivée</span>}
          </h2>
          <p className="text-sm text-muted">
            {actives.length === 0
              ? "Aucune prestation active"
              : `${pluriel(actives.length, "prestation active", "prestations actives")} · ${
                  mensuelles > 1 ? `${mensuelles} facturées chaque mois` : `${mensuelles} facturée chaque mois`
                }`}
            {nbArchiveesMasquees > 0 &&
              ` · ${pluriel(nbArchiveesMasquees, "archivée masquée", "archivées masquées")}`}
          </p>
        </div>
        <button type="button" className="btn-secondaire btn-petit" onClick={onAjouter}>
          <IconePlus className="size-3.5" />
          Ajouter
        </button>
      </div>

      {prestations.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <span className="rounded-full bg-brand-light p-3 text-brand">
            <IconeCatalogue className="size-6" />
          </span>
          <p className="mt-4 font-medium text-ink">Aucune prestation dans le catalogue de {entite.nom}</p>
          <p className="mt-1 max-w-md text-sm text-muted">
            {nbArchiveesMasquees > 0
              ? "Toutes ses prestations sont archivées. Affichez les archivées pour les réactiver, ou créez-en une nouvelle."
              : "Ajoutez les prestations que vous facturez (pension, entraînement, scolarité, stage…) avec leur prix : vous les attribuerez ensuite à chaque client."}
          </p>
          <button type="button" className="btn-primaire mt-5" onClick={onAjouter}>
            <IconePlus />
            Créer une prestation
          </button>
        </div>
      ) : (
        <>
          {/* Écrans larges : tableau */}
          <div className="hidden overflow-x-auto md:block">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Prestation</th>
                  <th className="text-right">Prix HT</th>
                  <th>Facturation</th>
                  <th>Clients</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {prestations.map((p) => (
                  <tr key={p.id} className={p.actif ? "" : "bg-page/40 text-muted"}>
                    <td className="max-w-md min-w-56">
                      <div className={`font-medium ${p.actif ? "text-ink" : ""}`}>
                        {p.libelle}
                        {!p.actif && <span className="badge ml-2 bg-zinc-200 align-middle text-zinc-600">Archivée</span>}
                      </div>
                      {p.description && <div className="line-clamp-2 text-xs text-muted">{p.description}</div>}
                    </td>
                    <td className="text-right whitespace-nowrap tabular-nums">
                      <span className="font-medium">{formatEuros(p.prix_unitaire_centimes)}</span>
                      <span className="block text-xs text-muted">{suffixeUnite(p.unite)}</span>
                    </td>
                    <td>
                      <TypeFacturation recurrente={p.recurrente} />
                    </td>
                    <td className="whitespace-nowrap">
                      <Utilisation p={p} />
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <BoutonsLigne p={p} {...actions} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile : cartes */}
          <ul className="divide-y divide-line md:hidden">
            {prestations.map((p) => (
              <li key={p.id} className={`space-y-2 px-5 py-4 ${p.actif ? "" : "bg-page/40 text-muted"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className={`font-medium ${p.actif ? "text-ink" : ""}`}>{p.libelle}</div>
                    {p.description && <div className="line-clamp-2 text-xs text-muted">{p.description}</div>}
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <div className="font-semibold">{formatEuros(p.prix_unitaire_centimes)}</div>
                    <div className="text-xs text-muted">{suffixeUnite(p.unite)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!p.actif && <span className="badge bg-zinc-200 text-zinc-600">Archivée</span>}
                  <TypeFacturation recurrente={p.recurrente} />
                </div>
                <div className="text-sm">
                  <Utilisation p={p} />
                </div>
                <div className="flex justify-end">
                  <BoutonsLigne p={p} {...actions} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function TypeFacturation({ recurrente }: { recurrente: boolean }) {
  return recurrente ? (
    <span className="badge gap-1 bg-brand-light text-brand-dark">
      <IconeRepeter className="size-3" />
      Mensuelle
    </span>
  ) : (
    <span className="badge bg-slate-100 text-slate-700">Ponctuelle</span>
  );
}

function Utilisation({ p }: { p: PrestationCatalogue }) {
  const inactifs = p.nbClientsReferences - p.nbClients;
  if (p.nbClientsReferences === 0) return <span className="text-sm text-muted">Aucun client</span>;
  return (
    <div className="text-sm">
      {p.nbClients > 0 ? (
        <span className="font-medium text-ink">{pluriel(p.nbClients, "client")}</span>
      ) : (
        <span className="text-muted">Aucun client actif</span>
      )}
      {p.nbPrixPersonnalises > 0 && (
        <span className="block text-xs text-muted">
          dont {p.nbPrixPersonnalises} au prix personnalisé
        </span>
      )}
      {inactifs > 0 && (
        <span className="block text-xs text-muted" title="Tarifs désactivés ou clients archivés">
          + {pluriel(inactifs, "tarif inactif", "tarifs inactifs")}
        </span>
      )}
    </div>
  );
}

function BoutonsLigne({ p, desactive, onModifier, onArchiver, onSupprimer }: ActionsLigne & { p: PrestationCatalogue }) {
  return (
    <div className="inline-flex flex-wrap items-center justify-end gap-1">
      <button
        type="button"
        className="btn-secondaire btn-petit"
        onClick={() => onModifier(p)}
        aria-label={`Modifier ${p.libelle}`}
      >
        <IconeCrayon className="size-3.5" />
        Modifier
      </button>
      {p.actif ? (
        <button
          type="button"
          className="btn-secondaire btn-petit"
          onClick={() => onArchiver(p, true)}
          disabled={desactive}
          aria-label={`Archiver ${p.libelle}`}
          title="Ne plus proposer cette prestation pour de nouveaux tarifs"
        >
          <IconeArchive className="size-3.5" />
          Archiver
        </button>
      ) : (
        <button
          type="button"
          className="btn-secondaire btn-petit"
          onClick={() => onArchiver(p, false)}
          disabled={desactive}
          aria-label={`Réactiver ${p.libelle}`}
        >
          <IconeRestaurer className="size-3.5" />
          Réactiver
        </button>
      )}
      <button
        type="button"
        className="inline-flex cursor-pointer items-center rounded-lg p-1.5 text-muted transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-brand"
        onClick={() => onSupprimer(p)}
        aria-label={`Supprimer ${p.libelle}`}
        title="Supprimer"
      >
        <IconeCorbeille className="size-4" />
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Suppression (ou archivage proposé si la prestation est utilisée)
// -----------------------------------------------------------------------------

function ConfirmationSuppression({
  prestation,
  onFermer,
  onTermine,
}: {
  prestation: PrestationCatalogue | null;
  onFermer: () => void;
  onTermine: (message: string) => void;
}) {
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function fermer() {
    if (enCours) return;
    setErreur(null);
    onFermer();
  }

  function executer(action: () => Promise<ResultatAction>, messageParDefaut: string) {
    setErreur(null);
    demarrer(async () => {
      const r = await action();
      if (!r.ok) {
        setErreur(r.erreur);
        return;
      }
      onTermine(r.message ?? messageParDefaut);
    });
  }

  const p = prestation;
  const utilisee = (p?.nbClientsReferences ?? 0) > 0;
  const archiverPrestation = p
    ? () => executer(() => changerArchivagePrestation(p.id, true), "Prestation archivée.")
    : () => undefined;

  return (
    <Modale
      ouverte={p !== null}
      onFermer={fermer}
      titre={utilisee ? "Suppression impossible" : "Supprimer la prestation ?"}
      sousTitre={p?.libelle}
    >
      {p && (
        <>
          <div className="space-y-3 text-sm text-ink">
            {utilisee ? (
              <>
                <p>
                  Cette prestation figure dans les tarifs de {pluriel(p.nbClientsReferences, "client")} : elle ne peut
                  pas être supprimée.
                </p>
                {p.actif ? (
                  <p>
                    <strong>Archivez-la plutôt</strong> : elle ne sera plus proposée pour de nouveaux tarifs.
                  </p>
                ) : (
                  <p>Elle est déjà archivée : elle n&apos;est plus proposée pour de nouveaux tarifs.</p>
                )}
                <p className="text-muted">
                  Les tarifs existants ne changent pas et restent facturés chaque mois. Pour arrêter de la facturer à
                  un client, désactivez ou supprimez la ligne correspondante sur sa fiche.
                </p>
              </>
            ) : (
              <>
                <p>
                  « {p.libelle} » sera définitivement retirée du catalogue. Aucun client ne l&apos;utilise dans ses
                  tarifs.
                </p>
                <p className="text-muted">Les factures déjà créées conservent leurs lignes, leur libellé et leur prix.</p>
              </>
            )}
          </div>

          {erreur && (
            <p role="alert" className="erreur mt-4 whitespace-pre-line">
              {erreur}
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-secondaire" onClick={fermer} disabled={enCours}>
              {utilisee && !p.actif ? "Fermer" : "Annuler"}
            </button>
            {utilisee ? (
              p.actif && (
                <button type="button" className="btn-primaire" disabled={enCours} autoFocus onClick={archiverPrestation}>
                  <IconeArchive />
                  {enCours ? "Patientez…" : "Archiver la prestation"}
                </button>
              )
            ) : (
              <>
                {/* Refus du serveur (tarif ajouté entre-temps) : l'archivage reste possible. */}
                {erreur && p.actif && (
                  <button type="button" className="btn-secondaire" disabled={enCours} onClick={archiverPrestation}>
                    <IconeArchive />
                    Archiver plutôt
                  </button>
                )}
                <button
                  type="button"
                  className="btn-danger"
                  disabled={enCours}
                  autoFocus
                  onClick={() => executer(() => supprimerPrestation(p.id), "Prestation supprimée.")}
                >
                  <IconeCorbeille />
                  {enCours ? "Suppression…" : "Supprimer définitivement"}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </Modale>
  );
}
