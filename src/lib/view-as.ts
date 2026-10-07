import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'

// "Ver como cliente": an owner or gestor previews the Central the way the client sees it. It only
// changes what the screens show; the data, the RLS and the server actions stay as they are.
export const VIEW_AS_COOKIE = 'ct-view-as'

export async function viewingAsClient(): Promise<boolean> {
  return (await cookies()).get(VIEW_AS_COOKIE)?.value === 'cliente'
}

/** has_client_role for what a page shows: false for any role above cliente while previewing as the client. */
export async function canActAs(db: SupabaseClient, clientId: string, minRole: 'owner' | 'gestor' | 'analista'): Promise<boolean> {
  if (await viewingAsClient()) return false
  const { data } = await db.rpc('has_client_role', { p_client_id: clientId, p_min_role: minRole })
  return data === true
}
