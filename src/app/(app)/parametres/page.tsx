import type { Metadata } from "next";
import { FormulaireEmailTest } from "@/components/parametres/FormulaireEmailTest";
import { FormulaireParametres } from "@/components/parametres/FormulaireParametres";
import { GestionAcademies, type AcademieGestion } from "@/components/parametres/GestionAcademies";
import { NavigationParametres, NavigationParametresMobile } from "@/components/parametres/NavigationParametres";
import { titreSection } from "@/components/parametres/sections";
import {
  IconeAlerte,
  IconeCoche,
  IconeFacture,
  IconeEnveloppe,
  IconeInfo,
  IconeLienExterne,
  IconeUtilisateurs,
} from "@/components/Icones";
import { exigerUtilisateur } from "@/lib/auth";
import { emailConfigure } from "@/lib/email";
import { chargerAcademies, chargerParametres } from "@/lib/facturation/service";
import { aujourdhuiParis, formatDate } from "@/lib/format";
import type { Academie, Parametres } from "@/lib/types";

export const metadata: Metadata = { title: "Paramètres" };

type Membre = { email: string; nom: string | null; created_at: string };
type Compteur = { annee: number; dernier_numero: number };

/** Adresse de la boîte mail de l'association, hébergée chez Amen. */
const ADRESSE_AMEN = "contact@academiedelaveau.com";

/** Informations manquantes pour des factures complètes, avec la section où les saisir. */
function aCompleter(p: Parametres): { libelle: string; ancre: string }[] {
  const manques: { libelle: string; ancre: string }[] = [];
  if (!p.iban) manques.push({ libelle: "IBAN", ancre: "paiement" });
  if (!p.adresse_ligne1 || !p.code_postal || !p.ville) manques.push({ libelle: "adresse", ancre: "coordonnees" });
  if (!p.email_contact) manques.push({ libelle: "e-mail de contact", ancre: "coordonnees" });
  if (Number(p.taux_tva) === 0 && !p.mention_tva) manques.push({ libelle: "mention TVA", ancre: "tva" });
  if (!p.mentions_professionnels?.trim()) manques.push({ libelle: "mentions clients professionnels", ancre: "tva" });
  return manques;
}

/** Numéro de facture au format de la série : « AD-2026-0042 ». */
function numeroFacture(prefixe: string, annee: number, sequence: number): string {
  return `${prefixe}-${annee}-${String(sequence).padStart(4, "0")}`;
}

