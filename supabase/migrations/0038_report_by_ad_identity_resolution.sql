-- get_test_report_by_ad built ONE key per side and compared them: the spend side keyed on
-- ad_id when it had one, the click side on fb_ad_id when the URL carried it and otherwise on
-- the ad *name*. A name never equals an id, so a click without fb_ad_id could not pick up the
-- spend of its own ad -- 2049 such clicks in production on 2026-09-07.
--
-- Two more traps this fixes:
--   * The same ad arrives both ways (some of its clicks carry fb_ad_id, some don't). Keyed
--     separately it became two rows, and each row picked up that ad's full spend, so the
--     reported investment came out doubled.
--   * "av.1KLT.21.V7 - Marçal, Um HB20 Zero" is 37 characters on the spend side and 36 on the
--     click side: the "ç" is stored pre-composed on one side and as letter + combining cedilla
--     on the other. normalize(..., NFC) settles that before any comparison.
--
-- Each spend group keeps one canonical key (its ad_id, or its normalized name when the source
-- has no id -- which 0031's test pins), and every click resolves to that same key: by id first,
-- by normalized name second, falling back to the raw name it arrived with.

drop function if exists get_test_report_by_ad(uuid, timestamptz, timestamptz);

create or replace function get_test_report_by_ad(p_test_id uuid, p_since timestamptz default null, p_until timestamptz default null)
returns table (
  variant_id uuid,
  variant_name text,
  ad_name text,
  clicks bigint,
  visitors bigint,
  conversions bigint,
  revenue_cents bigint,
  bot_clicks bigint,
  ad_spend numeric,
  ad_impressions bigint,
  ad_link_clicks bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_conversion_method text;
begin
  if not exists (
    select 1 from tests t join clients c on c.id = t.client_id
    where t.id = p_test_id and c.owner_id = auth.uid()
  ) then
    raise exception 'not found or access denied';
  end if;

  select client_id, conversion_method into v_client_id, v_conversion_method from tests where id = p_test_id;

  return query
  with spend_by_ad as (
    select
      coalesce(
        nullif(acsd.ad_id, ''),
        'name:' || lower(btrim(normalize(coalesce(acsd.ad_name, ''), NFC)))
      ) as ad_key,
      max(nullif(acsd.ad_id, '')) as ad_id,
      max(acsd.ad_name) as ad_label,
      nullif(lower(btrim(normalize(max(acsd.ad_name), NFC))), '') as norm_name,
      sum(acsd.spend) as spend,
      sum(acsd.impressions) as impressions,
      sum(acsd.link_clicks) as link_clicks
    from ad_creative_spend_daily acsd
    join sales_funnels sf on sf.id = acsd.sales_funnel_id
    where sf.client_id = v_client_id
      and (p_since is null or acsd.data >= p_since::date)
      and (p_until is null or acsd.data < p_until::date)
    group by 1
  ),
  -- One row per name, so resolving a click by name can never fan out into duplicate rows when
  -- two different ad ids happen to share a name. Highest spend wins that name.
  spend_by_name as (
    select distinct on (norm_name) norm_name, ad_key, ad_label
    from spend_by_ad
    where norm_name is not null
    order by norm_name, spend desc
  ),
  click_rows as (
    select
      v.id as v_id,
      v.name as v_name,
      ce.id as click_id,
      ce.visitor_id,
      ce.is_bot,
      cv.id as conversion_id,
      cv.value_cents,
      nullif(ce.source_utms->>'fb_ad_id', '') as click_ad_id,
      nullif(ce.source_utms->>'utm_term', '') as click_ad_name,
      nullif(lower(btrim(normalize(coalesce(ce.source_utms->>'utm_term', ''), NFC))), '') as click_norm_name
    from variants v
    left join click_events ce on ce.variant_id = v.id
      and (p_since is null or ce.created_at >= p_since)
      and (p_until is null or ce.created_at < p_until)
    left join conversions cv on cv.click_event_id = ce.id and cv.source = v_conversion_method
    where v.test_id = p_test_id
  ),
  resolved as (
    select
      c.*,
      coalesce(by_id.ad_key, by_name.ad_key) as canonical_ad_key,
      -- Prefer the human name the spend carries; keep the raw id as the last resort before
      -- "(sem anúncio)", or several unidentified ads would merge into one meaningless bucket.
      coalesce(by_id.ad_label, by_name.ad_label, c.click_ad_name, c.click_ad_id, '(sem anúncio)') as label
    from click_rows c
    left join spend_by_ad by_id on by_id.ad_id = c.click_ad_id
    left join spend_by_name by_name on by_name.norm_name = c.click_norm_name
  )
  select
    r.v_id,
    r.v_name,
    r.label,
    count(distinct r.click_id) filter (where r.is_bot = false)::bigint,
    count(distinct r.visitor_id) filter (where r.is_bot = false)::bigint,
    count(distinct r.conversion_id) filter (where r.is_bot = false)::bigint,
    coalesce(sum(r.value_cents) filter (where r.is_bot = false), 0)::bigint,
    count(distinct r.click_id) filter (where r.is_bot = true)::bigint,
    max(s.spend),
    max(s.impressions)::bigint,
    max(s.link_clicks)::bigint
  from resolved r
  left join spend_by_ad s on s.ad_key = r.canonical_ad_key
  group by r.v_id, r.v_name, r.label
  order by r.v_name, r.label;
end;
$$;

revoke all on function get_test_report_by_ad(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report_by_ad(uuid, timestamptz, timestamptz) to authenticated;
