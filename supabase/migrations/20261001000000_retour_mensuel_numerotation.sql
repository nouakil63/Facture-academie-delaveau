-- =============================================================================
-- Retour aux factures mensuelles : nouvelle numérotation F-<référence>-<MM>-<AAAA>-<n°>
-- =============================================================================
-- Décision : abandon du modèle « facture annuelle + avis d'échéance » (migration
-- 20260930000000). Retour aux factures MENSUELLES (septembre → juin générées par
-- generer_brouillons_mensuels, arrhes déduites ; juillet/août et ponctuelles à la main).
--
-- Migration ADDITIVE : aucune table, colonne ni fonction n'est supprimée. Les tables et
-- fonctions du modèle annuel (echeances, generer_factures_annuelles…) restent en base, inutilisées
-- par l'interface ; une facture annuelle existante reste une facture ordinaire.
--
-- Seul changement : le NUMÉRO attribué par emettre_facture (même signature, même retour, même
-- comportement que la version 20260930000000, création des échéances d'une éventuelle facture
-- annuelle comprise) :
--     F-<référence élève>-<MM>-<AAAA>-<n°>        ex. F-E1-10-2026-0012
--   * référence élève : lue sur le client AU MOMENT DE L'ÉMISSION (figée dans le numéro et
--     dans client_snapshot ; la modifier ensuite ne change pas le numéro émis) ;
--   * MM/AAAA : mois facturé (factures.periode) ou, sans période, mois de la date d'émission ;
--   * n° : compteur GLOBAL continu par année d'émission (compteurs_factures, inchangé : une
--     seule série pour tous les élèves et les deux académies), 4 chiffres minimum.
-- Le numéro reste attribué à l'émission uniquement (brouillon = pas de numéro). Une émission
-- en échec est entièrement annulée, compteur compris : aucun numéro consommé.
--
-- parametres.prefixe_facture n'entre plus dans le numéro (colonne et trigger
-- proteger_parametres conservés, sans effet sur la numérotation). Les factures déjà émises
-- (AD-2026-0001…) gardent leur numéro ; la séquence continue (unique (annee, sequence)).
-- =============================================================================

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

-- Droits identiques à ceux du schéma initial (create or replace les conserve ; rappel explicite).
revoke execute on function public.emettre_facture(uuid) from public, anon;
grant execute on function public.emettre_facture(uuid) to authenticated, service_role;
