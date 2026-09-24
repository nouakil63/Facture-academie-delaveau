"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { creerClient, modifierClient } from "@/app/(app)/clients/actions";
import { appeler } from "@/lib/appeler";
import type { Academie, Client, ResultatAction, TypeClient } from "@/lib/types";

const CIVILITES = ["Mme", "M.", "M. et Mme"];

type AcademieOption = Pick<Academie, "id" | "nom"> & Partial<Pick<Academie, "actif">>;

/**
 * Formulaire de fiche client (création et modification).
 * Soumission via onSubmit + startTransition : les champs saisis ne sont pas
 * réinitialisés si le serveur renvoie une erreur de validation.
 */
export function FormulaireClient({
  client,
  academies,
  academieParDefaut,
}: {
  /** Absent → création. */
  client?: Client;
  /** Académies proposées : les actives (+ l'actuelle du client, même désactivée). */
  academies: AcademieOption[];
  /** Création : académie présélectionnée (celle du filtre), sinon la première. */
  academieParDefaut?: string | null;
}) {
  const creation = !client;
  const [etat, envoyer, enCours] = useActionState<ResultatAction | null, FormData>(
    (precedent, donnees) => appeler((creation ? creerClient : modifierClient)(precedent, donnees)),
    null,
  );
  const [type, setType] = useState<TypeClient>(client?.type ?? "particulier");
  const professionnel = type === "professionnel";

  const academieInitiale = client?.academie_id ?? academieParDefaut ?? academies[0]?.id ?? "";
  const civilites =
    client?.civilite && !CIVILITES.includes(client.civilite) ? [...CIVILITES, client.civilite] : CIVILITES;

  function soumettre(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const donnees = new FormData(e.currentTarget);
    startTransition(() => envoyer(donnees));
  }

  return (
    <form onSubmit={soumettre} className="space-y-8">
      {client && <input type="hidden" name="id" value={client.id} />}

      {/* Clé = date de mise à jour : après un enregistrement réussi, les champs
          reprennent les valeurs normalisées par le serveur ; après une erreur, la saisie est conservée. */}
      <div key={client?.updated_at ?? "nouveau"} className="space-y-8">
        <Section titre="Rattachement">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="academie_id" className="label">
                Académie <Obligatoire />
              </label>
              <select id="academie_id" name="academie_id" defaultValue={academieInitiale} required className="champ">
                {academies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.actif === false ? `${a.nom} (désactivée)` : a.nom}
                  </option>
                ))}
              </select>
              <p className="aide">
                {creation
                  ? "Groupe de l'élève, rappelé sur ses factures. Modifiable à tout moment."
                  : "Modifiable à tout moment. Les factures déjà émises gardent l'académie d'origine."}
              </p>
            </div>

            <fieldset>
              <legend className="label">Type de client</legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["particulier", "Particulier", "Parent, cavalier…"],
                    ["professionnel", "Professionnel", "Entreprise, sponsor…"],
                  ] as const
                ).map(([valeur, libelle, detail]) => (
                  <label
                    key={valeur}
                    className={`flex cursor-pointer flex-col rounded-lg border px-3 py-2 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-brand ${
                      type === valeur ? "border-brand bg-brand-light text-brand-dark" : "border-line hover:bg-page"
                    }`}
                  >
                    <input
                      type="radio"
                      name="type"
                      value={valeur}
                      checked={type === valeur}
                      onChange={() => setType(valeur)}
                      className="sr-only"
                    />
                    <span className="font-medium">{libelle}</span>
                    <span className="text-xs text-muted">{detail}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </Section>

        <Section titre="Identité">
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <label htmlFor="civilite" className="label">
                Civilité
              </label>
              <select id="civilite" name="civilite" defaultValue={client?.civilite ?? ""} className="champ">
                <option value="">—</option>
                {civilites.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="nom" className="label">
                Nom <Obligatoire />
              </label>
              <input
                id="nom"
                name="nom"
                required
                maxLength={120}
                defaultValue={client?.nom ?? ""}
                autoComplete="off"
                className="champ"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="prenom" className="label">
                Prénom
              </label>
              <input
                id="prenom"
                name="prenom"
                maxLength={120}
                defaultValue={client?.prenom ?? ""}
                autoComplete="off"
                className="champ"
              />
            </div>

            {professionnel && (
              <>
                <div className="sm:col-span-6">
                  <label htmlFor="raison_sociale" className="label">
                    Raison sociale <Obligatoire />
                  </label>
                  <input
                    id="raison_sociale"
                    name="raison_sociale"
                    required
                    maxLength={200}
                    defaultValue={client?.raison_sociale ?? ""}
                    className="champ"
                  />
                  <p className="aide">Nom imprimé sur la facture ; le nom et le prénom désignent le contact.</p>
                </div>
                <div className="sm:col-span-3">
                  <label htmlFor="siret" className="label">
                    SIRET
                  </label>
                  <input
                    id="siret"
                    name="siret"
                    inputMode="numeric"
                    maxLength={20}
                    placeholder="14 chiffres"
                    defaultValue={client?.siret ?? ""}
                    className="champ"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label htmlFor="numero_tva" className="label">
                    N° de TVA intracommunautaire
                  </label>
                  <input
                    id="numero_tva"
                    name="numero_tva"
                    maxLength={20}
                    placeholder="FR12345678901"
                    defaultValue={client?.numero_tva ?? ""}
                    className="champ"
                  />
                </div>
              </>
            )}
          </div>
        </Section>

        <Section titre="Contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="email" className="label">
                E-mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                maxLength={254}
                defaultValue={client?.email ?? ""}
                autoComplete="off"
                className="champ"
              />
              <p className="aide">Adresse à laquelle les factures sont envoyées.</p>
            </div>
            <div>
              <label htmlFor="telephone" className="label">
                Téléphone
              </label>
              <input
                id="telephone"
                name="telephone"
                type="tel"
                maxLength={40}
                defaultValue={client?.telephone ?? ""}
                autoComplete="off"
                className="champ"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="emails_cc" className="label">
                E-mails en copie
              </label>
              <input
                id="emails_cc"
                name="emails_cc"
                defaultValue={client?.emails_cc?.join(", ") ?? ""}
                placeholder="autre.parent@exemple.fr, comptabilite@exemple.fr"
                autoComplete="off"
                className="champ"
              />
              <p className="aide">Séparez les adresses par des virgules. Elles reçoivent aussi chaque facture.</p>
            </div>
          </div>
        </Section>

        <Section titre="Adresse de facturation">
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="sm:col-span-6">
              <label htmlFor="adresse_ligne1" className="label">
                Adresse {professionnel && <Obligatoire />}
              </label>
              <input
                id="adresse_ligne1"
                name="adresse_ligne1"
                required={professionnel}
                maxLength={200}
                defaultValue={client?.adresse_ligne1 ?? ""}
                className="champ"
              />
            </div>
            <div className="sm:col-span-6">
              <label htmlFor="adresse_ligne2" className="label">
                Complément d&apos;adresse
              </label>
              <input
                id="adresse_ligne2"
                name="adresse_ligne2"
                maxLength={200}
                defaultValue={client?.adresse_ligne2 ?? ""}
                className="champ"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="code_postal" className="label">
                Code postal {professionnel && <Obligatoire />}
              </label>
              <input
                id="code_postal"
                name="code_postal"
                required={professionnel}
                maxLength={12}
                defaultValue={client?.code_postal ?? ""}
                className="champ"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="ville" className="label">
                Ville {professionnel && <Obligatoire />}
              </label>
              <input
                id="ville"
                name="ville"
                required={professionnel}
                maxLength={120}
                defaultValue={client?.ville ?? ""}
                className="champ"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="pays" className="label">
                Pays
              </label>
              <input id="pays" name="pays" maxLength={80} defaultValue={client?.pays ?? "France"} className="champ" />
            </div>
          </div>
        </Section>

        <Section titre="Facturation">
          <div className="grid gap-4">
            <div>
              <label htmlFor="cavaliers" className="label">
                Cavalier(s) concerné(s)
              </label>
              <input
                id="cavaliers"
                name="cavaliers"
                maxLength={300}
                defaultValue={client?.cavaliers ?? ""}
                placeholder="Ex. Léa et Hugo Martin"
                className="champ"
              />
              <p className="aide">Imprimé sur chaque facture de ce client.</p>
            </div>
            <div>
              <label htmlFor="notes" className="label">
                Notes internes
              </label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                maxLength={4000}
                defaultValue={client?.notes ?? ""}
                className="champ"
              />
              <p className="aide">Visibles uniquement dans l&apos;application, jamais imprimées.</p>
            </div>
          </div>
        </Section>
      </div>

      <div className="space-y-3 border-t border-line pt-5">
        {etat && !etat.ok && (
          <p role="alert" className="erreur whitespace-pre-line">
            {etat.erreur}
          </p>
        )}
        {etat?.ok && etat.message && (
          <p role="status" className="succes">
            {etat.message}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {creation && (
            <Link href="/clients" className="btn-secondaire">
              Annuler
            </Link>
          )}
          <button type="submit" className="btn-primaire" disabled={enCours}>
            {enCours ? "Enregistrement…" : creation ? "Créer le client" : "Enregistrer les modifications"}
          </button>
        </div>
      </div>
    </form>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{titre}</legend>
      {children}
    </fieldset>
  );
}

function Obligatoire() {
  return (
    <span className="text-red-600" aria-hidden="true">
      *
    </span>
  );
}
