import type { SupabaseClient } from '@supabase/supabase-js'

// Mirrors the role ladder in 0051_memberships_and_roles.sql. A staff admin passes every check.
export type ClientRole = 'cliente' | 'analista' | 'gestor' | 'owner'

/**
 * Throws unless the signed-in user holds at least `minRole` on the client. Call it on the user's
 * own session before any service-role write: the service role bypasses RLS, and "can read the
 * client" is no longer the same as "may change it" now that read-only members exist.
 */
export async function assertClientRole(
  userDb: SupabaseClient,
  clientId: string,
  minRole: ClientRole
): Promise<void> {
  const { data, error } = await userDb.rpc('has_client_role', { p_client_id: clientId, p_min_role: minRole })
  if (error) throw error
  if (data !== true) throw new Error('Cliente não encontrado')
}
