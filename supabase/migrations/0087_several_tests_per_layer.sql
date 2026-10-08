-- Several active tests of one type in a project (Vitor, 2026-10-08). No data changes.
--
-- 0078 allowed one active page test and one active checkout test per project, so two tests never
-- shared a sale. Projects run several tests at once, each on its own ads, so the limit goes. The
-- sale is still credited only inside the project; a person who goes through two links of the same
-- type counts in both tests, which the new-test form says when the project already runs one.

drop index tests_one_active_per_layer;
