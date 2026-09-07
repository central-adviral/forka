-- 0042 built two name -> id maps and date-filtered only one of them. spend_alias reads the whole
-- spend history on purpose, but ad_alias came off click_rows, which applies p_since/p_until --
-- so narrowing the report window shrank the map and changed how traffic was grouped.
--
-- Measured in production: 12 names resolve from the click stream over all time, 0 inside a
-- 01/09-04/09 window (fb_ad_id only started reaching the URL on 04/09). Seven of those 12 have
-- no spend_alias entry to fall back on, so in a window that excludes their id-bearing clicks
-- they fell into the unresolved bucket and lost the spend join entirely -- the same ad reported
-- its spend or reported "—" depending on which period the operator had selected.
--
-- Which ad a name belongs to is a fact about the account, not about the window being looked at.
-- Both maps read the full history now.
--
-- Also groups the final aggregate by ad_key rather than by the label alone. The label is
-- injective over the keys today, so no row changes; it just stops a future label collision from
-- silently dropping one ad's spend through max().

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
  with click_rows as (
    select
      v.id as v_id,
      v.name as v_name,
      ce.id as click_id,
      ce.visitor_id,
      ce.is_bot,
      ce.created_at,
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
  -- Name -> id, learned from every click this test ever received that carried both. Reads the
  -- full history, not the report window: a name a click identified in August still identifies
  -- the same ad in a September report. A name serving two ads is left out -- better unresolved
  -- than resolved wrongly.
  ad_alias as (
    select
      nullif(lower(btrim(normalize(coalesce(ce.source_utms->>'utm_term', ''), NFC))), '') as norm_name,
      min(nullif(ce.source_utms->>'fb_ad_id', '')) as ad_id
    from variants v
    join click_events ce on ce.variant_id = v.id
    where v.test_id = p_test_id
      and nullif(ce.source_utms->>'fb_ad_id', '') is not null
      and nullif(lower(btrim(normalize(coalesce(ce.source_utms->>'utm_term', ''), NFC))), '') is not null
    group by 1
    having count(distinct nullif(ce.source_utms->>'fb_ad_id', '')) = 1
  ),
  -- Second source for the same map, for a name no click ever carried an id for. Same rule.
  spend_alias as (
    select
      lower(btrim(normalize(acsd.ad_name, NFC))) as norm_name,
      min(acsd.ad_id) as ad_id
    from ad_creative_spend_daily acsd
    join sales_funnels sf on sf.id = acsd.sales_funnel_id
    where sf.client_id = v_client_id
      and nullif(acsd.ad_id, '') is not null
      and nullif(btrim(acsd.ad_name), '') is not null
    group by 1
    having count(distinct acsd.ad_id) = 1
  ),
  resolved as (
    select
      c.*,
      coalesce(
        'id:' || coalesce(c.click_ad_id, a.ad_id, sa.ad_id),
        'name:' || c.click_norm_name,
        '(sem anúncio)'
      ) as ad_key
    from click_rows c
    left join ad_alias a on a.norm_name = c.click_norm_name
    left join spend_alias sa on sa.norm_name = c.click_norm_name
  ),
  spend_by_key as (
    select
      case
        when nullif(acsd.ad_id, '') is not null then 'id:' || acsd.ad_id
        else 'name:' || lower(btrim(normalize(coalesce(acsd.ad_name, ''), NFC)))
      end as ad_key,
      max(acsd.ad_name) as spend_label,
      max(acsd.adset_name) as adset_name,
      max(acsd.campaign_name) as campaign_name,
      max(nullif(acsd.ad_id, '')) as ad_id,
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
  -- Fallback label for an ad the spend sync has not reached yet. The spend table wins when it
  -- has the id, since it holds the name the ad carries in Meta right now -- and it holds one
  -- canonical spelling, where clicks carry whatever bytes the browser sent (NFC or NFD).
  click_label as (
    select ad_key, (array_agg(click_ad_name order by created_at desc nulls last))[1] as label
    from resolved
    where click_ad_name is not null
    group by ad_key
  ),
  base_labels as (
    select
      k.ad_key,
      coalesce(s.spend_label, cl.label, '(sem anúncio)') as base,
      s.adset_name,
      s.campaign_name,
      coalesce(s.ad_id, substring(k.ad_key from '^id:(.+)$')) as ad_id
    from (select distinct ad_key from resolved) k
    left join click_label cl on cl.ad_key = k.ad_key
    left join spend_by_key s on s.ad_key = k.ad_key
  ),
  labels as (
    select
      ad_key,
      case
        when count(*) over (partition by base) = 1 then base
        -- A bucket that never resolved to an id. It is not an ad, it is the leftover traffic of
        -- a name two ads answer to, and saying so beats dressing it up as a third ad.
        when ad_id is null then base || ' · anúncio não identificado'
        when count(*) over (partition by base, coalesce(adset_name, '')) = 1 and adset_name is not null
          then base || ' · ' || adset_name
        when count(*) over (partition by base, coalesce(adset_name, ''), coalesce(campaign_name, '')) = 1
          and campaign_name is not null then base || ' · ' || campaign_name
        else base || ' · id …' || right(ad_id, 6)
      end as label
    from base_labels
  )
  select
    r.v_id,
    r.v_name,
    l.label,
    count(distinct r.click_id) filter (where r.is_bot = false)::bigint,
    count(distinct r.visitor_id) filter (where r.is_bot = false)::bigint,
    count(distinct r.conversion_id) filter (where r.is_bot = false)::bigint,
    coalesce(sum(r.value_cents) filter (where r.is_bot = false), 0)::bigint,
    count(distinct r.click_id) filter (where r.is_bot = true)::bigint,
    max(s.spend),
    max(s.impressions)::bigint,
    max(s.link_clicks)::bigint
  from resolved r
  join labels l on l.ad_key = r.ad_key
  left join spend_by_key s on s.ad_key = r.ad_key
  group by r.v_id, r.v_name, r.ad_key, l.label
  order by r.v_name, l.label;
end;
$$;

revoke all on function get_test_report_by_ad(uuid, timestamptz, timestamptz) from public;
grant execute on function get_test_report_by_ad(uuid, timestamptz, timestamptz) to authenticated;
