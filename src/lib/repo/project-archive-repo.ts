import type { SupabaseClient } from '@supabase/supabase-js'

export const ARCHIVED_PROJECT_ERROR = 'Funil arquivado: restaure para editar.'

// An archived project is read-only (0100); RLS still lets a gestor write it, so actions ask first.
// Returns the pt-BR refusal, or null when the project can be changed.
export async function archivedProjectError(supabase: SupabaseClient, salesFunnelId: string): Promise<string | null> {
  const { data, error } = await supabase.from('sales_funnels').select('archived_at').eq('id', salesFunnelId).maybeSingle()
  if (error) return error.message
  return data?.archived_at ? ARCHIVED_PROJECT_ERROR : null
}
