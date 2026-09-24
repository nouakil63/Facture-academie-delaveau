import type { Metadata } from "next";
import Link from "next/link";
import { AcademieBadge } from "@/components/AcademieBadge";
import { FiltresFactures } from "@/components/factures/FiltresFactures";
import { IconeCalendrier, IconeFacture, IconePlus } from "@/components/Icones";
import { ListeFactures, type FactureListe } from "@/components/factures/ListeFactures";
import { estFiltreStatut, FILTRES_STATUT, moisVersPeriode, pluriel } from "@/components/factures/outils";
import { academieSelectionnee } from "@/lib/academie-selectionnee";
import { exigerUtilisateur } from "@/lib/auth";
import { emailConfigure } from "@/lib/email";
import { chargerAcademies } from "@/lib/facturation/service";
import { avecArticle, formatPeriode } from "@/lib/format";
import type { Academie } from "@/lib/types";

export const metadata: Metadata = { title: "Factures" };

/** L'envoi groupé (Server Action de cette page) peut prendre plusieurs minutes. */
export const maxDuration = 300;

const LIMITE = 500;

const COLONNES =
  "id, numero, statut, objet, periode, date_emission, date_echeance, total_ht_centimes, total_ttc_centimes, " +
  "en_retard, client_id, client_type, client_nom, client_prenom, client_raison_sociale, client_email, " +
  "client_cavaliers, academie_id, academie_nom, academie_couleur";

const COLONNES_RECHERCHE = ["numero", "client_nom", "client_prenom", "client_raison_sociale", "client_cavaliers"];

/**
 * Filtre PostgREST `or=(…)` pour un mot : recherche insensible à la casse sur plusieurs colonnes.
 * Double échappement : d'abord pour LIKE (\ % _ précédés de \), puis pour PostgREST
 * (valeur entre guillemets, ce qui neutralise , ( ) et : ; \ et " y sont précédés de \).
 */
function filtreRecherche(mot: string): string {
  const motif = mot.replace(/[\\%_]/g, (c) => `\\${c}`);
  const valeur = `"%${motif.replace(/[\\"]/g, (c) => `\\${c}`)}%"`;
  return COLONNES_RECHERCHE.map((col) => `${col}.ilike.${valeur}`).join(",");
}

