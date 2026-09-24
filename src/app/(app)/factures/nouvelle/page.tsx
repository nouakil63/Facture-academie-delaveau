import type { Metadata } from "next";
import Link from "next/link";
import {
  FormulaireNouvelleFacture,
  type ClientFormulaire,
  type EntiteFormulaire,
  type LigneInitiale,
  type PrestationFormulaire,
} from "@/components/factures/FormulaireNouvelleFacture";
import { IconePlus, IconeRetour } from "@/components/factures/Icones";
import { exigerUtilisateur } from "@/lib/auth";
import { entiteSelectionnee } from "@/lib/entite-selectionnee";
import { destinatairesFacture } from "@/lib/facturation/service";
import { aujourdhuiParis, nomClient } from "@/lib/format";
import type { Client, Entite, Prestation, TarifClient } from "@/lib/types";

export const metadata: Metadata = { title: "Nouvelle facture" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAMPS_CLIENT = "id, entite_id, type, nom, prenom, raison_sociale, email, emails_cc, cavaliers, actif";

type ClientCharge = Pick<
  Client,
  "id" | "entite_id" | "type" | "nom" | "prenom" | "raison_sociale" | "email" | "emails_cc" | "cavaliers" | "actif"
>;
type TarifCharge = Pick<
  TarifClient,
  "client_id" | "prestation_id" | "libelle" | "description" | "prix_unitaire_centimes" | "quantite" | "date_fin"
> & { prestation: Pick<Prestation, "libelle" | "description" | "prix_unitaire_centimes"> | null };

export default async function PageNouvelleFacture(props: PageProps<"/factures/nouvelle">) {
  const { supabase } = await exigerUtilisateur();
  const parametres = await props.searchParams;
  const clientDemande = typeof parametres.client === "string" && UUID.test(parametres.client) ? parametres.client : null;

  const [idCookie, resEntites] = await Promise.all([
    entiteSelectionnee(),
    supabase
      .from("entites")
      .select("id, nom, couleur_primaire, taux_tva, mention_tva, actif")
      .order("ordre")
      .order("nom"),
  ]);
  if (resEntites.error) return <ErreurChargement message={resEntites.error.message} />;
  const toutesEntites = resEntites.data as (EntiteFormulaire & Pick<Entite, "actif">)[];
  const entiteFiltree = idCookie ? toutesEntites.find((e) => e.id === idCookie && e.actif) : undefined;

  // Clients actifs de l'entité sélectionnée (ou de toutes), + le client demandé dans l'URL.
  let requeteClients = supabase.from("clients").select(CHAMPS_CLIENT).eq("actif", true);
  if (entiteFiltree) requeteClients = requeteClients.eq("entite_id", entiteFiltree.id);
  const [resClients, resDemande] = await Promise.all([
    requeteClients.order("nom").order("prenom"),
    clientDemande
      ? supabase.from("clients").select(CHAMPS_CLIENT).eq("id", clientDemande).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (resClients.error) return <ErreurChargement message={resClients.error.message} />;
  if (resDemande.error) return <ErreurChargement message={resDemande.error.message} />;

  const clientsCharges = resClients.data as ClientCharge[];
  const demande = resDemande.data as ClientCharge | null;
  if (demande && !clientsCharges.some((c) => c.id === demande.id)) clientsCharges.push(demande);

  const idsClients = clientsCharges.map((c) => c.id);
  const idsEntites = [...new Set(clientsCharges.map((c) => c.entite_id))];

  const [resTarifs, resPrestations] = await Promise.all([
    idsClients.length > 0
      ? supabase
          .from("tarifs_clients")
          .select(
            "client_id, prestation_id, libelle, description, prix_unitaire_centimes, quantite, date_fin, prestation:prestations(libelle, description, prix_unitaire_centimes)",
          )
          .in("client_id", idsClients)
          .eq("actif", true)
          .order("ordre")
          .order("created_at")
      : Promise.resolve({ data: [], error: null }),
    idsEntites.length > 0
      ? supabase
          .from("prestations")
          .select("id, entite_id, libelle, description, prix_unitaire_centimes, unite")
          .in("entite_id", idsEntites)
          .eq("actif", true)
          .order("ordre")
          .order("libelle")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (resTarifs.error) return <ErreurChargement message={resTarifs.error.message} />;
  if (resPrestations.error) return <ErreurChargement message={resPrestations.error.message} />;

  // Lignes proposées : tarifs actifs non terminés (libellé / prix effectifs = tarif, sinon prestation).
  const aujourdhui = aujourdhuiParis();
  const lignesParClient: Record<string, LigneInitiale[]> = {};
  for (const t of resTarifs.data as TarifCharge[]) {
    if (t.date_fin && t.date_fin.slice(0, 10) < aujourdhui) continue;
    const libelle = t.libelle ?? t.prestation?.libelle;
    const prix = t.prix_unitaire_centimes ?? t.prestation?.prix_unitaire_centimes;
    if (!libelle || prix == null) continue;
    (lignesParClient[t.client_id] ??= []).push({
      prestation_id: t.prestation_id,
      libelle,
      description: t.description ?? t.prestation?.description ?? null,
      quantite: Number(t.quantite),
      prix_unitaire_centimes: prix,
    });
  }

  const prestationsParEntite: Record<string, PrestationFormulaire[]> = {};
  for (const p of resPrestations.data as (PrestationFormulaire & { entite_id: string })[]) {
    (prestationsParEntite[p.entite_id] ??= []).push({
      id: p.id,
      libelle: p.libelle,
      description: p.description,
      prix_unitaire_centimes: p.prix_unitaire_centimes,
      unite: p.unite,
    });
  }

  const clients: ClientFormulaire[] = clientsCharges
    .map((c) => ({
      id: c.id,
      entite_id: c.entite_id,
      nom: nomClient(c),
      cavaliers: c.cavaliers,
      aDesDestinataires: destinatairesFacture(c).length > 0,
      actif: c.actif,
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));

  const entites: EntiteFormulaire[] = toutesEntites
    .filter((e) => idsEntites.includes(e.id))
    .map((e) => ({
      id: e.id,
      nom: e.nom,
      couleur_primaire: e.couleur_primaire,
      taux_tva: Number(e.taux_tva),
      mention_tva: e.mention_tva,
    }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href={demande ? `/clients/${demande.id}` : "/factures"} className="btn-lien">
          <IconeRetour className="size-4" />
          {demande ? "Retour à la fiche client" : "Factures"}
        </Link>
        <h1 className="titre-page mt-2">Nouvelle facture</h1>
        <p className="mt-1 text-sm text-muted">
          Facture ponctuelle ou mensuelle créée à la main
          {entiteFiltree ? ` pour ${entiteFiltree.nom}` : ""}. Elle est enregistrée comme brouillon.
        </p>
      </div>

      {clientDemande && !demande && (
        <p className="avertissement">Le client demandé est introuvable : choisissez-en un dans la liste.</p>
      )}

      {clients.length === 0 ? (
        <div className="carte flex flex-col items-center px-6 py-14 text-center">
          <p className="font-medium text-ink">
            {entiteFiltree ? `Aucun client actif pour ${entiteFiltree.nom}` : "Aucun client actif"}
          </p>
          <p className="mt-1 max-w-md text-sm text-muted">
            Créez d&apos;abord la fiche du client à facturer
            {entiteFiltree ? ", ou changez d'entité dans le menu." : "."}
          </p>
          <Link href="/clients/nouveau" className="btn-primaire mt-5">
            <IconePlus />
            Nouveau client
          </Link>
        </div>
      ) : (
        <FormulaireNouvelleFacture
          entites={entites}
          clients={clients}
          lignesParClient={lignesParClient}
          prestationsParEntite={prestationsParEntite}
          clientInitial={demande?.id ?? null}
        />
      )}
    </div>
  );
}

function ErreurChargement({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <h1 className="titre-page">Nouvelle facture</h1>
      <p role="alert" className="erreur">
        Impossible de préparer le formulaire : {message}
      </p>
    </div>
  );
}
