-- =============================================================================
-- CRM de facturation — Académie Delaveau
-- Schéma initial
--
-- Principes :
--   * Une seule structure émettrice (l'association Académie Delaveau) : ses
--     réglages (informations légales, IBAN, mentions, e-mails, automatisation)
--     sont dans la table `parametres` (une seule ligne).
--   * Les élèves/clients sont rattachés à une académie (Académie Delaveau ou
--     Académie Espoir) pour les distinguer et filtrer. Tout le reste est commun :
--     catalogue, tarifs, numérotation, modèle de facture.
--   * Montants stockés en centimes (integer) pour éviter les erreurs d'arrondi.
--   * Une facture est un brouillon (sans numéro) tant qu'elle n'est pas émise.
--     L'émission (fonction emettre_facture) attribue un numéro séquentiel
--     continu par année, fige les coordonnées client/émetteur et rend le
--     contenu de la facture non modifiable.
--   * Seuls les utilisateurs listés dans la table `membres` ont accès aux données.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type public.statut_facture as enum ('brouillon', 'emise', 'envoyee', 'payee', 'annulee');
create type public.type_client as enum ('particulier', 'professionnel');
create type public.mois_facture as enum ('courant', 'precedent');

-- -----------------------------------------------------------------------------
-- Utilitaires
-- -----------------------------------------------------------------------------
create or replace function public.maj_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Date du jour en France (les factures sont datées à l'heure de Paris).
create or replace function public.aujourdhui_paris()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Europe/Paris')::date;
$$;

-- « octobre 2026 »
create or replace function public.nom_mois_fr(d date)
returns text
language sql
immutable
set search_path = public
as $$
  select (array['janvier','février','mars','avril','mai','juin','juillet',
                'août','septembre','octobre','novembre','décembre'])[extract(month from d)::int]
         || ' ' || extract(year from d)::int;
$$;

-- -----------------------------------------------------------------------------
-- Membres autorisés (les utilisateurs de l'application)
-- -----------------------------------------------------------------------------
create table public.membres (
  email text primary key check (email = lower(email)),
  nom text,
  created_at timestamptz not null default now()
);

create or replace function public.est_membre()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.membres m
    where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Accès serveur : clé secrète (service_role) ou connexion SQL directe
-- (éditeur SQL Supabase). Via l'API, PostgREST renseigne toujours le rôle.
create or replace function public.est_service()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'role', '') in ('service_role', '');
$$;

-- -----------------------------------------------------------------------------
-- Paramètres de la structure émettrice (une seule ligne)
-- -----------------------------------------------------------------------------
create table public.parametres (
  id boolean primary key default true check (id),

  -- Identité et charte
  prefixe_facture text not null default 'AD'
    check (prefixe_facture ~ '^[A-Z0-9]{1,8}$'),       -- « AD » → AD-2026-0001
  couleur_primaire text not null default '#0050A0' check (couleur_primaire ~ '^#[0-9A-Fa-f]{6}$'),
  couleur_secondaire text not null default '#DADADA' check (couleur_secondaire ~ '^#[0-9A-Fa-f]{6}$'),
  logo_url text,                                       -- null → logo Delaveau intégré

  -- Informations légales imprimées sur la facture
  raison_sociale text not null,
  forme_juridique text,
  adresse_ligne1 text,
  adresse_ligne2 text,
  code_postal text,
  ville text,
  pays text not null default 'France',
  siren text,
  siret text,
  rna text,
  numero_tva text,
  objet_social text,
  email_contact text,
  telephone text,
  site_web text,

  -- Paiement
  iban text,
  bic text,
  titulaire_compte text,
  conditions_paiement text not null default 'Paiement par virement bancaire au plus tard à la date d''échéance.',
  delai_paiement_jours integer not null default 30 check (delai_paiement_jours between 0 and 90),

  -- TVA et mentions
  taux_tva numeric(5,2) not null default 0 check (taux_tva >= 0 and taux_tva < 100),
  mention_tva text default 'TVA non applicable, art. 293 B du CGI',
  mentions_legales text,                               -- pied de page libre
  mentions_professionnels text default
    'En cas de retard de paiement : pénalités au taux de trois fois le taux d''intérêt légal '
    || 'et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 et D441-5 du Code de commerce). '
    || 'Pas d''escompte pour paiement anticipé.',

  -- Facturation mensuelle automatique
  objet_facture_mensuelle text not null default 'Formation et accompagnement',
  jour_generation integer not null default 1 check (jour_generation between 1 and 28),
  mois_facture public.mois_facture not null default 'courant',
  generation_auto boolean not null default false,      -- le cron crée les brouillons
  envoi_auto boolean not null default false,           -- le cron émet ET envoie (à activer en connaissance de cause)

  -- Modèles d'e-mail ({client} {numero} {montant} {echeance} {periode} {structure} {academie} {objet})
  email_objet text not null default 'Facture {numero} – {structure}',
  email_corps text not null default
    E'Bonjour {client},\n\nVeuillez trouver ci-joint la facture {numero} d''un montant de {montant}, '
    || E'à régler avant le {echeance}.\n\nNous restons à votre disposition pour toute question.\n\n'
    || E'Cordialement,\n{structure}',
  email_copie text,                                     -- adresse en copie cachée de chaque envoi (archivage)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger parametres_updated_at before update on public.parametres
  for each row execute function public.maj_updated_at();

-- -----------------------------------------------------------------------------
-- Académies : regroupement des élèves (Académie Delaveau, Académie Espoir)
-- -----------------------------------------------------------------------------
create table public.academies (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique check (length(trim(nom)) > 0),
  couleur text not null default '#0050A0' check (couleur ~ '^#[0-9A-Fa-f]{6}$'),
  actif boolean not null default true,
  ordre integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger academies_updated_at before update on public.academies
  for each row execute function public.maj_updated_at();

-- -----------------------------------------------------------------------------
-- Prestations (catalogue commun)
-- -----------------------------------------------------------------------------
create table public.prestations (
  id uuid primary key default gen_random_uuid(),
  libelle text not null check (length(trim(libelle)) > 0),
  description text,
  prix_unitaire_centimes integer not null check (prix_unitaire_centimes >= 0),
  unite text not null default 'mois',
  recurrente boolean not null default true,            -- proposée par défaut comme ligne mensuelle
  actif boolean not null default true,
  ordre integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger prestations_updated_at before update on public.prestations
  for each row execute function public.maj_updated_at();

-- -----------------------------------------------------------------------------
-- Clients (payeurs : parents, entreprises, sponsors…), rattachés à une académie
-- -----------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  academie_id uuid not null references public.academies(id) on delete restrict,
  type public.type_client not null default 'particulier',
  civilite text,
  nom text not null check (length(trim(nom)) > 0),
  prenom text,
  raison_sociale text,
  email text,
  emails_cc text[] not null default '{}',
  telephone text,
  adresse_ligne1 text,
  adresse_ligne2 text,
  code_postal text,
  ville text,
  pays text not null default 'France',
  siret text,
  numero_tva text,
  cavaliers text,                                      -- élève(s) concerné(s), imprimé sur la facture
  notes text,                                          -- notes internes
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_pro_raison_sociale check (type = 'particulier' or raison_sociale is not null)
);

create index clients_academie_idx on public.clients(academie_id);
create trigger clients_updated_at before update on public.clients
  for each row execute function public.maj_updated_at();

-- -----------------------------------------------------------------------------
-- Tarifs clients : lignes facturées à un client (prix personnalisable)
-- -----------------------------------------------------------------------------
create table public.tarifs_clients (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  prestation_id uuid references public.prestations(id) on delete restrict,
  libelle text,                                        -- null → libellé de la prestation
  description text,                                    -- null → description de la prestation
  prix_unitaire_centimes integer check (prix_unitaire_centimes >= 0), -- null → prix catalogue
  quantite numeric(10,2) not null default 1 check (quantite > 0),
  recurrent boolean not null default true,             -- incluse dans la facturation mensuelle
  date_debut date,
  date_fin date,
  actif boolean not null default true,
  ordre integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tarifs_ligne_libre check (
    prestation_id is not null
    or (libelle is not null and prix_unitaire_centimes is not null)
  ),
  constraint tarifs_dates check (date_debut is null or date_fin is null or date_debut <= date_fin)
);

create index tarifs_clients_client_idx on public.tarifs_clients(client_id);
create index tarifs_clients_prestation_idx on public.tarifs_clients(prestation_id);
create trigger tarifs_clients_updated_at before update on public.tarifs_clients
  for each row execute function public.maj_updated_at();

-- -----------------------------------------------------------------------------
-- Factures
-- -----------------------------------------------------------------------------
create table public.factures (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  academie_id uuid not null references public.academies(id) on delete restrict, -- repris du client

  numero text unique,                                  -- attribué à l'émission
  annee integer,
  sequence integer,
  statut public.statut_facture not null default 'brouillon',

  objet text,
  periode date check (periode is null or extract(day from periode) = 1), -- 1er jour du mois facturé
  date_emission date,
  date_echeance date,

  taux_tva numeric(5,2) not null default 0 check (taux_tva >= 0 and taux_tva < 100),
  total_ht_centimes integer not null default 0,
  total_tva_centimes integer not null default 0,
  total_ttc_centimes integer not null default 0,

  notes text,                                          -- imprimées sur la facture
  notes_internes text,

  client_snapshot jsonb,                               -- coordonnées figées à l'émission
  emetteur_snapshot jsonb,                             -- paramètres figés à l'émission
  academie_snapshot jsonb,

  envoyee_le timestamptz,
  payee_le date,
  mode_paiement text,
  reference_paiement text,
  annulee_le timestamptz,
  motif_annulation text,

  generation_auto boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint factures_numero_emise check (
    (statut = 'brouillon' and numero is null)
    or (statut <> 'brouillon' and numero is not null and date_emission is not null)
  ),
  -- Année et séquence : attribuées par emettre_facture(), jamais portées par un brouillon.
  constraint factures_sequence_emise check ((statut = 'brouillon') = (annee is null and sequence is null)),
  unique (annee, sequence)
);

create index factures_client_idx on public.factures(client_id);
create index factures_academie_idx on public.factures(academie_id);
create index factures_statut_idx on public.factures(statut);
create index factures_periode_idx on public.factures(periode);

-- Une seule facture mensuelle automatique (non annulée) par client et par mois.
create unique index factures_mensuelle_unique
  on public.factures(client_id, periode)
  where generation_auto and statut <> 'annulee';

create table public.lignes_facture (
  id uuid primary key default gen_random_uuid(),
  facture_id uuid not null references public.factures(id) on delete cascade,
  ordre integer not null default 0,
  libelle text not null check (length(trim(libelle)) > 0),
  description text,
  quantite numeric(10,2) not null default 1 check (quantite > 0),
  prix_unitaire_centimes integer not null check (prix_unitaire_centimes >= 0),
  total_centimes integer generated always as (round(quantite * prix_unitaire_centimes)::integer) stored,
  prestation_id uuid references public.prestations(id) on delete set null,
  created_at timestamptz not null default now()
);

create index lignes_facture_facture_idx on public.lignes_facture(facture_id);

-- Historique des envois d'e-mails
create table public.envois_email (
  id uuid primary key default gen_random_uuid(),
  facture_id uuid not null references public.factures(id) on delete cascade,
  destinataires text[] not null,
  objet text not null,
  succes boolean not null,
  erreur text,
  message_id text,
  envoye_par uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index envois_email_facture_idx on public.envois_email(facture_id);

-- Compteur de numérotation (par année)
create table public.compteurs_factures (
  annee integer primary key,
  dernier_numero integer not null check (dernier_numero > 0)
);

-- -----------------------------------------------------------------------------
-- Règles d'intégrité des factures
-- (les triggers d'une même table s'exécutent dans l'ordre alphabétique de leur nom)
-- -----------------------------------------------------------------------------

-- a0) Une facture naît brouillon : numéro, année, séquence, date d'émission et
--     informations figées sont attribués uniquement par emettre_facture().
create or replace function public.proteger_insertion_facture()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.statut <> 'brouillon'
     or new.numero is not null
     or new.annee is not null
     or new.sequence is not null
     or new.date_emission is not null
     or new.client_snapshot is not null
     or new.emetteur_snapshot is not null
     or new.academie_snapshot is not null
  then
    raise exception 'Une facture est créée en brouillon ; le numéro est attribué par emettre_facture()';
  end if;
  -- Champs sans objet pour un brouillon : remis à zéro.
  new.date_echeance := null;
  new.envoyee_le := null;
  new.payee_le := null;
  new.mode_paiement := null;
  new.reference_paiement := null;
  new.annulee_le := null;
  new.motif_annulation := null;
  new.created_by := auth.uid();
  return new;
end;
$$;

create trigger a0_factures_insertion before insert on public.factures
  for each row execute function public.proteger_insertion_facture();

-- a) Académie d'un brouillon = académie de son client.
create or replace function public.renseigner_academie_facture()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or (old.statut = 'brouillon' and new.statut = 'brouillon') then
    select c.academie_id into new.academie_id from public.clients c where c.id = new.client_id;
  end if;
  return new;
end;
$$;

create trigger a_factures_academie before insert or update on public.factures
  for each row execute function public.renseigner_academie_facture();

-- a bis) Un client change d'académie : ses brouillons suivent immédiatement
--        (les factures émises gardent l'académie figée à l'émission).
create or replace function public.propager_academie_client()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.factures
     set academie_id = new.academie_id
   where client_id = new.id
     and statut = 'brouillon'
     and academie_id is distinct from new.academie_id;
  return null;
end;
$$;

create trigger clients_academie_brouillons after update of academie_id on public.clients
  for each row when (old.academie_id is distinct from new.academie_id)
  execute function public.propager_academie_client();

-- b) Protection du contenu d'une facture émise + transitions de statut autorisées.
create or replace function public.proteger_facture()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.statut <> 'brouillon' then
      raise exception 'Une facture émise ne peut pas être supprimée (numéro %). Annulez-la.', old.numero;
    end if;
    return old;
  end if;

  -- Brouillon : libre, sauf l'émission qui doit passer par emettre_facture().
  if old.statut = 'brouillon' then
    if new.statut = 'brouillon' then
      if new.numero is not null or new.annee is not null or new.sequence is not null then
        raise exception 'Le numéro est attribué uniquement à l''émission';
      end if;
      return new;
    end if;
    if new.statut = 'emise' and coalesce(current_setting('app.emission_facture', true), '') = 'on' then
      return new;
    end if;
    raise exception 'Un brouillon doit être émis via emettre_facture()';
  end if;

  -- Facture émise : contenu figé.
  if new.client_id is distinct from old.client_id
     or new.academie_id is distinct from old.academie_id
     or new.numero is distinct from old.numero
     or new.annee is distinct from old.annee
     or new.sequence is distinct from old.sequence
     or new.objet is distinct from old.objet
     or new.periode is distinct from old.periode
     or new.date_emission is distinct from old.date_emission
     or new.date_echeance is distinct from old.date_echeance
     or new.taux_tva is distinct from old.taux_tva
     or new.total_ht_centimes is distinct from old.total_ht_centimes
     or new.total_tva_centimes is distinct from old.total_tva_centimes
     or new.total_ttc_centimes is distinct from old.total_ttc_centimes
     or new.notes is distinct from old.notes
     or new.client_snapshot is distinct from old.client_snapshot
     or new.emetteur_snapshot is distinct from old.emetteur_snapshot
     or new.academie_snapshot is distinct from old.academie_snapshot
     or new.generation_auto is distinct from old.generation_auto
     or new.created_by is distinct from old.created_by
  then
    raise exception 'Facture % émise : son contenu ne peut plus être modifié', old.numero;
  end if;

  if old.statut = 'annulee' and new.statut <> 'annulee' then
    raise exception 'Une facture annulée ne peut pas être réactivée';
  end if;

  if new.statut is distinct from old.statut then
    if not (
      (old.statut = 'emise'   and new.statut in ('envoyee', 'payee', 'annulee')) or
      (old.statut = 'envoyee' and new.statut in ('payee', 'annulee')) or
      (old.statut = 'payee'   and new.statut in ('emise', 'envoyee'))
    ) then
      raise exception 'Transition de statut interdite : % → %', old.statut, new.statut;
    end if;
  end if;

  if new.statut = 'payee' and new.payee_le is null then
    raise exception 'La date de paiement est obligatoire';
  end if;
  if new.statut <> 'payee' then
    new.payee_le := null;
    new.mode_paiement := null;
    new.reference_paiement := null;
  end if;
  if new.statut = 'annulee' then
    new.annulee_le := coalesce(new.annulee_le, now());
  end if;

  return new;
end;
$$;

create trigger b_factures_proteger before update or delete on public.factures
  for each row execute function public.proteger_facture();

-- c) Calcul TVA / TTC à partir du HT.
create or replace function public.calculer_totaux_facture()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.total_tva_centimes := round(new.total_ht_centimes * new.taux_tva / 100)::integer;
  new.total_ttc_centimes := new.total_ht_centimes + new.total_tva_centimes;
  return new;
end;
$$;

create trigger c_factures_totaux before insert or update on public.factures
  for each row execute function public.calculer_totaux_facture();

create trigger d_factures_updated_at before update on public.factures
  for each row execute function public.maj_updated_at();

-- d) Les lignes d'une facture émise sont figées.
create or replace function public.proteger_lignes_facture()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_statut public.statut_facture;
  v_facture uuid := coalesce(new.facture_id, old.facture_id);