function texte(v: string | string[] | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

export default async function PageFactures(props: PageProps<"/factures">) {
  const { supabase } = await exigerUtilisateur();
  const parametres = await props.searchParams;
  const statut = estFiltreStatut(texte(parametres.statut)) ? texte(parametres.statut) : "";
  const mois = moisVersPeriode(texte(parametres.mois)) ? texte(parametres.mois) : "";
  const periode = moisVersPeriode(mois);
  const q = texte(parametres.q).slice(0, 100);
  const mots = q.split(/\s+/).filter(Boolean).slice(0, 5);

  let academies: Academie[];
  let idCookie: string | null;
  try {
    [academies, idCookie] = await Promise.all([chargerAcademies(supabase), academieSelectionnee()]);
  } catch (e) {
    return <ErreurChargement message={e instanceof Error ? e.message : String(e)} />;
  }
  // Filtre de la barre latérale (cookie) : ignoré s'il désigne une académie inconnue ou désactivée.
  const academie = idCookie ? academies.find((a) => a.id === idCookie && a.actif) : undefined;

  let requete = supabase.from("factures_vue").select(COLONNES, { count: "exact" });
  if (academie) requete = requete.eq("academie_id", academie.id);
  if (statut === "en_retard") requete = requete.eq("en_retard", true);
  else if (statut) requete = requete.eq("statut", statut);
  if (periode) requete = requete.eq("periode", periode);
  for (const mot of mots) requete = requete.or(filtreRecherche(mot));

  // Brouillons d'abord (pas de date d'émission), puis les plus récentes.
  const resFactures = await requete
    .order("date_emission", { ascending: false, nullsFirst: true })
    .order("numero", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LIMITE);
  if (resFactures.error) return <ErreurChargement message={resFactures.error.message} />;

  const factures = resFactures.data as unknown as FactureListe[];
  const total = resFactures.count ?? factures.length;
  const tronque = total > factures.length;
  const filtresActifs = Boolean(statut || mois || q);
  // Colonne « Académie » utile seulement quand plusieurs académies sont mélangées.
  const afficherAcademie = !academie && academies.length > 1;

  const libelleStatut = FILTRES_STATUT.find((f) => f.valeur === statut)?.libelle;
  const resume = [
    academie || academies.length < 2 ? null : "Toutes les académies",
    pluriel(total, "facture"),
    libelleStatut ? libelleStatut.toLowerCase() : null,
    periode ? formatPeriode(periode) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  /** Lien d'onglet de statut, en conservant les autres filtres. */
  function lienStatut(valeur: string) {
    const p = new URLSearchParams();
    if (valeur) p.set("statut", valeur);
    if (mois) p.set("mois", mois);
    if (q) p.set("q", q);
    const chaine = p.toString();
    return chaine ? `/factures?${chaine}` : "/factures";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="titre-page">Factures</h1>
            {academie && <AcademieBadge nom={academie.nom} couleur={academie.couleur} />}
          </div>
          <p className="mt-1 text-sm text-muted">
            {resume}
            {q ? ` · « ${q} »` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/facturation-mensuelle" className="btn-secondaire">
            <IconeCalendrier />
            Facturation mensuelle
          </Link>
          <Link href="/factures/nouvelle" className="btn-primaire">
            <IconePlus />
            Nouvelle facture
          </Link>
        </div>
      </div>

      <div className="carte">
        <nav aria-label="Statut" className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-3">
          {[{ valeur: "", libelle: "Toutes" }, ...FILTRES_STATUT].map((f) => {
            const actif = statut === f.valeur;
            return (
              <Link
                key={f.valeur || "toutes"}
                href={lienStatut(f.valeur)}
                aria-current={actif ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  actif ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {f.libelle}
              </Link>
            );
          })}
        </nav>
        <div className="carte-corps">
          <FiltresFactures q={q} mois={mois} statut={statut} filtresActifs={filtresActifs} />
        </div>
      </div>

      {tronque && (
        <p className="avertissement">
          Seules les {LIMITE} premières factures sur {total} sont affichées (et comptées dans les totaux). Affinez avec les
          filtres ci-dessus.
        </p>
      )}

      {factures.length === 0 ? (
        <div className="carte flex flex-col items-center px-6 py-14 text-center">
          <span className="rounded-full bg-brand-light p-3 text-brand">
            <IconeFacture className="size-6" />
          </span>
          {filtresActifs ? (
            <>
              <p className="mt-4 font-medium text-ink">Aucune facture ne correspond à ces filtres</p>
              <p className="mt-1 max-w-md text-sm text-muted">
                {academie
                  ? `La liste est limitée à ${avecArticle(academie.nom)} : choisissez « Toutes » dans le menu pour voir les factures des autres académies.`
                  : "Modifiez la recherche, le mois ou le statut."}
              </p>
              <Link href="/factures" className="btn-secondaire mt-5">
                Effacer les filtres
              </Link>
            </>
          ) : (
            <>
              <p className="mt-4 font-medium text-ink">
                {academie ? `Aucune facture pour ${avecArticle(academie.nom)}` : "Aucune facture pour l'instant"}
              </p>
              <p className="mt-1 max-w-md text-sm text-muted">
                Générez les factures du mois à partir des tarifs de vos clients, ou créez une facture ponctuelle (stage,
                concours, pension…).
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Link href="/facturation-mensuelle" className="btn-primaire">
                  <IconeCalendrier />
                  Facturation du mois
                </Link>
                <Link href="/factures/nouvelle" className="btn-secondaire">
                  <IconePlus />
                  Facture ponctuelle
                </Link>
              </div>
            </>
          )}
        </div>
      ) : (
        <ListeFactures factures={factures} afficherAcademie={afficherAcademie} envoiPossible={emailConfigure()} />
      )}
    </div>
  );
}

/** « Académie Espoir » → « l'Académie Espoir » ; autre nom → « « Nom » ». */
function ErreurChargement({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <h1 className="titre-page">Factures</h1>
      <p role="alert" className="erreur">
        Impossible de charger les factures : {message}
      </p>
    </div>
  );
}
