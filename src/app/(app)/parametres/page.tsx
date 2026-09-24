import type { Metadata } from "next";
import Link from "next/link";
import { FormulaireEmailTest } from "@/components/parametres/FormulaireEmailTest";
import {
  IconeAlerte,
  IconeCoche,
  IconeEnveloppe,
  IconeFleche,
  IconeInfo,
  IconeUtilisateurs,
} from "@/components/prestations/Icones";
import { exigerUtilisateur } from "@/lib/auth";
import { emailConfigure } from "@/lib/email";
import { aujourdhuiParis, formatDate } from "@/lib/format";
import type { Entite } from "@/lib/types";

export const metadata: Metadata = { title: "Paramètres" };

type Membre = { email: string; nom: string | null; created_at: string };
type Compteur = { entite_id: string; annee: number; dernier_numero: number };

/** Informations manquantes pour des factures complètes. */
function aCompleter(e: Entite): string[] {
  const manques: string[] = [];
  if (!e.adresse_ligne1 || !e.code_postal || !e.ville) manques.push("adresse");
  if (!e.iban) manques.push("IBAN");
  if (!e.email_contact) manques.push("e-mail de contact");
  if (Number(e.taux_tva) === 0 && !e.mention_tva) manques.push("mention TVA");
  return manques;
}

