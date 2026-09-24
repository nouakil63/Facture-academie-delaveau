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

## Fonctionnalités

- **Clients** : fiche du payeur (coordonnées, e-mail et copies, cavaliers), académie de
  rattachement, archivage.
- **Tarifs par client** : lignes récurrentes (chaque mois) ou ponctuelles, au prix du catalogue
  ou à un prix personnalisé, avec des dates de début et de fin facultatives.
- **Catalogue de prestations** commun aux deux académies.
- **Factures** : brouillon → émise (le numéro définitif est attribué à ce moment-là) → envoyée
  → payée, ou annulée. PDF aux couleurs de l'académie, avec l'IBAN et les mentions légales.
- **Facturation mensuelle** : prépare en un clic les brouillons du mois pour tous les clients
  (ou une seule académie), avec un aperçu avant création, puis émission et envoi groupés par
  e-mail. Le tout peut être automatisé, jusqu'à l'envoi.
- **Envoi par e-mail** depuis la boîte `contact@academiedelaveau.com`, PDF en pièce jointe.
  Chaque envoi est journalisé, qu'il réussisse ou non.
- **Tableau de bord** : montants à encaisser, factures en retard, brouillons en attente,
  répartition Delaveau / Espoir, date de la prochaine facturation.
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
   Exécutez les deux fichiers du dossier `supabase/migrations`, **dans cet ordre et une
   seule fois chacun** :
   1. ouvrez `supabase/migrations/20260924000000_schema_initial.sql`, copiez tout son
      contenu, collez-le dans l'éditeur, puis cliquez sur **Run** ;
   2. faites de même avec `supabase/migrations/20260924000100_donnees_initiales.sql`.
      Ce fichier crée les paramètres de l'association et les deux académies.
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

   Pour `CRON_SECRET`, générez une chaîne longue au hasard : par exemple avec un gestionnaire
   de mots de passe, ou la commande `openssl rand -hex 32`. Vous n'aurez jamais à la saisir
   vous-même : Vercel l'envoie automatiquement à la tâche planifiée.
3. Cliquez sur **Deploy**. Une fois le déploiement terminé, ouvrez l'adresse du site (par
   exemple `https://facturation-delaveau.vercel.app`) et connectez-vous avec l'un des deux
   comptes.
4. **Tâche planifiée.** Le fichier `vercel.json` demande à Vercel d'appeler l'application
   **chaque jour vers 6 h (heure UTC)**. L'application vérifie alors si c'est le jour de
   génération choisi dans les Paramètres. Si oui, et si l'automatisation est activée, elle
   prépare les brouillons du mois pour les deux académies, puis les envoie si l'envoi
   automatique est aussi activé. Les autres jours, elle ne fait rien. Le suivi se trouve dans
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
   - **Facturation mensuelle** : jour de préparation (1 à 28), mois facturé (mois en cours ou
     mois précédent), préparation automatique, envoi automatique.
   - **E-mails** : objet et texte du message envoyé avec chaque facture. Variables
     disponibles : `{client}` `{numero}` `{montant}` `{echeance}` `{periode}` `{structure}`
     `{academie}` `{objet}`.
   - **Académies** : nom et couleur de l'Académie Delaveau et de l'Académie Espoir.
   - Le lien **« Aperçu d'une facture type »** montre le rendu du PDF avec vos réglages.
2. **Prestations** : créez le catalogue (pension, cours, stages…) avec leur prix. Il est
   commun aux deux académies.
3. **Clients** : créez chaque payeur. Choisissez son **académie**, puis renseignez son
   e-mail (et d'éventuelles adresses en copie) et le nom du ou des cavaliers. Sur sa fiche,
   ajoutez ses **tarifs** : les prestations facturées chaque mois, au prix du catalogue ou à
   un prix personnalisé.

## Utilisation mensuelle

1. **Préparer les factures du mois.**
   - *Automatiquement* : le jour choisi, les brouillons sont créés tout seuls. Si l'envoi
     automatique est activé, ils sont aussi émis et envoyés.
   - *Manuellement* : menu **Facturation mensuelle**, choisissez le mois (et au besoin une
     académie), vérifiez l'aperçu, puis cliquez sur **« Générer les brouillons »**.
2. **Vérifier** les brouillons. On peut les ouvrir, ajouter une ligne (stage, frais
   exceptionnels…), ou modifier un prix.
3. **Émettre et envoyer**. Depuis *Facturation mensuelle*, le bouton **« Émettre et
   envoyer »** traite tous les brouillons du mois. On peut aussi le faire facture par facture.
   Un client sans adresse e-mail est signalé : sa facture peut être émise puis remise en main
   propre (bouton de téléchargement du PDF).
4. **Suivre les paiements.** Le tableau de bord indique ce qui reste à encaisser et les
   factures en retard. À réception d'un règlement, ouvrez la facture et cliquez sur
   **« Marquer comme payée »** (date et mode de paiement).
5. **Factures ponctuelles** (stage, concours…) : **Factures → Nouvelle facture**.

## Règles à connaître

- **Numérotation continue et unique.** Un numéro n'est attribué qu'au moment de l'émission.
  Il n'y a donc pas de trou : supprimer un brouillon ne consomme aucun numéro. Delaveau et
  Espoir partagent la même série.
- **Une facture émise ne se modifie plus et ne se supprime pas.** Pour la corriger, on
  l'**annule** (bouton « Annuler la facture », avec un motif ; c'est définitif), puis
  **« Dupliquer en brouillon »** permet de préparer la facture corrigée, qui recevra un
  nouveau numéro à son émission. Le brouillon d'une facture mensuelle annulée la remplace
  dans la facturation mensuelle du mois (elle n'est pas générée une seconde fois).
- Supprimer un **brouillon mensuel** ne suffit pas à ne pas facturer le mois : il est recréé
  à la génération suivante tant que le client a un tarif récurrent actif (mettez une date de
  fin au tarif, ou archivez le client).
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
grâce à `apercu=1` :

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/facturation-mensuelle?date=2026-10-01&apercu=1"
```

L'organisation du code, les règles métier et les contrats entre modules sont décrits dans
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Le schéma de la base se trouve dans
`supabase/migrations/`.
