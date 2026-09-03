import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchWithTimeout } from '@/lib/supabase/fetch-with-timeout'

export function createLaunchOpsClient(): SupabaseClient {
  return createClient(
    process.env.LAUNCHOPS_SUPABASE_URL!,
    process.env.LAUNCHOPS_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, global: { fetch: fetchWithTimeout } }
  )
}
