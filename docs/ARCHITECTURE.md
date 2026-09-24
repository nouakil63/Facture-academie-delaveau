# Architecture — CRM de facturation Académie Delaveau

Application interne (2 utilisateurs) de suivi des clients et de facturation mensuelle
de l'association **Académie Delaveau**.

**Une seule structure émettrice.** L'Académie Delaveau et l'Académie Espoir sont la même
association : mêmes informations légales, même IBAN, même catalogue, mêmes modèles, **une seule
série de numéros** (`AD-2026-0001`, `AD-2026-0002`…). La seule différence : chaque client (élève)
est rattaché à une **académie** (`academies` : Académie Delaveau / Académie Espoir), ce qui sert à
distinguer, filtrer et suivre les deux groupes. L'académie est rappelée sur la facture (à côté du
cavalier). Tous les réglages sont dans la table `parametres` (une seule ligne) — pas de notion
d'« entité » dans l'interface.

## Pile technique

- **Next.js 16** (App Router, TypeScript, `src/`), déployé sur **Vercel**.
  ⚠️ Next 16 : le middleware s'appelle `proxy` (`src/proxy.ts`) ; `params`, `searchParams`,
  `cookies()` et `headers()` sont **asynchrones** (`await`). Documentation locale :
  `node_modules/next/dist/docs/`. Types globaux `PageProps<'/route/[id]'>` et `LayoutProps<'/'>`.
- **Supabase** : Postgres + Auth (e-mail / mot de passe). Schéma : `supabase/migrations/`.
- **Tailwind CSS v4** : classes de composants dans `src/app/globals.css`.
- **@react-pdf/renderer** pour le PDF, **nodemailer** (SMTP) pour l'envoi.
- **Vitest** : `npm test`. Tests SQL sur PGlite (`tests/sql/`).

## Règles métier (appliquées en base, ne pas les réimplémenter côté client)

