-- =============================================================================
-- Envoi automatique décidé client par client
-- =============================================================================
-- Le réglage global `parametres.envoi_auto` est remplacé par une case sur chaque fiche
-- client : le jour de génération (`parametres.jour_generation`), la tâche planifiée émet
-- et envoie les brouillons mensuels des seuls clients actifs cochés ; les autres
-- brouillons restent à relire à la main.
--
-- Reprise de l'existant : si l'envoi automatique global était activé, tous les clients
-- passent en envoi automatique (même comportement qu'avant).
-- Aucune vue ni fonction ne dépend de `parametres.envoi_auto` : la colonne peut être
-- supprimée sans cascade. (Les instantanés `emetteur_snapshot` des factures déjà émises
-- gardent leur copie JSON, sans effet.)

alter table public.clients add column envoi_auto boolean not null default false;

comment on column public.clients.envoi_auto is
  'Le jour de génération, la facture mensuelle du client est émise et envoyée sans relecture (tâche planifiée).';

update public.clients set envoi_auto = true where (select envoi_auto from public.parametres where id);

alter table public.parametres drop column envoi_auto;
