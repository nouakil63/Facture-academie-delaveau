import type { Metadata } from "next";
import Link from "next/link";
import { AcademieBadge } from "@/components/AcademieBadge";
import {
  FormulaireNouvelleFacture,
  type AcademieFormulaire,
  type ClientFormulaire,
  type LigneInitiale,
  type PrestationFormulaire,
} from "@/components/factures/FormulaireNouvelleFacture";
import { IconePlus, IconeRetour } from "@/components/Icones";
import { academieSelectionnee } from "@/lib/academie-selectionnee";
import { exigerUtilisateur } from "@/lib/auth";
import { chargerAcademies, chargerParametres, destinatairesFacture } from "@/lib/facturation/service";
import { aujourdhuiParis, avecArticle, nomClient } from "@/lib/format";
import { prixApplique } from "@/lib/tarifs";
import type { Academie, Client, Parametres, Prestation, TarifClient } from "@/lib/types";

export const metadata: Metadata = { title: "Nouvelle facture" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAMPS_CLIENT = "id, academie_id, type, nom, prenom, raison_sociale, email, emails_cc, cavaliers, actif";

type ClientCharge = Pick<
  Client,
  "id" | "academie_id" | "type" | "nom" | "prenom" | "raison_sociale" | "email" | "emails_cc" | "cavaliers" | "actif"
>;
type TarifCharge = Pick<
  TarifClient,
  "client_id" | "prestation_id" | "libelle" | "description" | "prix_unitaire_centimes" | "quantite" | "date_fin"
> & { prestation: Pick<Prestation, "libelle" | "description" | "prix_unitaire_centimes"> | null };

export default async function PageNouvelleFacture(props: PageProps<"/factures/nouvelle">) {
  const { supabase } = await exigerUtilisateur();
  const parametresUrl = await props.searchParams;
  const clientDemande =
    typeof parametresUrl.client === "string" && UUID.test(parametresUrl.client) ? parametresUrl.client : null;

  let parametres: Parametres;
  let academies: Academie[];
  let idCookie: string | null;
  try {
    [parametres, academies, idCookie] = await Promise.all([
      chargerParametres(supabase),
      chargerAcademies(supabase),
      academieSelectionnee(),
    ]);
  } catch (e) {
    return <ErreurChargement message={e instanceof Error ? e.message : String(e)} />;
  }
  // Filtre de la barre latérale (cookie) : ignoré s'il désigne une académie inconnue ou désactivée.
  const academieFiltree = idCookie ? academies.find((a) => a.id === idCookie && a.actif) : undefined;

  // Clients actifs de l'académie sélectionnée (ou de toutes), + le client demandé dans l'URL
  // (il peut appartenir à l'autre académie, ou être archivé : le formulaire le signale).
  let requeteClients = supabase.from("clients").select(CHAMPS_CLIENT).eq("actif", true);
  if (academieFiltree) requeteClients = requeteClients.eq("academie_id", academieFiltree.id);
  const [resClients, resDemande, resPrestations] = await Promise.all([
    requeteClients.order("nom").order("prenom"),
    clientDemande
      ? supabase.from("clients").select(CHAMPS_CLIENT).eq("id", clientDemande).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // Catalogue commun aux académies.
    supabase
      .from("prestations")
      .select("id, libelle, description, prix_unitaire_centimes, unite")
      .eq("actif", true)
      .order("ordre")
      .order("libelle"),
  ]);
  if (resClients.error) return <ErreurChargement message={resClients.error.message} />;
  if (resDemande.error) return <ErreurChargement message={resDemande.error.message} />;
  if (resPrestations.error) return <ErreurChargement message={resPrestations.error.message} />;

  const clientsCharges = resClients.data as ClientCharge[];
  const demande = resDemande.data as ClientCharge | null;
  if (demande && !clientsCharges.some((c) => c.id === demande.id)) clientsCharges.push(demande);

  const idsClients = clientsCharges.map((c) => c.id);
  const resTarifs =
    idsClients.length > 0
      ? await supabase
          .from("tarifs_clients")
          .select(
            "client_id, prestation_id, libelle, description, prix_unitaire_centimes, quantite, date_fin, prestation:prestations(libelle, description, prix_unitaire_centimes)",
          )
          .in("client_id", idsClients)
          .eq("actif", true)
          .order("ordre")
          .order("created_at")
      : { data: [], error: null };
  if (resTarifs.error) return <ErreurChargement message={resTarifs.error.message} />;

  // Lignes proposées : tarifs actifs non terminés (libellé / prix effectifs = tarif, sinon prestation).
  const aujourdhui = aujourdhuiParis();
  const lignesParClient: Record<string, LigneInitiale[]> = {};
  for (const t of resTarifs.data as TarifCharge[]) {
    if (t.date_fin && t.date_fin.slice(0, 10) < aujourdhui) continue;
    const libelle = t.libelle ?? t.prestation?.libelle;
    const prix = prixApplique(t);
    if (!libelle || prix == null) continue;
    (lignesParClient[t.client_id] ??= []).push({
      prestation_id: t.prestation_id,
      libelle,
      description: t.description ?? t.prestation?.description ?? null,
      quantite: Number(t.quantite),
      prix_unitaire_centimes: prix,
    });
  }

  const catalogue = resPrestations.data as PrestationFormulaire[];

  const clients: ClientFormulaire[] = clientsCharges
    .map((c) => ({
      id: c.id,
      academie_id: c.academie_id,
      nom: nomClient(c),
      cavaliers: c.cavaliers,
      aDesDestinataires: destinatairesFacture(c).length > 0,
      actif: c.actif,
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));

  const idsAcademies = new Set(clients.map((c) => c.academie_id));
  const academiesFormulaire: AcademieFormulaire[] = academies
    .filter((a) => idsAcademies.has(a.id))
    .map((a) => ({ id: a.id, nom: a.nom, couleur: a.couleur }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href={demande ? `/clients/${demande.id}` : "/factures"} className="btn-lien">
          <IconeRetour className="size-4" />
          {demande ? "Retour à la fiche client" : "Factures"}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="titre-page">Nouvelle facture</h1>
          {academieFiltree && <AcademieBadge nom={academieFiltree.nom} couleur={academieFiltree.couleur} />}
        </div>
        <p className="mt-1 text-sm text-muted">
          Facture ponctuelle ou mensuelle créée à la main. Elle est enregistrée comme brouillon, sans numéro.
        </p>
      </div>

      {clientDemande && !demande && (
        <p className="avertissement">Le client demandé est introuvable : choisissez-en un dans la liste.</p>
      )}

      {clients.length === 0 ? (
        <div className="carte flex flex-col items-center px-6 py-14 text-center">
          <p className="font-medium text-ink">
            {academieFiltree ? `Aucun client actif pour ${avecArticle(academieFiltree.nom)}` : "Aucun client actif"}
          </p>
          <p className="mt-1 max-w-md text-sm text-muted">
            Créez d&apos;abord la fiche du client à facturer
            {academieFiltree ? ", ou choisissez « Toutes » dans le filtre d'académie du menu." : "."}
          </p>
          <Link href="/clients/nouveau" className="btn-primaire mt-5">
            <IconePlus />
            Nouveau client
          </Link>
        </div>
      ) : (
        <FormulaireNouvelleFacture
          academies={academiesFormulaire}
          clients={clients}
          lignesParClient={lignesParClient}
          catalogue={catalogue}
          tauxTva={Number(parametres.taux_tva)}
          mentionTva={parametres.mention_tva}
          clientInitial={demande?.id ?? null}
        />
      )}
    </div>
  );
}

/** « Académie Espoir » → « l'Académie Espoir » ; autre nom → « « Nom » ». */
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
