"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { changerActivationAcademie, enregistrerAcademie, supprimerAcademie } from "@/app/(app)/parametres/actions";
import { AcademieBadge } from "@/components/AcademieBadge";
import { IconeCorbeille, IconeCrayon, IconeInfo, IconePlus } from "@/components/Icones";
import { Modale } from "@/components/Modale";
import { pluriel } from "@/components/prestations/unites";
import type { Academie, ResultatAction } from "@/lib/types";
import { ChampCouleur } from "./Champs";
import { normaliserCouleur } from "./controles";
import { titreSection } from "./sections";

/** Académie et ce qui y est rattaché (calculé côté serveur). */
export type AcademieGestion = Academie & {
  /** Clients rattachés, archivés compris : bloque la suppression. */
  nbClients: number;
  nbClientsActifs: number;
  /** Factures rattachées (historique) : bloque aussi la suppression. */
  nbFactures: number;
};

type Message = { ok: boolean; texte: string } | null;
type Edition = { academie: AcademieGestion } | { nouvelle: true } | null;

/** Couleurs proposées pour une nouvelle académie (bleu Delaveau, bleu-vert Espoir, puis d'autres teintes lisibles). */
const COULEURS_SUGGEREES = ["#0050A0", "#2E7D8C", "#7A4B9C", "#B5582A", "#3F7D3A", "#9C2F4E"];

/**
 * Académies de rattachement des clients (Académie Delaveau, Académie Espoir…) :
 * ajout, renommage, couleur, activation et suppression (si rien n'y est rattaché).
 */
