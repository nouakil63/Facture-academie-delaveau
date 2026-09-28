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

**Modèle de l'année scolaire** (migration `20260930000000`) : saison 2026 = septembre 2026 → juin 2027.
1. À la rentrée, **une facture annuelle par élève** (client) et par saison (`factures.type_facture =
   'annuelle'`, `saison`), numérotée dans la série normale (`emettre_facture`), avec la **référence élève**
   (`clients.reference` : E1, E2… une seule série pour les deux académies) imprimée à côté du numéro.
2. À son émission, **10 échéances** (table `echeances`, septembre → juin) : les **avis d'échéance** envoyés
   chaque mois. Un avis n'est **pas** une facture : aucun numéro de facture, numéro d'avis
   `<référence>-<AAAA>-<MM>` (E1-2026-09), mention « Document non fiscal ».
3. Juillet/août et prestations ponctuelles (stages…) : factures classiques (`type_facture = 'ponctuelle'`,
   défaut ; nouvelle facture manuelle et duplication restent ponctuelles).
L'ancien modèle (brouillons mensuels, `generer_brouillons_mensuels`) est conservé en base mais n'est plus
utilisé par l'interface ni par la tâche planifiée ; ses brouillons de la saison sont signalés (double
facturation) avec une action « Supprimer ces anciens brouillons ».

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
| *(Ancien modèle, conservé mais plus appelé par l'interface ni par le cron)* Génération mensuelle : `generer_brouillons_mensuels(periode, academie_id?, dry_run)` crée un brouillon par client actif ayant des tarifs actifs, récurrents et valides sur le mois (toutes académies si `academie_id` null). Idempotente. `dry_run` ne fait que lire (aperçu du tableau de bord et de la facturation mensuelle). Désactiver une académie ne coupe **pas** la facturation de ses clients actifs (archiver les clients pour cela). | SQL |
| `parametres` : une seule ligne, ni insertion ni suppression ; `select`/`update` seulement | SQL |
| Envoi automatique **par client** (`clients.envoi_auto`, défaut `false`) : le jour d'envoi (`jour_generation`), la tâche planifiée envoie l'**avis d'échéance** du mois des clients actifs cochés (voir Tâche planifiée). Aucune facture n'est plus générée ni émise automatiquement. `parametres.generation_auto` n'est plus utilisé (colonne conservée) | cron |
| **Arrhes par client** (`clients.arrhes_reglees`, `arrhes_centimes`, `arrhes_saison` = année de la rentrée, migration `20260929000000`). **Facture annuelle** : déduites du total pour calculer les 10 échéances (voir « Échéances créées à l'émission ») et imprimées sous le total ; lues à l'émission (un brouillon et son PDF reflètent toujours la fiche actuelle). *Ancien modèle mensuel* : si réglées et > 0, chaque facture **mensuelle** de septembre (saison) à juin (saison + 1) est diminuée de `floor(arrhes / 10)`, juin recevant le reste (`arrhes − 9 × floor(arrhes / 10)`) ; juillet/août et autres saisons : rien. `deduction_arrhes(client, periode)`. La déduction est retirée du **prix unitaire** de la ligne de plus grand total parmi les lignes de quantité 1 (égalité : la première dans l'ordre), si son prix ≥ déduction ; sinon **aucune déduction** (jamais de prix négatif, signalé sur la fiche et la facturation mensuelle). Aucune ligne « arrhes » : la facture montre le net. `total_ht_centimes` renvoyé (aperçu compris) = montant réel. Côté TS : `deductionArrhes`, `ligneDeductionArrhes`, `mensuelDetaille`, `mensuelNet` (`@/lib/tarifs`, même règle, testée contre Postgres) — le « mensuel estimé » affiché est **net** | SQL + `@/lib/tarifs` |
| **Informations figées sur les lignes générées** : `generer_factures_annuelles` (prix × mois) et `generer_brouillons_mensuels` renseignent `lignes_facture.prix_catalogue_centimes` (prix de la prestation liée, sinon null), `motif_reduction` (copie de `tarifs_clients.motif_reduction`, motif d'un prix personnalisé inférieur au catalogue) et `deduction_arrhes_centimes` (déduction retirée de cette ligne). Nulles pour les lignes existantes ou saisies à la main ; figées avec la ligne à l'émission | SQL |
| Rappel imprimé sous l'objet d'une facture **mensuelle** (septembre à juin) : « Enseignement annuel : … · {motif} : −… · Arrhes versées : … · Échéancier sur 10 mois (septembre à juin) » (`texteRappelFacture`, `src/lib/pdf/FacturePdf.tsx`). Arrhes lues dans `client_snapshot` pour une facture émise, sur la fiche pour un brouillon. Informatif : ne change jamais le total | PDF |
| « En retard » = `emise`/`envoyee` et échéance dépassée → colonne `en_retard` de la vue `factures_vue` | SQL |
| **Référence élève** `clients.reference` : `not null`, unique, format `^[A-Z0-9][A-Z0-9_-]{0,19}$` (normalisée en majuscules, espaces retirés). Vide à la création → `prochaine_reference_client()` = `E` + (plus grand numéro des références `E<n>`) + 1 ; vide à la modification → inchangée (trigger `a_clients_reference`). Reprise : clients existants E1, E2… dans l'ordre de `created_at`. Figée dans `client_snapshot` à l'émission | SQL |
| **Facture annuelle** : `type_facture = 'annuelle'` et `saison` (année de la rentrée) ; contrainte `(type = annuelle) = (saison non nulle)`, `periode` nulle ; une seule facture annuelle **non annulée** par client et saison (index `factures_annuelle_unique`, brouillons compris). Type et saison figés à l'émission | SQL |
| `generer_factures_annuelles(saison, academie_id?, dry_run)` : un brouillon par client actif ayant au moins une ligne `lignes_annuelles_client` (tarif actif, récurrent, valide sur au moins un mois de la saison). Une ligne par tarif : libellé « <libellé> – 2026-2027 » (« (8 mois) » si partiel), prix unitaire annuel = prix mensuel appliqué × nombre de mois de validité sur septembre → juin (**× 10** pour un tarif valide toute l'année), `prix_catalogue_centimes` = catalogue × même nombre, `motif_reduction` recopié. Objet « <objet_facture_mensuelle> – saison 2026-2027 », `generation_auto = true`. Idempotente (`deja_existante`, total = celui de la facture existante) | SQL + `annuelEstime` |
| **Échéances créées à l'émission** (`emettre_facture`, même signature et même retour) : reste = total TTC − arrhes **de la fiche au moment de l'émission** (si réglées, > 0 et `arrhes_saison = saison`), jamais < 0 ; septembre → mai `floor(reste / 10)`, juin le reste ; reste nul : aucune échéance. `date_echeance` = `greatest(jour_generation du mois, date d'émission) + delai_paiement_jours` (paramètres à l'émission). La facture annuelle prend pour échéance celle de juin. Numéro d'avis unique (suffixe `-2`, `-3`… si une facture annulée l'a déjà utilisé) | SQL + `echeancierAnnuel`, `dateEcheanceAvis` |
| Échéances protégées (trigger `a_echeances_proteger`) : créées seulement par `emettre_facture`, jamais supprimées, montant/date/numéro figés. Transitions `a_venir → envoyee/payee`, `envoyee → payee`, `payee → a_venir/envoyee` (annuler un paiement) ; `annulee` (définitif) seulement quand la facture est annulée. `payee` exige `payee_le` | SQL |
| Facture annuelle à échéances : **payée automatiquement** (`payee_le` = dernier paiement, mode unique sinon « Échéancier ») quand toutes ses échéances non annulées sont payées ; rouverte (`envoyee`/`emise`) si un paiement d'échéance est annulé (trigger `c_echeances_facture`). Paiement manuel de la facture refusé tant qu'une échéance est due. **Facture annulée → échéances non payées annulées**, paiements reçus conservés | SQL |
| « En retard » d'une facture annuelle à échéances = au moins une échéance échue non payée (`factures_vue.en_retard`) ; `echeances_vue.en_retard` = `a_venir`/`envoyee` et date dépassée | SQL |
| `recalculer_brouillon(facture_id)` (« Recalculer depuis les tarifs ») : brouillon généré uniquement (annuel → `lignes_annuelles_client` ; ancien mensuel → `lignes_mensuelles_client`, même règle que `generer_brouillons_mensuels`, arrhes comprises) ; remplace toutes les lignes ; refus si aucun tarif valide, facture émise ou brouillon manuel | SQL |
| Tableau de bord : « À encaisser » = échéances **exigibles** non payées (avis envoyé, ou mois commencé) + factures **ponctuelles** émises/envoyées ; « En retard » = échéances échues + ponctuelles échues ; « Encaissé ce mois-ci » = échéances payées + ponctuelles payées dans le mois. Une facture annuelle ne compte jamais elle-même (ses échéances la représentent) | `components/tableau-de-bord/donnees.ts` |
| Accès : utilisateur connecté **et** e-mail présent dans la table `membres` (RLS, `echeances` comprise) | SQL |

## Modules partagés (déjà écrits — à utiliser, ne pas dupliquer)

- `@/lib/types` : types des tables (`Parametres`, `Academie`, `Prestation`, `Client`, `TarifClient`,
  `Facture`, `FactureVue`, `LigneFacture`, `EnvoiEmail`, `FactureComplete` (+ `echeances` d'une facture
  annuelle émise), `Echeance`, `EcheanceVue`, `AvisComplet`, `TypeFacture`, `StatutEcheance`, `ResultatAction`).
- `@/lib/format` (pur, utilisable partout) : `formatEuros`, `formatEurosPdf`, `formatQuantite`,
  `parseEurosEnCentimes`, `centimesVersSaisie`, `formatDate`, `formatDateLongue` (« 1er octobre 2026 »),
  `formatDateHeure`, `formatPeriode`, `jourDuMois`, `aujourdhuiParis`, `premierDuMois`,
  `datesGeneration(jour, aujourdhui)`, `nomClient`, `destinatairesFacture`, `pluriel`
  (« 0 facture », « 2 factures »), `nomCourtAcademie` (« Delaveau »), `avecArticle`
  (« l'Académie Espoir »), `LIBELLES_STATUT`, `MODES_PAIEMENT`. Une date SQL "AAAA-MM-JJ" est
  affichée telle quelle, quel que soit le fuseau du serveur.
- `@/lib/tarifs` (pur) : `prixApplique`, `totalLigneCentimes` (arrondi identique à Postgres),
  `mensuelEstime`, `tarifFactureSurMois`, `situationSurMois`, `parseQuantite`, `quantiteVersSaisie`,
  `CHAMPS_TARIF_POUR_CALCUL` (à mettre dans le `select` de `tarifs_clients`). Année scolaire (mêmes règles
  que la base, testées contre Postgres) : `moisSaison`, `saisonDePeriode`, `saisonEnCours`, `libelleSaison`,
  `moisAvecEcheance`, `nbMoisSurSaison`, `prixAnnuel`, `annuelEstime`, `arrhesSurSaison`,
  `montantsEcheances`, `echeancierAnnuel`, `dateEcheanceAvis`.
- `@/lib/auth` : `exigerUtilisateur()` → `{ supabase, utilisateur }` (redirige vers /connexion).
  **À appeler en tête de chaque page protégée et de chaque Server Action.**
- `@/lib/supabase/server` : `creerClientServeur()` ; `@/lib/supabase/admin` : `creerClientAdmin()`
  (clé secrète, **cron uniquement**) ; `@/lib/supabase/client` : `creerClientNavigateur()`.
- `@/lib/facturation/service` : `chargerParametres`, `chargerAcademies`, `chargerFactureComplete`,
  `emettreFacture`, `genererFacturesAnnuelles(supabase, saison, { academieId?, apercu? })`,
  `chargerEcheancesFacture`, `chargerAvisComplet(supabase, echeanceId)`, `periodeAFacturer(parametres, date?)`
  (mois des avis envoyés un jour donné), `destinatairesFacture` (réexporté de `@/lib/format`).
  `genererBrouillonsMensuels` : ancien modèle, plus utilisé.
- `@/lib/academie-selectionnee` : `academieSelectionnee()` → id mémorisé dans le cookie (ou `null`) ;
  **toujours** le passer à `resoudreAcademie(id, academies)` → l'académie filtrée si elle existe et
  est active, sinon `null` (« Toutes »). `@/app/actions-academie` : `choisirAcademie(id | null)`.
- Année scolaire : `@/components/annee/*` — `TableauEcheances` (+ `COLONNES_ECHEANCE` pour
  `echeances_vue`), `ActionsEcheance` (PDF, envoi, paiement, annulation du paiement), `ActionsAnnuelles`
  (préparer, émettre et envoyer, envoyer les avis du mois, supprimer les anciens brouillons mensuels),
  `SelecteurAnnee`, `StatutEcheanceBadge`, `ReferenceBadge`. Server Actions :
  `@/app/(app)/facturation-annuelle/actions`.
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
export async function genererPdfAvis(donnees: AvisComplet): Promise<Buffer>;
export function nomFichierAvis(echeance: Pick<Echeance, "numero_avis">): string; // "Avis-E1-2026-09.pdf"
```
Routes : `GET /api/factures/[id]/pdf` et `GET /api/echeances/[id]/pdf` (session requise) →
`application/pdf`, `inline` ; `?telecharger=1` → `attachment`. Un brouillon est rendu avec un filigrane
« BROUILLON ». Outils communs (texte Helvetica, couleurs, pied) : `src/lib/pdf/outils.ts`.
- **Facture annuelle** (`FacturePdf`) : « FACTURE » + « Année scolaire 2026-2027 », numéro, « Réf. élève : E1 »
  (près du numéro et dans « Facturé à ») ; ligne à prix réduit motivé : « Tarif annuel 24 000,00 € – <motif> :
  −3 000,00 € » (`texteReductionLigne`) ; sous le total « Arrhes versées : … — Reste à payer : … » ; tableau
  **échéancier** (mois, date d'échéance, montant) des 10 échéances — réelles si émise, prévisionnelles
  (arrhes de la fiche actuelle) pour un brouillon (`echeancierFacture`). La référence élève est aussi imprimée
  sur toute facture dont l'instantané client la contient.
- **Avis d'échéance** (`AvisEcheancePdf`, même charte) : « AVIS D'ÉCHÉANCE », n° d'avis, « Facture n° … du … »,
  réf. élève, élève/famille + académie, « Échéance de septembre 2026 (1/10) », montant en grand, date limite,
  coordonnées bancaires + « Référence à rappeler : E1-2026-09 », rappel « Total annuel · Arrhes versées ·
  Déjà réglé · Reste dû après cette échéance » (`rappelAvis`, `texteRappelAvis`), pied « Document non fiscal —
  la facture est la facture annuelle n° … ». Émetteur, client et arrhes : figés sur la facture annuelle.
```ts
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
export function remplirModele(modele: string, donnees: FactureComplete): string; // {client} {numero} {montant} {echeance} {periode} {structure} {academie} {objet} {reference}
export function remplirModeleAvis(modele: string, donnees: AvisComplet): string; // {client} {numero} (n° d'avis) {montant} {echeance} {periode} {facture} {structure} {academie} {reference}
```
Modèles d'avis : `parametres.email_avis_objet` / `email_avis_corps` (Paramètres › E-mails).

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

### Envoi d'un avis d'échéance — `src/lib/facturation/avis.ts`
```ts
export async function envoyerAvis(supabase: SupabaseClient, echeanceId: string,
  options?: { exigerAEnvoyer?: boolean }):
  Promise<{ ok: true; destinataires: string[]; refusees: string[] } | { ok: false; erreur: string; ignoree?: true }>;
// PDF de l'avis joint ; journal dans envois_email (facture_id = facture annuelle, echeance_id), succès ET
// échec ; statut a_venir → envoyee et envoyee_le (date du DERNIER envoi) ; renvoi d'un avis déjà envoyé :
// seule la date change ; échéance payée ou annulée : refus. Mises à jour conditionnées au statut attendu.
// Mêmes règles que envoyerFacture : fiche client ACTUELLE (destinataires), paramètres ACTUELS (modèles,
// copie cachée), émetteur figé de la facture (PDF). `exigerAEnvoyer` (cron) : avis plus « à envoyer » ignoré.
export async function envoyerAvisLot(supabase, ids, options?): Promise<{ id; ok; erreur?; ignoree? }[]>; // séquentiel
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
  (app)/facturation-annuelle/   année scolaire : factures annuelles (aperçu, préparer, émettre et envoyer),
                                avis d'échéance du mois (envoi groupé, paiement) ; /facturation-mensuelle
                                redirige ici (next.config.ts, paramètres conservés)
  (app)/parametres/             un seul formulaire : infos légales, IBAN, mentions, e-mails,
                                automatisation ; académies (nom, couleur) ; test SMTP ; membres
  (app)/[...inconnu]/           URL inconnue → 404 dans la coquille ((app)/not-found.tsx)
  api/factures/[id]/pdf/route.ts
  api/echeances/[id]/pdf/route.ts
  api/parametres/apercu-pdf/route.ts
  api/cron/facturation-mensuelle/route.ts
```

### Paramètres d'URL et ancres (contrats entre pages)
- `/factures?statut=brouillon|emise|envoyee|en_retard|payee|annulee&type=annuelle|ponctuelle&mois=AAAA-MM&q=…`
  (filtré en plus par le cookie d'académie ; `q` cherche aussi la référence élève).
- `/factures/nouvelle?client=<uuid>` : client présélectionné.
- `/facturation-annuelle?academie=toutes|<uuid>&saison=AAAA&mois=AAAA-MM` (par défaut : cookie, saison en
  cours, mois en cours s'il appartient à la saison ; ancre `#avis`).
- Fiche client : section `#annee` (facture annuelle de la saison en cours et ses échéances).
- `/clients?q=…&archives=1` (`q` cherche aussi la référence), `/prestations?archivees=1`.
- `/api/parametres/apercu-pdf?modele=annuelle|avis` : facture annuelle ou avis fictifs.
- Ancres de `/parametres` (`src/components/parametres/sections.ts`, à garder stables) : `#charte`
  `#legal` `#coordonnees` `#paiement` `#tva` `#mensuelle` `#emails` `#academies` `#envoi-emails`
  `#utilisateurs`.

## Tâche planifiée
Vercel appelle chaque jour à 6 h UTC `GET /api/cron/facturation-mensuelle` (chemin conservé) avec
`Authorization: Bearer $CRON_SECRET`. **Aucune facture n'est générée ni émise automatiquement** : les factures
annuelles se préparent et s'émettent à la main (rentrée). Le jour `jour_generation` (jour du mois, Paris), s'il
existe au moins un client **actif** avec `clients.envoi_auto`, pour le mois des avis `periodeAFacturer`
(réglage « mois en cours / précédent ») s'il n'est **ni juillet ni août** :
1. envoie (`envoyerAvisLot(…, { exigerAEnvoyer: true })`) l'avis d'échéance du mois de chaque client actif en
   envoi automatique, s'il existe (facture annuelle émise) et s'il est encore « à envoyer » (jamais de renvoi
   d'un avis envoyé ou réglé) ;
2. liste les clients en envoi automatique **sans facture annuelle émise** pour la saison (aucune, ou brouillon
   à émettre) : `sans_facture_annuelle` ;
3. si au moins un envoi a été tenté (hors avis ignorés) ou un client est à traiter, envoie **un** e-mail
   récapitulatif (`src/lib/facturation/recapitulatif.ts`) aux adresses de `membres` + `parametres.email_copie`
   (sans doublon) : avis envoyés (client, n° d'avis, montant, total), échecs et raison, clients à traiter,
   lien `urlApplication()/facturation-annuelle?mois=AAAA-MM`. Son échec est journalisé et reporté dans
   `recapitulatif.erreur`, sans faire échouer la tâche.

Sinon, réponse `execute: false` avec `raison` : « aucun client en envoi automatique », « envoi des avis prévu
le N du mois », « juillet/août : pas d'avis d'échéance » (+ `periode`).

Réponse JSON : `ok`, `date`, `jour`, `apercu`, `execute`, `reglages` (`jour_generation`, `mois_facture`,
`clients_envoi_auto`), `raison` (si rien à faire) ou `periode`, `saison`, `a_envoyer` (`echeance_id`,
`client_id`, `client`, `numero_avis`, `montant_centimes`), `deja_envoyes`, `envoyes`, `echecs_envoi`
(`echeance_id`, `client`, `numero_avis`, `erreur`), `ignores`, `sans_facture_annuelle` (`client_id`, `client`,
`reference`, `raison`), `recapitulatif` (`envoye`, `destinataires`, `erreur?` ; `null` si rien à signaler).
Tests manuels : `?date=AAAA-MM-JJ` (simule un jour) et `?apercu=1` (n'envoie rien, ni avis ni récapitulatif :
`a_envoyer` liste ce qui partirait). Codes : 401 secret faux, 500 `CRON_SECRET` absent ou lecture impossible,
400 date invalide ; un envoi en échec (client sans e-mail…) laisse la réponse à 200 et figure dans
`echecs_envoi` (et dans `envois_email`).
