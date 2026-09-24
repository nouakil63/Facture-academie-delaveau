import Link from "next/link";
import { BandeauAcces } from "@/components/coquille/BandeauAcces";
import { chargerEntitesActives, entiteFiltree, verifierAcces } from "@/components/coquille/donnees";
import { Logo } from "@/components/coquille/Logo";
import { MenuMobile } from "@/components/coquille/MenuMobile";
import { PanneauNavigation } from "@/components/coquille/PanneauNavigation";
import { exigerUtilisateur } from "@/lib/auth";
import { entiteSelectionnee } from "@/lib/entite-selectionnee";

/** Coquille de l'application : barre latérale, sélecteur d'entité, compte connecté. */
export default async function LayoutApplication({ children }: LayoutProps<"/">) {
  const { supabase, utilisateur } = await exigerUtilisateur();

  const [entites, acces, idCookie] = await Promise.all([
    chargerEntitesActives(supabase),
    verifierAcces(supabase),
    entiteSelectionnee(),
  ]);
  const entiteCourante = entiteFiltree(idCookie, entites);
  const email = utilisateur.email ?? "";

  const panneau = <PanneauNavigation entites={entites} entiteCourante={entiteCourante} email={email} />;

  return (
    <div className="min-h-screen">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand focus:shadow"
      >
        Aller au contenu
      </a>

      {/* Ordinateur : barre latérale fixe */}
      <aside className="hidden border-r border-line bg-surface lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col">
        <div className="px-6 pt-6 pb-2">
          <Link href="/" className="inline-block rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
            <Logo largeur={150} prioritaire />
          </Link>
          <p className="mt-2 text-xs font-medium tracking-wider text-muted uppercase">Facturation</p>
        </div>
        {panneau}
      </aside>

      {/* Mobile : barre supérieure + menu repliable */}
      <MenuMobile
        logo={
          <Link href="/" className="inline-block rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
            <Logo largeur={96} prioritaire />
          </Link>
        }
      >
        {panneau}
      </MenuMobile>

      <div className="lg:pl-64">
        <main id="contenu" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <BandeauAcces etat={acces} email={email} />
          {children}
        </main>
      </div>
    </div>
  );
}