export function GestionAcademies({ academies }: { academies: AcademieGestion[] }) {
  const [edition, setEdition] = useState<Edition>(null);
  const [aSupprimer, setASupprimer] = useState<AcademieGestion | null>(null);
  const [aDesactiver, setADesactiver] = useState<AcademieGestion | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [enCours, demarrer] = useTransition();

  const nbActives = academies.filter((a) => a.actif).length;
  const academieEditee = edition && "academie" in edition ? edition.academie : null;

  function ouvrir(cible: Edition) {
    setMessage(null);
    setEdition(cible);
  }

  function reactiver(a: AcademieGestion) {
    setMessage(null);
    demarrer(async () => {
      const r = await changerActivationAcademie(a.id, true);
      setMessage(r.ok ? { ok: true, texte: r.message ?? "Académie réactivée." } : { ok: false, texte: r.erreur });
    });
  }

  // Couleur proposée à la création : la première qui n'est pas déjà prise.
  const couleursPrises = new Set(academies.map((a) => a.couleur.toUpperCase()));
  const couleurNouvelle = COULEURS_SUGGEREES.find((c) => !couleursPrises.has(c)) ?? COULEURS_SUGGEREES[0];

  return (
    <section id="academies" aria-labelledby="academies-titre" className="carte scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id="academies-titre" className="titre-section">
            {titreSection("academies")}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Chaque client est rattaché à une académie pour distinguer, filtrer et suivre les groupes. Tout le reste est
            commun : informations légales, IBAN, catalogue, modèles d&apos;e-mail et numérotation.
          </p>
        </div>
        <button type="button" className="btn-secondaire btn-petit shrink-0" onClick={() => ouvrir({ nouvelle: true })}>
          <IconePlus className="size-3.5" />
          Ajouter une académie
        </button>
      </div>

      {message && (
        <div className="px-5 pt-4">
          <p role={message.ok ? "status" : "alert"} className={`${message.ok ? "succes" : "erreur"} whitespace-pre-line`}>
            {message.texte}
          </p>
        </div>
      )}

      {academies.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">
          Aucune académie : ajoutez-en une pour pouvoir créer des clients.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {academies.map((a) => {
            const derniereActive = a.actif && nbActives <= 1;
            return (
              <li key={a.id} className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center ${a.actif ? "" : "bg-page/40"}`}>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className="size-9 shrink-0 rounded-full ring-1 ring-line ring-inset"
                    style={{ backgroundColor: a.couleur }}
                    title={a.couleur}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium ${a.actif ? "text-ink" : "text-muted"}`}>{a.nom}</span>
                      <AcademieBadge nom={a.nom} couleur={a.couleur} />
                      {!a.actif && <span className="badge bg-zinc-200 text-zinc-600">Désactivée</span>}
                    </p>
                    <p className="text-sm text-muted">
                      <ResumeClients a={a} />
                      <span className="ml-2 font-mono text-xs">{a.couleur.toUpperCase()}</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                  <button
                    type="button"
                    className="btn-secondaire btn-petit"
                    onClick={() => ouvrir({ academie: a })}
                    aria-label={`Modifier ${a.nom}`}
                  >
                    <IconeCrayon className="size-3.5" />
                    Modifier
                  </button>
                  {a.actif ? (
                    <button
                      type="button"
                      className="btn-secondaire btn-petit"
                      disabled={enCours || derniereActive}
                      onClick={() => {
                        setMessage(null);
                        setADesactiver(a);
                      }}
                      aria-label={`Désactiver ${a.nom}`}
                      title={
                        derniereActive
                          ? "Au moins une académie doit rester active"
                          : "Ne plus proposer cette académie pour les nouveaux clients ni dans le filtre"
                      }
                    >
                      Désactiver
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondaire btn-petit"
                      disabled={enCours}
                      onClick={() => reactiver(a)}
                      aria-label={`Réactiver ${a.nom}`}
                    >
                      Réactiver
                    </button>
                  )}
                  <button
                    type="button"
                    className="inline-flex cursor-pointer items-center rounded-lg p-1.5 text-muted transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-brand"
                    onClick={() => {
                      setMessage(null);
                      setASupprimer(a);
                    }}
                    aria-label={`Supprimer ${a.nom}`}
                    title="Supprimer"
                  >
                    <IconeCorbeille className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="flex items-start gap-2 border-t border-line bg-page/60 px-5 py-3 text-xs text-muted">
        <IconeInfo className="mt-0.5 size-4 shrink-0 text-brand" />
        <span>
          Une académie désactivée n&apos;est plus proposée pour les nouveaux clients ni dans le filtre ; ses clients
          restent rattachés et continuent d&apos;être facturés tant qu&apos;ils sont actifs. Le nom de l&apos;académie
          est rappelé sur les factures de ses clients.
        </span>
      </p>

      <Modale
        ouverte={edition !== null}
        onFermer={() => setEdition(null)}
        titre={academieEditee ? "Modifier l'académie" : "Nouvelle académie"}
        sousTitre={academieEditee ? academieEditee.nom : "Groupe auquel rattacher des clients"}
      >
        {edition !== null && (
          <FormulaireAcademie
            key={academieEditee?.id ?? "nouvelle"}
            academie={academieEditee}
            couleurParDefaut={couleurNouvelle}
            derniereActive={academieEditee ? academieEditee.actif && nbActives <= 1 : false}
            onAnnuler={() => setEdition(null)}
            onSucces={(texte) => {
              setEdition(null);
              setMessage({ ok: true, texte: texte ?? "Académie enregistrée." });
            }}
          />
        )}
      </Modale>

      <ConfirmationDesactivation
        academie={aDesactiver}
        onFermer={() => setADesactiver(null)}
        onTermine={(texte) => {
          setADesactiver(null);
          setMessage({ ok: true, texte });
        }}
      />

      <ConfirmationSuppression
        academie={aSupprimer}
        peutDesactiver={aSupprimer ? aSupprimer.actif && nbActives > 1 : false}
        onFermer={() => setASupprimer(null)}
        onTermine={(texte) => {
          setASupprimer(null);
          setMessage({ ok: true, texte });
        }}
      />
    </section>
  );
}

function ResumeClients({ a }: { a: AcademieGestion }) {
  if (a.nbClients === 0) return <>Aucun client</>;
  const archives = a.nbClients - a.nbClientsActifs;
  return (
    <>
      {a.nbClientsActifs > 0
        ? pluriel(a.nbClientsActifs, "client actif", "clients actifs")
        : "Aucun client actif"}
      {archives > 0 && ` · ${pluriel(archives, "archivé", "archivés")}`}
    </>
  );
}

// -----------------------------------------------------------------------------
// Formulaire (création / modification)
// -----------------------------------------------------------------------------

function FormulaireAcademie({
  academie,
  couleurParDefaut,
  derniereActive,
  onAnnuler,
  onSucces,
}: {
  /** null → création. */
  academie: AcademieGestion | null;
  couleurParDefaut: string;
  /** Seule académie active : elle ne peut pas être désactivée. */
  derniereActive: boolean;
  onAnnuler: () => void;
  onSucces: (message?: string) => void;
}) {
  const [etat, envoyer, enCours] = useActionState<ResultatAction | null, FormData>(async (precedent, donnees) => {
    const resultat = await enregistrerAcademie(precedent, donnees);
    if (resultat.ok) onSucces(resultat.message);
    return resultat;
  }, null);
  const [nom, setNom] = useState(academie?.nom ?? "");
  const [couleur, setCouleur] = useState((academie?.couleur ?? couleurParDefaut).toUpperCase());
  const couleurApercu = normaliserCouleur(couleur) ?? academie?.couleur ?? couleurParDefaut;

  function soumettre(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const donnees = new FormData(e.currentTarget);
    startTransition(() => envoyer(donnees));
  }

  return (
    <form onSubmit={soumettre} className="space-y-5">
      <input type="hidden" name="id" value={academie?.id ?? ""} />

      <div>
        <label htmlFor="academie-nom" className="label">
          Nom
          <span className="text-red-600" aria-hidden="true">
            {" "}
            *
          </span>
        </label>
        <input
          id="academie-nom"
          name="nom"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          required
          maxLength={80}
          autoComplete="off"
          autoFocus
          placeholder="Académie Espoir"
          aria-describedby="academie-nom-aide"
          className="champ"
        />
        <p id="academie-nom-aide" className="aide">
          Affiché dans les listes, le filtre et sur les factures. Sur les pastilles, « Académie » est omis.
        </p>
      </div>

      <ChampCouleur
        nom="couleur"
        libelle="Couleur"
        valeur={couleur}
        onChange={setCouleur}
        aide="Sert à repérer l'académie dans les listes et le tableau de bord."
      />

      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-page px-3 py-2 text-sm text-muted">
        Aperçu :
        <AcademieBadge nom={nom.trim() || "Académie"} couleur={couleurApercu} />
      </div>

      {academie && (
        <label
          className={`flex items-start gap-3 rounded-lg border border-line px-3 py-2.5 ${
            derniereActive && academie.actif ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-page"
          }`}
        >
          {/* Case désactivée : non envoyée par le navigateur, on transmet la valeur actuelle. */}
          {derniereActive && academie.actif && <input type="hidden" name="actif" value="on" />}
          <input
            type="checkbox"
            name={derniereActive && academie.actif ? undefined : "actif"}
            defaultChecked={academie.actif}
            disabled={derniereActive && academie.actif}
            className="mt-0.5 size-4 shrink-0 accent-brand"
          />
          <span className="text-sm">
            <span className="font-medium text-ink">Active</span>
            <span className="block text-xs text-muted">
              {derniereActive && academie.actif
                ? "Seule académie active : elle ne peut pas être désactivée."
                : "Décochée : l'académie n'est plus proposée pour les nouveaux clients ni dans le filtre."}
            </span>
          </span>
        </label>
      )}

      {etat && !etat.ok && (
        <p role="alert" className="erreur whitespace-pre-line">
          {etat.erreur}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondaire" onClick={onAnnuler} disabled={enCours}>
          Annuler
        </button>
        <button type="submit" className="btn-primaire" disabled={enCours}>
          {enCours ? "Enregistrement…" : academie ? "Enregistrer" : "Ajouter l'académie"}
        </button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Confirmations
// -----------------------------------------------------------------------------

/** Exécute une action serveur depuis une boîte de confirmation (erreur affichée dans la boîte). */
function useActionConfirmee(onTermine: (message: string) => void) {
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

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

  return { enCours, erreur, setErreur, executer };
}

function ConfirmationDesactivation({
  academie,
  onFermer,
  onTermine,
}: {
  academie: AcademieGestion | null;
  onFermer: () => void;
  onTermine: (message: string) => void;
}) {
  const { enCours, erreur, setErreur, executer } = useActionConfirmee(onTermine);

  function fermer() {
    if (enCours) return;
    setErreur(null);
    onFermer();
  }

  const a = academie;
  return (
    <Modale ouverte={a !== null} onFermer={fermer} titre="Désactiver l'académie ?" sousTitre={a?.nom}>
      {a && (
        <>
          <div className="space-y-3 text-sm text-ink">
            <p>« {a.nom} » ne sera plus proposée pour les nouveaux clients ni dans le filtre des académies.</p>
            {a.nbClientsActifs > 0 ? (
              <p>
                Ses {pluriel(a.nbClientsActifs, "client actif", "clients actifs")} restent rattachés et{" "}
                <strong>continuent d&apos;être facturés</strong>. Pour arrêter de les facturer, archivez-les depuis leur
                fiche ou rattachez-les à une autre académie.
              </p>
            ) : (
              <p className="text-muted">Aucun client actif n&apos;y est rattaché.</p>
            )}
            <p className="text-muted">Vous pourrez la réactiver à tout moment.</p>
          </div>

          {erreur && (
            <p role="alert" className="erreur mt-4 whitespace-pre-line">
              {erreur}
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-secondaire" onClick={fermer} disabled={enCours}>
              Annuler
            </button>
            <button
              type="button"
              className="btn-primaire"
              disabled={enCours}
              autoFocus
              onClick={() => executer(() => changerActivationAcademie(a.id, false), "Académie désactivée.")}
            >
              {enCours ? "Patientez…" : "Désactiver"}
            </button>
          </div>
        </>
      )}
    </Modale>
  );
}

function ConfirmationSuppression({
  academie,
  peutDesactiver,
  onFermer,
  onTermine,
}: {
  academie: AcademieGestion | null;
  /** Académie active et non la dernière : la désactivation est proposée à la place. */
  peutDesactiver: boolean;
  onFermer: () => void;
  onTermine: (message: string) => void;
}) {
  const { enCours, erreur, setErreur, executer } = useActionConfirmee(onTermine);

  function fermer() {
    if (enCours) return;
    setErreur(null);
    onFermer();
  }

  const a = academie;
  const rattachee = a ? a.nbClients > 0 || a.nbFactures > 0 : false;
  const desactiver = a
    ? () => executer(() => changerActivationAcademie(a.id, false), "Académie désactivée.")
    : () => undefined;

  return (
    <Modale
      ouverte={a !== null}
      onFermer={fermer}
      titre={rattachee ? "Suppression impossible" : "Supprimer l'académie ?"}
      sousTitre={a?.nom}
    >
      {a && (
        <>
          <div className="space-y-3 text-sm text-ink">
            {rattachee ? (
              <>
                <p>
                  {a.nbClients > 0
                    ? `${a.nbClients > 1 ? `${a.nbClients} clients y sont rattachés` : "1 client y est rattaché"} (clients archivés compris)`
                    : `${a.nbFactures > 1 ? `${a.nbFactures} factures y sont rattachées` : "1 facture y est rattachée"} (historique de facturation)`}{" "}
                  : cette académie ne peut pas être supprimée.
                </p>
                {a.nbClients > 0 && (
                  <p className="text-muted">
                    Pour la supprimer, rattachez d&apos;abord chaque client à une autre académie depuis sa fiche.
                  </p>
                )}
                {peutDesactiver ? (
                  <p>
                    <strong>Désactivez-la plutôt</strong> : elle ne sera plus proposée pour les nouveaux clients ni dans
                    le filtre.
                  </p>
                ) : !a.actif ? (
                  <p>Elle est déjà désactivée : elle n&apos;est plus proposée pour les nouveaux clients.</p>
                ) : null}
              </>
            ) : (
              <>
                <p>« {a.nom} » sera définitivement supprimée. Aucun client ni aucune facture n&apos;y est rattaché.</p>
                {a.actif && !peutDesactiver && (
                  <p className="avertissement">
                    C&apos;est la seule académie active : ajoutez ou réactivez d&apos;abord une autre académie.
                  </p>
                )}
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
              {rattachee && !peutDesactiver ? "Fermer" : "Annuler"}
            </button>
            {rattachee ? (
              peutDesactiver && (
                <button type="button" className="btn-primaire" disabled={enCours} autoFocus onClick={desactiver}>
                  {enCours ? "Patientez…" : "Désactiver l'académie"}
                </button>
              )
            ) : (
              <>
                {/* Refus du serveur (client rattaché entre-temps) : la désactivation reste possible. */}
                {erreur && peutDesactiver && (
                  <button type="button" className="btn-secondaire" disabled={enCours} onClick={desactiver}>
                    Désactiver plutôt
                  </button>
                )}
                <button
                  type="button"
                  className="btn-danger"
                  disabled={enCours || (a.actif && !peutDesactiver)}
                  autoFocus
                  onClick={() => executer(() => supprimerAcademie(a.id), "Académie supprimée.")}
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
