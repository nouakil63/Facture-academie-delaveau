import type { Metadata } from "next";
import Link from "next/link";
import { academieFiltree, chargerAcademiesActives, verifierAcces } from "@/components/coquille/donnees";
import { IconeAlerte, IconeBillet, IconeCrayon, IconeFleche, IconeHorloge, IconeValide } from "@/components/Icones";
import { chargerTableauDeBord } from "@/components/tableau-de-bord/donnees";
import { Indicateur } from "@/components/tableau-de-bord/Indicateur";
import { pluriel } from "@/components/tableau-de-bord/outils";
import { PremiersPas } from "@/components/tableau-de-bord/PremiersPas";
import { ProchaineFacturation } from "@/components/tableau-de-bord/ProchaineFacturation";
import { Raccourcis } from "@/components/tableau-de-bord/Raccourcis";
import { RepartitionAcademies } from "@/components/tableau-de-bord/RepartitionAcademies";
import { TableauFactures } from "@/components/tableau-de-bord/TableauFactures";
import { academieSelectionnee } from "@/lib/academie-selectionnee";
import { exigerUtilisateur } from "@/lib/auth";
import { aujourdhuiParis, formatDateLongue, formatEuros, formatPeriode } from "@/lib/format";

export const metadata: Metadata = { title: "Tableau de bord" };

const FACTURES_EN_RETARD = "/factures?statut=en_retard";

function EnTete({ perimetre, date }: { perimetre: string; date: string }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-sm text-muted">
          {perimetre} · {formatDateLongue(date)}
        </p>
        <h1 className="titre-page mt-1">Tableau de bord</h1>
      </div>
      <Raccourcis />
    </div>
  );
}

