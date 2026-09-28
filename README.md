# Facturation — Académie Delaveau

Application web interne de suivi des clients et de facturation de l'association
**Académie Delaveau**, pour deux utilisateurs.

## Présentation

- **Une seule association.** L'Académie Delaveau et l'Académie Espoir sont la même
  association. Elles partagent les mêmes informations légales, le même IBAN, le même
  catalogue de prestations et les mêmes modèles d'e-mail.
- **Deux académies pour distinguer les élèves.** Chaque client (le payeur : parent,
  entreprise, sponsor…) est rattaché à l'**Académie Delaveau** ou à l'**Académie Espoir**.
  Ce rattachement sert à filtrer les listes, à suivre les deux groupes séparément, et il est
  rappelé sur la facture, sous le nom du ou des cavaliers.
- **Une seule numérotation.** Toutes les factures suivent la même série continue, quelle que
  soit l'académie : `AD-2026-0001`, `AD-2026-0002`… La série repart à `0001` chaque année.
- **Une facture annuelle par élève, puis des avis d'échéance.** À la rentrée, chaque élève reçoit
  une facture pour l'année scolaire (septembre → juin), numérotée dans la série normale. Elle est
  ensuite réglée en 10 échéances : chaque mois, un **avis d'échéance** (document non fiscal, sans
  numéro de facture, n° `E1-2026-09`) rappelle le montant à payer. Chaque élève a une **référence**
  (E1, E2…, une seule série pour les deux académies), imprimée sur la facture et les avis.
  Juillet/août et prestations ponctuelles (stages…) : factures classiques.

## Fonctionnalités

- **Clients** : fiche du payeur (référence élève, coordonnées, e-mail et copies, cavaliers),
  académie de rattachement, archivage, section « Année 2026-2027 » (facture annuelle et échéances).
- **Tarifs par client** : lignes récurrentes (prix mensuel, × 10 sur la facture annuelle) ou
  ponctuelles, au prix du catalogue ou à un prix personnalisé (avec motif de réduction), avec des
  dates de début et de fin facultatives.
- **Catalogue de prestations** commun aux deux académies.
- **Factures** : brouillon → émise (le numéro définitif est attribué à ce moment-là) → envoyée
  → payée, ou annulée. PDF aux couleurs de l'académie, avec l'IBAN et les mentions légales.
- **Facturation de l'année** : prépare en un clic les factures annuelles de tous les élèves (ou
  d'une académie), avec un aperçu, puis émission et envoi groupés ; chaque mois, liste des avis
  d'échéance (à envoyer, envoyés, payés, en retard), envoi groupé et enregistrement des paiements.
  L'envoi des avis peut être automatique pour les clients choisis (case sur leur fiche), avec un
  récapitulatif par e-mail.
- **Envoi par e-mail** depuis la boîte `contact@academiedelaveau.com`, PDF en pièce jointe.
  Chaque envoi est journalisé, qu'il réussisse ou non.
