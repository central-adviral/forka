-- "Weights sum to 100" and "exactly one control" were only ever guaranteed by
-- create_test_with_variants (0006/0012/0013) plus the partial unique index in 0015, which
-- covers at-most-one control and nothing else. Editing a test went around both.
--
-- Deferrable and initially deferred on purpose: any legitimate multi-variant write passes
-- through intermediate states where the weights don't add up yet. Checking at commit time
-- lets those through and still rejects the transaction that would leave the test broken.
create or replace function assert_test_variant_integrity() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_test_id uuid;
  v_total numeric;
  v_controls int;
begin
  v_test_id := coalesce(new.test_id, old.test_id);

  -- Test already gone (cascade delete): its variants going with it is not a violation.
  if not exists (select 1 from tests where id = v_test_id) then
    return null;
  end if;

  select coalesce(sum(weight_pct), 0), count(*) filter (where is_control)
    into v_total, v_controls
    from variants
   where test_id = v_test_id;

  if abs(v_total - 100) > 0.01 then
    raise exception 'variant weights for test % must sum to 100, got %', v_test_id, v_total;
  end if;

  if v_controls <> 1 then
    raise exception 'test % must have exactly one control variant, found %', v_test_id, v_controls;
  end if;

  return null;
end;
$$;

create constraint trigger variants_integrity_check
  after insert or update or delete on variants
  deferrable initially deferred
  for each row
  execute function assert_test_variant_integrity();
