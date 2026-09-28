-- =============================================================================
-- Extras à facturer (passage de galop, licence, engagements, transport au km…)
-- =============================================================================
-- Au fil du mois, les extras d'un élève sont saisis sur sa fiche (table extras_clients) :
-- « en attente » tant qu'ils ne sont rattachés à aucune facture (facture_id null).
--
-- Ils partent tout seuls avec la facture MENSUELLE (brouillon généré : generation_auto et
-- periode) : integrer_extras(facture) ajoute en lignes, après les lignes existantes, tous les
-- extras en attente du client datés au plus tard du dernier jour du mois facturé, et les
-- rattache à la facture. Appelée :
--   * par generer_brouillons_mensuels sur chaque brouillon créé (un client sans tarif mensuel
--     mais avec des extras en attente reçoit aussi un brouillon ; l'aperçu les compte) ;
--   * par emettre_facture juste avant de figer un brouillon mensuel généré : les extras saisis
--     entre la génération et l'émission (envoi automatique compris) partent aussi ;
--   * par recalculer_brouillon (les lignes d'extras sont conservées, les extras en attente
--     ajoutés) et à la demande (« Ajouter les extras en attente »).
-- Un extra n'est jamais facturé deux fois (un seul rattachement, une seule ligne : index
-- unique sur lignes_facture.extra_id).
--
-- Règles :
--   * un extra naît en attente ; rattaché à un BROUILLON, il reste modifiable (sa ligne suit ;
--     une date postérieure au mois facturé le remet en attente) ou supprimable (sa ligne est
--     retirée) ; rattaché à une facture émise (ou annulée), il est figé ;
--   * la ligne d'un extra modifiée dans le brouillon → l'extra suit ; supprimée du brouillon →
--     l'extra repasse en attente (il repartira avec la prochaine facture mensuelle, émission
--     de ce brouillon comprise) ;
--   * brouillon supprimé → ses extras repassent en attente (on delete set null).
--
-- Migration ADDITIVE : nouvelle table, nouvelle colonne nulle (lignes_facture.extra_id),
-- nouvelles fonctions ; generer_brouillons_mensuels, recalculer_brouillon et emettre_facture
-- sont remplacées (même signature, même retour). Sans extra, comportement inchangé.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table des extras
-- -----------------------------------------------------------------------------
create table public.extras_clients (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  prestation_id uuid references public.prestations(id) on delete set null,  -- null : ligne libre
  libelle text not null check (length(trim(libelle)) > 0),
  description text,
  quantite numeric(10,2) not null default 1 check (quantite > 0),
  prix_unitaire_centimes integer not null check (prix_unitaire_centimes >= 0),
  date_extra date not null default public.aujourdhui_paris(),
  facture_id uuid references public.factures(id) on delete set null,      -- null : en attente
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index extras_clients_client_idx on public.extras_clients(client_id);
create index extras_clients_facture_idx on public.extras_clients(facture_id);
create index extras_clients_attente_idx on public.extras_clients(client_id, date_extra) where facture_id is null;

comment on table public.extras_clients is
  'Extras à facturer (passage de galop, licence, engagements…) : ajoutés à la prochaine facture mensuelle du client.';
comment on column public.extras_clients.date_extra is
  'Date de l''extra : intégré à la facture mensuelle d''un mois s''il est daté au plus tard du dernier jour de ce mois.';
comment on column public.extras_clients.facture_id is
  'Facture sur laquelle l''extra est facturé (null : en attente).';

-- Ligne de facture issue d'un extra (traçabilité).
alter table public.lignes_facture
  add column extra_id uuid references public.extras_clients(id) on delete set null;

comment on column public.lignes_facture.extra_id is
  'Extra facturé par cette ligne (null : ligne de tarif ou saisie à la main).';

-- Un extra = une ligne au plus : jamais facturé deux fois.
create unique index lignes_facture_extra_unique on public.lignes_facture(extra_id) where extra_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Protection des extras
-- -----------------------------------------------------------------------------
create or replace function public.proteger_extra()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_facture public.factures;
begin
  if tg_op = 'INSERT' then
    if new.facture_id is not null then
      raise exception 'Un extra est créé en attente : il est rattaché à sa facture par integrer_extras()';
    end if;
    return new;
  end if;

  if old.facture_id is not null then
    select * into v_facture from public.factures where id = old.facture_id;
  end if;

  if tg_op = 'DELETE' then
    if v_facture.id is not null and v_facture.statut <> 'brouillon' then
      raise exception 'Extra déjà facturé (facture %) : suppression impossible', v_facture.numero;
    end if;
    if v_facture.id is not null then
      -- Rattaché à un brouillon : sa ligne est retirée (sans remettre en attente l'extra supprimé).
      perform set_config('app.extra_supprime', old.id::text, true);
      delete from public.lignes_facture where extra_id = old.id and facture_id = old.facture_id;
      perform set_config('app.extra_supprime', '', true);
    end if;
    return old;
  end if;

  -- UPDATE
  if new.client_id is distinct from old.client_id then
    raise exception 'Un extra ne change pas de client';
  end if;

  if v_facture.id is not null and v_facture.statut <> 'brouillon' then
    -- Seule exception : la suppression d'une prestation du catalogue (on delete set null).
    if old.prestation_id is not null and new.prestation_id is null
       and (to_jsonb(new) - 'prestation_id' - 'updated_at') = (to_jsonb(old) - 'prestation_id' - 'updated_at') then
      return new;
    end if;
    raise exception 'Extra déjà facturé (facture %) : il ne peut plus être modifié', v_facture.numero;
  end if;

  if new.facture_id is not null and new.facture_id is distinct from old.facture_id then
    if old.facture_id is not null then
      raise exception 'Un extra rattaché à une facture ne change pas de facture';
    end if;
    if not exists (
      select 1 from public.factures f
       where f.id = new.facture_id and f.statut = 'brouillon' and f.client_id = new.client_id
    ) then
      raise exception 'Un extra se rattache seulement à un brouillon de son client';
    end if;
  end if;

  -- Rattaché à un brouillon mensuel et daté après le mois facturé : l'extra repasse en attente.
  if new.facture_id is not null and new.facture_id = old.facture_id and v_facture.periode is not null
     and new.date_extra > (date_trunc('month', v_facture.periode) + interval '1 month - 1 day')::date then
    new.facture_id := null;
  end if;

  return new;
end;
$$;

create trigger a_extras_proteger before insert or update or delete on public.extras_clients
  for each row execute function public.proteger_extra();
create trigger b_extras_updated_at before update on public.extras_clients
  for each row execute function public.maj_updated_at();

-- Extra modifié : la ligne de son brouillon suit ; extra remis en attente : sa ligne est retirée.
create or replace function public.synchroniser_ligne_extra()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.facture_id is not null and new.facture_id is null then
    delete from public.lignes_facture l
     where l.extra_id = new.id
       and l.facture_id = old.facture_id
       and exists (select 1 from public.factures f where f.id = old.facture_id and f.statut = 'brouillon');
    return null;
  end if;

  if new.facture_id is not null and new.facture_id = old.facture_id then
    update public.lignes_facture l
       set libelle = new.libelle,
           description = new.description,
           quantite = new.quantite,
           prix_unitaire_centimes = new.prix_unitaire_centimes,
           prestation_id = new.prestation_id
     where l.extra_id = new.id
       and l.facture_id = new.facture_id
       and (l.libelle, l.description, l.quantite, l.prix_unitaire_centimes, l.prestation_id)
           is distinct from (new.libelle, new.description, new.quantite, new.prix_unitaire_centimes, new.prestation_id)
       and exists (select 1 from public.factures f where f.id = new.facture_id and f.statut = 'brouillon');
  end if;
  return null;
end;
$$;

create trigger c_extras_ligne after update on public.extras_clients
  for each row execute function public.synchroniser_ligne_extra();

-- -----------------------------------------------------------------------------
-- 3. Lignes issues d'un extra
-- -----------------------------------------------------------------------------

-- Une ligne reçoit son extra_id uniquement par integrer_extras() ; le lien ne change plus
-- ensuite (sauf remise à null par la suppression de l'extra).
create or replace function public.controler_ligne_extra()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.extra_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.extra_id is distinct from old.extra_id then
      raise exception 'Le lien d''une ligne vers son extra ne se modifie pas';
    end if;
    return new;
  end if;
  if coalesce(current_setting('app.integration_extras', true), '') <> 'on' then
    raise exception 'Les lignes d''extras sont ajoutées par integrer_extras()';
  end if;
  if not exists (
    select 1
      from public.extras_clients e
      join public.factures f on f.id = new.facture_id
     where e.id = new.extra_id
       and e.client_id = f.client_id
       and e.facture_id is null
  ) then
    raise exception 'Extra introuvable, d''un autre client ou déjà facturé';
  end if;
  return new;
end;
$$;

create trigger c_lignes_extra before insert or update on public.lignes_facture
  for each row execute function public.controler_ligne_extra();

-- Ligne d'un extra modifiée dans le brouillon : l'extra suit. Supprimée : l'extra repasse en
-- attente (sauf quand c'est l'extra lui-même qui est supprimé).
create or replace function public.suivre_extra_ligne()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.extra_id is not null
       and old.extra_id::text is distinct from coalesce(current_setting('app.extra_supprime', true), '') then
      update public.extras_clients
         set facture_id = null
       where id = old.extra_id
         and facture_id = old.facture_id;
    end if;
    return null;
  end if;

  if new.extra_id is not null
     and exists (select 1 from public.factures f where f.id = new.facture_id and f.statut = 'brouillon') then
    update public.extras_clients e
       set libelle = new.libelle,
           description = new.description,
           quantite = new.quantite,
           prix_unitaire_centimes = new.prix_unitaire_centimes,
           prestation_id = new.prestation_id
     where e.id = new.extra_id
       and e.facture_id = new.facture_id
       and (e.libelle, e.description, e.quantite, e.prix_unitaire_centimes, e.prestation_id)
           is distinct from (new.libelle, new.description, new.quantite, new.prix_unitaire_centimes, new.prestation_id);
  end if;
  return null;
end;
$$;

create trigger d_lignes_extra_suivi after update or delete on public.lignes_facture
  for each row execute function public.suivre_extra_ligne();

-- -----------------------------------------------------------------------------
-- 4. Intégration des extras en attente dans un brouillon mensuel
-- -----------------------------------------------------------------------------
-- Ajoute en lignes (après les lignes existantes, par date puis saisie) les extras en attente
-- du client datés au plus tard du dernier jour du mois facturé, et les rattache à la facture.
-- Renvoie le nombre d'extras ajoutés (0 : rien en attente). Idempotente.
create or replace function public.integrer_extras(p_facture_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  f public.factures;
  v_fin date;
  v_ordre integer;
  v_nb integer := 0;
  e record;
begin
  select * into f from public.factures where id = p_facture_id for update;
  if not found then
    raise exception 'Facture introuvable';
  end if;
  if f.statut <> 'brouillon' then
    raise exception 'Facture % émise : plus aucun extra ne peut y être ajouté', f.numero;
  end if;
  if not f.generation_auto or f.periode is null then
    raise exception 'Extras intégrés seulement dans une facture mensuelle générée (brouillon saisi à la main : ajouter les lignes à la main)';
  end if;

  v_fin := (date_trunc('month', f.periode) + interval '1 month - 1 day')::date;
  select coalesce(max(l.ordre), 0) into v_ordre from public.lignes_facture l where l.facture_id = f.id;

  perform set_config('app.integration_extras', 'on', true);
  for e in
    select x.*
      from public.extras_clients x
     where x.client_id = f.client_id
       and x.facture_id is null
       and x.date_extra <= v_fin
     order by x.date_extra, x.created_at, x.id
       for update
  loop
    v_ordre := v_ordre + 1;
    insert into public.lignes_facture (facture_id, ordre, libelle, description, quantite, prix_unitaire_centimes,
                                       prestation_id, extra_id)
    values (f.id, v_ordre, e.libelle, e.description, e.quantite, e.prix_unitaire_centimes, e.prestation_id, e.id);
    update public.extras_clients set facture_id = f.id where id = e.id;
    v_nb := v_nb + 1;
  end loop;
  perform set_config('app.integration_extras', 'off', true);

  return v_nb;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Génération mensuelle (même signature, même retour ; corps de la migration 20260929000000)
--    + clients sans tarif mais avec des extras en attente ; extras intégrés à chaque brouillon
--    créé ; total renvoyé (aperçu compris) = tarifs (arrhes déduites) + extras.
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
  v_statut public.statut_facture;
  v_deduction integer;
  v_nb_extras integer;
  v_total_extras integer;
begin
  select * into p from public.parametres where id;
  if not found then
    raise exception 'Paramètres de facturation absents';
  end if;

  for r in
    select c.id as cid,
           coalesce(tf.nb, 0) as nb,
           coalesce(tf.total, 0) as total,
           coalesce(ex.nb, 0) as nb_extras,
           coalesce(ex.total, 0) as total_extras
      from public.clients c
      left join lateral (
        select count(t.id)::integer as nb,
               sum(round(t.quantite * coalesce(t.prix_unitaire_centimes, pr.prix_unitaire_centimes)))::integer as total
          from public.tarifs_clients t
          left join public.prestations pr on pr.id = t.prestation_id
         where t.client_id = c.id
           and t.actif
           and t.recurrent
           and (t.date_debut is null or t.date_debut <= v_fin)
           and (t.date_fin is null or t.date_fin >= v_debut)
      ) tf on true
      left join lateral (
        -- Extras en attente datés au plus tard du dernier jour du mois.
        select count(e.id)::integer as nb,
               sum(round(e.quantite * e.prix_unitaire_centimes))::integer as total
          from public.extras_clients e
         where e.client_id = c.id
           and e.facture_id is null
           and e.date_extra <= v_fin
      ) ex on true
     where (p_academie_id is null or c.academie_id = p_academie_id)
       and c.actif
       and (coalesce(tf.nb, 0) > 0 or coalesce(ex.nb, 0) > 0)
     order by c.id
  loop
    -- Arrhes : déduction du mois, appliquée seulement si une ligne de quantité 1 peut
    -- l'absorber (la ligne la plus chère de quantité 1 a un prix ≥ déduction).
    select public.deduction_arrhes(c, v_debut) into v_deduction
      from public.clients c
     where c.id = r.cid;
    v_deduction := coalesce(v_deduction, 0);
    if v_deduction > 0 and not exists (
      select 1
        from public.tarifs_clients t
        left join public.prestations pr on pr.id = t.prestation_id
       where t.client_id = r.cid
         and t.actif
         and t.recurrent
         and (t.date_debut is null or t.date_debut <= v_fin)
         and (t.date_fin is null or t.date_fin >= v_debut)
         and t.quantite = 1
         and coalesce(t.prix_unitaire_centimes, pr.prix_unitaire_centimes) >= v_deduction
    ) then
      v_deduction := 0;
    end if;

    select f.id, f.statut into v_facture, v_statut
      from public.factures f
     where f.client_id = r.cid
       and f.periode = v_debut
       and f.generation_auto
       and f.statut <> 'annulee'
     limit 1;

    if v_facture is not null then
      -- Extras déjà rattachés, plus ceux en attente si la facture est encore un brouillon
      -- (ils y seront ajoutés au plus tard à l'émission).
      select count(l.id)::integer, coalesce(sum(l.total_centimes), 0)::integer
        into v_nb_extras, v_total_extras
        from public.lignes_facture l
       where l.facture_id = v_facture
         and l.extra_id is not null;
      if v_statut = 'brouillon' then
        v_nb_extras := v_nb_extras + r.nb_extras;
        v_total_extras := v_total_extras + r.total_extras;
      end if;
      client_id := r.cid; facture_id := v_facture; nb_lignes := r.nb + v_nb_extras;
      total_ht_centimes := r.total - v_deduction + v_total_extras; deja_existante := true;
      return next;
      v_facture := null;
      continue;
    end if;

    if p_dry_run then
      client_id := r.cid; facture_id := null; nb_lignes := r.nb + r.nb_extras;
      total_ht_centimes := r.total - v_deduction + r.total_extras; deja_existante := false;
      return next;
      continue;
    end if;

    insert into public.factures (client_id, statut, objet, periode, taux_tva, generation_auto)
    values (r.cid, 'brouillon',
            p.objet_facture_mensuelle || ' – ' || public.nom_mois_fr(v_debut),
            v_debut, p.taux_tva, true)
    returning id into v_facture;

    insert into public.lignes_facture (facture_id, ordre, libelle, description, quantite, prix_unitaire_centimes,
                                       prestation_id, prix_catalogue_centimes, motif_reduction, deduction_arrhes_centimes)
    with lignes as (
      select t.id as tarif_id,
             row_number() over (order by t.ordre, t.created_at)::integer as rang,
             coalesce(t.libelle, pr.libelle) as libelle_ligne,
             coalesce(t.description, pr.description) as description_ligne,
             t.quantite as quantite_ligne,
             coalesce(t.prix_unitaire_centimes, pr.prix_unitaire_centimes) as prix_ligne,
             t.prestation_id as prestation_ligne,
             pr.prix_unitaire_centimes as catalogue_ligne,
             t.motif_reduction as motif_ligne
        from public.tarifs_clients t
        left join public.prestations pr on pr.id = t.prestation_id
       where t.client_id = r.cid
         and t.actif
         and t.recurrent
         and (t.date_debut is null or t.date_debut <= v_fin)
         and (t.date_fin is null or t.date_fin >= v_debut)
    ),
    cible as (
      -- Ligne qui absorbe la déduction : plus grand total parmi les lignes de quantité 1,
      -- la première dans l'ordre en cas d'égalité.
      select l.tarif_id
        from lignes l
       where v_deduction > 0
         and l.quantite_ligne = 1
         and l.prix_ligne >= v_deduction
       order by l.prix_ligne desc, l.rang
       limit 1
    )
    select v_facture,
           l.rang,
           l.libelle_ligne,
           l.description_ligne,
           l.quantite_ligne,
           l.prix_ligne - case when l.tarif_id = (select cible.tarif_id from cible) then v_deduction else 0 end,
           l.prestation_ligne,
           l.catalogue_ligne,
           l.motif_ligne,
           case when l.tarif_id = (select cible.tarif_id from cible) then v_deduction end
      from lignes l;

    -- Extras en attente : ajoutés après les lignes des tarifs.
    v_nb_extras := public.integrer_extras(v_facture);
    select coalesce(sum(l.total_centimes), 0)::integer into v_total_extras
      from public.lignes_facture l
     where l.facture_id = v_facture
       and l.extra_id is not null;

    client_id := r.cid; facture_id := v_facture; nb_lignes := r.nb + v_nb_extras;
    total_ht_centimes := r.total - v_deduction + v_total_extras; deja_existante := false;
    return next;
    v_facture := null;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. « Recalculer depuis les tarifs » (même signature, même retour ; corps de la migration
--    20260930000000) : les lignes d'extras d'un brouillon mensuel sont conservées (placées
--    après les lignes des tarifs) et les extras en attente ajoutés. Renvoie le nombre de lignes.
-- -----------------------------------------------------------------------------
create or replace function public.recalculer_brouillon(p_facture_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  f public.factures;
  v_nb integer;
begin
  select * into f from public.factures where id = p_facture_id for update;
  if not found then
    raise exception 'Facture introuvable';
  end if;
  if f.statut <> 'brouillon' then
    raise exception 'Seul un brouillon peut être recalculé (facture % émise)', f.numero;
  end if;

  if f.type_facture = 'annuelle' then
    select count(*) into v_nb from public.lignes_annuelles_client(f.client_id, f.saison);
  elsif f.generation_auto and f.periode is not null then
    select count(*) into v_nb from public.lignes_mensuelles_client(f.client_id, f.periode);
  else
    raise exception 'Brouillon saisi à la main : aucun tarif à recalculer';
  end if;
  if v_nb = 0 then
    raise exception 'Aucun tarif récurrent valide pour ce client : rien à recalculer';
  end if;

  if f.type_facture = 'annuelle' then
    delete from public.lignes_facture where facture_id = f.id;
    insert into public.lignes_facture (facture_id, ordre, libelle, description, quantite, prix_unitaire_centimes,
                                       prestation_id, prix_catalogue_centimes, motif_reduction)
    select f.id, l.ordre, l.libelle, l.description, l.quantite, l.prix_unitaire_centimes,
           l.prestation_id, l.prix_catalogue_centimes, l.motif_reduction
      from public.lignes_annuelles_client(f.client_id, f.saison) l;
    return v_nb;
  end if;

  -- Mensuel : lignes des tarifs remplacées, lignes d'extras conservées.
  delete from public.lignes_facture where facture_id = f.id and extra_id is null;
  insert into public.lignes_facture (facture_id, ordre, libelle, description, quantite, prix_unitaire_centimes,
                                     prestation_id, prix_catalogue_centimes, motif_reduction, deduction_arrhes_centimes)
  select f.id, l.ordre, l.libelle, l.description, l.quantite, l.prix_unitaire_centimes,
         l.prestation_id, l.prix_catalogue_centimes, l.motif_reduction, l.deduction_arrhes_centimes
    from public.lignes_mensuelles_client(f.client_id, f.periode) l;

  -- Extras rattachés placés après les lignes des tarifs, dans leur ordre actuel.
  update public.lignes_facture lf
     set ordre = v_nb + x.rang
    from (
      select l.id, row_number() over (order by l.ordre, l.created_at, l.id)::integer as rang
        from public.lignes_facture l
       where l.facture_id = f.id
         and l.extra_id is not null
    ) x
   where lf.id = x.id
     and lf.ordre is distinct from v_nb + x.rang;

  -- Extras en attente du mois : ajoutés à la suite.
  perform public.integrer_extras(f.id);

  select count(*)::integer into v_nb from public.lignes_facture where facture_id = f.id;
  return v_nb;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Émission (même signature, même retour ; corps de la migration 20261001000000) : un
--    brouillon mensuel généré reçoit ses extras en attente juste avant d'être figé.
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
  v_mois_numero date;
  v_numero_facture text;
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

  -- Brouillon mensuel généré : les extras saisis depuis la génération partent aussi.
  if f.generation_auto and f.periode is not null then
    perform public.integrer_extras(f.id);
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

  -- Numéro : F-<référence élève>-<MM>-<AAAA>-<n°>. MM/AAAA = mois facturé (période) ou, sans
  -- période, mois de la date d'émission ; n° = compteur global continu de l'année d'émission.
  v_mois_numero := coalesce(f.periode, v_date);
  v_numero_facture := 'F-' || c.reference
    || '-' || to_char(v_mois_numero, 'MM')
    || '-' || to_char(v_mois_numero, 'YYYY')
    || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
  -- Cas extrême (même élève, même mois, même n° d'une autre année) : refus explicite ; l'erreur
  -- annule toute l'émission, compteur compris (aucun numéro consommé).
  if exists (select 1 from public.factures where numero = v_numero_facture) then
    raise exception 'Numéro % déjà attribué : émission impossible', v_numero_facture;
  end if;

  perform set_config('app.emission_facture', 'on', true);

  update public.factures
     set statut = 'emise',
         numero = v_numero_facture,
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
-- 8. Sécurité
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.extras_clients to authenticated, service_role;

alter table public.extras_clients enable row level security;
create policy extras_clients_membres on public.extras_clients
  for all to authenticated using (public.est_membre()) with check (public.est_membre());

revoke execute on function public.integrer_extras(uuid) from public, anon;
grant execute on function public.integrer_extras(uuid) to authenticated, service_role;
-- Fonctions remplacées : droits identiques (create or replace les conserve ; rappel explicite).
revoke execute on function public.generer_brouillons_mensuels(date, uuid, boolean) from public, anon;
grant execute on function public.generer_brouillons_mensuels(date, uuid, boolean) to authenticated, service_role;
revoke execute on function public.recalculer_brouillon(uuid) from public, anon;
grant execute on function public.recalculer_brouillon(uuid) to authenticated, service_role;
revoke execute on function public.emettre_facture(uuid) from public, anon;
grant execute on function public.emettre_facture(uuid) to authenticated, service_role;
