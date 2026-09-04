import type { SupabaseClient } from '@supabase/supabase-js'

export interface LaunchOpsAdCreative {
  id: string
  ad_id: string | null
  ad_name: string | null
}

export interface LaunchOpsAdCreativeSpendRow {
  anuncio_id: string
  data_referencia: string
  spend: number
  impressions: number
  link_clicks: number
  updated_at: string
}

export interface JoinedAdCreativeSpendRow {
  ad_id: string | null
  ad_name: string | null
  data: string
  spend: number
  impressions: number
  link_clicks: number
}

export async function fetchLaunchOpsAdCreatives(
  launchopsDb: SupabaseClient,
  operacaoIds: string[]
): Promise<LaunchOpsAdCreative[]> {
  const { data, error } = await launchopsDb.from('anuncio').select('id, ad_id, ad_name').in('operacao_id', operacaoIds)
  if (error) throw error
  return (data ?? []) as LaunchOpsAdCreative[]
}

export async function fetchLaunchOpsAdCreativeSpendRows(
  launchopsDb: SupabaseClient,
  params: { anuncioIds: string[]; since: string | null }
): Promise<LaunchOpsAdCreativeSpendRow[]> {
  if (params.anuncioIds.length === 0) return []
  let query = launchopsDb
    .from('anuncio_dia')
    .select('anuncio_id, data_referencia, spend, impressions, link_clicks, updated_at')
    .in('anuncio_id', params.anuncioIds)
    .order('updated_at', { ascending: true })
  if (params.since) query = query.gt('updated_at', params.since)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as LaunchOpsAdCreativeSpendRow[]
}

export function joinAdCreativeSpend(
  creatives: LaunchOpsAdCreative[],
  spendRows: LaunchOpsAdCreativeSpendRow[]
): JoinedAdCreativeSpendRow[] {
  const creativeById = new Map(creatives.map((c) => [c.id, c]))
  const joined: JoinedAdCreativeSpendRow[] = []
  for (const row of spendRows) {
    const creative = creativeById.get(row.anuncio_id)
    if (!creative) continue
    joined.push({
      ad_id: creative.ad_id,
      ad_name: creative.ad_name,
      data: row.data_referencia,
      spend: row.spend,
      impressions: row.impressions,
      link_clicks: row.link_clicks,
    })
  }
  return joined
}

export async function syncAdCreativeSpendForFunnel(
  appDb: SupabaseClient,
  salesFunnelId: string,
  rows: JoinedAdCreativeSpendRow[]
): Promise<{ synced: number }> {
  if (rows.length === 0) return { synced: 0 }

  const payload = rows.map((row) => ({
    sales_funnel_id: salesFunnelId,
    source: 'launchops_sync',
    data: row.data,
    ad_id: row.ad_id,
    ad_name: row.ad_name,
    spend: row.spend,
    impressions: row.impressions,
    link_clicks: row.link_clicks,
    updated_at: new Date().toISOString(),
  }))

  const { error } = await appDb
    .from('ad_creative_spend_daily')
    .upsert(payload, { onConflict: 'sales_funnel_id,source,data,ad_id,ad_name' })
  if (error) throw error
  return { synced: payload.length }
}
