"use client";

import Link from "next/link";
import { startTransition, useActionState, useId, useState } from "react";
import { creerFacture } from "@/app/(app)/factures/actions";
import { EntiteBadge } from "@/components/EntiteBadge";
import { centimesVersSaisie, formatEuros, parseEurosEnCentimes } from "@/lib/format";
import type { ResultatAction } from "@/lib/types";
import { IconeAlerte, IconeCorbeille, IconePlus } from "./Icones";
import { parseQuantite, quantiteVersSaisie, totalLigneCentimes, type LigneSaisie } from "./outils";

export interface EntiteFormulaire {
  id: string;
  nom: string;
  couleur_primaire: string;
  taux_tva: number;
  mention_tva: string | null;
}

export interface ClientFormulaire {
  id: string;
  entite_id: string;
  nom: string;
  cavaliers: string | null;
  aDesDestinataires: boolean;
  actif: boolean;
}

export interface PrestationFormulaire {
  id: string;
  libelle: string;
  description: string | null;
  prix_unitaire_centimes: number;
  unite: string;
}

/** Ligne proposée à partir d'un tarif du client (libellé / prix effectifs). */
export interface LigneInitiale {
  prestation_id: string | null;
  libelle: string;
  description: string | null;
  quantite: number;
  prix_unitaire_centimes: number;
}

/** Clés des lignes ajoutées après l'affichage (événements uniquement, jamais au rendu). */
let compteur = 0;
function nouvelleCle() {
  compteur += 1;
  return `n${compteur}`;
}

function versSaisie(l: LigneInitiale, cle: string): LigneSaisie {
  return {
    cle,
    prestation_id: l.prestation_id,
    libelle: l.libelle,
    description: l.description ?? "",
    quantite: quantiteVersSaisie(l.quantite),
    prix: centimesVersSaisie(l.prix_unitaire_centimes),
  };
}

/** Total d'une ligne saisie, ou null si la quantité ou le prix est invalide. */
function totalSaisie(l: LigneSaisie): number | null {
  const q = parseQuantite(l.quantite);
  const p = parseEurosEnCentimes(l.prix);
  return q == null || p == null ? null : totalLigneCentimes(q, p);
}

/**
 * Création d'une facture brouillon : client, objet, période, notes, lignes
 * pré-remplies depuis les tarifs du client (modifiables, supprimables) +
 * ajout depuis le catalogue de l'entité ou ligne libre.
 */
