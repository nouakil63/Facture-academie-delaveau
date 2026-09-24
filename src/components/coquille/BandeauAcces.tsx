import type { EtatAcces } from "./donnees";
import { IconeAlerte } from "./Icones";

/** Avertissement affiché en haut du contenu quand le compte ne peut pas lire les données. */
export function BandeauAcces({ etat, email }: { etat: EtatAcces; email: string }) {
  if (etat === "autorise") return null;

  if (etat === "erreur") {
    return (
      <div role="alert" className="avertissement mb-6 flex gap-3">
        <IconeAlerte className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold">La base de données ne répond pas correctement</p>
          <p>
            Impossible de vérifier les droits de votre compte. Vérifiez que les migrations Supabase ont bien été
            appliquées (voir le README), puis rechargez la page.
          </p>
        </div>
      </div>
    );
  }

  const adresse = email.toLowerCase().replace(/'/g, "''");

  return (
    <div role="alert" className="avertissement mb-6 flex gap-3">
      <IconeAlerte className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 space-y-2">
        <p className="font-semibold">Compte non autorisé</p>
        <p>
          Le compte <strong className="break-all">{email || "actuel"}</strong> est bien connecté, mais son adresse ne
          figure pas dans la table <code className="font-mono">membres</code> : aucune donnée n&apos;est accessible.
        </p>
        <p>
          Pour l&apos;autoriser, ajoutez son e-mail à la table <code className="font-mono">membres</code> depuis
          l&apos;éditeur SQL de Supabase (voir le README), puis rechargez la page :
        </p>
        <pre className="overflow-x-auto rounded-md border border-amber-200 bg-white/70 px-3 py-2 font-mono text-xs">
          <code>{`insert into public.membres (email) values ('${adresse}');`}</code>
        </pre>
      </div>
    </div>
  );
}