begin
  select statut into v_statut from public.factures where id = v_facture;
  -- Suppression en cascade d'un brouillon : la facture n'existe déjà plus.
  if not found then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.facture_id is distinct from old.facture_id then
    raise exception 'Une ligne ne peut pas changer de facture';
  end if;
  if v_statut <> 'brouillon' then
    -- Seule exception : la suppression d'une prestation du catalogue (on delete set null).
    if tg_op = 'UPDATE'
       and old.prestation_id is not null and new.prestation_id is null
       and (to_jsonb(new) - 'prestation_id' - 'total_centimes') = (to_jsonb(old) - 'prestation_id' - 'total_centimes') then
      return new;
    end if;
    raise exception 'Les lignes d''une facture émise ne peuvent pas être modifiées';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger a_lignes_proteger before insert or update or delete on public.lignes_facture
  for each row execute function public.proteger_lignes_facture();

-- e) Recalcul du total HT d'un brouillon à chaque modification de ligne.
create or replace function public.recalculer_total_facture()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_facture uuid := coalesce(new.facture_id, old.facture_id);
begin
  update public.factures f
     set total_ht_centimes = coalesce((select sum(l.total_centimes) from public.lignes_facture l where l.facture_id = v_facture), 0)
   where f.id = v_facture
     and f.statut = 'brouillon';
  return null;
