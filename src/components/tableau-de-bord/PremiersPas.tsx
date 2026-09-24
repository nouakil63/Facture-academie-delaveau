import Link from "next/link";
import { IconeAlerte, IconeCoche, IconeFleche } from "@/components/coquille/Icones";
import type { DonneesTableauDeBord } from "./donnees";
import { jourDuMois, nomAvecArticle } from "./outils";

/**
 * Accueil du premier démarrage (aucune facture dans le périmètre affiché), guide pas à pas :
 * prestations (catalogue commun) → clients et leurs tarifs → facturation mensuelle.
 */
export function PremiersPas({
  compteurs,
  nomAcademie,
  ibanManquant,
  facturation,
}: {
  compteurs: DonneesTableauDeBord["premiersPas"];
  /** Académie filtrée, ou null pour « Toutes ». */
  nomAcademie: string | null;
  ibanManquant: boolean;
  facturation: Pick<DonneesTableauDeBord["facturation"], "generationAuto" | "jourGeneration">;
}) {
  const sansTarifs = compteurs.clients > 0 && compteurs.tarifs === 0;

  const etapes = [
    {
      titre: "Créez vos prestations",
      texte: "Le catalogue, commun aux deux académies : pension, cours, formation… avec leur prix mensuel.",
      href: "/prestations",
      action: "Ouvrir le catalogue",
      faite: compteurs.prestations > 0,
    },
    {
      titre: "Ajoutez vos clients et leurs tarifs",
      texte: sansTarifs
        ? "Ouvrez la fiche de chaque client pour lui ajouter les prestations à facturer chaque mois (au prix du catalogue ou à un prix personnalisé)."
        : `Chaque famille ou structure facturée, rattachée ${
            nomAcademie ? `à ${nomAvecArticle(nomAcademie)}` : "à l'Académie Delaveau ou à l'Académie Espoir"
          }, avec les prestations à lui facturer chaque mois.`,
      href: compteurs.clients > 0 ? "/clients" : "/clients/nouveau",
      action: compteurs.clients > 0 ? "Ajouter les tarifs" : "Nouveau client",
      faite: compteurs.clients > 0 && compteurs.tarifs > 0,
    },
    {
      titre: "Lancez la facturation du mois",
      texte: `Un brouillon est préparé pour chaque client ayant des tarifs ; vous le vérifiez, puis vous l'envoyez. ${
        facturation.generationAuto
          ? `Préparation automatique le ${jourDuMois(facturation.jourGeneration)} de chaque mois.`
          : "L'automatisation mensuelle est désactivée (réglable dans les paramètres)."
      }`,
      href: "/facturation-mensuelle",
      action: "Facturation du mois",
      faite: compteurs.factures > 0,
    },
  ];
  const prochaine = etapes.findIndex((e) => !e.faite);

  return (
    <section className="carte overflow-hidden" aria-labelledby="titre-premiers-pas">
      <div className="border-b border-line bg-brand-light/50 px-5 py-5 sm:px-6">
        <h2 id="titre-premiers-pas" className="titre-section">
          Bienvenue{nomAcademie ? ` — ${nomAcademie}` : ""}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {nomAcademie ? `Aucune facture pour ${nomAvecArticle(nomAcademie)} pour l'instant. ` : "Aucune facture pour l'instant. "}
          Commencez par créer vos prestations puis vos clients : la facturation mensuelle s&apos;appuie sur eux.
        </p>
      </div>

      {ibanManquant && (
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <div role="note" className="avertissement flex flex-col gap-3 sm:flex-row sm:items-center">
            <IconeAlerte className="hidden h-5 w-5 shrink-0 sm:block" />
            <p className="flex-1">
              <strong className="font-semibold">IBAN à compléter.</strong> Il est imprimé sur chaque facture pour le
              règlement par virement : renseignez-le avant d&apos;envoyer vos premières factures.
            </p>
            <Link href="/parametres" className="btn-secondaire btn-petit shrink-0">
              Compléter l&apos;IBAN
              <IconeFleche className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}

      <ol className="divide-y divide-line">
        {etapes.map((etape, i) => {
          const active = i === prochaine;
          return (
            <li key={etape.titre} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  etape.faite
                    ? "bg-emerald-100 text-emerald-700"
                    : active
                      ? "bg-brand text-white"
                      : "bg-page text-muted ring-1 ring-line"
                }`}
              >
                {etape.faite ? <IconeCoche className="h-4 w-4" /> : i + 1}
                <span className="sr-only">{etape.faite ? " (étape terminée)" : ""}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${etape.faite ? "text-muted line-through decoration-muted/40" : "text-ink"}`}>
                  {etape.titre}
                </p>
                <p className="text-sm text-muted">{etape.texte}</p>
              </div>
              <Link href={etape.href} className={active ? "btn-primaire btn-petit" : "btn-secondaire btn-petit"}>
                {etape.action}
                <IconeFleche className="h-3.5 w-3.5" />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