export default async function PageParametres() {
  const { supabase, utilisateur } = await exigerUtilisateur();

  let parametres: Parametres;
  let academies: Academie[];
  try {
    [parametres, academies] = await Promise.all([chargerParametres(supabase), chargerAcademies(supabase)]);
  } catch (e) {
    return <ErreurChargement message={e instanceof Error ? e.message : String(e)} />;
  }

  const compter = (requete: PromiseLike<{ count: number | null; error: { message: string } | null }>) =>
    Promise.resolve(requete).then(({ count, error }) => {
      if (error) throw new Error(error.message);
      return count ?? 0;
    });

  let membres: Membre[];
  let compteurs: Compteur[];
  let nbClientsSansEmail: number;
  let academiesGestion: AcademieGestion[];
  try {
    const [resMembres, resCompteurs, sansEmail, comptes] = await Promise.all([
      supabase.from("membres").select("email, nom, created_at").order("created_at"),
      supabase.from("compteurs_factures").select("annee, dernier_numero").order("annee", { ascending: false }),
      compter(
        supabase.from("clients").select("id", { count: "exact", head: true }).eq("actif", true).is("email", null).eq("emails_cc", "{}"),
      ),
      // Rattachements de chaque académie : affichés, et bloquants pour la suppression.
      Promise.all(
        academies.map((a) =>
          Promise.all([
            compter(supabase.from("clients").select("id", { count: "exact", head: true }).eq("academie_id", a.id)),
            compter(
              supabase
                .from("clients")
                .select("id", { count: "exact", head: true })
                .eq("academie_id", a.id)
                .eq("actif", true),
            ),
            compter(supabase.from("factures").select("id", { count: "exact", head: true }).eq("academie_id", a.id)),
          ]),
        ),
      ),
    ]);
    if (resMembres.error) throw new Error(resMembres.error.message);
    if (resCompteurs.error) throw new Error(resCompteurs.error.message);
    membres = resMembres.data as Membre[];
    compteurs = resCompteurs.data as Compteur[];
    nbClientsSansEmail = sansEmail;
    academiesGestion = academies.map((a, i) => ({
      ...a,
      nbClients: comptes[i][0],
      nbClientsActifs: comptes[i][1],
      nbFactures: comptes[i][2],
    }));
  } catch (e) {
    return <ErreurChargement message={e instanceof Error ? e.message : String(e)} />;
  }

  const emailUtilisateur = (utilisateur.email ?? "").toLowerCase();
  const aujourdhui = aujourdhuiParis();
  const anneeCourante = Number(aujourdhui.slice(0, 4));

  // Série unique : le préfixe est figé dès qu'un numéro a été attribué.
  const prefixeVerrouille = compteurs.length > 0;
  const dernier = compteurs[0];
  const dernierNumero = dernier ? numeroFacture(parametres.prefixe_facture, dernier.annee, dernier.dernier_numero) : null;
  const compteurAnnee = compteurs.find((c) => c.annee === anneeCourante);
  const prochainNumero = numeroFacture(parametres.prefixe_facture, anneeCourante, (compteurAnnee?.dernier_numero ?? 0) + 1);

  const manques = aCompleter(parametres);
  const academiesActives = academies.filter((a) => a.actif);

  // Configuration SMTP : jamais le mot de passe, seulement sa présence.
  const smtpOk = emailConfigure();
  const env = (nom: string) => process.env[nom]?.trim() || undefined;
  const smtp = [
    { libelle: "Serveur (SMTP_HOST)", valeur: env("SMTP_HOST") },
    { libelle: "Port (SMTP_PORT)", valeur: env("SMTP_PORT") ?? (env("SMTP_HOST") ? "465 (par défaut)" : undefined) },
    {
      libelle: "Chiffrement (SMTP_SECURE)",
      valeur: env("SMTP_SECURE") ?? (env("SMTP_HOST") ? "automatique (SSL si port 465, STARTTLS sinon)" : undefined),
    },
    { libelle: "Utilisateur (SMTP_USER)", valeur: env("SMTP_USER") },
    { libelle: "Mot de passe (SMTP_PASSWORD)", valeur: env("SMTP_PASSWORD") ? "défini (masqué)" : undefined },
    { libelle: "Expéditeur (EMAIL_FROM)", valeur: env("EMAIL_FROM") ?? (env("SMTP_USER") ? `${env("SMTP_USER")} (par défaut)` : undefined) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="titre-page">Paramètres</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Informations imprimées sur toutes les factures (Académie Delaveau comme Académie Espoir), facturation
            mensuelle, académies, envoi des e-mails et accès. Une facture déjà émise conserve les informations en vigueur
            à sa date d&apos;émission.
          </p>
        </div>
        <a
          href="/api/parametres/apercu-pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondaire"
          title="Ouvre un PDF d'exemple dans un nouvel onglet, avec les paramètres enregistrés"
        >
          <IconeFacture />
          Aperçu d&apos;une facture type
          <IconeLienExterne className="size-3.5 text-muted" />
          <span className="sr-only">(nouvel onglet)</span>
        </a>
      </div>

      {/* État en un coup d'œil */}
      <div className="carte flex flex-col gap-3 px-5 py-4 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
        <p className="flex items-center gap-2">
          <span className="text-muted">Numérotation</span>
          <span className="font-mono font-medium text-ink">
            {dernierNumero ? `dernière ${dernierNumero}` : `à venir ${prochainNumero}`}
          </span>
        </p>
        <p className="flex items-center gap-2">
          <span className="text-muted">Facturation mensuelle</span>
          <span className="font-medium text-ink">
            {parametres.generation_auto
              ? `automatique, le ${parametres.jour_generation === 1 ? "1er" : parametres.jour_generation}`
              : "manuelle"}
          </span>
          {parametres.envoi_auto && (
            <span className="badge bg-red-100 text-red-800" title="Factures émises et envoyées sans relecture">
              Envoi automatique
            </span>
          )}
        </p>
        <div className="sm:ml-auto">
          {manques.length === 0 ? (
            <span className="badge gap-1 bg-emerald-100 text-emerald-800">
              <IconeCoche className="size-3" />
              Informations complètes
            </span>
          ) : (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="badge gap-1 bg-amber-100 text-amber-900">
                <IconeAlerte className="size-3" />À compléter
              </span>
              {manques.map((m, i) => (
                <span key={m.libelle}>
                  <a href={`#${m.ancre}`} className="btn-lien">
                    {m.libelle}
                  </a>
                  {i < manques.length - 1 && <span className="text-muted">,</span>}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8">
        <NavigationParametres />

        <div className="min-w-0 space-y-8">
          <NavigationParametresMobile />

          <FormulaireParametres
            parametres={parametres}
            prefixeVerrouille={prefixeVerrouille}
            dernierNumero={dernierNumero}
            prochainNumero={prochainNumero}
            aujourdhui={aujourdhui}
            smtpConfigure={smtpOk}
            nbClientsSansEmail={nbClientsSansEmail}
            academies={(academiesActives.length > 0 ? academiesActives : academies).map((a) => ({ id: a.id, nom: a.nom }))}
          />

          <GestionAcademies academies={academiesGestion} />

          {/* Envoi des e-mails */}
          <section id="envoi-emails" aria-labelledby="envoi-emails-titre" className="carte">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-brand-light p-2 text-brand">
                  <IconeEnveloppe className="size-5" />
                </span>
                <div>
                  <h2 id="envoi-emails-titre" className="titre-section">
                    {titreSection("envoi-emails")}
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
              {!smtpOk && parametres.envoi_auto && (
                <p className="erreur flex items-start gap-2">
                  <IconeAlerte className="mt-0.5 size-4 shrink-0" />
                  <span>
                    L&apos;envoi automatique est activé, mais aucun serveur SMTP n&apos;est configuré : les factures
                    seront émises sans pouvoir être envoyées.
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

              <AideAmen ouverte={!smtpOk} />

              <div className="border-t border-line pt-5">
                <FormulaireEmailTest adresseParDefaut={emailUtilisateur} actif={smtpOk} />
              </div>

              <p className="aide">
                Le message envoyé avec chaque facture (objet, texte, copie cachée) se règle dans la section{" "}
                <a href="#emails" className="btn-lien text-xs">
                  {titreSection("emails")}
                </a>
                .
              </p>
            </div>
          </section>

          {/* Utilisateurs */}
          <section id="utilisateurs" aria-labelledby="utilisateurs-titre" className="carte">
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <span className="rounded-lg bg-brand-light p-2 text-brand">
                <IconeUtilisateurs className="size-5" />
              </span>
              <div>
                <h2 id="utilisateurs-titre" className="titre-section">
                  {titreSection("utilisateurs")}
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
                <IconeInfo className="mt-0.5 size-4 shrink-0 text-brand" />
                Ajouter un utilisateur
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  Dans Supabase, <strong>Authentication → Users → Add user</strong> : créez le compte (e-mail et mot de
                  passe).
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
      </div>
    </div>
  );
}

/** Aide à la configuration SMTP pour la boîte mail hébergée chez Amen. */
function AideAmen({ ouverte }: { ouverte: boolean }) {
  const variables: { nom: string; valeur: string; detail: string }[] = [
    {
      nom: "SMTP_HOST",
      valeur: "smtp-fr.securemail.pro",
      detail: "ou smtp.amen.fr : à vérifier dans l'espace client Amen (paramètres de la messagerie).",
    },
    { nom: "SMTP_PORT", valeur: "465", detail: "SSL. À défaut : 587 (STARTTLS)." },
    { nom: "SMTP_SECURE", valeur: "true", detail: "true avec le port 465, false avec le port 587." },
    { nom: "SMTP_USER", valeur: ADRESSE_AMEN, detail: "L'adresse complète, pas seulement « contact »." },
    { nom: "SMTP_PASSWORD", valeur: "••••••••", detail: "Le mot de passe de la boîte mail (celui du webmail)." },
    {
      nom: "EMAIL_FROM",
      valeur: `Académie Delaveau <${ADRESSE_AMEN}>`,
      detail: "Expéditeur affiché : gardez l'adresse de la boîte, sinon les messages risquent d'être refusés.",
    },
  ];

  return (
    <details open={ouverte} className="group rounded-lg border border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-ink hover:bg-page">
        <span>
          Configurer avec la messagerie Amen <span className="font-normal text-muted">({ADRESSE_AMEN})</span>
        </span>
        <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="space-y-3 border-t border-line px-4 py-4 text-sm text-muted">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Dans l&apos;<strong>espace client Amen</strong>, ouvrez la boîte <Code>{ADRESSE_AMEN}</Code> et relevez le{" "}
            <strong>serveur d&apos;envoi (SMTP)</strong> indiqué dans les paramètres de configuration de la messagerie.
          </li>
          <li>
            Dans <strong>Vercel</strong>, ouvrez le projet → <strong>Settings → Environment Variables</strong> et
            ajoutez :
          </li>
        </ol>
        <dl className="divide-y divide-line rounded-lg border border-line bg-surface">
          {variables.map((v) => (
            <div key={v.nom} className="grid gap-1 px-3 py-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
              <dt className="font-mono text-xs font-medium text-ink sm:pt-0.5">{v.nom}</dt>
              <dd className="min-w-0">
                <span className="font-mono text-xs break-all text-ink">{v.valeur}</span>
                <span className="block text-xs">{v.detail}</span>
              </dd>
            </div>
          ))}
        </dl>
        <ol start={3} className="list-decimal space-y-1 pl-5">
          <li>Redéployez l&apos;application, puis envoyez-vous un e-mail de test ci-dessous.</li>
        </ol>
        <p className="text-xs">
          Si le test échoue sur le port 465, essayez le port 587 avec <Code>SMTP_SECURE=false</Code>. Un refus
          d&apos;identification signifie le plus souvent un mot de passe erroné ou un identifiant incomplet.
        </p>
      </div>
    </details>
  );
}

function ErreurChargement({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <h1 className="titre-page">Paramètres</h1>
      <div role="alert" className="erreur space-y-1">
        <p className="font-medium">Impossible de charger les paramètres.</p>
        <p>{message}</p>
        <p>
          Vérifiez que les migrations Supabase ont été appliquées et que votre adresse figure parmi les utilisateurs
          autorisés (table <Code>membres</Code>).
        </p>
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em] break-all text-ink ring-1 ring-line">{children}</code>;
}
