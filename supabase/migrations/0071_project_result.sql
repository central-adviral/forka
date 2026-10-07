-- Plano do Projeto, step 1: what the project produces.
--
-- A project is a purchase project (CPA over entry sales, the only kind so far) or a lead project
-- (CPL over the paid leads of its campaigns). The result is fixed: when a project changes what it
-- produces, the owner opens a new project with new campaign names and the old one keeps its history.
-- daily_sales_target keeps its name and now reads as results per day of the project's result.

alter table sales_funnels add column resultado text not null default 'compra'
  check (resultado in ('compra', 'lead'));
