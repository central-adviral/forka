import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchWithTimeout } from './fetch-with-timeout'

export function createServiceRoleClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, global: { fetch: fetchWithTimeout } }
  )
}
