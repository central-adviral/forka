import { createBrowserClient } from '@supabase/ssr'
import { fetchWithTimeout } from './fetch-with-timeout'

export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: fetchWithTimeout } }
  )
}
