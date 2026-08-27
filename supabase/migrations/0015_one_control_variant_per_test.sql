-- Defense-in-depth: stops two variants of the same test from ever being marked
-- as control at the same time. Does NOT guarantee at least one control exists —
-- that guarantee comes from create_test_with_variants (0006/0012/0013) and the
-- integration test that pins it, not from a constraint (a "must have at least
-- one" rule needs a deferred trigger, not a unique index, and isn't worth the
-- extra complexity given the existing test coverage).
create unique index variants_one_control_per_test
  on variants (test_id)
  where is_control;