| Règle | Où |
|---|---|
| Montants en **centimes** (`integer`) partout | tables, `src/lib/format.ts` |
| Brouillon = pas de numéro. `emettre_facture(id)` attribue `AD-2026-0001` (série unique, continue par année ; préfixe dans `parametres`, figé après la 1re émission), date d'émission = aujourd'hui (Paris), échéance = + délai, fige client / émetteur / académie (`client_snapshot`, `emetteur_snapshot`, `academie_snapshot`) | SQL |
| Une facture est **créée en brouillon** (sans numéro, année, séquence, date d'émission ni instantané) : toute autre insertion est refusée | trigger `proteger_insertion_facture` |
| Facture émise : contenu et lignes **non modifiables**, **non supprimable** → on l'annule | trigger `proteger_facture` |
| Transitions : `emise→envoyee/payee/annulee`, `envoyee→payee/annulee`, `payee→emise/envoyee` (annuler un paiement), `annulee` définitif. `payee` exige `payee_le`. | trigger |
| Total HT d'un brouillon recalculé automatiquement depuis les lignes ; TVA/TTC depuis `taux_tva`. Un nouveau taux dans `parametres` est reporté aussitôt sur les brouillons | triggers |
| `lignes_facture.total_centimes` est une colonne générée : **ne jamais l'insérer** | SQL |
| `factures.academie_id` est renseigné automatiquement depuis le client (trigger) tant que la facture est un brouillon : **ne pas l'envoyer à l'insertion**. Un client qui change d'académie entraîne aussitôt ses brouillons (trigger `clients_academie_brouillons`) ; les factures émises gardent l'académie figée | SQL |
| Tarif client : `prix_unitaire_centimes` null → prix catalogue de la prestation ; `libelle` null → libellé de la prestation. Catalogue commun. | SQL |
| Génération mensuelle : `generer_brouillons_mensuels(periode, academie_id?, dry_run)` crée un brouillon par client actif ayant des tarifs actifs, récurrents et valides sur le mois (toutes académies si `academie_id` null). Idempotente. `dry_run` ne fait que lire (aperçu du tableau de bord et de la facturation mensuelle). Désactiver une académie ne coupe **pas** la facturation de ses clients actifs (archiver les clients pour cela). | SQL |
| `parametres` : une seule ligne, ni insertion ni suppression ; `select`/`update` seulement | SQL |
| « En retard » = `emise`/`envoyee` et échéance dépassée → colonne `en_retard` de la vue `factures_vue` | SQL |
| Accès : utilisateur connecté **et** e-mail présent dans la table `membres` (RLS) | SQL |

## Modules partagés (déjà écrits — à utiliser, ne pas dupliquer)

- `@/lib/types` : types des tables (`Parametres`, `Academie`, `Prestation`, `Client`, `TarifClient`,
  `Facture`, `FactureVue`, `LigneFacture`, `EnvoiEmail`, `FactureComplete`, `ResultatAction`).
- `@/lib/format` (pur, utilisable partout) : `formatEuros`, `formatEurosPdf`, `formatQuantite`,
  `parseEurosEnCentimes`, `centimesVersSaisie`, `formatDate`, `formatDateLongue` (« 1er octobre 2026 »),
  `formatDateHeure`, `formatPeriode`, `jourDuMois`, `aujourdhuiParis`, `premierDuMois`,
  `datesGeneration(jour, aujourdhui)`, `nomClient`, `destinatairesFacture`, `pluriel`
  (« 0 facture », « 2 factures »), `nomCourtAcademie` (« Delaveau »), `avecArticle`
  (« l'Académie Espoir »), `LIBELLES_STATUT`, `MODES_PAIEMENT`. Une date SQL "AAAA-MM-JJ" est
  affichée telle quelle, quel que soit le fuseau du serveur.
- `@/lib/tarifs` (pur) : `prixApplique`, `totalLigneCentimes` (arrondi identique à Postgres),
  `mensuelEstime`, `tarifFactureSurMois`, `situationSurMois`, `parseQuantite`, `quantiteVersSaisie`,
  `CHAMPS_TARIF_POUR_CALCUL` (à mettre dans le `select` de `tarifs_clients`).
- `@/lib/auth` : `exigerUtilisateur()` → `{ supabase, utilisateur }` (redirige vers /connexion).
  **À appeler en tête de chaque page protégée et de chaque Server Action.**
- `@/lib/supabase/server` : `creerClientServeur()` ; `@/lib/supabase/admin` : `creerClientAdmin()`
  (clé secrète, **cron uniquement**) ; `@/lib/supabase/client` : `creerClientNavigateur()`.
- `@/lib/facturation/service` : `chargerParametres`, `chargerAcademies`, `chargerFactureComplete`,
  `emettreFacture`, `genererBrouillonsMensuels(supabase, periode, { academieId?, apercu? })`,
  `periodeAFacturer(parametres, date?)`, `destinatairesFacture` (réexporté de `@/lib/format`).
- `@/lib/academie-selectionnee` : `academieSelectionnee()` → id mémorisé dans le cookie (ou `null`) ;
  **toujours** le passer à `resoudreAcademie(id, academies)` → l'académie filtrée si elle existe et
  est active, sinon `null` (« Toutes »). `@/app/actions-academie` : `choisirAcademie(id | null)`.
- Composants : `@/components/StatutBadge`, `@/components/AcademieBadge`, `@/components/Modale`
  (`Modale` — `verrouillee` pendant un enregistrement, alimenté par `useSignalerEnCours` dans le
  formulaire affiché ; `ModaleConfirmation` : `onConfirmer` renvoie un `ResultatAction`, `onSucces(resultat)`),
  `@/components/Icones` (**seul** jeu d'icônes : `IconePlus`, `IconeCrayon`, `IconeAlerte`…).
- Classes CSS : `titre-page`, `titre-section`, `carte`, `carte-corps`, `btn-primaire`,
  `btn-secondaire`, `btn-danger`, `btn-lien`, `btn-petit`, `label`, `champ`, `aide`, `erreur`,
  `succes`, `avertissement`, `tableau`, `badge`. Couleurs : `brand`, `brand-dark`, `brand-light`,
  `brand-grey`, `page`, `surface`, `ink`, `muted`, `line`. Police titres : `font-display`.

## Contrats entre modules

### PDF — `src/lib/pdf/`
```ts
// src/lib/pdf/index.ts
export async function genererPdfFacture(donnees: FactureComplete): Promise<Buffer>;
export function nomFichierFacture(facture: Facture): string; // "Facture-AD-2026-0001.pdf" / "Brouillon-….pdf"
```
Route : `GET /api/factures/[id]/pdf` (session requise) → `application/pdf`, `inline` ;
`?telecharger=1` → `attachment`. Un brouillon est rendu avec un filigrane « BROUILLON ».
Aperçu de la charte : `GET /api/parametres/apercu-pdf` (session requise ; brouillon fictif avec les
paramètres réels et la première académie active ; `?telecharger=1`). Le nom de l'académie est imprimé
sous le(s) cavalier(s) dans le bloc « Facturé à ».

### E-mail — `src/lib/email/`
```ts
// src/lib/email/index.ts
export function emailConfigure(): boolean;                 // variables SMTP présentes
export async function envoyerEmail(msg: {
  a: string[]; objet: string; texte: string; html?: string;
  cci?: string[]; pieceJointe?: { nom: string; contenu: Buffer };
}): Promise<{ messageId: string; refusees: string[] }>; // refusees : destinataires `a` refusés
// (refus partiel) ; tous les destinataires `a` refusés → Error code EENVELOPE
export function remplirModele(modele: string, donnees: FactureComplete): string; // {client} {numero} {montant} {echeance} {periode} {structure} {academie} {objet}
```

### Envoi d'une facture — `src/lib/facturation/envoi.ts`
```ts
export async function envoyerFacture(supabase: SupabaseClient, factureId: string,
  options?: { exigerBrouillon?: boolean }):
  Promise<{ ok: true; destinataires: string[]; refusees: string[] } | { ok: false; erreur: string; ignoree?: true }>;
// Émet le brouillon si besoin, génère le PDF, envoie, journalise dans envois_email
// (succès ET échec), passe le statut à « envoyee » (si « emise ») et renseigne envoyee_le
// (date du DERNIER envoi). Mises à jour conditionnées au statut attendu (un paiement enregistré
// pendant l'envoi n'est jamais effacé). Une facture payée peut être renvoyée (duplicata) sans
// changer son statut. Une annulée : refus. Adresse principale refusée par le SMTP : échec.
// Destinataires = fiche client ACTUELLE (e-mail + copies, jamais figés) ; destinataires et SMTP
// vérifiés AVANT l'émission (un brouillon sans destinataire n'est pas émis).
// `exigerBrouillon` (facturation mensuelle, cron) : une facture qui n'est plus un brouillon est
// ignorée (`ignoree: true`), sans e-mail — deux envois simultanés ne font pas de doublon.
// Le PDF et {structure} utilisent l'émetteur figé à l'émission ; l'e-mail lui-même (modèles
// objet/corps, copie cachée email_copie, couleurs, pied) utilise les paramètres ACTUELS.
export async function envoyerFactures(supabase: SupabaseClient, ids: string[],
  options?: { exigerBrouillon?: boolean }):
  Promise<{ id: string; ok: boolean; erreur?: string; ignoree?: boolean }[]>; // séquentiel
```

### Server Actions
- Déclarées dans un fichier `actions.ts` du dossier de la route (`"use server"`).
- Valident les entrées avec **zod**, appellent `exigerUtilisateur()`, retournent
  `ResultatAction` (jamais d'exception vers le client), puis `revalidatePath(...)`.
- Formulaires : `useActionState` (React 19) dans des composants client ; messages en français.
- Côté navigateur, un appel direct (hors `ModaleConfirmation`, qui s'en charge) passe par
  `appeler(action(...))` (`@/lib/appeler`) : une coupure réseau devient un `ResultatAction` en échec,
  une redirection est relancée (`unstable_rethrow`).
- Envois groupés : le navigateur appelle l'action par lots de `LOT_ENVOI` (10) factures
  (`envoyerParLots`, `src/components/factures/lots.ts`) ; une action n'en accepte pas plus de
  `LOT_ENVOI_MAX` (20) par appel.

## Arborescence des routes

```
src/app/
  layout.tsx                    racine (polices, globals.css)
  connexion/                    page de connexion (publique)
  (app)/layout.tsx              coquille : barre latérale, filtre d'académie (Toutes / Delaveau / Espoir), déconnexion
  (app)/page.tsx                tableau de bord
  (app)/clients/…               liste, nouveau, [id] (fiche + tarifs)
  (app)/prestations/…           catalogue (commun)
  (app)/factures/…              liste, nouvelle, [id]
  (app)/facturation-mensuelle/  génération du mois + envoi groupé
  (app)/parametres/             un seul formulaire : infos légales, IBAN, mentions, e-mails,
                                automatisation ; académies (nom, couleur) ; test SMTP ; membres
  (app)/[...inconnu]/           URL inconnue → 404 dans la coquille ((app)/not-found.tsx)
  api/factures/[id]/pdf/route.ts
  api/parametres/apercu-pdf/route.ts
  api/cron/facturation-mensuelle/route.ts
```

### Paramètres d'URL et ancres (contrats entre pages)
- `/factures?statut=brouillon|emise|envoyee|en_retard|payee|annulee&mois=AAAA-MM&q=…`
  (filtré en plus par le cookie d'académie).
- `/factures/nouvelle?client=<uuid>` : client présélectionné.
- `/facturation-mensuelle?academie=toutes|<uuid>&mois=AAAA-MM` (par défaut : cookie, puis
  `periodeAFacturer`).
- `/clients?q=…&archives=1`, `/prestations?archivees=1`.
- Ancres de `/parametres` (`src/components/parametres/sections.ts`, à garder stables) : `#charte`
  `#legal` `#coordonnees` `#paiement` `#tva` `#mensuelle` `#emails` `#academies` `#envoi-emails`
  `#utilisateurs`.

## Tâche planifiée
Vercel appelle chaque jour à 6 h UTC `GET /api/cron/facturation-mensuelle` avec
`Authorization: Bearer $CRON_SECRET`. Si `parametres.generation_auto` et
`jour_generation` = jour du mois (Paris) : génère les brouillons du mois pour toutes les académies
(`periodeAFacturer`). Si `envoi_auto` : émet et envoie les brouillons nouvellement créés.
Réponse JSON : `ok`, `date`, `jour`, `apercu`, `execute`, `raison` (si rien à faire) ou `periode`,
`reglages`, `brouillons_crees`, `deja_existantes`, `par_academie`, `envoi_auto`, `envoyees`,
`echecs_envoi`. Tests manuels : `?date=AAAA-MM-JJ` (simule un jour) et `?apercu=1` (n'écrit rien).
Codes : 401 secret faux, 500 `CRON_SECRET` absent ou génération impossible, 400 date invalide ;
un envoi en échec (client sans e-mail…) laisse la réponse à 200 et figure dans `echecs_envoi`
(et dans `envois_email`).
