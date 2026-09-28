-- =============================================================================
-- Arrhes par client
-- =============================================================================
-- Les arrhes sont versées avant la rentrée. La mensualité reste calculée sur 10 mois
-- (septembre → juin) ; si les arrhes sont réglées, chaque facture MENSUELLE de la saison
-- est diminuée de arrhes / 10 :
--   * septembre → mai : floor(arrhes / 10) ;
--   * juin            : arrhes − 9 × floor(arrhes / 10) (le total déduit est exact).
-- Saison 2026 = septembre 2026 → juin 2027. Juillet et août : aucune déduction.
--
-- La facture n'affiche que le montant net : la déduction est retirée du prix unitaire de
-- la ligne de plus grand total parmi les lignes de quantité 1 (égalité : la première dans
-- l'ordre des lignes), à condition que son prix soit ≥ à la déduction. Sinon, aucune
-- déduction (un prix ne devient jamais négatif) : l'interface le signale.
--
-- Réduction motivée : un tarif à prix personnalisé inférieur au catalogue peut porter un motif
-- (« Prise en charge 50 % location cheval »). La génération mensuelle recopie sur chaque ligne
-- le prix catalogue, le motif et la déduction d'arrhes appliquée : figés avec la ligne (les
-- lignes d'une facture émise sont immuables), ils alimentent le rappel imprimé sous l'objet
-- de la facture (« Enseignement annuel … »). Ils ne changent jamais le total.
--
-- Reprise de l'existant : défauts neutres (arrhes non réglées, colonnes nulles), aucune
-- donnée ne change. Les brouillons et factures déjà créés ne sont pas modifiés.

alter table public.clients
  add column arrhes_reglees boolean not null default false,
  add column arrhes_centimes integer
    constraint clients_arrhes_montant check (arrhes_centimes is null or arrhes_centimes >= 0),
  add column arrhes_saison integer
    constraint clients_arrhes_saison check (arrhes_saison is null or arrhes_saison between 2000 and 2100);

comment on column public.clients.arrhes_reglees is
  'Arrhes réglées : déduites des factures mensuelles de septembre à juin de la saison (arrhes_saison).';
comment on column public.clients.arrhes_centimes is
  'Montant des arrhes (centimes), réparti sur 10 mensualités (septembre → juin).';
comment on column public.clients.arrhes_saison is
  'Année de la rentrée : 2026 = septembre 2026 → juin 2027.';

-- Réduction motivée sur un tarif (prix personnalisé inférieur au catalogue).
alter table public.tarifs_clients add column motif_reduction text;

comment on column public.tarifs_clients.motif_reduction is
  'Motif d''un prix personnalisé inférieur au catalogue, rappelé sur la facture mensuelle.';

-- Informations figées sur chaque ligne générée (nulles pour les lignes existantes et saisies à la main).
-- Le trigger proteger_lignes_facture compare les lignes entières : ces colonnes, jamais modifiées
-- sur une facture émise, ne changent rien à l'exception « prestation supprimée » (on delete set null).
alter table public.lignes_facture
  add column prix_catalogue_centimes integer
    constraint lignes_facture_prix_catalogue check (prix_catalogue_centimes is null or prix_catalogue_centimes >= 0),
  add column motif_reduction text,
  add column deduction_arrhes_centimes integer
    constraint lignes_facture_deduction_arrhes check (deduction_arrhes_centimes is null or deduction_arrhes_centimes >= 0);

comment on column public.lignes_facture.prix_catalogue_centimes is
  'Prix catalogue de la prestation au moment de la génération (null : ligne libre ou saisie à la main).';
comment on column public.lignes_facture.motif_reduction is
  'Motif de la réduction du tarif (copie de tarifs_clients.motif_reduction à la génération).';
comment on column public.lignes_facture.deduction_arrhes_centimes is
  'Déduction des arrhes retirée du prix unitaire de cette ligne à la génération (null : aucune).';

-- -----------------------------------------------------------------------------
-- Déduction des arrhes sur la facture mensuelle du mois de p_periode (centimes, ≥ 0).
-- -----------------------------------------------------------------------------
create or replace function public.deduction_arrhes(c public.clients, p_periode date)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when not coalesce(c.arrhes_reglees, false)
      or coalesce(c.arrhes_centimes, 0) <= 0
      or c.arrhes_saison is null
      or date_trunc('month', p_periode)::date < make_date(c.arrhes_saison, 9, 1)
      or date_trunc('month', p_periode)::date > make_date(c.arrhes_saison + 1, 6, 1)
      then 0
    when extract(month from p_periode)::int = 6
      then c.arrhes_centimes - 9 * (c.arrhes_centimes / 10)
    else c.arrhes_centimes / 10
  end;
$$;

revoke execute on function public.deduction_arrhes(public.clients, date) from public, anon;
grant execute on function public.deduction_arrhes(public.clients, date) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Génération mensuelle des brouillons (même signature, même retour) : déduction des arrhes
-- intégrée aux lignes créées ET au total renvoyé (l'aperçu montre le montant réel).
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
  v_deduction integer;
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

    select f.id into v_facture
      from public.factures f
     where f.client_id = r.cid
       and f.periode = v_debut
       and f.generation_auto
       and f.statut <> 'annulee'
     limit 1;

    if v_facture is not null then
      client_id := r.cid; facture_id := v_facture; nb_lignes := r.nb;
      total_ht_centimes := r.total - v_deduction; deja_existante := true;
      return next;
      v_facture := null;
      continue;
    end if;

    if p_dry_run then
      client_id := r.cid; facture_id := null; nb_lignes := r.nb;
      total_ht_centimes := r.total - v_deduction; deja_existante := false;
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

    client_id := r.cid; facture_id := v_facture; nb_lignes := r.nb;
    total_ht_centimes := r.total - v_deduction; deja_existante := false;
    return next;
    v_facture := null;
  end loop;
end;
$$;

-- Droits identiques à la migration initiale.
revoke execute on function public.generer_brouillons_mensuels(date, uuid, boolean) from public, anon;
grant execute on function public.generer_brouillons_mensuels(date, uuid, boolean) to authenticated, service_role;
