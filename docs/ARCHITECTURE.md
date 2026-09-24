# Architecture — CRM de facturation Académie Delaveau

Application interne (2 utilisateurs) de suivi des clients et de facturation mensuelle
pour deux entités : **Académie Delaveau** (préfixe `AD`) et **Académie Espoir** (préfixe `AE`).

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
| Brouillon = pas de numéro. `emettre_facture(id)` attribue `AD-2026-0001` (continu par entité/année), date d'émission = aujourd'hui (Paris), échéance = + délai, fige coordonnées client/entité | SQL |
| Facture émise : contenu et lignes **non modifiables**, **non supprimable** → on l'annule | trigger `proteger_facture` |
| Transitions : `emise→envoyee/payee/annulee`, `envoyee→payee/annulee`, `payee→emise/envoyee` (annuler un paiement), `annulee` définitif. `payee` exige `payee_le`. | trigger |
| Total HT d'un brouillon recalculé automatiquement depuis les lignes ; TVA/TTC depuis `taux_tva` | triggers |
| `lignes_facture.total_centimes` est une colonne générée : **ne jamais l'insérer** | SQL |
| Tarif client : `prix_unitaire_centimes` null → prix catalogue de la prestation ; `libelle` null → libellé de la prestation. La prestation doit être de la même entité que le client. | SQL |
| Génération mensuelle : `generer_brouillons_mensuels(entite, periode, dry_run)` crée un brouillon par client actif ayant des tarifs actifs, récurrents et valides sur le mois. Idempotente. | SQL |
| « En retard » = `emise`/`envoyee` et échéance dépassée → colonne `en_retard` de la vue `factures_vue` | SQL |
| Accès : utilisateur connecté **et** e-mail présent dans la table `membres` (RLS) | SQL |

## Modules partagés (déjà écrits — à utiliser, ne pas dupliquer)

- `@/lib/types` : types des tables (`Entite`, `Prestation`, `Client`, `TarifClient`, `Facture`,
  `FactureVue`, `LigneFacture`, `EnvoiEmail`, `FactureComplete`, `ResultatAction`).
- `@/lib/format` : `formatEuros`, `formatEurosPdf`, `formatQuantite`, `parseEurosEnCentimes`,
  `centimesVersSaisie`, `formatDate`, `formatDateLongue`, `formatDateHeure`, `formatPeriode`,
  `aujourdhuiParis`, `premierDuMois`, `nomClient`, `LIBELLES_STATUT`, `MODES_PAIEMENT`.
- `@/lib/auth` : `exigerUtilisateur()` → `{ supabase, utilisateur }` (redirige vers /connexion).
  **À appeler en tête de chaque page protégée et de chaque Server Action.**
- `@/lib/supabase/server` : `creerClientServeur()` ; `@/lib/supabase/admin` : `creerClientAdmin()`
  (clé secrète, **cron uniquement**) ; `@/lib/supabase/client` : `creerClientNavigateur()`.
- `@/lib/facturation/service` : `chargerFactureComplete`, `emettreFacture`,
  `genererBrouillonsMensuels`, `periodeAFacturer`, `destinatairesFacture`.
- `@/lib/entite-selectionnee` : `entiteSelectionnee()` → id de l'entité filtrée ou `null` (toutes).
  `@/app/actions-entite` : `choisirEntite(id | null)` (Server Action).
- `@/components/StatutBadge`, `@/components/EntiteBadge`.
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

### E-mail — `src/lib/email/`
```ts
// src/lib/email/index.ts
export function emailConfigure(): boolean;                 // variables SMTP présentes
export async function envoyerEmail(msg: {
  a: string[]; objet: string; texte: string; html?: string;
  cci?: string[]; pieceJointe?: { nom: string; contenu: Buffer };
}): Promise<{ messageId: string }>;
export function remplirModele(modele: string, donnees: FactureComplete): string; // {client} {numero} {montant} {echeance} {periode} {entite} {objet}
```

### Envoi d'une facture — `src/lib/facturation/envoi.ts`
```ts
export async function envoyerFacture(supabase: SupabaseClient, factureId: string):
  Promise<{ ok: true; destinataires: string[] } | { ok: false; erreur: string }>;
// Émet le brouillon si besoin, génère le PDF, envoie, journalise dans envois_email
// (succès ET échec), passe le statut à « envoyee » (si « emise ») et renseigne envoyee_le.
// Une facture payée peut être renvoyée (duplicata) sans changer son statut. Une annulée : refus.
export async function envoyerFactures(supabase: SupabaseClient, ids: string[]):
  Promise<{ id: string; ok: boolean; erreur?: string }[]>; // séquentiel
```

### Server Actions
- Déclarées dans un fichier `actions.ts` du dossier de la route (`"use server"`).
- Valident les entrées avec **zod**, appellent `exigerUtilisateur()`, retournent
  `ResultatAction` (jamais d'exception vers le client), puis `revalidatePath(...)`.
- Formulaires : `useActionState` (React 19) dans des composants client ; messages en français.

## Arborescence des routes

```
src/app/
  layout.tsx                    racine (polices, globals.css)
  connexion/                    page de connexion (publique)
  (app)/layout.tsx              coquille : barre latérale, sélecteur d'entité, déconnexion
  (app)/page.tsx                tableau de bord
  (app)/clients/…               liste, nouveau, [id] (fiche + tarifs)
  (app)/prestations/…           catalogue par entité
  (app)/factures/…              liste, nouvelle, [id]
  (app)/facturation-mensuelle/  génération du mois + envoi groupé
  (app)/parametres/…            entités (infos légales, paiement, e-mails, automatisation), test SMTP
  api/factures/[id]/pdf/route.ts
  api/cron/facturation-mensuelle/route.ts
```

## Tâche planifiée
Vercel appelle chaque jour à 6 h UTC `GET /api/cron/facturation-mensuelle` avec
`Authorization: Bearer $CRON_SECRET`. Pour chaque entité active avec `generation_auto` et
`jour_generation` = jour du mois (Paris) : génère les brouillons du mois
(`periodeAFacturer`). Si `envoi_auto` : émet et envoie ces brouillons. Réponse JSON récapitulative.
