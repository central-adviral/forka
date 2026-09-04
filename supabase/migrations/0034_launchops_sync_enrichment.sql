alter table sales add column transaction_id_plataforma text;
alter table sales add column conversion_id uuid references conversions(id) on delete set null;

alter table ad_creative_spend_daily add column campaign_id text;
alter table ad_creative_spend_daily add column campaign_name text;
alter table ad_creative_spend_daily add column adset_id text;
alter table ad_creative_spend_daily add column adset_name text;