- **Tableau de bord** : montants à encaisser (avis d'échéance et factures ponctuelles), retards,
  brouillons en attente, répartition Delaveau / Espoir, prochain envoi des avis, avancement des
  factures annuelles.
- **Filtre d'académie** dans le menu (Toutes / Delaveau / Espoir), mémorisé d'une visite à
  l'autre.
- **Accès réservé** aux adresses e-mail autorisées : même avec un compte valide, une autre
  adresse ne voit aucune donnée.

---

## Mise en place pas à pas

Comptez environ une heure. Il faut trois comptes : **Supabase** (la base de données),
**Vercel** (l'hébergement du site) et **GitHub** (où se trouve le code), ainsi que le mot de
passe de la boîte mail Amen.

### a) Supabase : la base de données

1. Créez un compte sur [supabase.com](https://supabase.com), puis **New project** :
   - un nom (par exemple `facturation-delaveau`) ;
   - un mot de passe de base de données, à conserver dans un gestionnaire de mots de passe ;
   - **Region : une région de l'Union européenne**, par exemple *West EU (Paris)* ou
     *Central EU (Frankfurt)*.
2. Une fois le projet prêt, ouvrez **SQL Editor** (menu de gauche) → **New query**.
   Exécutez les trois fichiers du dossier `supabase/migrations`, **dans cet ordre et une
   seule fois chacun** :
   1. ouvrez `supabase/migrations/20260924000000_schema_initial.sql`, copiez tout son
      contenu, collez-le dans l'éditeur, puis cliquez sur **Run** ;
   2. faites de même avec `supabase/migrations/20260924000100_donnees_initiales.sql`.
      Ce fichier crée les paramètres de l'association et les deux académies ;
   3. faites de même avec `supabase/migrations/20260928000000_envoi_auto_clients.sql`
      (envoi automatique réglé client par client) ;
   4. faites de même avec `supabase/migrations/20260929000000_arrhes_clients.sql`
      (arrhes par client, réduction motivée) ;
   5. faites de même avec `supabase/migrations/20260930000000_facture_annuelle_echeances.sql`
      (facture annuelle, avis d'échéance, référence élève).

   **Base déjà installée** (les quatre premiers fichiers déjà exécutés) : exécuter seulement le
   **cinquième**, une seule fois. Il n'efface rien : les clients existants reçoivent une référence
   E1, E2… dans l'ordre de création ; les factures et brouillons existants restent tels quels
   (factures « ponctuelles »). Après l'avoir exécuté, redéployer l'application.
3. **Authentication → Sign In / Providers** : désactivez **« Allow new users to sign up »**.
   Personne ne pourra créer de compte depuis le site.
4. **Authentication → Users → Add user → Create new user**, pour **chacun des deux comptes** :
   saisissez l'adresse e-mail et un mot de passe, cochez **« Auto Confirm User »**, puis validez.
5. Autorisez ces deux adresses. Dans **SQL Editor → New query**, exécutez la requête
   ci-dessous en remplaçant les adresses d'exemple par les vraies, **en minuscules** :

   ```sql
   insert into membres (email) values ('premiere.adresse@exemple.fr'), ('seconde.adresse@exemple.fr');
   ```

6. Relevez trois informations, à saisir ensuite dans Vercel :
   - l'**URL du projet** : bouton **Connect** en haut de page, ou **Project Settings → Data API**
     (`https://xxxx.supabase.co`) ;
   - dans **Project Settings → API Keys** : la clé **publishable** (`sb_publishable_…`) ;
   - au même endroit : la clé **secret** (`sb_secret_…`, bouton *Reveal*). **Ne la communiquez
     jamais**, car elle donne un accès complet à la base.

### b) Vercel : la mise en ligne

1. Sur [vercel.com](https://vercel.com), connectez-vous avec GitHub, puis **Add New… →
   Project** et **importez le dépôt GitHub** de l'application. Vercel reconnaît Next.js tout
   seul.
2. Avant de déployer, ouvrez **Environment Variables**. Ajoutez une à une les variables du
   fichier [`.env.example`](.env.example) :

   | Variable | Valeur |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clé publishable |
   | `SUPABASE_SECRET_KEY` | clé secret |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | voir c) ci-dessous |
   | `CRON_SECRET` | une chaîne aléatoire d'au moins 32 caractères |
   | `APP_URL` | *(facultatif)* adresse du site, pour le lien du récapitulatif d'envoi automatique ; par défaut, le domaine de production Vercel |

   Pour `CRON_SECRET`, générez une chaîne longue au hasard : par exemple avec un gestionnaire
   de mots de passe, ou la commande `openssl rand -hex 32`. Vous n'aurez jamais à la saisir
   vous-même : Vercel l'envoie automatiquement à la tâche planifiée.
3. Cliquez sur **Deploy**. Une fois le déploiement terminé, ouvrez l'adresse du site (par
   exemple `https://facturation-delaveau.vercel.app`) et connectez-vous avec l'un des deux
   comptes.
4. **Tâche planifiée.** Le fichier `vercel.json` demande à Vercel d'appeler l'application
   **chaque jour vers 6 h (heure UTC)**. L'application vérifie alors si c'est le jour de
   d'envoi des avis choisi dans les Paramètres. Si oui (de septembre à juin), elle envoie l'avis
   d'échéance du mois des clients en envoi automatique (si leur facture annuelle est émise et
   que l'avis n'est ni déjà envoyé ni réglé), puis adresse un récapitulatif aux utilisateurs
   (table `membres`, plus l'adresse en copie cachée des Paramètres), qui signale aussi les
   clients en envoi automatique sans facture annuelle émise. Elle ne crée ni n'émet jamais de
   facture. Les autres jours, et en juillet/août, elle ne fait rien. Le suivi se trouve dans
   Vercel, onglet **Settings → Cron Jobs**, puis **Logs**.
5. *(Facultatif)* Dans **Project Settings → Functions**, choisissez la région **Paris
   (cdg1)**, proche de la base de données.

> Après toute modification d'une variable d'environnement dans Vercel, relancez un
> déploiement : **Deployments → ⋯ → Redeploy**.

### c) E-mail avec Amen (contact@academiedelaveau.com)

Les factures partent de la boîte de l'académie, hébergée chez Amen. Renseignez ces variables
dans Vercel :

| Variable | Valeur |
|---|---|
| `SMTP_HOST` | serveur d'envoi Amen, **à vérifier dans l'espace client Amen** (Messagerie → paramètres de la boîte) : `smtp-fr.securemail.pro` ou `smtp.amen.fr` selon l'offre |
| `SMTP_PORT` | `465` |
| `SMTP_SECURE` | `true` |
| `SMTP_USER` | `contact@academiedelaveau.com` (l'adresse **complète**) |
| `SMTP_PASSWORD` | le mot de passe de la boîte mail |
| `EMAIL_FROM` | `Académie Delaveau <contact@academiedelaveau.com>` |
| `EMAIL_REPLY_TO` | facultatif : une autre adresse de réponse |

Si le port 465 est refusé, essayez `SMTP_PORT=587` avec `SMTP_SECURE=false`.

**Pour tester** : dans l'application, ouvrez **Paramètres → Envoi des e-mails**. La page
indique si la configuration est complète. Le bouton **« Envoyer un e-mail de test »** envoie
un message à l'adresse de votre choix. En cas d'échec, le message d'erreur précise la cause :
mot de passe refusé, serveur introuvable…

> Si les e-mails arrivent dans les courriers indésirables, demandez au support Amen de
> vérifier que le domaine `academiedelaveau.com` possède bien un enregistrement **SPF**
> (et si possible **DKIM**) qui autorise leurs serveurs.

### d) Premiers réglages dans l'application

1. **Paramètres** (menu de gauche) :
   - **Informations légales** et **Coordonnées** : pré-remplies (SIREN/SIRET, RNA, adresse,
     e-mail). Vérifiez-les et complétez le téléphone si besoin.
   - **Paiement** : **IBAN**, BIC, titulaire du compte, délai de paiement (30 jours par
     défaut) et texte des conditions. L'IBAN est imprimé sur toutes les factures ; tant qu'il
     manque, un rappel s'affiche sur le tableau de bord.
   - **TVA et mentions** : taux et **mention de TVA** (par défaut « TVA non applicable,
     art. 293 B du CGI »), plus les mentions pour les clients professionnels. **À faire valider
     par le comptable** (voir plus bas).
   - **Identité & charte** : couleurs et logo, et le **préfixe** des numéros (`AD`). Le
     préfixe ne peut plus changer après la première facture émise.
   - **Année scolaire et avis** : objet des factures annuelles, jour d'envoi des avis (1 à 28 ;
     date limite de chaque échéance = ce jour + délai de paiement), avis du mois en cours ou du
     mois précédent. L'envoi automatique se règle client par client (voir ci-dessous).
   - **E-mails** : objet et texte du message envoyé avec chaque facture (variables `{client}`
     `{numero}` `{montant}` `{echeance}` `{periode}` `{structure}` `{academie}` `{objet}`
     `{reference}`), et avec chaque avis d'échéance (variables `{client}` `{numero}` (n° d'avis)
     `{montant}` `{echeance}` `{periode}` `{facture}` `{structure}` `{academie}` `{reference}`).
   - **Académies** : nom et couleur de l'Académie Delaveau et de l'Académie Espoir.
   - Les liens **« Aperçu d'une facture type »**, **« Facture annuelle type »** et **« Avis
     d'échéance type »** montrent le rendu des PDF avec vos réglages.
2. **Prestations** : créez le catalogue (pension, cours, stages…) avec leur prix. Il est
   commun aux deux académies.
3. **Clients** : créez chaque payeur. Choisissez son **académie** (la **référence élève** E1,
   E2… est attribuée automatiquement, modifiable), puis renseignez son e-mail (et d'éventuelles
   adresses en copie), le nom du ou des cavaliers et, le cas échéant, les **arrhes** réglées.
   Sur sa fiche, ajoutez ses **tarifs** : les prestations au prix mensuel du catalogue ou à un
   prix personnalisé. La case **« Envoyer ses avis d'échéance automatiquement »** fait partir
   son avis du mois sans relecture, le jour d'envoi (badge « Auto » dans la liste des clients).

## Utilisation au fil de l'année

1. **À la rentrée : préparer les factures annuelles.** Menu **Facturation de l'année**, choisir
   l'année scolaire (et au besoin une académie), vérifier l'aperçu (un élève par ligne, total
   annuel = prix mensuel × 10, arrhes), puis **« Préparer les factures annuelles »** : un
   brouillon par élève. Si d'anciens brouillons mensuels de la saison existent encore, la page
   les signale : **« Supprimer ces anciens brouillons »** (brouillons seulement).
2. **Relire** les brouillons (lien « Relire ») : ajouter une ligne, corriger un prix, ou
   **« Recalculer depuis les tarifs »** après une modification des tarifs de l'élève. Les arrhes
   sont lues sur la fiche au moment de l'émission : les saisir ou les corriger avant.
3. **Émettre et envoyer** : bouton groupé de la page, ou facture par facture. Chaque facture
   reçoit son numéro définitif et ses **10 échéances** (septembre à juin, arrhes déduites ; juin
   reçoit l'arrondi) ; le PDF envoyé montre l'échéancier.
4. **Chaque mois : envoyer les avis d'échéance.** Même page, rubrique « Avis d'échéance » du mois :
   **« Envoyer les avis »** (seuls les avis pas encore envoyés partent), ou avis par avis. Pour les
   clients en envoi automatique, c'est fait tout seul le jour d'envoi, avec un récapitulatif.
5. **Enregistrer les paiements** échéance par échéance (bouton « Payée » sur la page de l'année,
   sur la fiche client ou sur la facture). Quand toutes les échéances sont réglées, la facture
   annuelle passe « Payée » toute seule. Le tableau de bord indique ce qui reste à encaisser et
   les retards.
6. **Juillet/août et prestations ponctuelles** (stage, concours…) : **Factures → Nouvelle
   facture** (facture classique).

## Règles à connaître

- **Numérotation continue et unique.** Un numéro n'est attribué qu'au moment de l'émission.
  Il n'y a donc pas de trou : supprimer un brouillon ne consomme aucun numéro. Delaveau et
  Espoir partagent la même série.
- **Une facture émise ne se modifie plus et ne se supprime pas.** Pour la corriger, on
  l'**annule** (bouton « Annuler la facture », avec un motif ; c'est définitif), puis
  **« Dupliquer en brouillon »** permet de préparer la facture corrigée, qui recevra un
  nouveau numéro à son émission. La copie est une facture ponctuelle : pour
  remplacer une facture annuelle annulée, préparer une nouvelle facture annuelle depuis
  « Facturation de l'année ».
- Supprimer un **brouillon de facture annuelle** ne suffit pas à ne pas facturer l'élève : il
  est recréé à la préparation suivante tant que le client a un tarif récurrent actif (mettez une
  date de fin au tarif, ou archivez le client).
- **Annuler une facture annuelle** annule ses échéances non payées ; les paiements reçus restent
  enregistrés. Une nouvelle facture annuelle peut ensuite être préparée pour la même année.
- Un **avis d'échéance** n'est pas une facture : il ne consomme aucun numéro de facture. Son
  numéro (`E1-2026-09`) sert de référence de virement.
- Un **brouillon** reste librement modifiable et peut être supprimé.
- Un paiement enregistré par erreur peut être annulé (« Annuler le paiement » : retour à
  « émise » ou « envoyée »).
- **Changer l'académie d'un client** déplace aussi ses brouillons vers la nouvelle académie.
  Les factures déjà émises gardent l'académie d'origine.
- **Désactiver une académie** la retire des menus mais n'arrête pas la facturation de ses
  clients. Pour ne plus facturer un client, **archivez-le**.
- Les factures émises conservent les coordonnées du client et de l'association **du jour de
  l'émission**, même si les fiches changent ensuite. Seules les **adresses e-mail** (non
  imprimées) suivent la fiche client : une adresse corrigée sert dès l'envoi suivant.
