import { createServerSupabaseClient } from '@/lib/supabase/server'
import { readResult } from '@/lib/domain/project-plan'
import { funnelResultLine } from '@/lib/domain/stage-canvas'
import type { StageMeasure } from '@/lib/domain/funnel-stages'
import type { ProjectStatus } from '@/lib/domain/new-funnel'
import { FunnelHeaderForm } from './funnel-header-form'

// The header every Configurar › Funil screen shares (0107): name, funnel tag, status and window,
// editable in place, and the result the stages give. Two small reads: the funnel row and its stages.

export async function FunnelHeader({
  client,
  salesFunnelId,
  canEdit,
  regrasHref,
}: {
  client: { id: string; slug: string }
  salesFunnelId: string
  /** Gestor or owner on an open funnel. */
  canEdit: boolean
  regrasHref: string
}) {
  const supabase = await createServerSupabaseClient()
  const [{ data: funnel, error }, { data: stageRows, error: stagesError }] = await Promise.all([
    supabase.from('sales_funnels').select('name, tag, status, starts_on, ends_on, resultado').eq('id', salesFunnelId).single(),
    supabase.from('funnel_stages').select('name, measure, parallel, archived_at, meta, meta_roas').eq('sales_funnel_id', salesFunnelId).order('position').order('created_at'),
  ])
  if (error) throw error
  if (stagesError) throw stagesError
  const stages = ((stageRows ?? []) as { name: string; measure: StageMeasure; parallel: boolean; archived_at: string | null; meta: number | null; meta_roas: number | null }[]).map((row) => ({
    name: row.name,
    measure: row.measure,
    parallel: row.parallel,
    archivedAt: row.archived_at,
    meta: row.meta === null ? null : Number(row.meta),
    metaRoas: row.meta_roas === null ? null : Number(row.meta_roas),
  }))

  return (
    <FunnelHeaderForm
      context={{ client_id: client.id, client_slug: client.slug, sales_funnel_id: salesFunnelId }}
      initial={{ name: funnel.name, tag: funnel.tag ?? '', status: funnel.status as ProjectStatus, startsOn: funnel.starts_on ?? '', endsOn: funnel.ends_on ?? '' }}
      result={funnelResultLine(stages, readResult(funnel.resultado))}
      canEdit={canEdit}
      regrasHref={regrasHref}
    />
  )
}
