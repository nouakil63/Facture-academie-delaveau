import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormulaireEntite } from "@/components/parametres/FormulaireEntite";
import { IconeDocument, IconeLienExterne, IconeRetour } from "@/components/prestations/Icones";
import { exigerUtilisateur } from "@/lib/auth";
import { emailConfigure } from "@/lib/email";
import { aujourdhuiParis } from "@/lib/format";
import type { Entite } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Titre de l'onglet : nom de l'entité. */
export async function generateMetadata(props: PageProps<"/parametres/[id]">): Promise<Metadata> {
  const { supabase } = await exigerUtilisateur();
  const { id } = await props.params;
  if (!UUID.test(id)) return { title: "Entité introuvable" };
  const { data } = await supabase.from("entites").select("nom").eq("id", id).maybeSingle();
  return { title: data ? `Paramètres — ${(data as { nom: string }).nom}` : "Paramètres" };
}

export default async function PageParametresEntite(props: PageProps<"/parametres/[id]">) {
  const { supabase } = await exigerUtilisateur();
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const [resEntite, resCompteurs, resSansEmail] = await Promise.all([
    supabase.from("entites").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("compteurs_factures")
      .select("annee, dernier_numero")
      .eq("entite_id", id)
      .order("annee", { ascending: false }),
    supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("entite_id", id)
      .eq("actif", true)
      .is("email", null),
  ]);

  const erreur = resEntite.error ?? resCompteurs.error ?? resSansEmail.error;
  if (erreur) {
    return (
      <div className="space-y-6">
        <RetourParametres />
        <p role="alert" className="erreur">
          Impossible de charger les paramètres de l&apos;entité : {erreur.message}
        </p>
      </div>
    );
  }
  if (!resEntite.data) notFound();

  const entite = resEntite.data as Entite;
  const compteurs = resCompteurs.data as { annee: number; dernier_numero: number }[];
  const dernier = compteurs[0];
  const dernierNumero = dernier
    ? `${entite.prefixe_facture}-${dernier.annee}-${String(dernier.dernier_numero).padStart(4, "0")}`
    : null;

  return (
    <div className="space-y-6">
      <RetourParametres />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="titre-page flex flex-wrap items-center gap-3">
            <span
              className="inline-block size-3 shrink-0 rounded-full"
              style={{ backgroundColor: entite.couleur_primaire }}
              aria-hidden="true"
            />
            {entite.nom}
            <span
              className="badge border font-sans text-xs tracking-wider"
              style={{ borderColor: entite.couleur_primaire, color: entite.couleur_primaire }}
              title="Préfixe des numéros de facture"
            >
              {entite.prefixe_facture}
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            Les modifications s&apos;appliquent aux prochaines factures émises : une facture déjà émise conserve les
            informations en vigueur à sa date d&apos;émission.
          </p>
        </div>
        <a
          href={`/api/entites/${entite.id}/apercu-pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondaire"
          title="Ouvre un PDF d'exemple dans un nouvel onglet, avec les paramètres enregistrés"
        >
          <IconeDocument />
          Aperçu d&apos;une facture type
          <IconeLienExterne className="size-3.5 text-muted" />
          <span className="sr-only">(nouvel onglet)</span>
        </a>
      </div>

      <FormulaireEntite
        entite={entite}
        prefixeVerrouille={compteurs.length > 0}
        dernierNumero={dernierNumero}
        aujourdhui={aujourdhuiParis()}
        smtpConfigure={emailConfigure()}
        nbClientsSansEmail={resSansEmail.count ?? 0}
      />
    </div>
  );
}

function RetourParametres() {
  return (
    <Link href="/parametres" className="btn-lien">
      <IconeRetour className="size-4" />
      Paramètres
    </Link>
  );
}
