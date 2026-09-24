import Link from "next/link";
import { AcademieBadge } from "@/components/AcademieBadge";
import { BandeauAcces } from "@/components/coquille/BandeauAcces";
import { chargerAcademiesActives, verifierAcces } from "@/components/coquille/donnees";
import { Logo } from "@/components/coquille/Logo";
import { MenuMobile } from "@/components/coquille/MenuMobile";
import { PanneauNavigation } from "@/components/coquille/PanneauNavigation";
import { academieSelectionnee, resoudreAcademie } from "@/lib/academie-selectionnee";
import { exigerUtilisateur } from "@/lib/auth";

/** Coquille de l'application : barre latérale, filtre d'académie, compte connecté. */
export default async function LayoutApplication({ children }: LayoutProps<"/">) {
  const { supabase, utilisateur } = await exigerUtilisateur();

  const [academies, acces, idCookie] = await Promise.all([
    chargerAcademiesActives(supabase),
    verifierAcces(supabase),
    academieSelectionnee(),
  ]);
  // Cookie d'une académie inexistante ou désactivée → « Toutes ».
  const academieCourante = resoudreAcademie(idCookie, academies)?.id ?? null;
  const academie = academies.find((a) => a.id === academieCourante);
  const email = utilisateur.email ?? "";

  const panneau = <PanneauNavigation academies={academies} academieCourante={academieCourante} email={email} />;

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
        indicateur={
          academie && (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
              <span className="sr-only">Académie affichée :</span>
              <AcademieBadge nom={academie.nom} couleur={academie.couleur} />
            </span>
          )
        }
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