export default async function PageParametres() {
  const { supabase, utilisateur } = await exigerUtilisateur();

  const [resEntites, resMembres, resCompteurs] = await Promise.all([
    supabase.from("entites").select("*").order("ordre").order("nom"),
    supabase.from("membres").select("email, nom, created_at").order("created_at"),
    supabase.from("compteurs_factures").select("entite_id, annee, dernier_numero").order("annee", { ascending: false }),
  ]);

  const erreur = resEntites.error ?? resMembres.error ?? resCompteurs.error;
  if (erreur) {
    return (
      <div className="space-y-6">
        <h1 className="titre-page">Paramètres</h1>
        <p role="alert" className="erreur">
          Impossible de charger les paramètres : {erreur.message}
        </p>
      </div>
    );
  }

  const entites = resEntites.data as Entite[];
  const membres = resMembres.data as Membre[];
  const compteurs = resCompteurs.data as Compteur[];
  const emailUtilisateur = (utilisateur.email ?? "").toLowerCase();
  const anneeCourante = aujourdhuiParis().slice(0, 4);

  // Configuration SMTP : jamais le mot de passe, seulement sa présence.
  const smtpOk = emailConfigure();
  const smtp = [
    { libelle: "Serveur (SMTP_HOST)", valeur: process.env.SMTP_HOST },
    { libelle: "Port (SMTP_PORT)", valeur: process.env.SMTP_PORT },
    { libelle: "Utilisateur (SMTP_USER)", valeur: process.env.SMTP_USER },
    { libelle: "Mot de passe (SMTP_PASSWORD)", valeur: process.env.SMTP_PASSWORD ? "défini (masqué)" : undefined },
    { libelle: "Expéditeur (EMAIL_FROM)", valeur: process.env.EMAIL_FROM },
  ];
  const envoiAutoSansSmtp = !smtpOk && entites.filter((e) => e.envoi_auto).map((e) => e.nom);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="titre-page">Paramètres</h1>
        <p className="mt-1 text-sm text-muted">
          Informations imprimées sur les factures, facturation mensuelle automatique, envoi des e-mails et accès.
        </p>
      </div>

      {/* Entités */}
      <section aria-labelledby="titre-entites" className="space-y-3">
        <div>
          <h2 id="titre-entites" className="titre-section">
            Entités de facturation
          </h2>
          <p className="text-sm text-muted">
            Chaque entité a sa propre numérotation, ses informations légales, son catalogue et ses clients.
          </p>
        </div>

        {entites.length === 0 ? (
          <p className="erreur">
            Aucune entité n&apos;est accessible. Vérifiez que les migrations Supabase ont été appliquées et que votre
            adresse figure parmi les utilisateurs autorisés.
          </p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {entites.map((e) => {
              const manques = aCompleter(e);
              const dernier = compteurs.find((c) => c.entite_id === e.id);
              const jumelle = entites.find(
                (autre) => autre.id !== e.id && e.siret && autre.siret === e.siret && autre.ordre < e.ordre,
              );
              return (
                <li key={e.id}>
                  <Link
                    href={`/parametres/${e.id}`}
                    className="carte group flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    <div className="flex h-1.5">
                      <span className="flex-3" style={{ backgroundColor: e.couleur_primaire }} />
                      <span className="flex-1" style={{ backgroundColor: e.couleur_secondaire }} />
                    </div>
                    <div className="flex flex-1 flex-col gap-3 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-display text-lg font-medium tracking-wide text-ink">{e.nom}</p>
                          <p className="truncate text-sm text-muted">
                            {[e.raison_sociale, e.ville].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <span
                          className="badge shrink-0 border tracking-wider"
                          style={{ borderColor: e.couleur_primaire, color: e.couleur_primaire }}
                          title="Préfixe des numéros de facture"
                        >
                          {e.prefixe_facture}
                        </span>
                      </div>

                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <dt className="text-muted">Numérotation</dt>
                        <dd className="font-medium text-ink tabular-nums">
                          {dernier
                            ? `${e.prefixe_facture}-${dernier.annee}-${String(dernier.dernier_numero).padStart(4, "0")}`
                            : `${e.prefixe_facture}-${anneeCourante}-0001 (à venir)`}
                        </dd>
                        <dt className="text-muted">Facturation mensuelle</dt>
                        <dd className="font-medium text-ink">
                          {e.generation_auto ? `Automatique, le ${e.jour_generation === 1 ? "1er" : e.jour_generation}` : "Manuelle"}
                        </dd>
                        <dt className="text-muted">TVA</dt>
                        <dd className="font-medium text-ink">
                          {Number(e.taux_tva) === 0 ? "Non facturée" : `${String(e.taux_tva).replace(".", ",")} %`}
                        </dd>
                        <dt className="text-muted">Couleurs</dt>
                        <dd className="flex items-center gap-1.5">
                          <Pastille couleur={e.couleur_primaire} />
                          <Pastille couleur={e.couleur_secondaire} />
                          <span className="font-mono text-[11px] text-muted">{e.couleur_primaire}</span>
                        </dd>
                      </dl>

                      <div className="flex flex-wrap gap-1.5">
                        {!e.actif && <span className="badge bg-zinc-200 text-zinc-600">Désactivée</span>}
                        {e.envoi_auto && (
                          <span className="badge bg-red-100 text-red-800" title="Factures émises et envoyées sans relecture">
                            Envoi automatique
                          </span>
                        )}
                        {manques.length === 0 ? (
                          <span className="badge gap-1 bg-emerald-100 text-emerald-800">
                            <IconeCoche className="size-3" />
                            Informations complètes
                          </span>
                        ) : (
                          <span className="badge gap-1 bg-amber-100 text-amber-900">
                            <IconeAlerte className="size-3" />À compléter : {manques.join(", ")}
                          </span>
                        )}
                      </div>

                      {jumelle && (
                        <p className="text-xs text-muted">
                          Mêmes informations légales que {jumelle.nom} (même SIRET) : à corriger si {e.nom} est une
                          structure distincte.
                        </p>
                      )}

                      <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium text-brand group-hover:underline">
                        Modifier les paramètres
                        <IconeFleche className="size-3.5" />
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* E-mails */}
      <section aria-labelledby="titre-emails" className="carte">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-brand-light p-2 text-brand">
              <IconeEnveloppe className="size-5" />
            </span>
            <div>
              <h2 id="titre-emails" className="titre-section">
                Envoi des e-mails
              </h2>
              <p className="text-sm text-muted">Serveur SMTP utilisé pour envoyer les factures aux clients.</p>
            </div>
          </div>
          {smtpOk ? (
            <span className="badge gap-1 bg-emerald-100 text-emerald-800">
              <IconeCoche className="size-3" />
              Configuré
            </span>
          ) : (
            <span className="badge gap-1 bg-amber-100 text-amber-900">
              <IconeAlerte className="size-3" />
              Non configuré
            </span>
          )}
        </div>

        <div className="space-y-5 px-5 py-5">
          {envoiAutoSansSmtp && envoiAutoSansSmtp.length > 0 && (
            <p className="erreur flex items-start gap-2">
              <IconeAlerte className="mt-0.5 size-4" />
              <span>
                L&apos;envoi automatique est activé pour {envoiAutoSansSmtp.join(" et ")}, mais aucun serveur SMTP
                n&apos;est configuré : les factures seront émises sans pouvoir être envoyées.
              </span>
            </p>
          )}

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            {smtp.map((ligne) => (
              <div key={ligne.libelle} className="contents">
                <dt className="text-muted">{ligne.libelle}</dt>
                <dd className="min-w-0 font-medium break-all text-ink">
                  {ligne.valeur ? ligne.valeur : <span className="font-normal text-amber-700">non défini</span>}
                </dd>
              </div>
            ))}
          </dl>

          {!smtpOk && (
            <div className="avertissement space-y-2">
              <p className="font-medium">Pour activer l&apos;envoi des factures par e-mail :</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  Dans Vercel, ouvrez le projet → <strong>Settings → Environment Variables</strong>.
                </li>
                <li>
                  Ajoutez <Code>SMTP_HOST</Code>, <Code>SMTP_PORT</Code>, <Code>SMTP_SECURE</Code>,{" "}
                  <Code>SMTP_USER</Code>, <Code>SMTP_PASSWORD</Code> et <Code>EMAIL_FROM</Code> (voir le README,
                  section Configuration). Pour Gmail : <Code>smtp.gmail.com</Code>, port 465, <Code>SMTP_SECURE=true</Code>{" "}
                  et un « mot de passe d&apos;application ».
                </li>
                <li>Redéployez l&apos;application pour prendre en compte les nouvelles variables.</li>
              </ol>
            </div>
          )}

          <div className="border-t border-line pt-5">
            <FormulaireEmailTest adresseParDefaut={emailUtilisateur} actif={smtpOk} />
          </div>

          <p className="aide">
            Les modèles d&apos;e-mail (objet, message, copie cachée) se règlent dans les paramètres de chaque entité.
          </p>
        </div>
      </section>

      {/* Utilisateurs */}
      <section aria-labelledby="titre-membres" className="carte">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="rounded-lg bg-brand-light p-2 text-brand">
            <IconeUtilisateurs className="size-5" />
          </span>
          <div>
            <h2 id="titre-membres" className="titre-section">
              Utilisateurs autorisés
            </h2>
            <p className="text-sm text-muted">
              Seules ces adresses ont accès aux données, même avec un compte de connexion valide.
            </p>
          </div>
        </div>

        {membres.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Aucun utilisateur autorisé n&apos;est visible.</p>
        ) : (
          <ul className="divide-y divide-line">
            {membres.map((m) => (
              <li key={m.email} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {m.nom ?? m.email}
                    {m.email === emailUtilisateur && <span className="ml-2 badge bg-brand-light text-brand-dark">Vous</span>}
                  </p>
                  {m.nom && <p className="truncate text-sm text-muted">{m.email}</p>}
                </div>
                <p className="text-xs text-muted">Ajouté le {formatDate(m.created_at)}</p>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 border-t border-line bg-page/60 px-5 py-4 text-sm text-muted">
          <p className="flex items-start gap-2 font-medium text-ink">
            <IconeInfo className="mt-0.5 size-4 text-brand" />
            Ajouter un utilisateur
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Dans Supabase, <strong>Authentication → Users → Add user</strong> : créez le compte (e-mail et mot de passe).
            </li>
            <li>
              Dans <strong>SQL Editor</strong>, autorisez son adresse (en minuscules) :
              <pre className="mt-1.5 overflow-x-auto rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink">
                insert into membres (email, nom) values (&apos;prenom.nom@exemple.fr&apos;, &apos;Prénom Nom&apos;);
              </pre>
            </li>
          </ol>
          <p>
            Pour retirer un accès : <Code>delete from membres where email = &apos;…&apos;;</Code>
          </p>
        </div>
      </section>
    </div>
  );
}

function Pastille({ couleur }: { couleur: string }) {
  return (
    <span
      className="inline-block size-3.5 rounded-full ring-1 ring-line ring-inset"
      style={{ backgroundColor: couleur }}
      title={couleur}
    />
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em] text-ink ring-1 ring-line">{children}</code>;
}
