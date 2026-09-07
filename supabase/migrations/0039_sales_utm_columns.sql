-- LaunchOps records which ad produced each sale (utm_term carries the ad name, filled on
-- 39812 of 40387 sales -- 98.6%), but the sync never copied those fields. On this side a sale
-- could therefore only be tied to an ad through conversion_id: the narrow path that exists
-- only when the sale came through one of our own tests.
--
-- With the UTMs stored, revenue per creative works for every sale of the funnel, test or not.
-- Nullable and no default: existing rows keep NULL until the next sync fills them.
alter table sales
  add column utm_source text,
  add column utm_medium text,
  add column utm_campaign text,
  add column utm_term text,
  add column utm_content text;

-- The creative panel groups sales by ad name; without this it would scan the whole table on
-- every load.
create index sales_utm_term_idx on sales (utm_term) where utm_term is not null;
