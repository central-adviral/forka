import type { SupabaseClient } from '@supabase/supabase-js'

export type SyncEntity = 'sales' | 'ad_spend_daily' | 'ad_creative_spend_daily'

export async function getSyncCursor(db: SupabaseClient, salesFunnelId: string, entity: SyncEntity): Promise<string | null> {
  const { data, error } = await db
    .from('funnel_sync_state')
    .select('cursor_updated_at')
    .eq('sales_funnel_id', salesFunnelId)
    .eq('entity', entity)
    .maybeSingle()
  if (error) throw error
  const cursor = data?.cursor_updated_at as string | undefined
  return cursor ? new Date(cursor).toISOString() : null
}

export async function recordSyncResult(
  db: SupabaseClient,
  params: {
    salesFunnelId: string
    entity: SyncEntity
    result: 'ok' | 'error'
    message?: string
    newCursor?: string
  }
): Promise<void> {
  const update: Record<string, unknown> = {
    sales_funnel_id: params.salesFunnelId,
    entity: params.entity,
    last_run_at: new Date().toISOString(),
    last_result: params.result,
    last_message: params.message ?? null,
  }
  if (params.result === 'ok' && params.newCursor) {
    update.cursor_updated_at = params.newCursor
  } else {
    const existing = await getSyncCursor(db, params.salesFunnelId, params.entity)
    update.cursor_updated_at = existing
  }
  const { error } = await db.from('funnel_sync_state').upsert(update, { onConflict: 'sales_funnel_id,entity' })
  if (error) throw error
}
