-- Extra Meta Ads traffic-funnel metrics for the sales funnel dashboard cone:
-- reach/link_clicks/landing_page_views come from LaunchOps' meta_ads_daily (already
-- synced, just not previously selected); initiate_checkout is ad-level in LaunchOps
-- (anuncio_dia), summed per operacao/day during sync.
alter table ad_spend_daily add column reach bigint not null default 0;
alter table ad_spend_daily add column link_clicks bigint not null default 0;
alter table ad_spend_daily add column landing_page_views bigint not null default 0;
alter table ad_spend_daily add column initiate_checkout bigint not null default 0;