/** Rappel affiché tant que l'IBAN de l'association n'est pas renseigné. */
function RappelIban() {
  return (
    <div role="note" className="avertissement flex flex-col gap-3 sm:flex-row sm:items-center">
      <IconeAlerte className="hidden h-5 w-5 shrink-0 sm:block" />
      <p className="flex-1">
        <strong className="font-semibold">IBAN non renseigné.</strong> Les factures n&apos;indiquent aucune coordonnée
        bancaire pour le règlement par virement.
      </p>
      <Link href="/parametres" className="btn-secondaire btn-petit shrink-0">
        Compléter l&apos;IBAN
        <IconeFleche className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

export default async function PageTableauDeBord() {
  const { supabase } = await exigerUtilisateur();

  const [academies, acces, idCookie] = await Promise.all([
    chargerAcademiesActives(supabase),
    verifierAcces(supabase),
    academieSelectionnee(),
  ]);
  // Cookie d'une académie inexistante ou désactivée → « Toutes ».
  const academieId = academieFiltree(idCookie, academies);
  const academie = academies.find((a) => a.id === academieId) ?? null;
  const perimetre = academie ? academie.nom : "Toutes les académies";

  // Compte non autorisé ou base injoignable : la coquille affiche déjà le bandeau explicatif.
  if (acces !== "autorise") {
    return (
      <div className="space-y-6">
        <EnTete perimetre={perimetre} date={aujourdhuiParis()} />
        <div className="carte carte-corps py-12 text-center">
          <p className="font-medium text-ink">Aucune donnée accessible</p>
          <p className="mt-1 text-sm text-muted">
            {acces === "non_membre"
              ? "Le tableau de bord s'affichera dès que votre compte sera autorisé."
              : "Le tableau de bord s'affichera dès que la base de données répondra."}
          </p>
        </div>
      </div>
    );
  }

  const donnees = await chargerTableauDeBord(supabase, academieId, academies);
  const { indicateurs: ind, premiersPas, facturation } = donnees;
  const afficherAcademie = academieId === null && academies.length > 1;

  // Premier démarrage : aucune facture dans le périmètre affiché.
  if (premiersPas.factures === 0) {
    return (
      <div className="space-y-6">
        <EnTete perimetre={perimetre} date={donnees.aujourdhui} />
        <PremiersPas
          compteurs={premiersPas}
          nomAcademie={academie?.nom ?? null}
          ibanManquant={donnees.ibanManquant}
          facturation={facturation}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <EnTete perimetre={perimetre} date={donnees.aujourdhui} />

      {donnees.ibanManquant && <RappelIban />}

      <section aria-label="Indicateurs" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicateur
          libelle="À encaisser"
          valeur={formatEuros(ind.aEncaisser.centimes)}
          detail={
            ind.aEncaisser.nombre > 0
              ? pluriel(ind.aEncaisser.nombre, "facture émise ou envoyée", "factures émises ou envoyées")
              : "Aucune facture en attente de règlement"
          }
          icone={<IconeBillet className="h-5 w-5" />}
        />
        <Indicateur
          libelle="En retard"
          valeur={formatEuros(ind.enRetard.centimes)}
          detail={
            ind.enRetard.nombre > 0
              ? pluriel(ind.enRetard.nombre, "facture échue non réglée", "factures échues non réglées")
              : "Aucune facture échue"
          }
          icone={<IconeHorloge className="h-5 w-5" />}
          ton={ind.enRetard.nombre > 0 ? "alerte" : "neutre"}
          href={FACTURES_EN_RETARD}
          action="Voir les retards"
        />
        <Indicateur
          libelle="Encaissé ce mois-ci"
          valeur={formatEuros(ind.encaisseMois.centimes)}
          detail={`${pluriel(ind.encaisseMois.nombre, "paiement")} en ${formatPeriode(donnees.moisCourant)}`}
          icone={<IconeValide className="h-5 w-5" />}
          ton={ind.encaisseMois.nombre > 0 ? "succes" : "neutre"}
        />
        <Indicateur
          libelle="Brouillons à valider"
          valeur={String(ind.brouillons)}
          detail={ind.brouillons > 0 ? "À vérifier puis émettre" : "Aucun brouillon en attente"}
          icone={<IconeCrayon className="h-5 w-5" />}
          ton={ind.brouillons > 0 ? "attention" : "neutre"}
          href="/factures?statut=brouillon"
          action="Voir les brouillons"
        />
      </section>

      <ProchaineFacturation facturation={facturation} nomAcademie={academie?.nom ?? null} />

      {afficherAcademie && <RepartitionAcademies repartition={donnees.parAcademie} />}

      <section className="carte overflow-hidden" aria-labelledby="titre-retards">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
          <div>
            <h2 id="titre-retards" className="titre-section">
              Factures en retard
            </h2>
            {ind.enRetard.nombre > 0 && (
              <p className="text-xs text-muted">
                {pluriel(ind.enRetard.nombre, "facture")} · {formatEuros(ind.enRetard.centimes)}
                {ind.enRetard.nombre > donnees.retards.length && ` · les ${donnees.retards.length} plus anciennes échéances`}
              </p>
            )}
          </div>
          {ind.enRetard.nombre > 0 && (
            <Link href={FACTURES_EN_RETARD} className="btn-lien">
              Tous les retards
              <IconeFleche className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
        {donnees.retards.length > 0 ? (
          <TableauFactures
            factures={donnees.retards}
            variante="retard"
            afficherAcademie={afficherAcademie}
            aujourdhui={donnees.aujourdhui}
          />
        ) : (
          <div className="flex items-center gap-3 px-5 py-8 text-sm text-muted">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <IconeValide className="h-5 w-5" />
            </span>
            Aucune facture en retard : tous les règlements attendus sont dans les délais.
          </div>
        )}
      </section>

      <section className="carte overflow-hidden" aria-labelledby="titre-dernieres">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
          <h2 id="titre-dernieres" className="titre-section">
            Dernières factures
          </h2>
          <Link href="/factures" className="btn-lien">
            Toutes les factures
            <IconeFleche className="h-3.5 w-3.5" />
          </Link>
        </div>
        <TableauFactures
          factures={donnees.dernieres}
          variante="recent"
          afficherAcademie={afficherAcademie}
          aujourdhui={donnees.aujourdhui}
        />
      </section>
    </div>
  );
}
