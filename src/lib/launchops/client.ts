import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchWithTimeout } from '@/lib/supabase/fetch-with-timeout'

export function createLaunchOpsClient(params: { url: string; serviceRoleKey: string }): SupabaseClient {
  return createClient(params.url, params.serviceRoleKey, {
    auth: { persistSession: false },
    global: { fetch: fetchWithTimeout },
  })
}
