-- Collapses getOrAssignVariant's 2 DB round-trips (upsert-ignore-duplicates, then a
-- separate select, needed because "ON CONFLICT DO NOTHING RETURNING" never returns the
-- pre-existing row) into 1: an upsert with a no-op "DO UPDATE SET visitor_id = excluded.visitor_id"
-- (updates a column to its own value, so the assignment is never actually changed) that
-- returns variant_id whether the row was just inserted or already existed. Only hit on a
-- visitor's first click / after cookie expiry.
--
-- Not security definer: this is only ever invoked from the public /r/[slug] redirect route via
-- the service-role client (no authenticated user in that flow), the same way insertClickEvent
-- writes to click_events directly. service_role bypasses function-execute grants entirely, so
-- this is intentionally never granted to authenticated/public -- a signed-in dashboard user has
-- no legitimate reason to call it, and granting it would let them read/overwrite any visitor's
-- assignment for any test by guessing IDs.

create or replace function get_or_assign_variant(p_test_id uuid, p_visitor_id text, p_candidate_variant_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_variant_id uuid;
begin
  insert into variant_assignments (test_id, visitor_id, variant_id)
  values (p_test_id, p_visitor_id, p_candidate_variant_id)
  on conflict (test_id, visitor_id) do update set visitor_id = excluded.visitor_id
  returning variant_id into v_variant_id;
  return v_variant_id;
end;
$$;

revoke all on function get_or_assign_variant(uuid, text, uuid) from public;
