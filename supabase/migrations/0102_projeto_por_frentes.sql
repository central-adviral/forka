-- Projeto por Frentes (Vitor, 2026-10-08). Additive: no row loses data.
--
-- * sales_funnels.status (rascunho, rodando, encerrado) replaces the meaning of is_active. A draft
--   is being configured: no sync, no watcher runs. Rodando syncs, watches and alerts. Encerrado stops
--   the sync, so its numbers stay as they were, and its watchers stop. is_active stays, derived from
--   status (true only when rodando), so every reader of it keeps working; the old toggle that writes
--   is_active moves the status the same way. Backfill: is_active true -> rodando; false -> encerrado,
--   because a paused project today is one the sync skips and nobody is configuring, which is what
--   encerrado means; Reabrir brings it back.
-- * sales_funnels.modelo records the template the project was created from; it only pre-fills.
-- * sales_funnels.metrica_secundaria: the project's second metric, in the same terms as resultado.
--   Its target is a project watcher with plan_role 'secundaria', next to the plan watcher (0094),
--   which gets plan_role 'principal'.
-- * project_fronts.metrica_principal / metrica_secundaria and their targets, all optional. Empty: the
--   front follows the project and has no alert of its own. Set: a front watcher per metric, kept in
--   step by a trigger. A front's CPA is CPA de anúncio (sales tie to a front only through the ad, 0086).

alter table public.sales_funnels
  add column status text not null default 'rodando' check (status in ('rascunho', 'rodando', 'encerrado')),
  add column modelo text check (modelo in ('pago', 'gratuito', 'perpetuo', 'captacao')),
  add column metrica_secundaria text check (metrica_secundaria in ('compra', 'lead', 'roas', 'checkout', 'visita', 'alcance'));
update public.sales_funnels set status = case when is_active then 'rodando' else 'encerrado' end;
alter table public.sales_funnels add constraint sales_funnels_secondary_differs check (metrica_secundaria is distinct from resultado);

create or replace function private.sync_funnel_status() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- An insert that only says is_active = false (the old form, old tests) is a stopped project.
    if not new.is_active and new.status = 'rodando' then
      new.status := 'encerrado';
    end if;
  elsif new.status is not distinct from old.status and new.is_active is distinct from old.is_active then
    new.status := case when new.is_active then 'rodando' else 'encerrado' end;
  end if;
  new.is_active := new.status = 'rodando';
  return new;
end
$$;
create trigger sales_funnels_status before insert or update of status, is_active on public.sales_funnels
  for each row execute function private.sync_funnel_status();

alter table public.project_fronts
  add column metrica_principal text check (metrica_principal in ('compra', 'lead', 'roas', 'checkout', 'visita', 'alcance')),
  add column alvo_principal numeric check (alvo_principal > 0),
  add column metrica_secundaria text check (metrica_secundaria in ('compra', 'lead', 'roas', 'checkout', 'visita', 'alcance')),
  add column alvo_secundaria numeric check (alvo_secundaria > 0),
  add constraint project_fronts_secondary_differs check (metrica_secundaria is null or metrica_secundaria is distinct from metrica_principal);

alter table public.watchers add column plan_role text check (plan_role in ('principal', 'secundaria'));
update public.watchers set plan_role = 'principal' where is_plan;
-- The plan watcher (is_plan, 0094) is the project's principal, whoever writes it.
create or replace function private.plan_watcher_role() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.is_plan then
    new.plan_role := 'principal';
  end if;
  return new;
end
$$;
create trigger watchers_plan_role before insert or update of is_plan, plan_role on public.watchers
  for each row execute function private.plan_watcher_role();
create unique index watchers_one_role_per_scope on public.watchers
  (sales_funnel_id, coalesce(front_id, '00000000-0000-0000-0000-000000000000'::uuid), plan_role) where plan_role is not null;

-- A project or front metric, in watcher terms. A front has no CPA geral: its sales are the ones its ads bring.
create or replace function public.result_watcher_metric(p_result text, p_front boolean) returns text
language sql immutable set search_path = ''
as $$
  select case p_result
    when 'compra' then case when p_front then 'cpa_anuncio' else 'cpa_geral' end
    when 'lead' then 'cpl'
    when 'roas' then 'roas'
    when 'checkout' then 'custo_checkout'
    when 'visita' then 'custo_visita'
    when 'alcance' then 'cpm'
  end
$$;

-- The front's watchers follow its metric columns: set adds or changes one, empty removes it.
create or replace function private.sync_front_watchers() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_client_id uuid;
  v_role text;
  v_metric text;
  v_target numeric;
begin
  select sf.client_id into v_client_id from public.sales_funnels sf where sf.id = new.sales_funnel_id;
  foreach v_role in array array['principal', 'secundaria'] loop
    v_metric := case v_role when 'principal' then new.metrica_principal else new.metrica_secundaria end;
    v_target := case v_role when 'principal' then new.alvo_principal else new.alvo_secundaria end;
    if v_metric is null or v_target is null then
      delete from public.watchers where front_id = new.id and plan_role = v_role;
    else
      update public.watchers
         set metric = public.result_watcher_metric(v_metric, true), target = v_target
       where front_id = new.id and plan_role = v_role;
      if not found then
        insert into public.watchers (client_id, sales_funnel_id, front_id, metric, target, plan_role)
        values (v_client_id, new.sales_funnel_id, new.id, public.result_watcher_metric(v_metric, true), v_target, v_role);
      end if;
    end if;
  end loop;
  return new;
end
$$;
create trigger project_fronts_watchers after insert or update of metrica_principal, alvo_principal, metrica_secundaria, alvo_secundaria
  on public.project_fronts for each row execute function private.sync_front_watchers();

-- Watchers only judge a running project: a draft is still being set up and a closed one is frozen.
create or replace function public.evaluate_watchers(p_client_id uuid)
 returns integer
 language plpgsql
 set search_path to ''
as $function$
declare
  w record;
  r record;
  v_day date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  v_count integer := 0;
begin
  for w in
    select wa.id from public.watchers wa
    join public.sales_funnels sf on sf.id = wa.sales_funnel_id
    left join public.project_fronts pf on pf.id = wa.front_id
    where wa.client_id = p_client_id and wa.is_active and sf.archived_at is null and pf.archived_at is null
      and sf.status = 'rodando'
  loop
    select * into r from public.watcher_day(w.id, v_day);

    update public.watchers
       set last_day = v_day, last_value = r.value, last_status = r.status, evaluated_at = now()
     where id = w.id;

    if r.status in ('warn', 'crit') then
      update public.alerts set severity = r.status, value = r.value, day = v_day, updated_at = now()
       where watcher_id = w.id and closed_at is null;
      if not found then
        insert into public.alerts (watcher_id, client_id, severity, value, day) values (w.id, p_client_id, r.status, r.value, v_day);
      end if;
    elsif r.status = 'ok' then
      update public.alerts set closed_at = now(), updated_at = now() where watcher_id = w.id and closed_at is null;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$function$;
