alter table clients
  add column custom_domain text,
  add column domain_status text not null default 'unconfigured'
    check (domain_status in ('unconfigured', 'pending', 'verified')),
  add column hubla_webhook_token text;
