"use client";

import Image from "next/image";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { enregistrerParametres } from "@/app/(app)/parametres/actions";
import { appeler } from "@/lib/appeler";
import {
  datesGeneration,
  formatDate,
  formatDateLongue,
  formatPeriode,
  nomCourtAcademie,
  pluriel,
  premierDuMois,
} from "@/lib/format";
import type { Academie, MoisFacture, Parametres, ResultatAction } from "@/lib/types";
import { IconeAlerte, IconeCadenas, IconeCoche, IconeInfo } from "@/components/Icones";
import { ChampCouleur, Champ, ChampControle, contrasteAvecBlanc, Obligatoire, Section, ZoneTexte } from "./Champs";
import {
  bicValide,
  erreurIban,
  erreurSiren,
  erreurSiret,
  formaterIban,
  formaterSiren,
  formaterSiret,
  normaliserBic,
  normaliserCouleur,
  normaliserRna,
  rnaValide,
} from "./controles";
import { apercuModele, VARIABLES_AVIS, VARIABLES_EMAIL, variablesInconnues } from "./modeles-email";
import { titreSection } from "./sections";

const MENTIONS_TVA = [
  "TVA non applicable, art. 293 B du CGI",
  "Exonération de TVA, art. 261-7-1° du CGI",
] as const;

const FORMES_JURIDIQUES = ["Association déclarée", "Association loi 1901", "SAS", "SASU", "SARL", "EURL", "Entreprise individuelle"];

type Contexte = {
  parametres: Parametres;
  /** Des numéros ont déjà été attribués : le préfixe est figé. */
  prefixeVerrouille: boolean;
  /** Dernier numéro attribué (« AD-2026-0012 »), s'il existe. */
  dernierNumero: string | null;
  /** Prochain numéro qui sera attribué (« AD-2026-0013 »). */
  prochainNumero: string;
  /** Date du jour à Paris ("AAAA-MM-JJ"), calculée côté serveur. */
  aujourdhui: string;
  /** Variables SMTP présentes. */
  smtpConfigure: boolean;
  /** Clients actifs (toutes académies) en envoi automatique. */
  nbClientsEnvoiAuto: number;
  /** Parmi eux, ceux sans adresse e-mail (envoi voué à l'échec). */
  nbClientsAutoSansEmail: number;
  /** Académies actives, pour l'aperçu de l'e-mail ({academie}). */
  academies: Pick<Academie, "id" | "nom">[];
  onModifie: () => void;
};

/**
 * Formulaire unique des paramètres de l'association (ligne `parametres`), en sections.
 * Soumission via onSubmit + startTransition (les saisies sont conservées en cas d'erreur) ;
 * après enregistrement, le formulaire est remonté avec les valeurs normalisées par le serveur.
 */
