"use client";

import { useId, useState } from "react";
import { IconeCoche } from "@/components/prestations/Icones";
import { normaliserCouleur } from "./controles";

/*
 * Briques du formulaire des paramètres d'une entité : sections, champs texte,
 * champs contrôlés (IBAN, SIREN…), sélecteur de couleur.
 */

export function Section({
  id,
  titre,
  description,
  children,
}: {
  id: string;
  titre: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="carte scroll-mt-6">
      <div className="border-b border-line px-5 py-4">
        <h2 id={`${id}-titre`} className="titre-section">
          {titre}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      <div className="space-y-5 p-5">{children}</div>
    </section>
  );
}

export function Obligatoire() {
  return (
    <>
      <span className="text-red-600" aria-hidden="true">
        {" "}
        *
      </span>
      <span className="sr-only"> (obligatoire)</span>
    </>
  );
}

type PropsChamp = Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "defaultValue" | "id"> & {
  nom: string;
  libelle: string;
  defaut?: string | number | null;
  obligatoire?: boolean;
  aide?: React.ReactNode;
  /** Classes du conteneur (grille). */
  classeConteneur?: string;
};

/** Champ texte non contrôlé avec libellé et aide. */
export function Champ({ nom, libelle, defaut, obligatoire, aide, classeConteneur, className, ...attributs }: PropsChamp) {
  const idAide = useId();
  return (
    <div className={classeConteneur}>
      <label htmlFor={nom} className="label">
        {libelle}
        {obligatoire && <Obligatoire />}
      </label>
      <input
        id={nom}
        name={nom}
        defaultValue={defaut ?? ""}
        required={obligatoire}
        aria-describedby={aide ? idAide : undefined}
        className={`champ ${className ?? ""}`}
        {...attributs}
      />
      {aide && (
        <p id={idAide} className="aide">
          {aide}
        </p>
      )}
    </div>
  );
}

type PropsZone = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "name" | "defaultValue" | "id"> & {
  nom: string;
  libelle: string;
  defaut?: string | null;
  obligatoire?: boolean;
  aide?: React.ReactNode;
  classeConteneur?: string;
};

/** Zone de texte non contrôlée avec libellé et aide. */
export function ZoneTexte({ nom, libelle, defaut, obligatoire, aide, classeConteneur, rows = 3, ...attributs }: PropsZone) {
  const idAide = useId();
  return (
    <div className={classeConteneur}>
      <label htmlFor={nom} className="label">
        {libelle}
        {obligatoire && <Obligatoire />}
      </label>
      <textarea
        id={nom}
        name={nom}
        rows={rows}
        defaultValue={defaut ?? ""}
        required={obligatoire}
        aria-describedby={aide ? idAide : undefined}
        className="champ"
        {...attributs}
      />
      {aide && (
        <p id={idAide} className="aide">
          {aide}
        </p>
      )}
    </div>
  );
}

/**
 * Identifiant vérifié à la sortie du champ (IBAN, BIC, SIREN, SIRET, RNA) :
 * mis en forme s'il est valide, message d'erreur sinon. Le serveur refait le contrôle.
 */
export function ChampControle({
  nom,
  libelle,
  defaut,
  controle,
  formater,
  aide,
  placeholder,
  maxLength = 50,
  classeConteneur,
  inputMode,
  messageValide,
}: {
  nom: string;
  libelle: string;
  defaut: string | null;
  /** Message d'erreur, ou null si la valeur est valide. */
  controle: (valeur: string) => string | null;
  formater: (valeur: string) => string;
  aide?: React.ReactNode;
  placeholder?: string;
  maxLength?: number;
  classeConteneur?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  messageValide?: string;
}) {
  const [valeur, setValeur] = useState(defaut ?? "");
  const [verifie, setVerifie] = useState(false);
  const idAide = useId();
  const erreur = verifie && valeur.trim() !== "" ? controle(valeur.trim()) : null;
  const valide = verifie && valeur.trim() !== "" && !erreur;

  return (
    <div className={classeConteneur}>
      <label htmlFor={nom} className="label">
        {libelle}
      </label>
      <input
        id={nom}
        name={nom}
        value={valeur}
        maxLength={maxLength}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={idAide}
        onChange={(e) => {
          setValeur(e.target.value);
          setVerifie(false);
        }}
        onBlur={() => {
          const brute = valeur.trim();
          if (brute !== "" && !controle(brute)) setValeur(formater(brute));
          setVerifie(true);
        }}
        className={`champ font-mono tracking-wide ${erreur ? "border-red-400 focus:border-red-500 focus:ring-red-500/20" : ""}`}
      />
      <p id={idAide} className="aide">
        {erreur ? (
          <span className="text-red-700">{erreur}</span>
        ) : valide ? (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <IconeCoche className="size-3.5" />
            {messageValide ?? "Format valide."}
          </span>
        ) : (
          aide
        )}
      </p>
    </div>
  );
}

/** Luminance relative (WCAG) d'une couleur #RRGGBB. */
function luminance(hex: string): number {
  const canaux = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canaux[0] + 0.7152 * canaux[1] + 0.0722 * canaux[2];
}

/** Contraste entre une couleur et le blanc (1 à 21). */
export function contrasteAvecBlanc(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

/** Couleur : sélecteur natif + saisie hexadécimale synchronisés (seule la saisie est envoyée). */
export function ChampCouleur({
  nom,
  libelle,
  valeur,
  onChange,
  aide,
}: {
  nom: string;
  libelle: string;
  valeur: string;
  onChange: (valeur: string) => void;
  aide?: React.ReactNode;
}) {
  const idAide = useId();
  const normalisee = normaliserCouleur(valeur);
  return (
    <div>
      <label htmlFor={nom} className="label">
        {libelle}
        <Obligatoire />
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={(normalisee ?? "#000000").toLowerCase()}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          aria-label={`${libelle} : sélecteur de couleur`}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-surface p-1"
        />
        <input
          id={nom}
          name={nom}
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => normalisee && onChange(normalisee)}
          required
          maxLength={7}
          pattern="#?[0-9A-Fa-f]{6}"
          title="Couleur hexadécimale, ex. #0050A0"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={normalisee ? undefined : true}
          aria-describedby={idAide}
          className="champ w-32 font-mono uppercase"
        />
      </div>
      <p id={idAide} className="aide">
        {normalisee ? aide : <span className="text-red-700">Format attendu : #RRGGBB (ex. #0050A0).</span>}
      </p>
    </div>
  );
}
