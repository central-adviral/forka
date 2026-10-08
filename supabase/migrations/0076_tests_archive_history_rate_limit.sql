-- Testes 2.0: stop losing clicks and history (review of 2026-10-07). Additive only.
--
-- 1. A click over the per-IP limit is still recorded, flagged. Mobile carriers put many people
--    behind one IP (NAT), and an unrecorded click leaves its sale with no variant.
-- 2. A test is archived instead of deleted. Deleting cascaded its clicks and conversions, left late
--    sales with no test and freed the slug for a new test that old ads would then feed.
-- 3. Weight and URL changes are logged, so the sample-ratio check counts from the last weight change
--    instead of comparing the whole period to the new weights.

alter table click_events add column rate_limited boolean not null default false;

alter table tests add column archived_at timestamptz;
-- An archived test stays paused: /r sends its traffic to the control and /c keeps the buy button.
alter table tests add constraint tests_archived_is_paused check (archived_at is null or status = 'paused');

create table test_changes (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references tests(id) on delete cascade,
  variant_id uuid references variants(id) on delete set null,
  field text not null check (field in ('weight_pct', 'destination_url')),
  old_value text,
  new_value text,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index test_changes_test_created_idx on test_changes (test_id, created_at desc);

alter table test_changes enable row level security;
create policy test_changes_read on test_changes for select to authenticated
  using (test_id in (select t.id from tests t where t.client_id in (select private.accessible_client_ids('cliente'))));
-- No write policy: rows come only from the trigger below.

-- Security definer so the log is written whatever the editor's policies are; it only records what
-- the UPDATE on variants (already checked by its own RLS) changed.
create function private.log_variant_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.weight_pct is distinct from old.weight_pct then
    insert into public.test_changes (test_id, variant_id, field, old_value, new_value, changed_by)
    values (new.test_id, new.id, 'weight_pct', old.weight_pct::text, new.weight_pct::text, auth.uid());
  end if;
  if new.destination_url is distinct from old.destination_url then
    insert into public.test_changes (test_id, variant_id, field, old_value, new_value, changed_by)
    values (new.test_id, new.id, 'destination_url', old.destination_url, new.destination_url, auth.uid());
  end if;
  return new;
end
$$;
create trigger variants_log_change after update of weight_pct, destination_url on variants
  for each row execute function private.log_variant_change();