export function FormulaireParametres(props: Omit<Contexte, "onModifie">) {
  const { parametres } = props;
  const [modifie, setModifie] = useState(false);
  const [etat, envoyer, enCours] = useActionState<ResultatAction | null, FormData>(async (precedent, donnees) => {
    const resultat = await appeler(enregistrerParametres(precedent, donnees));
    if (resultat.ok) setModifie(false);
    return resultat;
  }, null);
  const refErreur = useRef<HTMLDivElement>(null);

  // Erreur renvoyée par le serveur : on l'amène à l'écran.
  useEffect(() => {
    if (etat && !etat.ok) refErreur.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [etat]);

  // Quitter la page avec des modifications non enregistrées : confirmation. `beforeunload` couvre
  // le rechargement et la fermeture de l'onglet ; les liens internes (barre latérale, menu mobile)
  // naviguent sans décharger la page : leurs clics sont interceptés avant ceux de Next (capture).
  useEffect(() => {
    if (!modifie) return;
    const avertir = (e: BeforeUnloadEvent) => e.preventDefault();
    const garder = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const lien = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(lien instanceof HTMLAnchorElement) || lien.target === "_blank" || lien.hasAttribute("download")) return;
      const url = new URL(lien.href, window.location.href);
      // Ancres de la page (navigation des sections) : on reste sur le formulaire.
      if (url.origin === window.location.origin && url.pathname === window.location.pathname) return;
      if (!window.confirm("Modifications non enregistrées. Quitter quand même ?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", avertir);
    document.addEventListener("click", garder, true);
    return () => {
      window.removeEventListener("beforeunload", avertir);
      document.removeEventListener("click", garder, true);
    };
  }, [modifie]);

  function soumettre(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const donnees = new FormData(e.currentTarget);
    startTransition(() => envoyer(donnees));
  }

  const contexte: Contexte = { ...props, onModifie: () => setModifie(true) };

  return (
    // Remonté à chaque enregistrement (updated_at change) : affiche les valeurs normalisées.
    <form key={parametres.updated_at} onSubmit={soumettre} onChange={() => setModifie(true)} className="min-w-0 space-y-6">
      <SectionCharte {...contexte} />
      <SectionLegale {...contexte} />
      <SectionCoordonnees {...contexte} />
      <SectionPaiement {...contexte} />
      <SectionTva {...contexte} />
      <SectionMensuelle {...contexte} />
      <SectionEmails {...contexte} />

      {etat && !etat.ok && (
        <div ref={refErreur} role="alert" className="erreur">
          <p className="font-medium">L&apos;enregistrement a échoué :</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {etat.erreur.split("\n").map((ligne) => (
              <li key={ligne}>{ligne}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="carte sticky bottom-4 z-10 flex flex-col gap-3 px-4 py-3 shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm" aria-live="polite">
          {enCours ? (
            <span className="text-muted">Enregistrement en cours…</span>
          ) : modifie ? (
            <span className="inline-flex items-center gap-2 font-medium text-amber-800">
              <span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />
              Modifications non enregistrées
            </span>
          ) : etat?.ok ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
              <IconeCoche />
              {etat.message ?? "Paramètres enregistrés."}
            </span>
          ) : (
            <span className="text-muted">Dernière modification le {formatDate(parametres.updated_at)}</span>
          )}
        </p>
        <button type="submit" className="btn-primaire" disabled={enCours}>
          {enCours ? "Enregistrement…" : "Enregistrer les paramètres"}
        </button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Charte et numérotation
// -----------------------------------------------------------------------------

function SectionCharte({ parametres, prefixeVerrouille, dernierNumero, prochainNumero, aujourdhui }: Contexte) {
  const [prefixe, setPrefixe] = useState(parametres.prefixe_facture);
  const [primaire, setPrimaire] = useState(parametres.couleur_primaire.toUpperCase());
  const [secondaire, setSecondaire] = useState(parametres.couleur_secondaire.toUpperCase());
  const [logo, setLogo] = useState(parametres.logo_url ?? "");

  const prefixeAffiche = prefixeVerrouille ? parametres.prefixe_facture : prefixe.trim().toUpperCase() || "??";
  // Tant que le préfixe est libre, aucun numéro n'a été attribué : la série démarre à 0001.
  const numeroExemple = prefixeVerrouille ? prochainNumero : `${prefixeAffiche}-${aujourdhui.slice(0, 4)}-0001`;
  const couleurPrimaire = normaliserCouleur(primaire) ?? parametres.couleur_primaire;
  const couleurSecondaire = normaliserCouleur(secondaire) ?? parametres.couleur_secondaire;
  const peuContrastee = contrasteAvecBlanc(couleurPrimaire) < 3;
  const logoUrl = logo.trim();

  return (
    <Section
      id="charte"
      titre={titreSection("charte")}
      description="Numérotation des factures, couleurs et logo. Une seule série de numéros pour les deux académies."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="prefixe_facture" className="label">
            Préfixe des numéros de facture
            {!prefixeVerrouille && <Obligatoire />}
          </label>
          <div className="relative">
            <input
              id="prefixe_facture"
              name={prefixeVerrouille ? undefined : "prefixe_facture"}
              value={prefixeVerrouille ? parametres.prefixe_facture : prefixe}
              onChange={(e) => setPrefixe(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              disabled={prefixeVerrouille}
              required={!prefixeVerrouille}
              minLength={1}
              maxLength={8}
              pattern="[A-Za-z0-9]{1,8}"
              title="1 à 8 lettres majuscules ou chiffres"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="prefixe-aide"
              className={`champ font-mono tracking-wider uppercase ${prefixeVerrouille ? "pr-9" : ""}`}
            />
            {prefixeVerrouille && (
              <IconeCadenas className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
            )}
          </div>
          <p id="prefixe-aide" className="aide">
            {prefixeVerrouille ? (
              <>
                Bloqué : des factures portent déjà ce préfixe, et la série doit rester continue, sans trou ni
                doublon.
              </>
            ) : (
              <>1 à 8 lettres ou chiffres, sans espace ni tiret. Bloqué dès la première facture émise.</>
            )}
          </p>
        </div>

        <div className="rounded-lg border border-line bg-page/60 px-4 py-3 text-sm">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Numérotation</p>
          <dl className="mt-1.5 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted">Prochain numéro</dt>
            <dd className="font-mono font-medium text-ink">{numeroExemple}</dd>
            <dt className="text-muted">Dernier émis</dt>
            <dd className="font-mono text-ink">{dernierNumero ?? <span className="font-sans text-muted">aucun</span>}</dd>
          </dl>
          <p className="mt-2 text-xs text-muted">
            Une série continue par année, commune à l&apos;Académie Delaveau et à l&apos;Académie Espoir.
          </p>
        </div>

        <ChampCouleur
          nom="couleur_primaire"
          libelle="Couleur principale"
          valeur={primaire}
          onChange={setPrimaire}
          aide={
            peuContrastee ? (
              <span className="text-amber-800">Couleur trop claire : le texte blanc des en-têtes sera difficile à lire.</span>
            ) : (
              "Titres et en-têtes de tableau des factures."
            )
          }
        />
        <ChampCouleur
          nom="couleur_secondaire"
          libelle="Couleur secondaire"
          valeur={secondaire}
          onChange={setSecondaire}
          aide="Filets et fonds discrets."
        />
      </div>

      {/* Aperçu de la charte */}
      <div className="overflow-hidden rounded-lg border border-line" aria-hidden="true">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ backgroundColor: couleurPrimaire }}>
          <span className="font-display text-sm font-medium tracking-wider text-white uppercase">Facture</span>
          <span className="font-mono text-xs text-white/90">{numeroExemple}</span>
        </div>
        <div
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-xs text-muted"
          style={{ borderTop: `3px solid ${couleurSecondaire}` }}
        >
          <span>Aperçu des couleurs</span>
          <span className="font-mono">
            {couleurPrimaire} · {couleurSecondaire}
          </span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div>
          <label htmlFor="logo_url" className="label">
            URL du logo
          </label>
          <input
            id="logo_url"
            name="logo_url"
            type="url"
            value={logo}
            onChange={(e) => setLogo(e.target.value)}
            maxLength={1000}
            placeholder="https://…/logo.png"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="logo-aide"
            className="champ"
          />
          <p id="logo-aide" className="aide">
            Facultatif. Image PNG ou JPEG accessible publiquement. Vide : logo Académie Delaveau intégré.
          </p>
        </div>
        <div className="flex h-20 w-40 items-center justify-center rounded-lg border border-line bg-white p-2">
          {logoUrl ? (
            // Adresse externe quelconque : next/image exigerait de déclarer chaque domaine.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Aperçu du logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <Image
              src="/brand/logo-delaveau-fond-clair.png"
              alt="Logo intégré de l'Académie Delaveau"
              width={140}
              height={58}
              className="h-auto max-h-full w-auto"
            />
          )}
        </div>
      </div>
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Informations légales
// -----------------------------------------------------------------------------

function SectionLegale({ parametres }: Contexte) {
  return (
    <Section
      id="legal"
      titre={titreSection("legal")}
      description="Imprimées en haut et en bas de chaque facture, quelle que soit l'académie du client."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ
          nom="raison_sociale"
          libelle="Raison sociale"
          defaut={parametres.raison_sociale}
          obligatoire
          maxLength={200}
          aide="Nom officiel de l'association, tel que déclaré."
        />
        <Champ
          nom="forme_juridique"
          libelle="Forme juridique"
          defaut={parametres.forme_juridique}
          maxLength={100}
          list="formes-juridiques"
          placeholder="Association déclarée"
        />
        <datalist id="formes-juridiques">
          {FORMES_JURIDIQUES.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>

        <ChampControle
          nom="siren"
          libelle="SIREN"
          defaut={parametres.siren}
          controle={erreurSiren}
          formater={formaterSiren}
          placeholder="853 472 298"
          inputMode="numeric"
          maxLength={15}
          aide="9 chiffres, sur l'avis de situation Insee."
        />
        <ChampControle
          nom="siret"
          libelle="SIRET"
          defaut={parametres.siret}
          controle={erreurSiret}
          formater={formaterSiret}
          placeholder="853 472 298 00019"
          inputMode="numeric"
          maxLength={20}
          aide="14 chiffres : SIREN + numéro d'établissement."
        />
        <ChampControle
          nom="rna"
          libelle="N° RNA"
          defaut={parametres.rna}
          controle={(v) => (rnaValide(v) ? null : "Numéro RNA invalide : « W » suivi de 9 caractères.")}
          formater={normaliserRna}
          placeholder="W143007272"
          maxLength={12}
          aide="Numéro au Répertoire national des associations (commence par W)."
        />
        <Champ
          nom="numero_tva"
          libelle="N° de TVA intracommunautaire"
          defaut={parametres.numero_tva}
          maxLength={20}
          placeholder="FR12853472298"
          spellCheck={false}
          className="font-mono tracking-wide uppercase"
          aide="Seulement en cas d'assujettissement à la TVA. Sinon, laisser vide."
        />
        <ZoneTexte
          nom="objet_social"
          libelle="Objet social"
          defaut={parametres.objet_social}
          maxLength={500}
          rows={2}
          classeConteneur="sm:col-span-2"
        />
      </div>
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Coordonnées
// -----------------------------------------------------------------------------

function SectionCoordonnees({ parametres }: Contexte) {
  return (
    <Section id="coordonnees" titre={titreSection("coordonnees")} description="Adresse et contacts, imprimés sur les factures.">
      <div className="grid gap-4 sm:grid-cols-6">
        <Champ
          nom="adresse_ligne1"
          libelle="Adresse"
          defaut={parametres.adresse_ligne1}
          maxLength={200}
          autoComplete="address-line1"
          classeConteneur="sm:col-span-6"
        />
        <Champ
          nom="adresse_ligne2"
          libelle="Complément d'adresse"
          defaut={parametres.adresse_ligne2}
          maxLength={200}
          autoComplete="address-line2"
          classeConteneur="sm:col-span-6"
        />
        <Champ
          nom="code_postal"
          libelle="Code postal"
          defaut={parametres.code_postal}
          maxLength={12}
          inputMode="numeric"
          autoComplete="postal-code"
          classeConteneur="sm:col-span-2"
        />
        <Champ
          nom="ville"
          libelle="Ville"
          defaut={parametres.ville}
          maxLength={120}
          autoComplete="address-level2"
          classeConteneur="sm:col-span-2"
        />
        <Champ
          nom="pays"
          libelle="Pays"
          defaut={parametres.pays}
          maxLength={80}
          placeholder="France"
          autoComplete="country-name"
          classeConteneur="sm:col-span-2"
        />
        <Champ
          nom="email_contact"
          libelle="E-mail de contact"
          type="email"
          defaut={parametres.email_contact}
          maxLength={254}
          autoComplete="email"
          placeholder="contact@academiedelaveau.com"
          classeConteneur="sm:col-span-3"
          aide="Imprimé sur la facture : adresse à laquelle les familles écrivent en cas de question."
        />
        <Champ
          nom="telephone"
          libelle="Téléphone"
          type="tel"
          defaut={parametres.telephone}
          maxLength={40}
          autoComplete="tel"
          classeConteneur="sm:col-span-3"
        />
        <Champ
          nom="site_web"
          libelle="Site web"
          defaut={parametres.site_web}
          maxLength={200}
          placeholder="www.academiedelaveau.com"
          spellCheck={false}
          classeConteneur="sm:col-span-6"
        />
      </div>
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Paiement
// -----------------------------------------------------------------------------

function SectionPaiement({ parametres }: Contexte) {
  return (
    <Section
      id="paiement"
      titre={titreSection("paiement")}
      description="Coordonnées bancaires et conditions de règlement, identiques pour les deux académies."
    >
      {/* L'IBAN est l'information la plus importante pour être payé : mis en avant. */}
      <div className="space-y-4 rounded-lg border-2 border-brand/30 bg-brand-light/50 p-4">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-brand-dark">
          <span className="badge bg-brand text-white">Important</span>
          IBAN imprimé sur toutes les factures
        </p>
        <ChampControle
          nom="iban"
          libelle="IBAN"
          defaut={parametres.iban}
          controle={erreurIban}
          formater={formaterIban}
          placeholder="FR76 3000 6000 0112 3456 7890 189"
          maxLength={50}
          classeChamp="py-2.5 text-base"
          messageValide="IBAN valide (clé de contrôle vérifiée)."
          aide="IBAN du compte, avec ou sans espaces (vérifié puis regroupé par 4). À contrôler avec le RIB."
        />
        {!parametres.iban && (
          <p className="avertissement flex items-start gap-2">
            <IconeAlerte className="mt-0.5 size-4 shrink-0" />
            <span>
              Aucun IBAN : les factures n&apos;indiqueront pas aux familles où faire le virement.
            </span>
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-6">
          <Champ
            nom="titulaire_compte"
            libelle="Titulaire du compte"
            defaut={parametres.titulaire_compte}
            maxLength={200}
            placeholder={parametres.raison_sociale}
            classeConteneur="sm:col-span-4"
            aide="Facultatif. Imprimé avec l'IBAN (ex. Académie Delaveau)."
          />
          <ChampControle
            nom="bic"
            libelle="BIC"
            defaut={parametres.bic}
            controle={(v) => (bicValide(v) ? null : "BIC invalide : 8 ou 11 caractères (ex. AGRIFRPP866).")}
            formater={normaliserBic}
            placeholder="AGRIFRPP866"
            maxLength={15}
            classeConteneur="sm:col-span-2"
            messageValide="BIC valide."
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-6">
        <ZoneTexte
          nom="conditions_paiement"
          libelle="Conditions de paiement"
          defaut={parametres.conditions_paiement}
          obligatoire
          maxLength={500}
          rows={2}
          classeConteneur="sm:col-span-4"
          aide="Exemple : « Paiement par virement bancaire au plus tard à la date d'échéance. »"
        />
        <Champ
          nom="delai_paiement_jours"
          libelle="Délai de paiement (jours)"
          type="number"
          min={0}
          max={90}
          step={1}
          inputMode="numeric"
          defaut={parametres.delai_paiement_jours}
          obligatoire
          classeConteneur="sm:col-span-2"
          aide="Échéance = date d'émission + ce délai. 0 pour « à réception »."
        />
      </div>
    </Section>
  );
}

// -----------------------------------------------------------------------------
// TVA et mentions
// -----------------------------------------------------------------------------

function SectionTva({ parametres, onModifie }: Contexte) {
  const [taux, setTaux] = useState(String(parametres.taux_tva).replace(".", ","));
  const [mention, setMention] = useState(parametres.mention_tva ?? "");

  const tauxNombre = Number(taux.replace(/[\s%]/g, "").replace(",", "."));
  const sansTva = taux.trim() !== "" && tauxNombre === 0;
  const mentionExoneration = /non applicable|exon[ée]ration|franchise/i.test(mention);

  return (
    <Section
      id="tva"
      titre={titreSection("tva")}
      description="Régime de TVA et mentions obligatoires imprimées sur la facture."
    >
      <div className="grid gap-4 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label htmlFor="taux_tva" className="label">
            Taux de TVA
            <Obligatoire />
          </label>
          <div className="relative">
            <input
              id="taux_tva"
              name="taux_tva"
              value={taux}
              onChange={(e) => setTaux(e.target.value)}
              required
              inputMode="decimal"
              maxLength={6}
              pattern="\s*\d{1,2}([.,]\d{1,2})?\s*%?\s*"
              title="Pourcentage entre 0 et 99,99"
              autoComplete="off"
              className="champ pr-8 text-right tabular-nums"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">%</span>
          </div>
          <p className="aide">0 si aucune TVA n&apos;est facturée (association non assujettie).</p>
        </div>

        <div className="sm:col-span-4">
          <label htmlFor="mention_tva" className="label">
            Mention TVA
            {sansTva && <Obligatoire />}
          </label>
          <input
            id="mention_tva"
            name="mention_tva"
            value={mention}
            onChange={(e) => setMention(e.target.value)}
            required={sansTva}
            maxLength={300}
            className="champ"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MENTIONS_TVA.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMention(m);
                  onModifie();
                }}
                className={`rounded-full border px-2.5 py-1 text-left text-xs transition-colors ${
                  mention === m ? "border-brand bg-brand-light text-brand-dark" : "border-line text-muted hover:bg-page hover:text-ink"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="flex items-start gap-2 rounded-lg bg-page px-3 py-2 text-xs text-muted">
        <IconeInfo className="mt-0.5 size-4 shrink-0 text-brand" />
        <span>
          Association non assujettie : faire valider la mention exacte par le comptable. Exemples : « TVA non
          applicable, art. 293 B du CGI » (franchise en base) ou « Exonération de TVA, art. 261-7-1° du CGI »
          (activités d&apos;une association à but non lucratif).
        </span>
      </p>

      {sansTva && mention.trim() === "" && (
        <p className="avertissement">Sans TVA, la facture doit porter une mention justificative : en choisir une ci-dessus.</p>
      )}
      {!sansTva && tauxNombre > 0 && mentionExoneration && (
        <p className="avertissement">
          Mention d&apos;exonération incompatible avec un taux de {taux.trim()} % : choisir l&apos;un ou l&apos;autre.
        </p>
      )}

      <ZoneTexte
        nom="mentions_legales"
        libelle="Mentions légales (pied de page)"
        defaut={parametres.mentions_legales}
        maxLength={1500}
        rows={2}
        aide="Texte libre imprimé en bas de chaque facture (ex. assurance, agrément, numéro de déclaration)."
      />
      <ZoneTexte
        nom="mentions_professionnels"
        libelle="Mentions pour les clients professionnels"
        defaut={parametres.mentions_professionnels}
        maxLength={1500}
        rows={3}
        aide="Imprimées seulement sur les factures des clients professionnels. Obligatoires entre professionnels : taux des pénalités de retard et indemnité forfaitaire de 40 € pour frais de recouvrement."
      />
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Année scolaire et avis (ancre #mensuelle conservée)
// -----------------------------------------------------------------------------

function SectionMensuelle({ parametres, aujourdhui, smtpConfigure, nbClientsEnvoiAuto, nbClientsAutoSansEmail }: Contexte) {
  const [objet, setObjet] = useState(parametres.objet_facture_mensuelle);
  const [jour, setJour] = useState(String(parametres.jour_generation));
  const [mois, setMois] = useState<MoisFacture>(parametres.mois_facture);
  const envoiAuto = nbClientsEnvoiAuto > 0;

  const jourNombre = Number(jour);
  const jourValide = Number.isInteger(jourNombre) && jourNombre >= 1 && jourNombre <= 28;
  const dateEnvoi = jourValide ? datesGeneration(jourNombre, aujourdhui).prochaine : null;
  const periode = dateEnvoi ? premierDuMois(dateEnvoi, mois === "precedent" ? -1 : 0) : null;
  const avecAvis = periode ? !["07", "08"].includes(periode.slice(5, 7)) : true;
  const [a] = aujourdhui.split("-").map(Number);
  const saison = Number(aujourdhui.slice(5, 7)) >= 7 ? a : a - 1;
  const objetExemple = `${objet.trim() || "…"} – saison ${saison}-${saison + 1}`;

  return (
    <Section
      id="mensuelle"
      titre={titreSection("mensuelle")}
      description="Une facture annuelle par élève (émise à la rentrée), puis un avis d'échéance chaque mois de septembre à juin."
    >
      <div>
        <label htmlFor="objet_facture_mensuelle" className="label">
          Objet des factures annuelles
          <Obligatoire />
        </label>
        <input
          id="objet_facture_mensuelle"
          name="objet_facture_mensuelle"
          value={objet}
          onChange={(e) => setObjet(e.target.value)}
          required
          maxLength={150}
          placeholder="Formation et accompagnement"
          className="champ"
        />
        <p className="aide">
          Année scolaire ajoutée automatiquement : <span className="font-medium text-ink">« {objetExemple} »</span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="jour_generation" className="label">
            Jour d&apos;envoi des avis
            <Obligatoire />
          </label>
          <input
            id="jour_generation"
            name="jour_generation"
            type="number"
            min={1}
            max={28}
            step={1}
            inputMode="numeric"
            required
            value={jour}
            onChange={(e) => setJour(e.target.value)}
            className="champ"
          />
          <p className="aide">
            Entre 1 et 28. Date limite de chaque échéance : ce jour + délai de paiement (section Paiement), fixée à
            l&apos;émission de la facture annuelle.
          </p>
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="label">Avis envoyé ce jour-là</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["courant", "Échéance du mois en cours", "Le 1er octobre → avis d'octobre (à échoir)."],
                ["precedent", "Échéance du mois précédent", "Le 1er octobre → avis de septembre (échu)."],
              ] as const
            ).map(([valeur, libelle, detail]) => (
              <label
                key={valeur}
                className={`flex cursor-pointer flex-col rounded-lg border px-3 py-2 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-brand ${
                  mois === valeur ? "border-brand bg-brand-light text-brand-dark" : "border-line hover:bg-page"
                }`}
              >
                <input
                  type="radio"
                  name="mois_facture"
                  value={valeur}
                  checked={mois === valeur}
                  onChange={() => setMois(valeur)}
                  className="sr-only"
                />
                <span className="font-medium">{libelle}</span>
                <span className="text-xs text-muted">{detail}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="space-y-3">
        <div
          className={`rounded-lg border px-3 py-3 text-sm ${envoiAuto ? "border-brand/40 bg-brand-light/40" : "border-line"}`}
        >
          <p className="font-medium text-ink">Envoi automatique des avis : réglé client par client</p>
          <p className="mt-0.5 text-muted">
            Case « Envoyer ses avis d&apos;échéance automatiquement » sur la fiche client. Le jour d&apos;envoi (vers 7 h –
            8 h, heure de Paris), l&apos;avis du mois des clients cochés part sans relecture, s&apos;il n&apos;est ni déjà
            envoyé ni réglé. Récapitulatif ensuite envoyé aux utilisateurs de l&apos;application, avec les clients sans
            facture annuelle émise. Les factures annuelles, elles, ne sont jamais émises automatiquement.
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={envoiAuto ? "font-medium text-brand-dark" : "text-muted"}>
              {envoiAuto
                ? `${pluriel(nbClientsEnvoiAuto, "client actif", "clients actifs")} en envoi automatique`
                : "Aucun client en envoi automatique"}
            </span>
            <Link href="/clients" className="btn-lien text-sm">
              Voir les clients
            </Link>
          </p>
        </div>

        {envoiAuto && (!smtpConfigure || nbClientsAutoSansEmail > 0) && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <IconeAlerte className="mt-0.5 size-4 shrink-0 text-red-600" />
            <div className="space-y-1">
              {!smtpConfigure && (
                <p className="font-medium">Envoi d&apos;e-mails non configuré : avis automatiques impossibles à envoyer.</p>
              )}
              {nbClientsAutoSansEmail > 0 && (
                <p>
                  {nbClientsAutoSansEmail > 1
                    ? `${nbClientsAutoSansEmail} clients en envoi automatique sans adresse e-mail : leur envoi échouera.`
                    : "1 client en envoi automatique sans adresse e-mail : son envoi échouera."}
                </p>
              )}
            </div>
          </div>
        )}

        {envoiAuto && dateEnvoi && periode && (
          <p className="flex items-start gap-2 text-sm text-muted">
            <IconeInfo className="mt-0.5 size-4 shrink-0 text-brand" />
            <span>
              Prochain envoi : <span className="font-medium text-ink">{formatDateLongue(dateEnvoi)}</span>
              {avecAvis
                ? `, avis de ${formatPeriode(periode)} pour ${pluriel(nbClientsEnvoiAuto, "client")}.`
                : " : juillet/août, aucun avis."}
            </span>
          </p>
        )}
      </div>
    </Section>
  );
}

// -----------------------------------------------------------------------------
// E-mails
// -----------------------------------------------------------------------------

function SectionEmails({ parametres, aujourdhui, prochainNumero, academies, onModifie }: Contexte) {
  const [objet, setObjet] = useState(parametres.email_objet);
  const [corps, setCorps] = useState(parametres.email_corps);
  const [academieApercu, setAcademieApercu] = useState(academies[0]?.id ?? "");
  const refObjet = useRef<HTMLInputElement>(null);
  const refCorps = useRef<HTMLTextAreaElement>(null);
  const dernierChamp = useRef<"objet" | "corps">("corps");

  const inconnuesObjet = variablesInconnues(objet);
  const inconnuesCorps = variablesInconnues(corps);

  // Valeurs d'exemple cohérentes avec les paramètres enregistrés.
  const [a, m, j] = aujourdhui.split("-").map(Number);
  const echeance = new Date(Date.UTC(a, m - 1, j + parametres.delai_paiement_jours)).toISOString().slice(0, 10);
  // Exemple : facture annuelle de la saison en cours.
  const saison = m >= 7 ? a : a - 1;
  const periode = `${saison}-${saison + 1}`;
  const academie = academies.find((x) => x.id === academieApercu) ?? academies[0];
  const exemples = {
    numero: prochainNumero,
    echeance: formatDate(echeance),
    periode,
    structure: parametres.raison_sociale,
    academie: academie?.nom ?? "Académie Delaveau",
    objet: `${parametres.objet_facture_mensuelle} – saison ${periode}`,
  };

  /** Insère « {variable} » à la position du curseur dans le dernier champ utilisé. */
  function inserer(variable: string) {
    const cible = dernierChamp.current === "objet" ? refObjet.current : refCorps.current;
    if (!cible) return;
    const texte = `{${variable}}`;
    const debut = cible.selectionStart ?? cible.value.length;
    const fin = cible.selectionEnd ?? cible.value.length;
    const nouvelle = cible.value.slice(0, debut) + texte + cible.value.slice(fin);
    if (dernierChamp.current === "objet") setObjet(nouvelle);
    else setCorps(nouvelle);
    onModifie();
    requestAnimationFrame(() => {
      cible.focus();
      cible.setSelectionRange(debut + texte.length, debut + texte.length);
    });
  }

  return (
    <Section
      id="emails"
      titre={titreSection("emails")}
      description="Messages envoyés avec chaque facture et chaque avis d'échéance (PDF joint automatiquement). Identiques pour les deux académies."
    >
      <div>
        <label htmlFor="email_objet" className="label">
          Objet de l&apos;e-mail
          <Obligatoire />
        </label>
        <input
          ref={refObjet}
          id="email_objet"
          name="email_objet"
          value={objet}
          onChange={(e) => setObjet(e.target.value)}
          onFocus={() => {
            dernierChamp.current = "objet";
          }}
          required
          maxLength={200}
          className="champ"
        />
        {inconnuesObjet.length > 0 && <VariablesInconnues noms={inconnuesObjet} />}
      </div>

      <div>
        <label htmlFor="email_corps" className="label">
          Message
          <Obligatoire />
        </label>
        <textarea
          ref={refCorps}
          id="email_corps"
          name="email_corps"
          value={corps}
          onChange={(e) => setCorps(e.target.value)}
          onFocus={() => {
            dernierChamp.current = "corps";
          }}
          required
          rows={8}
          maxLength={5000}
          className="champ"
        />
        {inconnuesCorps.length > 0 && <VariablesInconnues noms={inconnuesCorps} />}
      </div>

      <div className="rounded-lg border border-line bg-page/60 p-3">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Variables disponibles</p>
        <p className="mt-0.5 text-xs text-muted">
          Cliquer pour insérer à l&apos;emplacement du curseur. Remplacées à l&apos;envoi de chaque facture.
        </p>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {VARIABLES_EMAIL.map((v) => (
            <li key={v.nom} className="flex items-center gap-2 text-sm">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => inserer(v.nom)}
                className="shrink-0 rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-xs text-brand hover:border-brand hover:bg-brand-light"
                aria-label={`Insérer la variable ${v.nom} (${v.description})`}
              >
                {`{${v.nom}}`}
              </button>
              <span className="min-w-0 text-muted">{v.description}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <p className="label mb-0">Aperçu</p>
          {academies.length > 1 && (
            <div role="group" aria-label="Académie du client dans l'aperçu" className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-muted">Client de :</span>
              {academies.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={x.id === academie?.id}
                  onClick={() => setAcademieApercu(x.id)}
                  className={`rounded-full border px-2.5 py-0.5 transition-colors ${
                    x.id === academie?.id
                      ? "border-brand bg-brand-light text-brand-dark"
                      : "border-line text-muted hover:bg-page hover:text-ink"
                  }`}
                >
                  {nomCourtAcademie(x.nom)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="border-b border-line bg-page px-4 py-2 text-sm break-words">
            <span className="text-muted">Objet : </span>
            <span className="font-medium text-ink">{apercuModele(objet, exemples)}</span>
          </div>
          <div className="px-4 py-3 text-sm break-words whitespace-pre-line text-ink">{apercuModele(corps, exemples)}</div>
          <div className="border-t border-line px-4 py-2 text-xs break-all text-muted">
            Pièce jointe : Facture-{exemples.numero}.pdf
          </div>
        </div>
        <p className="aide">Exemple avec des valeurs inventées.</p>
      </div>

      <ModeleAvis parametres={parametres} academie={academie?.nom ?? "Académie Delaveau"} />

      <Champ
        nom="email_copie"
        libelle="Copie cachée (archivage)"
        type="email"
        defaut={parametres.email_copie}
        maxLength={254}
        placeholder="contact@academiedelaveau.com"
        aide="Facultatif. Reçoit en copie cachée chaque facture et chaque avis envoyés (trace dans la boîte mail)."
      />
    </Section>
  );
}

/** Modèle de l'e-mail d'un avis d'échéance (objet, message, variables, aperçu). */
function ModeleAvis({ parametres, academie }: { parametres: Parametres; academie: string }) {
  const [objet, setObjet] = useState(parametres.email_avis_objet);
  const [corps, setCorps] = useState(parametres.email_avis_corps);
  const exemples = { structure: parametres.raison_sociale, academie };
  return (
    <div className="space-y-4 rounded-lg border border-line p-4">
      <div>
        <p className="font-medium text-ink">E-mail d&apos;un avis d&apos;échéance</p>
        <p className="aide mt-0.5">
          Envoyé chaque mois avec l&apos;avis (PDF joint), à la main ou automatiquement. Destiné aux familles.
        </p>
      </div>
      <div>
        <label htmlFor="email_avis_objet" className="label">
          Objet
          <Obligatoire />
        </label>
        <input
          id="email_avis_objet"
          name="email_avis_objet"
          value={objet}
          onChange={(e) => setObjet(e.target.value)}
          required
          maxLength={200}
          className="champ"
        />
        {variablesInconnues(objet, VARIABLES_AVIS).length > 0 && (
          <VariablesInconnues noms={variablesInconnues(objet, VARIABLES_AVIS)} />
        )}
      </div>
      <div>
        <label htmlFor="email_avis_corps" className="label">
          Message
          <Obligatoire />
        </label>
        <textarea
          id="email_avis_corps"
          name="email_avis_corps"
          value={corps}
          onChange={(e) => setCorps(e.target.value)}
          required
          rows={6}
          maxLength={5000}
          className="champ"
        />
        {variablesInconnues(corps, VARIABLES_AVIS).length > 0 && (
          <VariablesInconnues noms={variablesInconnues(corps, VARIABLES_AVIS)} />
        )}
      </div>
      <p className="text-xs text-muted">
        Variables : {VARIABLES_AVIS.map((v) => (
          <span key={v.nom} className="mr-2 inline-block" title={v.description}>
            <code className="font-mono text-brand">{`{${v.nom}}`}</code> {v.description.toLowerCase()}
          </span>
        ))}
      </p>
      <div className="overflow-hidden rounded-lg border border-line">
        <div className="border-b border-line bg-page px-4 py-2 text-sm break-words">
          <span className="text-muted">Objet : </span>
          <span className="font-medium text-ink">{apercuModele(objet, exemples, VARIABLES_AVIS)}</span>
        </div>
        <div className="px-4 py-3 text-sm break-words whitespace-pre-line text-ink">
          {apercuModele(corps, exemples, VARIABLES_AVIS)}
        </div>
        <div className="border-t border-line px-4 py-2 text-xs text-muted">Pièce jointe : Avis-E1-2026-10.pdf</div>
      </div>
    </div>
  );
}

function VariablesInconnues({ noms }: { noms: string[] }) {
  return (
    <p className="mt-1 text-xs text-red-700">
      Variable{noms.length > 1 ? "s" : ""} inconnue{noms.length > 1 ? "s" : ""} : {noms.map((n) => `{${n}}`).join(", ")}
      . Utiliser celles de la liste ci-dessous.
    </p>
  );
}
