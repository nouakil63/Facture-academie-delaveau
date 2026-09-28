-- =============================================================================
-- Facture annuelle par élève et avis d'échéance mensuels
-- =============================================================================
-- Nouveau modèle de l'année scolaire (saison 2026 = septembre 2026 → juin 2027) :
--   * une FACTURE ANNUELLE par élève (client) et par saison, numérotée dans la série
--     normale (AD-2026-0001…, emettre_facture) ;
--   * à son émission, 10 ÉCHÉANCES (septembre → juin) : les « avis d'échéance » envoyés
--     chaque mois. Un avis n'est pas une facture : il ne consomme aucun numéro de facture ;
--     son numéro est `<référence élève>-<AAAA>-<MM>` (ex. E1-2026-09) ;
--   * chaque client reçoit une RÉFÉRENCE élève (E1, E2…, une seule série pour les deux
--     académies), attribuée à la création, modifiable, unique ;
--   * juillet/août et prestations ponctuelles : factures classiques (type « ponctuelle »).
--
-- Montants des échéances (figés à l'émission) :
--   reste = total TTC − arrhes versées (si arrhes réglées pour CETTE saison), jamais < 0 ;
--   septembre → mai : floor(reste / 10) ; juin : reste − 9 × floor(reste / 10) (total exact).
--   Reste nul (arrhes ≥ total) : aucune échéance.
-- Date d'échéance : jour_generation du mois de l'échéance + delai_paiement_jours (paramètres
-- à l'émission), sans jamais partir d'avant la date d'émission : une facture émise en retard
-- (élève arrivé en cours d'année) n'a pas d'échéance déjà échue. La facture annuelle prend
-- pour échéance celle de juin.
-- Paiement : la facture annuelle passe « payée » (payee_le = date du dernier paiement) quand
-- toutes ses échéances non annulées sont payées, et revient à « envoyée »/« émise » si un
-- paiement d'échéance est annulé. Annuler la facture annule ses échéances non payées.
--
-- Reprise de l'existant (additive, sans perte) :
--   * clients existants : référence E1, E2… dans l'ordre de création (created_at, puis id) ;
--   * factures existantes : type « ponctuelle », sans saison, contenu inchangé (les brouillons
--     mensuels déjà générés restent tels quels) ;
--   * generer_brouillons_mensuels est conservée (plus utilisée par l'interface).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Référence élève
-- -----------------------------------------------------------------------------
alter table public.clients add column reference text;

-- Reprise : E1, E2… dans l'ordre de création. La date de modification n'est pas touchée.
alter table public.clients disable trigger clients_updated_at;
with ordre as (
  select id, row_number() over (order by created_at, id) as n from public.clients
)
update public.clients c set reference = 'E' || o.n from ordre o where o.id = c.id;
alter table public.clients enable trigger clients_updated_at;

alter table public.clients
  alter column reference set not null,
  add constraint clients_reference_format check (reference ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  add constraint clients_reference_unique unique (reference);

comment on column public.clients.reference is
  'Référence élève (E1, E2…), unique, attribuée à la création ; imprimée sur les factures et les avis.';

-- Prochaine référence libre : E + (plus grand numéro des références « E<n> ») + 1.
create or replace function public.prochaine_reference_client()
returns text
language sql
stable
set search_path = public
as $$
  select 'E' || (coalesce(max(substring(reference from '^E([0-9]{1,9})$')::bigint), 0) + 1)
    from public.clients;
$$;

-- Référence normalisée (majuscules, sans espaces) ; vide à la création → prochaine libre ;
-- vide à la modification → inchangée.
create or replace function public.renseigner_reference_client()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.reference := upper(regexp_replace(coalesce(new.reference, ''), '\s', '', 'g'));
  if new.reference = '' then
    if tg_op = 'UPDATE' then
      new.reference := old.reference;
    else
      -- Deux créations simultanées ne prennent pas le même numéro.
      perform pg_advisory_xact_lock(hashtext('public.clients.reference'));
      new.reference := public.prochaine_reference_client();
    end if;
  end if;
  return new;
end;
$$;

create trigger a_clients_reference before insert or update of reference on public.clients
  for each row execute function public.renseigner_reference_client();

-- -----------------------------------------------------------------------------
-- 2. Type de facture et saison
-- -----------------------------------------------------------------------------
create type public.type_facture as enum ('ponctuelle', 'annuelle');

alter table public.factures
  add column type_facture public.type_facture not null default 'ponctuelle',
  add column saison integer
    constraint factures_saison_bornes check (saison is null or saison between 2000 and 2100),
  add constraint factures_saison_annuelle check ((type_facture = 'annuelle') = (saison is not null));

comment on column public.factures.type_facture is
  'annuelle : facture de l''année scolaire (échéances mensuelles) ; ponctuelle : facture classique.';
comment on column public.factures.saison is
  'Facture annuelle : année de la rentrée (2026 = septembre 2026 → juin 2027).';

-- Une seule facture annuelle non annulée par client et par saison (brouillons compris).
create unique index factures_annuelle_unique
  on public.factures(client_id, saison)
  where type_facture = 'annuelle' and statut <> 'annulee';

-- -----------------------------------------------------------------------------
-- 3. Échéances (avis d'échéance)
-- -----------------------------------------------------------------------------
create type public.statut_echeance as enum ('a_venir', 'envoyee', 'payee', 'annulee');

create table public.echeances (
  id uuid primary key default gen_random_uuid(),
  facture_id uuid not null references public.factures(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  rang integer not null check (rang between 1 and 10),
  periode date not null check (extract(day from periode) = 1),   -- 1er du mois de l'échéance
  montant_centimes integer not null check (montant_centimes >= 0),
  date_echeance date not null,
  statut public.statut_echeance not null default 'a_venir',
  numero_avis text not null,
  envoyee_le timestamptz,
  payee_le date,
  mode_paiement text,
  reference_paiement text,
  annulee_le timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint echeances_rang_unique unique (facture_id, rang),
  constraint echeances_numero_avis_unique unique (numero_avis),
  constraint echeances_payee check ((statut = 'payee') = (payee_le is not null))
);

create index echeances_client_idx on public.echeances(client_id);
create index echeances_periode_idx on public.echeances(periode);
create index echeances_statut_idx on public.echeances(statut);

comment on table public.echeances is
  'Échéances d''une facture annuelle (septembre → juin), créées à son émission : avis d''échéance mensuels (documents non fiscaux).';

-- Protection : créées seulement par emettre_facture, jamais supprimées, montants figés,
-- transitions a_venir → envoyee/payee, envoyee → payee, payee → a_venir/envoyee (annulation
-- du paiement) ; annulee (définitif) seulement quand la facture est annulée.
create or replace function public.proteger_echeance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_statut_facture public.statut_facture;
begin
  if tg_op = 'DELETE' then
    raise exception 'Une échéance ne peut pas être supprimée : annuler la facture annuelle.';
  end if;

  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.emission_facture', true), '') <> 'on' then
      raise exception 'Les échéances sont créées à l''émission de la facture annuelle (emettre_facture)';
    end if;
    new.statut := 'a_venir';
    new.envoyee_le := null;
    new.payee_le := null;
    new.mode_paiement := null;
    new.reference_paiement := null;
    new.annulee_le := null;
    return new;
  end if;

  if new.facture_id is distinct from old.facture_id
     or new.client_id is distinct from old.client_id
     or new.rang is distinct from old.rang
     or new.periode is distinct from old.periode
     or new.montant_centimes is distinct from old.montant_centimes
     or new.date_echeance is distinct from old.date_echeance
     or new.numero_avis is distinct from old.numero_avis
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Échéance % : montant, date et numéro figés à l''émission', old.numero_avis;
  end if;

  if old.statut = 'annulee' and new.statut <> 'annulee' then
    raise exception 'Une échéance annulée ne peut pas être réactivée';
  end if;

  if new.statut is distinct from old.statut then
    select statut into v_statut_facture from public.factures where id = old.facture_id;
    if new.statut = 'annulee' then
      if v_statut_facture <> 'annulee' then
        raise exception 'Une échéance s''annule avec sa facture annuelle (annuler la facture)';
      end if;
    elsif v_statut_facture = 'annulee' then
      raise exception 'Facture annuelle annulée : échéance non modifiable';
    elsif not (
      (old.statut = 'a_venir' and new.statut in ('envoyee', 'payee')) or
      (old.statut = 'envoyee' and new.statut = 'payee') or
      (old.statut = 'payee'   and new.statut in ('a_venir', 'envoyee'))
    ) then
      raise exception 'Transition d''échéance interdite : % → %', old.statut, new.statut;
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

create trigger a_echeances_proteger before insert or update or delete on public.echeances
  for each row execute function public.proteger_echeance();
create trigger b_echeances_updated_at before update on public.echeances
  for each row execute function public.maj_updated_at();

-- Facture annuelle payée quand toutes ses échéances non annulées le sont (date = dernier
-- paiement ; mode = celui des échéances s'il est unique, sinon « Échéancier ») ; rouverte
-- (« envoyée » ou « émise ») si un paiement d'échéance est annulé.
create or replace function public.synchroniser_facture_annuelle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  f public.factures;
  v_actives integer;
  v_payees integer;
  v_derniere date;
  v_modes integer;
  v_mode text;
begin
  select * into f from public.factures where id = new.facture_id;
  if not found or f.statut not in ('emise', 'envoyee', 'payee') then
    return null;
  end if;

  select count(*) filter (where e.statut <> 'annulee'),
         count(*) filter (where e.statut = 'payee'),
         max(e.payee_le) filter (where e.statut = 'payee'),
         count(distinct e.mode_paiement) filter (where e.statut = 'payee'),
         min(e.mode_paiement) filter (where e.statut = 'payee')
    into v_actives, v_payees, v_derniere, v_modes, v_mode
    from public.echeances e
   where e.facture_id = f.id;

  if v_actives > 0 and v_payees = v_actives then
    v_mode := case when v_modes = 1 then v_mode else 'Échéancier' end;
    if f.statut <> 'payee' or f.payee_le is distinct from v_derniere or f.mode_paiement is distinct from v_mode then
      update public.factures
         set statut = 'payee', payee_le = v_derniere, mode_paiement = v_mode, reference_paiement = null
       where id = f.id;
    end if;
  elsif f.statut = 'payee' and v_payees < v_actives then
    update public.factures
       set statut = case when f.envoyee_le is not null then 'envoyee'::public.statut_facture else 'emise'::public.statut_facture end
     where id = f.id;
  end if;
  return null;
end;
$$;

create trigger c_echeances_facture after update of statut, payee_le, mode_paiement on public.echeances
  for each row execute function public.synchroniser_facture_annuelle();

-- -----------------------------------------------------------------------------
-- 4. Factures : protection étendue (type et saison figés, paiement d'une facture annuelle)
-- -----------------------------------------------------------------------------
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
     or new.type_facture is distinct from old.type_facture
     or new.saison is distinct from old.saison
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

    -- Facture annuelle avec échéances : son paiement suit celui des échéances.
    if old.type_facture = 'annuelle' and exists (
      select 1 from public.echeances e where e.facture_id = old.id and e.statut <> 'annulee'
    ) then
      if new.statut = 'payee' and exists (
        select 1 from public.echeances e where e.facture_id = old.id and e.statut in ('a_venir', 'envoyee')
      ) then
        raise exception 'Facture annuelle : payée automatiquement quand toutes ses échéances sont réglées. Enregistrer le paiement de chaque échéance.';
      end if;
      if old.statut = 'payee' and not exists (
        select 1 from public.echeances e where e.facture_id = old.id and e.statut in ('a_venir', 'envoyee')
      ) then
        raise exception 'Facture annuelle : annuler le paiement d''une échéance pour la rouvrir.';
      end if;
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

-- Facture annulée → ses échéances non payées sont annulées (les paiements reçus restent).
create or replace function public.annuler_echeances_facture()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.echeances
     set statut = 'annulee', annulee_le = now()
   where facture_id = new.id
     and statut in ('a_venir', 'envoyee');
  return null;
end;
$$;

create trigger e_factures_annulation_echeances after update of statut on public.factures
  for each row when (new.statut = 'annulee' and old.statut is distinct from new.statut)
  execute function public.annuler_echeances_facture();

-- -----------------------------------------------------------------------------
-- 5. Émission : même signature et même retour ; une facture annuelle reçoit ses échéances
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
  v_echeance date;
  v_arrhes integer;
  v_reste integer;
  r record;
  v_numero text;
  v_suffixe integer;
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

  -- Facture annuelle : échéance de la facture = celle de juin.
  v_echeance := case
    when f.type_facture = 'annuelle'
      then greatest(make_date(f.saison + 1, 6, p.jour_generation), v_date) + p.delai_paiement_jours
    else v_date + p.delai_paiement_jours
  end;

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
         date_echeance = v_echeance,
         taux_tva = p.taux_tva,
         total_ht_centimes = (select coalesce(sum(total_centimes), 0) from public.lignes_facture where facture_id = f.id),
         client_snapshot = to_jsonb(c) - 'notes',
         emetteur_snapshot = to_jsonb(p),
         academie_snapshot = to_jsonb(a)
   where id = f.id
  returning * into f;

  if f.type_facture = 'annuelle' then
    v_arrhes := case
      when c.arrhes_reglees and c.arrhes_saison = f.saison and coalesce(c.arrhes_centimes, 0) > 0
        then c.arrhes_centimes
      else 0
    end;
    v_reste := greatest(f.total_ttc_centimes - v_arrhes, 0);
    if v_reste > 0 then
      for r in
        select k as rang, (make_date(f.saison, 9, 1) + make_interval(months => k - 1))::date as periode
          from generate_series(1, 10) as k
      loop
        -- Numéro d'avis unique : E1-2026-09 (suffixe -2, -3… si une facture annulée l'a déjà utilisé).
        v_numero := c.reference || '-' || to_char(r.periode, 'YYYY-MM');
        v_suffixe := 1;
        while exists (
          select 1 from public.echeances e
           where e.numero_avis = case when v_suffixe = 1 then v_numero else v_numero || '-' || v_suffixe end
        ) loop
          v_suffixe := v_suffixe + 1;
        end loop;
        if v_suffixe > 1 then
          v_numero := v_numero || '-' || v_suffixe;
        end if;

        insert into public.echeances (facture_id, client_id, rang, periode, montant_centimes, date_echeance, numero_avis)
        values (
          f.id, f.client_id, r.rang, r.periode,
          case when r.rang = 10 then v_reste - 9 * (v_reste / 10) else v_reste / 10 end,
          greatest(make_date(extract(year from r.periode)::integer, extract(month from r.periode)::integer, p.jour_generation), v_date)
            + p.delai_paiement_jours,
          v_numero
        );
      end loop;
    end if;
  end if;

  perform set_config('app.emission_facture', 'off', true);
  return f;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Génération des brouillons de factures annuelles
--   p_saison      : année de la rentrée (2026 = septembre 2026 → juin 2027)
--   p_academie_id : null → toutes les académies
--   p_dry_run     : true → aperçu sans rien créer
-- Un brouillon par client actif ayant des tarifs actifs, récurrents et valides sur au moins
-- un mois de la saison ; une ligne par tarif : prix unitaire annuel = prix mensuel appliqué ×
-- nombre de mois de validité sur la saison (10 pour un tarif valide toute l'année), prix
-- catalogue × même nombre de mois, motif de réduction recopié. Idempotente : un client qui a
-- déjà une facture annuelle non annulée pour la saison est renvoyé avec deja_existante.
-- -----------------------------------------------------------------------------
create or replace function public.generer_factures_annuelles(
  p_saison integer,
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
  v_debut date := make_date(p_saison, 9, 1);
  v_libelle_saison text := p_saison || '-' || (p_saison + 1);
  p public.parametres;
  r record;
  v_facture uuid;
  v_total_existant integer;
begin
  if p_saison is null or p_saison < 2000 or p_saison > 2099 then
    raise exception 'Saison invalide';
  end if;
  select * into p from public.parametres where id;
  if not found then
    raise exception 'Paramètres de facturation absents';
  end if;

  for r in
    with tarifs as (
      select t.*,
             coalesce(t.prix_unitaire_centimes, pr.prix_unitaire_centimes) as prix_mensuel,
             (select count(*)::integer
                from generate_series(0, 9) as k
               where (t.date_debut is null or t.date_debut < (v_debut + make_interval(months => k + 1))::date)
                 and (t.date_fin is null or t.date_fin >= (v_debut + make_interval(months => k))::date)) as nb_mois
        from public.tarifs_clients t
        left join public.prestations pr on pr.id = t.prestation_id
       where t.actif and t.recurrent
    )
    select c.id as cid,
           count(t.id)::integer as nb,
           sum(round(t.quantite * t.prix_mensuel * t.nb_mois))::integer as total
      from public.clients c
      join tarifs t on t.client_id = c.id
     where (p_academie_id is null or c.academie_id = p_academie_id)
       and c.actif
       and t.nb_mois > 0
     group by c.id
     order by c.id
  loop
    select f.id, f.total_ht_centimes into v_facture, v_total_existant
      from public.factures f
     where f.client_id = r.cid
       and f.type_facture = 'annuelle'
       and f.saison = p_saison
       and f.statut <> 'annulee'
     limit 1;

    if v_facture is not null then
      client_id := r.cid; facture_id := v_facture; nb_lignes := r.nb;
      total_ht_centimes := v_total_existant; deja_existante := true;
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

    insert into public.factures (client_id, statut, objet, periode, taux_tva, generation_auto, type_facture, saison)
    values (r.cid, 'brouillon', p.objet_facture_mensuelle || ' – saison ' || v_libelle_saison,
            null, p.taux_tva, true, 'annuelle', p_saison)
    returning id into v_facture;

    insert into public.lignes_facture (facture_id, ordre, libelle, description, quantite, prix_unitaire_centimes,
                                       prestation_id, prix_catalogue_centimes, motif_reduction)
    select v_facture,
           row_number() over (order by t.ordre, t.created_at)::integer,
           coalesce(t.libelle, pr.libelle) || ' – ' || v_libelle_saison
             || case when m.nb_mois < 10 then ' (' || m.nb_mois || ' mois)' else '' end,
           coalesce(t.description, pr.description),
           t.quantite,
           coalesce(t.prix_unitaire_centimes, pr.prix_unitaire_centimes) * m.nb_mois,
           t.prestation_id,
           pr.prix_unitaire_centimes * m.nb_mois,
           t.motif_reduction
      from public.tarifs_clients t
      left join public.prestations pr on pr.id = t.prestation_id
      cross join lateral (
        select count(*)::integer as nb_mois
          from generate_series(0, 9) as k
         where (t.date_debut is null or t.date_debut < (v_debut + make_interval(months => k + 1))::date)
           and (t.date_fin is null or t.date_fin >= (v_debut + make_interval(months => k))::date)
      ) m
     where t.client_id = r.cid
       and t.actif
       and t.recurrent
       and m.nb_mois > 0;

    client_id := r.cid; facture_id := v_facture; nb_lignes := r.nb;
    total_ht_centimes := r.total; deja_existante := false;
    return next;
    v_facture := null;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Journal des envois : un envoi d'avis est rattaché à sa facture annuelle ET à l'échéance
-- -----------------------------------------------------------------------------
alter table public.envois_email
  add column echeance_id uuid references public.echeances(id) on delete restrict;

create index envois_email_echeance_idx on public.envois_email(echeance_id);

comment on column public.envois_email.echeance_id is
  'Envoi d''un avis d''échéance (null : envoi de la facture elle-même).';

-- -----------------------------------------------------------------------------
-- 8. Modèles d'e-mail des avis d'échéance
-- -----------------------------------------------------------------------------
alter table public.parametres
  add column email_avis_objet text not null default 'Avis d''échéance {numero} – {structure}',
  add column email_avis_corps text not null default
    E'Bonjour {client},\n\nVeuillez trouver ci-joint l''avis d''échéance {numero} de {montant} à régler avant le {echeance}.\n\n'
    || E'Cordialement,\n{structure}';

-- -----------------------------------------------------------------------------
-- 9. Vues de travail (héritent des droits de l'appelant)
-- -----------------------------------------------------------------------------
-- factures_vue : colonnes existantes + type/saison (f.*), référence élève et avancement des
-- échéances. « En retard » d'une facture annuelle à échéances = au moins une échéance échue
-- non payée ; sinon, règle habituelle (émise/envoyée et échéance dépassée).
drop view public.factures_vue;
create view public.factures_vue with (security_invoker = true) as
select f.*,
       case
         when f.type_facture = 'annuelle' and coalesce(ech.actives, 0) > 0
           then f.statut in ('emise', 'envoyee') and ech.echues > 0
         else f.statut in ('emise', 'envoyee') and f.date_echeance < public.aujourdhui_paris()
       end as en_retard,
       c.type as client_type,
       c.nom as client_nom,
       c.prenom as client_prenom,
       c.raison_sociale as client_raison_sociale,
       c.email as client_email,
       c.emails_cc as client_emails_cc,
       c.cavaliers as client_cavaliers,
       a.nom as academie_nom,
       a.couleur as academie_couleur,
       c.reference as client_reference,
       coalesce(ech.actives, 0) as echeances_actives,
       coalesce(ech.payees, 0) as echeances_payees,
       coalesce(ech.reste, 0) as echeances_reste_centimes
  from public.factures f
  join public.clients c on c.id = f.client_id
  join public.academies a on a.id = f.academie_id
  left join lateral (
    select count(*) filter (where e.statut <> 'annulee')::integer as actives,
           count(*) filter (where e.statut = 'payee')::integer as payees,
           count(*) filter (where e.statut in ('a_venir', 'envoyee') and e.date_echeance < public.aujourdhui_paris())::integer as echues,
           coalesce(sum(e.montant_centimes) filter (where e.statut in ('a_venir', 'envoyee')), 0)::integer as reste
      from public.echeances e
     where e.facture_id = f.id
  ) ech on true;

-- echeances_vue : échéance + facture annuelle + client + académie (figée sur la facture).
create view public.echeances_vue with (security_invoker = true) as
select e.*,
       (e.statut in ('a_venir', 'envoyee') and e.date_echeance < public.aujourdhui_paris()) as en_retard,
       f.numero as facture_numero,
       f.saison,
       f.date_emission as facture_date_emission,
       f.statut as facture_statut,
       f.total_ttc_centimes as facture_total_ttc_centimes,
       f.academie_id,
       c.type as client_type,
       c.nom as client_nom,
       c.prenom as client_prenom,
       c.raison_sociale as client_raison_sociale,
       c.email as client_email,
       c.emails_cc as client_emails_cc,
       c.cavaliers as client_cavaliers,
       c.reference as client_reference,
       c.actif as client_actif,
       c.envoi_auto as client_envoi_auto,
       a.nom as academie_nom,
       a.couleur as academie_couleur
  from public.echeances e
  join public.factures f on f.id = e.facture_id
  join public.clients c on c.id = e.client_id
  join public.academies a on a.id = f.academie_id;

-- -----------------------------------------------------------------------------
-- 10. Sécurité
-- -----------------------------------------------------------------------------
alter table public.echeances enable row level security;
create policy echeances_membres on public.echeances
  for all to authenticated using (public.est_membre()) with check (public.est_membre());

revoke execute on function public.generer_factures_annuelles(integer, uuid, boolean) from public, anon;
grant execute on function public.generer_factures_annuelles(integer, uuid, boolean) to authenticated, service_role;
revoke execute on function public.prochaine_reference_client() from public, anon;
grant execute on function public.prochaine_reference_client() to authenticated, service_role;
-- emettre_facture : droits inchangés (create or replace les conserve).
