-- Contract step of the secrets move started in 0045.
--
-- APPLY ONLY AFTER the code that reads client_secrets is deployed. Until then the running
-- deployment still selects these columns, and dropping them takes the integrations screen and
-- the funnel sync down.
--
-- The guard below refuses to run if any secret still on `clients` is missing from, or differs
-- from, the copy in client_secrets. Dropping a column is the one step here that cannot be undone.

do $$
declare
  v_unmigrated int;
begin
  select count(*) into v_unmigrated
  from clients c
  left join client_secrets s on s.client_id = c.id
  where (c.funnel_source_service_role_key is not null
         and s.funnel_source_service_role_key is distinct from c.funnel_source_service_role_key)
     or (c.hubla_webhook_token is not null
         and s.hubla_webhook_token is distinct from c.hubla_webhook_token);

  if v_unmigrated > 0 then
    raise exception 'aborting: % client(s) hold a secret client_secrets does not have. Re-run 0045 first.', v_unmigrated;
  end if;
end $$;

alter table clients drop column funnel_source_service_role_key;
alter table clients drop column hubla_webhook_token;
