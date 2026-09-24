import Link from "next/link";
import { IconeCoche, IconeFleche } from "@/components/coquille/Icones";
import type { DonneesTableauDeBord } from "./donnees";

/** Accueil du premier démarrage : tant qu'aucune facture n'existe, guide pas à pas. */
export function PremiersPas({
  compteurs,
  nomEntite,
}: {
  compteurs: DonneesTableauDeBord["premiersPas"];
  /** Entité sélectionnée, ou null pour « Toutes ». */
  nomEntite: string | null;
}) {
  const etapes = [
    {
      titre: "Créez vos prestations",
      texte: "Le catalogue de chaque entité : pension, cours, formation… avec leur prix mensuel.",
      href: "/prestations",
      action: "Ouvrir le catalogue",
      faite: compteurs.prestations > 0,
    },
    {
      titre: "Ajoutez vos clients et leurs tarifs",
      texte: "Les familles ou structures facturées, et les prestations à leur facturer chaque mois.",
      href: "/clients/nouveau",
      action: "Nouveau client",
      faite: compteurs.clients > 0,
    },
    {
      titre: "Lancez la facturation du mois",
      texte: "Les brouillons sont préparés pour chaque client ; vous les vérifiez, puis vous les envoyez.",
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
          Bienvenue{nomEntite ? ` — ${nomEntite}` : ""}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {nomEntite ? `Aucune facture pour ${nomEntite} pour l'instant. ` : "Aucune facture pour l'instant. "}
          Commencez par créer vos prestations puis vos clients : la facturation mensuelle s&apos;appuie sur eux.
        </p>
      </div>

      <ol className="divide-y divide-line">
        {etapes.map((etape, i) => {
          const active = i === prochaine;
          return (
            <li key={etape.href} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
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