end;
$$;

create trigger b_lignes_totaux after insert or update or delete on public.lignes_facture
  for each row execute function public.recalculer_total_facture();

-- Le paramétrage est une ligne unique : ni ajout ni suppression.
create or replace function public.proteger_parametres()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Les paramètres ne peuvent pas être supprimés';
  end if;
  if tg_op = 'UPDATE' and new.prefixe_facture is distinct from old.prefixe_facture
     and exists (select 1 from public.compteurs_factures) then
    raise exception 'Le préfixe ne peut plus changer : des factures ont déjà été émises (la numérotation doit rester continue)';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger parametres_proteger before update or delete on public.parametres
  for each row execute function public.proteger_parametres();

-- Nouveau taux de TVA : appliqué aussitôt aux brouillons (totaux recalculés), pour que le
-- montant relu avant l'émission soit celui qui sera émis. Les factures émises ne changent pas.
create or replace function public.propager_tva_brouillons()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.factures
     set taux_tva = new.taux_tva
   where statut = 'brouillon'
     and taux_tva is distinct from new.taux_tva;
  return null;
end;
$$;

create trigger parametres_tva_brouillons after update of taux_tva on public.parametres
  for each row when (old.taux_tva is distinct from new.taux_tva)
  execute function public.propager_tva_brouillons();

