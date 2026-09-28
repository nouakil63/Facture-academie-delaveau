import Link from "next/link";
import { IconeCalendrier, IconeNouveauClient, IconePlus } from "@/components/Icones";

/** Actions fréquentes, en tête du tableau de bord. */
export function Raccourcis() {
  return (
    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end">
      <Link href="/factures/nouvelle" className="btn-primaire">
        <IconePlus className="h-4 w-4" />
        Nouvelle facture
      </Link>
      <Link href="/facturation-annuelle" className="btn-secondaire">
        <IconeCalendrier className="h-4 w-4" />
        Facturation de l&apos;année
      </Link>
      <Link href="/clients/nouveau" className="btn-secondaire">
        <IconeNouveauClient className="h-4 w-4" />
        Nouveau client
      </Link>
    </div>
  );
}