export function FormulaireNouvelleFacture({
  entites,
  clients,
  lignesParClient,
  prestationsParEntite,
  clientInitial,
}: {
  entites: EntiteFormulaire[];
  clients: ClientFormulaire[];
  lignesParClient: Record<string, LigneInitiale[]>;
  prestationsParEntite: Record<string, PrestationFormulaire[]>;
  clientInitial: string | null;
}) {
  const [etat, envoyer, enCours] = useActionState<ResultatAction | null, FormData>(creerFacture, null);
  const id = useId();

  const [clientId, setClientId] = useState(clientInitial ?? "");
  const [lignes, setLignes] = useState<LigneSaisie[]>(() =>
    // Clés déterministes au premier rendu (identiques côté serveur et navigateur).
    clientInitial ? (lignesParClient[clientInitial] ?? []).map((l, i) => versSaisie(l, `t${i}`)) : [],
  );
  const [objet, setObjet] = useState("");
  const [mois, setMois] = useState("");
  const [notes, setNotes] = useState("");
  const [prestationAAjouter, setPrestationAAjouter] = useState("");
  const [tentative, setTentative] = useState(false);

  const client = clients.find((c) => c.id === clientId) ?? null;
  const entite = client ? (entites.find((e) => e.id === client.entite_id) ?? null) : null;
  const catalogue = client ? (prestationsParEntite[client.entite_id] ?? []) : [];
  const plusieursEntites = new Set(clients.map((c) => c.entite_id)).size > 1;

  const totaux = lignes.map(totalSaisie);
  const lignesInvalides = lignes.filter((l, i) => l.libelle.trim() === "" || totaux[i] == null).length;
  const totalHt = totaux.reduce<number>((s, t) => s + (t ?? 0), 0);
  const taux = entite ? Number(entite.taux_tva) : 0;
  const tva = Math.round((totalHt * taux) / 100);

  function choisirClient(nouveau: string) {
    setClientId(nouveau);
    setPrestationAAjouter("");
    setLignes((lignesParClient[nouveau] ?? []).map((l) => versSaisie(l, nouvelleCle())));
  }

  function modifierLigne(cle: string, champ: keyof Omit<LigneSaisie, "cle">, valeur: string) {
    setLignes((avant) => avant.map((l) => (l.cle === cle ? { ...l, [champ]: valeur } : l)));
  }

  function retirerLigne(cle: string) {
    setLignes((avant) => avant.filter((l) => l.cle !== cle));
  }

  function ajouterPrestation() {
    const p = catalogue.find((x) => x.id === prestationAAjouter);
    if (!p) return;
    setLignes((avant) => [
      ...avant,
      versSaisie({
        prestation_id: p.id,
        libelle: p.libelle,
        description: p.description,
        quantite: 1,
        prix_unitaire_centimes: p.prix_unitaire_centimes,
      }, nouvelleCle()),
    ]);
    setPrestationAAjouter("");
  }

  function ajouterLigneLibre() {
    setLignes((avant) => [
      ...avant,
      { cle: nouvelleCle(), prestation_id: null, libelle: "", description: "", quantite: "1", prix: "" },
    ]);
  }

  function soumettre(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTentative(true);
    if (!client || lignes.length === 0 || lignesInvalides > 0) return;
    const donnees = new FormData();
    donnees.set("client_id", clientId);
    donnees.set("objet", objet);
    donnees.set("periode", mois);
    donnees.set("notes", notes);
    donnees.set(
      "lignes",
      JSON.stringify(
        lignes.map((l) => ({
          prestation_id: l.prestation_id,
          libelle: l.libelle,
          description: l.description,
          quantite: l.quantite,
          prix: l.prix,
        })),
      ),
    );
    startTransition(() => envoyer(donnees));
  }

  // Clients regroupés par entité pour la liste déroulante.
  const groupes = entites
    .map((e) => ({ entite: e, clients: clients.filter((c) => c.entite_id === e.id) }))
    .filter((g) => g.clients.length > 0);

  return (
    <form onSubmit={soumettre} className="space-y-6" noValidate>
      {/* Client et informations */}
      <section className="carte carte-corps space-y-5" aria-labelledby={`${id}-infos`}>
        <h2 id={`${id}-infos`} className="titre-section">
          Client et objet
        </h2>

        <div>
          <label htmlFor={`${id}-client`} className="label">
            Client <span className="text-red-600">*</span>
          </label>
          <select
            id={`${id}-client`}
            className="champ"
            value={clientId}
            onChange={(e) => choisirClient(e.target.value)}
            required
            aria-invalid={tentative && !client}
          >
            <option value="" disabled>
              Choisir un client…
            </option>
            {plusieursEntites
              ? groupes.map((g) => (
                  <optgroup key={g.entite.id} label={g.entite.nom}>
                    {g.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nom}
                        {c.cavaliers ? ` — ${c.cavaliers}` : ""}
                        {c.actif ? "" : " (archivé)"}
                      </option>
                    ))}
                  </optgroup>
                ))
              : clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom}
                    {c.cavaliers ? ` — ${c.cavaliers}` : ""}
                    {c.actif ? "" : " (archivé)"}
                  </option>
                ))}
          </select>
          {tentative && !client && <p className="mt-1 text-xs text-red-700">Choisissez le client à facturer.</p>}
          {client && entite && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>Facturé par</span>
              <EntiteBadge nom={entite.nom} couleur={entite.couleur_primaire} />
              <Link href={`/clients/${client.id}`} className="btn-lien text-xs">
                Voir la fiche client
              </Link>
            </div>
          )}
          {client && !client.actif && (
            <p className="avertissement mt-2">Ce client est archivé : réactivez sa fiche pour pouvoir le facturer.</p>
          )}
          {client && client.actif && !client.aDesDestinataires && (
            <p className="avertissement mt-2 flex items-start gap-2">
              <IconeAlerte className="mt-0.5 size-4 text-amber-600" />
              <span>
                Ce client n&apos;a pas d&apos;adresse e-mail : la facture pourra être émise et téléchargée, mais pas
                envoyée par e-mail.{" "}
                <Link href={`/clients/${client.id}`} className="font-medium underline">
                  Compléter la fiche
                </Link>
              </span>
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-objet`} className="label">
              Objet
            </label>
            <input
              id={`${id}-objet`}
              className="champ"
              value={objet}
              onChange={(e) => setObjet(e.target.value)}
              maxLength={200}
              placeholder="Ex. Stage de Pâques, Concours de Deauville…"
            />
          </div>
          <div>
            <label htmlFor={`${id}-periode`} className="label">
              Mois facturé <span className="font-normal text-muted">(facultatif)</span>
            </label>
            <input
              id={`${id}-periode`}
              type="month"
              className="champ"
              value={mois}
              onChange={(e) => setMois(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-notes`} className="label">
            Notes imprimées sur la facture <span className="font-normal text-muted">(facultatif)</span>
          </label>
          <textarea
            id={`${id}-notes`}
            className="champ min-h-20"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Ex. Merci d'indiquer le numéro de facture dans le libellé du virement."
          />
        </div>
      </section>

      {/* Lignes */}
      <section className="carte" aria-labelledby={`${id}-lignes`}>
        <div className="border-b border-line px-5 py-4">
          <h2 id={`${id}-lignes`} className="titre-section">
            Lignes de la facture
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {client
              ? "Pré-remplies à partir des tarifs actifs du client. Modifiez, retirez ou ajoutez des lignes."
              : "Choisissez d'abord le client : ses tarifs seront repris automatiquement."}
          </p>
        </div>

        {client && lignes.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted">
            Aucune ligne pour l&apos;instant. Ajoutez une prestation du catalogue ou une ligne libre.
          </div>
        )}

        {lignes.length > 0 && (
          <ul className="divide-y divide-line">
            <li className="hidden grid-cols-[1fr_6rem_8rem_7rem_2.5rem] gap-3 bg-page px-5 py-2 text-xs font-semibold tracking-wide text-muted uppercase md:grid">
              <span>Désignation</span>
              <span>Quantité</span>
              <span>Prix unitaire</span>
              <span className="text-right">Total HT</span>
              <span className="sr-only">Retirer</span>
            </li>
            {lignes.map((l, i) => {
              const total = totaux[i];
              const libelleManquant = tentative && l.libelle.trim() === "";
              const quantiteInvalide = (tentative || l.quantite !== "") && parseQuantite(l.quantite) == null;
              const prixInvalide = (tentative || l.prix !== "") && parseEurosEnCentimes(l.prix) == null;
              return (
                <li key={l.cle} className="grid gap-3 px-5 py-3 md:grid-cols-[1fr_6rem_8rem_7rem_2.5rem] md:items-start">
                  <div className="space-y-1.5">
                    <label className="sr-only" htmlFor={`${l.cle}-libelle`}>
                      Libellé de la ligne {i + 1}
                    </label>
                    <input
                      id={`${l.cle}-libelle`}
                      className={`champ ${libelleManquant ? "border-red-400" : ""}`}
                      value={l.libelle}
                      onChange={(e) => modifierLigne(l.cle, "libelle", e.target.value)}
                      maxLength={200}
                      placeholder="Libellé"
                      aria-invalid={libelleManquant}
                    />
                    <label className="sr-only" htmlFor={`${l.cle}-description`}>
                      Description de la ligne {i + 1}
                    </label>
                    <input
                      id={`${l.cle}-description`}
                      className="champ py-1.5 text-xs"
                      value={l.description}
                      onChange={(e) => modifierLigne(l.cle, "description", e.target.value)}
                      maxLength={1000}
                      placeholder="Description (facultatif)"
                    />
                    {l.prestation_id && <p className="text-[11px] text-muted">Prestation du catalogue</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:contents">
                    <div>
                      <label className="label text-xs md:sr-only" htmlFor={`${l.cle}-quantite`}>
                        Quantité
                      </label>
                      <input
                        id={`${l.cle}-quantite`}
                        className={`champ text-right tabular-nums ${quantiteInvalide ? "border-red-400" : ""}`}
                        value={l.quantite}
                        onChange={(e) => modifierLigne(l.cle, "quantite", e.target.value)}
                        inputMode="decimal"
                        aria-invalid={quantiteInvalide}
                      />
                    </div>
                    <div>
                      <label className="label text-xs md:sr-only" htmlFor={`${l.cle}-prix`}>
                        Prix unitaire (€)
                      </label>
                      <div className="relative">
                        <input
                          id={`${l.cle}-prix`}
                          className={`champ pr-7 text-right tabular-nums ${prixInvalide ? "border-red-400" : ""}`}
                          value={l.prix}
                          onChange={(e) => modifierLigne(l.cle, "prix", e.target.value)}
                          inputMode="decimal"
                          placeholder="0,00"
                          aria-invalid={prixInvalide}
                        />
                        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">
                          €
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between md:block md:pt-2 md:text-right">
                    <span className="text-xs text-muted md:hidden">Total HT</span>
                    <span className="font-medium tabular-nums">{total == null ? "—" : formatEuros(total)}</span>
                  </div>
                  <div className="flex justify-end md:pt-1">
                    <button
                      type="button"
                      onClick={() => retirerLigne(l.cle)}
                      className="btn-secondaire btn-petit md:border-0 md:p-1.5"
                      aria-label={`Retirer la ligne ${l.libelle || i + 1}`}
                      title="Retirer la ligne"
                    >
                      <IconeCorbeille className="size-4" />
                      <span className="md:sr-only">Retirer</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {client && (
          <div className="flex flex-col gap-3 border-t border-line bg-page/40 px-5 py-4 sm:flex-row sm:items-end">
            {catalogue.length > 0 ? (
              <div className="flex min-w-0 flex-1 gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`${id}-catalogue`} className="label text-xs">
                    Ajouter une prestation du catalogue
                  </label>
                  <select
                    id={`${id}-catalogue`}
                    className="champ"
                    value={prestationAAjouter}
                    onChange={(e) => setPrestationAAjouter(e.target.value)}
                  >
                    <option value="">Choisir une prestation…</option>
                    {catalogue.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.libelle} — {formatEuros(p.prix_unitaire_centimes)} / {p.unite}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn-secondaire self-end"
                  onClick={ajouterPrestation}
                  disabled={!prestationAAjouter}
                >
                  <IconePlus />
                  Ajouter
                </button>
              </div>
            ) : (
              <p className="flex-1 text-xs text-muted">
                Le catalogue de {entite?.nom ?? "cette entité"} est vide.{" "}
                <Link href="/prestations" className="btn-lien text-xs">
                  Gérer les prestations
                </Link>
              </p>
            )}
            <button type="button" className="btn-secondaire" onClick={ajouterLigneLibre}>
              <IconePlus />
              Ligne libre
            </button>
          </div>
        )}

        {lignes.length > 0 && (
          <dl className="space-y-1 border-t border-line px-5 py-4 text-sm sm:ml-auto sm:w-80">
            <div className="flex justify-between">
              <dt className="text-muted">Total HT</dt>
              <dd className="tabular-nums">{formatEuros(totalHt)}</dd>
            </div>
            {taux > 0 ? (
              <div className="flex justify-between">
                <dt className="text-muted">TVA {String(taux).replace(".", ",")} %</dt>
                <dd className="tabular-nums">{formatEuros(tva)}</dd>
              </div>
            ) : (
              entite?.mention_tva && <p className="text-xs text-muted">{entite.mention_tva}</p>
            )}
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
              <dt>Total TTC</dt>
              <dd className="text-brand tabular-nums">{formatEuros(totalHt + tva)}</dd>
            </div>
          </dl>
        )}
      </section>

      {tentative && client && lignes.length === 0 && (
        <p role="alert" className="erreur">
          Ajoutez au moins une ligne à la facture.
        </p>
      )}
      {tentative && lignesInvalides > 0 && (
        <p role="alert" className="erreur">
          {lignesInvalides === 1
            ? "Une ligne est incomplète : vérifiez le libellé, la quantité et le prix (surlignés en rouge)."
            : `${lignesInvalides} lignes sont incomplètes : vérifiez les libellés, quantités et prix (surlignés en rouge).`}
        </p>
      )}
      {etat && !etat.ok && (
        <p role="alert" className="erreur whitespace-pre-line">
          {etat.erreur}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Link href="/factures" className="btn-secondaire">
          Annuler
        </Link>
        <button type="submit" className="btn-primaire" disabled={enCours || (client != null && !client.actif)}>
          {enCours ? "Création…" : "Créer le brouillon"}
        </button>
      </div>
      <p className="text-right text-xs text-muted">
        Le brouillon n&apos;a pas encore de numéro : vous pourrez le relire, le modifier puis l&apos;émettre.
      </p>
    </form>
  );
}