-- -----------------------------------------------------------------------------
-- Émission d'une facture : numéro séquentiel + figement
-- -----------------------------------------------------------------------------
create or replace function public.emettre_facture(p_facture_id uuid)
returns public.factures
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.factures;
  p public.parametres;
  c public.clients;
  a public.academies;
  v_date date := public.aujourdhui_paris();
  v_annee integer := extract(year from v_date)::integer;
  v_seq integer;
begin
  if not (public.est_membre() or public.est_service()) then
    raise exception 'Accès refusé';
  end if;

  select * into f from public.factures where id = p_facture_id for update;
  if not found then
    raise exception 'Facture introuvable';
  end if;
  if f.statut <> 'brouillon' then
    raise exception 'La facture % est déjà émise', f.numero;
  end if;
  if not exists (select 1 from public.lignes_facture where facture_id = f.id) then
    raise exception 'La facture ne contient aucune ligne';
  end if;

  select * into p from public.parametres where id;
  if not found then
    raise exception 'Paramètres de facturation absents';
  end if;
  select * into c from public.clients where id = f.client_id;
  select * into a from public.academies where id = f.academie_id;

  insert into public.compteurs_factures as cf (annee, dernier_numero)
  values (v_annee, 1)
  on conflict (annee) do update set dernier_numero = cf.dernier_numero + 1
  returning dernier_numero into v_seq;

  perform set_config('app.emission_facture', 'on', true);

  update public.factures
     set statut = 'emise',
         numero = p.prefixe_facture || '-' || v_annee || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0'),
         annee = v_annee,
         sequence = v_seq,
         date_emission = v_date,
         date_echeance = v_date + p.delai_paiement_jours,
         taux_tva = p.taux_tva,
         total_ht_centimes = (select coalesce(sum(total_centimes), 0) from public.lignes_facture where facture_id = f.id),
         client_snapshot = to_jsonb(c) - 'notes',
         emetteur_snapshot = to_jsonb(p),
         academie_snapshot = to_jsonb(a)
   where id = f.id
  returning * into f;

  perform set_config('app.emission_facture', 'off', true);
  return f;
