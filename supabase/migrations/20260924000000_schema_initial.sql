-- =============================================================================
-- CRM de facturation — Académie Delaveau / Académie Espoir
-- Schéma initial
--
-- Principes :
--   * Montants stockés en centimes (integer) pour éviter les erreurs d'arrondi.
--   * Une facture est un brouillon (sans numéro) tant qu'elle n'est pas émise.
--     L'émission (fonction emettre_facture) attribue un numéro séquentiel
--     continu par entité et par année, fige les coordonnées client/entité et
--     rend le contenu de la facture non modifiable.
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
-- Membres autorisés (les 2 utilisateurs de l'application)
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
-- Entités (Académie Delaveau, Académie Espoir)
-- -----------------------------------------------------------------------------
create table public.entites (
  id uuid primary key default gen_random_uuid(),
  nom text not null,                                   -- nom affiché : « Académie Delaveau »
  prefixe_facture text not null unique
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
  conditions_paiement text not null default 'Paiement par virement bancaire à réception de la facture.',
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

  -- Modèles d'e-mail ({client} {numero} {montant} {echeance} {periode} {entite} {objet})
  email_objet text not null default 'Facture {numero} – {entite}',
  email_corps text not null default
    E'Bonjour {client},\n\nVeuillez trouver ci-joint la facture {numero} d''un montant de {montant}, '
    || E'à régler avant le {echeance}.\n\nNous restons à votre disposition pour toute question.\n\n'
    || E'Cordialement,\n{entite}',
  email_copie text,                                     -- adresse en copie cachée de chaque envoi (archivage)

  actif boolean not null default true,
  ordre integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger entites_updated_at before update on public.entites
  for each row execute function public.maj_updated_at();

-- -----------------------------------------------------------------------------
-- Prestations (catalogue, par entité)
-- -----------------------------------------------------------------------------
create table public.prestations (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null references public.entites(id) on delete restrict,
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

create index prestations_entite_idx on public.prestations(entite_id);
create trigger prestations_updated_at before update on public.prestations
  for each row execute function public.maj_updated_at();

-- -----------------------------------------------------------------------------
-- Clients (payeurs : parents, entreprises, sponsors…), rattachés à une entité
-- -----------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null references public.entites(id) on delete restrict,
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

create index clients_entite_idx on public.clients(entite_id);
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
create trigger tarifs_clients_updated_at before update on public.tarifs_clients
  for each row execute function public.maj_updated_at();

-- La prestation d'un tarif doit appartenir à l'entité du client.
create or replace function public.verifier_tarif_entite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.prestation_id is not null and not exists (
    select 1
    from public.prestations p
    join public.clients c on c.id = new.client_id
    where p.id = new.prestation_id and p.entite_id = c.entite_id
  ) then
    raise exception 'La prestation n''appartient pas à l''entité du client';
  end if;
  return new;
end;
$$;

create trigger tarifs_clients_entite before insert or update on public.tarifs_clients
  for each row execute function public.verifier_tarif_entite();

-- -----------------------------------------------------------------------------
-- Factures
-- -----------------------------------------------------------------------------
create table public.factures (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null references public.entites(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,

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
  entite_snapshot jsonb,

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
  unique (entite_id, annee, sequence)
);

create index factures_entite_idx on public.factures(entite_id);
create index factures_client_idx on public.factures(client_id);
create index factures_statut_idx on public.factures(statut);
create index factures_periode_idx on public.factures(periode);

-- Une seule facture mensuelle automatique (non annulée) par client / entité / mois.
create unique index factures_mensuelle_unique
  on public.factures(client_id, entite_id, periode)
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

-- Compteurs de numérotation (par entité et par année)
create table public.compteurs_factures (
  entite_id uuid not null references public.entites(id) on delete restrict,
  annee integer not null,
  dernier_numero integer not null check (dernier_numero > 0),
  primary key (entite_id, annee)
);

-- -----------------------------------------------------------------------------
-- Règles d'intégrité des factures
-- -----------------------------------------------------------------------------

-- a) Protection du contenu d'une facture émise + transitions de statut autorisées.
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
  if new.entite_id is distinct from old.entite_id
     or new.client_id is distinct from old.client_id
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
     or new.entite_snapshot is distinct from old.entite_snapshot
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

create trigger a_factures_proteger before update or delete on public.factures
  for each row execute function public.proteger_facture();

-- b) Calcul TVA / TTC à partir du HT.
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

create trigger b_factures_totaux before insert or update on public.factures
  for each row execute function public.calculer_totaux_facture();

create trigger c_factures_updated_at before update on public.factures
  for each row execute function public.maj_updated_at();

-- c) Les lignes d'une facture émise sont figées.
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

-- d) Recalcul du total HT d'un brouillon à chaque modification de ligne.
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
  e public.entites;
  c public.clients;
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

  select * into e from public.entites where id = f.entite_id;
  select * into c from public.clients where id = f.client_id;
  if c.entite_id <> f.entite_id then
    raise exception 'Le client n''appartient pas à l''entité de la facture';
  end if;

  insert into public.compteurs_factures as cf (entite_id, annee, dernier_numero)
  values (e.id, v_annee, 1)
  on conflict (entite_id, annee) do update set dernier_numero = cf.dernier_numero + 1
  returning dernier_numero into v_seq;

  perform set_config('app.emission_facture', 'on', true);

  update public.factures
     set statut = 'emise',
         numero = e.prefixe_facture || '-' || v_annee || '-' || lpad(v_seq::text, 4, '0'),
         annee = v_annee,
         sequence = v_seq,
         date_emission = v_date,
         date_echeance = v_date + e.delai_paiement_jours,
         taux_tva = e.taux_tva,
         total_ht_centimes = (select coalesce(sum(total_centimes), 0) from public.lignes_facture where facture_id = f.id),
         client_snapshot = to_jsonb(c) - 'notes',
         entite_snapshot = to_jsonb(e)
   where id = f.id
  returning * into f;

  perform set_config('app.emission_facture', 'off', true);
  return f;