- Un client **archivé** ne peut plus recevoir de nouvelle facture (ni duplication) : réactivez
  sa fiche d'abord.

## À faire valider par le comptable

- La **mention de TVA** imprimée sur les factures, et le taux (0 % par défaut, avec la mention
  « TVA non applicable, art. 293 B du CGI »). Selon la situation de l'association, une autre
  mention ou un autre article peut être requis.
- Les **mentions pour les clients professionnels** (pénalités de retard, indemnité forfaitaire
  de 40 €).
- La procédure en cas d'erreur sur une facture émise : l'application l'**annule**. Le
  comptable dira si un **avoir** doit en plus être établi.
- La durée de **conservation** des factures (les PDF peuvent être retéléchargés à tout moment
  depuis l'application ; la base Supabase doit être conservée).

---

## Développement local

Prérequis : **Node.js 20.9 ou plus récent**.

```bash
npm install
cp .env.example .env.local   # puis compléter les valeurs (projet Supabase de test conseillé)
npm run dev                  # http://localhost:3000
```

Commandes utiles :

| Commande | Rôle |
|---|---|
| `npm test` | tous les tests, dont ceux de la base de données (Postgres en mémoire, sans Supabase) |
| `npm run typecheck` | vérification des types TypeScript |
| `npm run lint` | vérification du code (ESLint) |
| `npm run build` | build de production, comme sur Vercel |
| `node scripts/generer-logo-pdf.mjs` | régénère les logos « fond clair » et le logo du PDF depuis `public/brand/logo-delaveau.png` |

La tâche planifiée peut se tester en local avec l'en-tête du secret, sans rien enregistrer
grâce à `apercu=1` (ni avis ni récapitulatif envoyé ; la réponse liste ce qui partirait) :

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/facturation-mensuelle?date=2026-10-01&apercu=1"
# avis d'octobre qui partiraient, clients en envoi automatique sans facture annuelle émise
```

L'organisation du code, les règles métier et les contrats entre modules sont décrits dans
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Le schéma de la base se trouve dans
`supabase/migrations/`.