end;
$$;

-- -----------------------------------------------------------------------------
-- Génération mensuelle des brouillons
--   p_periode     : n'importe quel jour du mois à facturer
--   p_academie_id : null → toutes les académies
--   p_dry_run     : true → aperçu sans rien créer
-- -----------------------------------------------------------------------------
create or replace function public.generer_brouillons_mensuels(
  p_periode date,
  p_academie_id uuid default null,
  p_dry_run boolean default false
)
returns table (
  client_id uuid,
  facture_id uuid,
  nb_lignes integer,
  total_ht_centimes integer,
  deja_existante boolean
)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  v_debut date := date_trunc('month', p_periode)::date;
  v_fin date := (date_trunc('month', p_periode) + interval '1 month - 1 day')::date;
  p public.parametres;
  r record;
  v_facture uuid;
begin
  select * into p from public.parametres where id;
  if not found then
    raise exception 'Paramètres de facturation absents';
  end if;

  for r in
    select c.id as cid,
           count(t.id)::integer as nb,
           sum(round(t.quantite * coalesce(t.prix_unitaire_centimes, pr.prix_unitaire_centimes)))::integer as total
      from public.clients c
      join public.tarifs_clients t on t.client_id = c.id
      left join public.prestations pr on pr.id = t.prestation_id
     where (p_academie_id is null or c.academie_id = p_academie_id)
       and c.actif
       and t.actif
       and t.recurrent
       and (t.date_debut is null or t.date_debut <= v_fin)
       and (t.date_fin is null or t.date_fin >= v_debut)
     group by c.id
     order by c.id
  loop
    select f.id into v_facture
      from public.factures f
     where f.client_id = r.cid
       and f.periode = v_debut
       and f.generation_auto
       and f.statut <> 'annulee'
     limit 1;

    if v_facture is not null then
      client_id := r.cid; facture_id := v_facture; nb_lignes := r.nb;
      total_ht_centimes := r.total; deja_existante := true;
      return next;
      v_facture := null;
      continue;
    end if;

    if p_dry_run then
      client_id := r.cid; facture_id := null; nb_lignes := r.nb;
      total_ht_centimes := r.total; deja_existante := false;
      return next;
      continue;
    end if;

    insert into public.factures (client_id, statut, objet, periode, taux_tva, generation_auto)
    values (r.cid, 'brouillon',
            p.objet_facture_mensuelle || ' – ' || public.nom_mois_fr(v_debut),
            v_debut, p.taux_tva, true)
    returning id into v_facture;

    insert into public.lignes_facture (facture_id, ordre, libelle, description, quantite, prix_unitaire_centimes, prestation_id)
    select v_facture,
           row_number() over (order by t.ordre, t.created_at)::integer,
           coalesce(t.libelle, pr.libelle),
           coalesce(t.description, pr.description),
           t.quantite,
           coalesce(t.prix_unitaire_centimes, pr.prix_unitaire_centimes),
           t.prestation_id
      from public.tarifs_clients t
      left join public.prestations pr on pr.id = t.prestation_id
     where t.client_id = r.cid
       and t.actif
       and t.recurrent
       and (t.date_debut is null or t.date_debut <= v_fin)
       and (t.date_fin is null or t.date_fin >= v_debut);

    client_id := r.cid; facture_id := v_facture; nb_lignes := r.nb;
    total_ht_centimes := r.total; deja_existante := false;
    return next;
    v_facture := null;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Vue de travail des factures (hérite des droits de l'appelant)
-- -----------------------------------------------------------------------------
create view public.factures_vue with (security_invoker = true) as
select f.*,
       (f.statut in ('emise', 'envoyee') and f.date_echeance < public.aujourdhui_paris()) as en_retard,
       c.type as client_type,
       c.nom as client_nom,
       c.prenom as client_prenom,
       c.raison_sociale as client_raison_sociale,
       c.email as client_email,
       c.emails_cc as client_emails_cc,
       c.cavaliers as client_cavaliers,
       a.nom as academie_nom,
       a.couleur as academie_couleur
  from public.factures f
  join public.clients c on c.id = f.client_id
  join public.academies a on a.id = f.academie_id;

-- -----------------------------------------------------------------------------
-- Sécurité : Row Level Security
-- -----------------------------------------------------------------------------
alter table public.membres enable row level security;
alter table public.parametres enable row level security;
alter table public.academies enable row level security;
alter table public.prestations enable row level security;
alter table public.clients enable row level security;
alter table public.tarifs_clients enable row level security;
alter table public.factures enable row level security;
alter table public.lignes_facture enable row level security;
alter table public.envois_email enable row level security;
alter table public.compteurs_factures enable row level security;

create policy membres_lecture on public.membres
  for select to authenticated using (public.est_membre());

create policy parametres_lecture on public.parametres
  for select to authenticated using (public.est_membre());
create policy parametres_modification on public.parametres
  for update to authenticated using (public.est_membre()) with check (public.est_membre());

create policy academies_membres on public.academies
  for all to authenticated using (public.est_membre()) with check (public.est_membre());
create policy prestations_membres on public.prestations
  for all to authenticated using (public.est_membre()) with check (public.est_membre());
create policy clients_membres on public.clients
  for all to authenticated using (public.est_membre()) with check (public.est_membre());
create policy tarifs_clients_membres on public.tarifs_clients
  for all to authenticated using (public.est_membre()) with check (public.est_membre());
create policy factures_membres on public.factures
  for all to authenticated using (public.est_membre()) with check (public.est_membre());
create policy lignes_facture_membres on public.lignes_facture
  for all to authenticated using (public.est_membre()) with check (public.est_membre());
create policy envois_email_lecture on public.envois_email
  for select to authenticated using (public.est_membre());
create policy envois_email_ajout on public.envois_email
  for insert to authenticated with check (public.est_membre());
create policy compteurs_lecture on public.compteurs_factures
  for select to authenticated using (public.est_membre());

-- Les fonctions ne sont pas exposées aux visiteurs anonymes.
revoke execute on function public.emettre_facture(uuid) from public, anon;
revoke execute on function public.generer_brouillons_mensuels(date, uuid, boolean) from public, anon;
grant execute on function public.emettre_facture(uuid) to authenticated, service_role;
grant execute on function public.generer_brouillons_mensuels(date, uuid, boolean) to authenticated, service_role;
