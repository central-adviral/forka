import type { SupabaseClient } from '@supabase/supabase-js'

// client_secrets has RLS on and no policy, so every function here needs a service-role client.
// service_role bypasses RLS, which also means it bypasses the ownership check RLS used to do for
// free: a caller acting on behalf of a logged-in user must verify ownership itself first.

export interface ClientSecrets {
  funnelSourceServiceRoleKey: string | null
  hublaWebhookToken: string | null
}

export async function getClientSecrets(serviceDb: SupabaseClient, clientId: string): Promise<ClientSecrets> {
  const { data, error } = await serviceDb
    .from('client_secrets')
    .select('funnel_source_service_role_key, hubla_webhook_token')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw error
  return {
    funnelSourceServiceRoleKey: data?.funnel_source_service_role_key ?? null,
    hublaWebhookToken: data?.hubla_webhook_token ?? null,
  }
}

/**
 * Whether each secret is set, without handing the caller the secret. The integrations screen only
 * needs this much to choose between "configured" and "not configured", and a value that never
 * reaches the page cannot be rendered by accident.
 */
export async function getConfiguredSecrets(
  serviceDb: SupabaseClient,
  clientId: string
): Promise<{ hasFunnelSourceKey: boolean; hasHublaToken: boolean }> {
  const secrets = await getClientSecrets(serviceDb, clientId)
  return {
    hasFunnelSourceKey: Boolean(secrets.funnelSourceServiceRoleKey),
    hasHublaToken: Boolean(secrets.hublaWebhookToken),
  }
}

/** Writes only the keys present in `patch`; an omitted key keeps whatever is stored. */
export async function saveClientSecrets(
  serviceDb: SupabaseClient,
  clientId: string,
  patch: Partial<ClientSecrets>
): Promise<void> {
  const row: Record<string, string | null> = { client_id: clientId, updated_at: new Date().toISOString() }
  if (patch.funnelSourceServiceRoleKey !== undefined) {
    row.funnel_source_service_role_key = patch.funnelSourceServiceRoleKey
  }
  if (patch.hublaWebhookToken !== undefined) row.hubla_webhook_token = patch.hublaWebhookToken
  const { error } = await serviceDb.from('client_secrets').upsert(row, { onConflict: 'client_id' })
  if (error) throw error
}