end;
$$;

-- -----------------------------------------------------------------------------
-- Génération mensuelle des brouillons
--   p_periode : n'importe quel jour du mois à facturer
--   p_dry_run : true → aperçu sans rien créer
-- -----------------------------------------------------------------------------
create or replace function public.generer_brouillons_mensuels(
  p_entite_id uuid,
  p_periode date,
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
  e public.entites;
  r record;
  v_facture uuid;
begin
  select * into e from public.entites where id = p_entite_id;
  if not found then
    raise exception 'Entité introuvable';
  end if;

  for r in
    select c.id as cid,
           count(t.id)::integer as nb,
           sum(round(t.quantite * coalesce(t.prix_unitaire_centimes, p.prix_unitaire_centimes)))::integer as total
      from public.clients c
      join public.tarifs_clients t on t.client_id = c.id
      left join public.prestations p on p.id = t.prestation_id
     where c.entite_id = p_entite_id
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
       and f.entite_id = p_entite_id
       and f.periode = v_debut
       and f.generation_auto
       and f.statut <> 'annulee'
     limit 1;

    if v_facture is not null then
      client_id := r.cid; facture_id := v_facture; nb_lignes := r.nb;
      total_ht_centimes := r.total; deja_existante := true;
      return next;
      continue;
    end if;

    if p_dry_run then
      client_id := r.cid; facture_id := null; nb_lignes := r.nb;
      total_ht_centimes := r.total; deja_existante := false;
      return next;
      continue;
    end if;

    insert into public.factures (entite_id, client_id, statut, objet, periode, taux_tva, generation_auto)
    values (p_entite_id, r.cid, 'brouillon',
            e.objet_facture_mensuelle || ' – ' || public.nom_mois_fr(v_debut),
            v_debut, e.taux_tva, true)
    returning id into v_facture;

    insert into public.lignes_facture (facture_id, ordre, libelle, description, quantite, prix_unitaire_centimes, prestation_id)
    select v_facture,
           row_number() over (order by t.ordre, t.created_at)::integer,
           coalesce(t.libelle, p.libelle),
           coalesce(t.description, p.description),
           t.quantite,
           coalesce(t.prix_unitaire_centimes, p.prix_unitaire_centimes),
           t.prestation_id
      from public.tarifs_clients t
      left join public.prestations p on p.id = t.prestation_id
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
       c.cavaliers as client_cavaliers,
       e.nom as entite_nom,
       e.prefixe_facture as entite_prefixe,
       e.couleur_primaire as entite_couleur
  from public.factures f
  join public.clients c on c.id = f.client_id
  join public.entites e on e.id = f.entite_id;

-- -----------------------------------------------------------------------------
-- Sécurité : Row Level Security
-- -----------------------------------------------------------------------------
alter table public.membres enable row level security;
alter table public.entites enable row level security;
alter table public.prestations enable row level security;
alter table public.clients enable row level security;
alter table public.tarifs_clients enable row level security;
alter table public.factures enable row level security;
alter table public.lignes_facture enable row level security;
alter table public.envois_email enable row level security;
alter table public.compteurs_factures enable row level security;

create policy membres_lecture on public.membres
  for select to authenticated using (public.est_membre());

create policy entites_membres on public.entites
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
revoke execute on function public.generer_brouillons_mensuels(uuid, date, boolean) from public, anon;
grant execute on function public.emettre_facture(uuid) to authenticated, service_role;
grant execute on function public.generer_brouillons_mensuels(uuid, date, boolean) to authenticated, service_role;
