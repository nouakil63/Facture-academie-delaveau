import type { Metadata } from "next";
import { Logo } from "@/components/coquille/Logo";
import { FormulaireConnexion } from "./FormulaireConnexion";

export const metadata: Metadata = { title: "Connexion" };

export default async function PageConnexion({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { suite } = await searchParams;
  // Transmis tel quel : la Server Action le valide avant toute redirection.
  const cheminSuite = typeof suite === "string" ? suite : "";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo largeur={220} prioritaire />
        </div>

        <div className="carte carte-corps sm:p-8">
          <h1 className="titre-page">Connexion</h1>
          <p className="mt-1 mb-6 text-sm text-muted">Espace de facturation de l&apos;Académie Delaveau et de l&apos;Académie Espoir.</p>
          <FormulaireConnexion suite={cheminSuite} />
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Accès réservé aux membres de l&apos;académie.
          <br />
          Pour obtenir un compte, adressez-vous à l&apos;administrateur de l&apos;application.
        </p>
      </div>
    </main>
  );
}
