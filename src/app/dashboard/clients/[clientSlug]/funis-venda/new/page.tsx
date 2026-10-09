import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { canActAs } from '@/lib/view-as'
import { getStagePresets } from '@/lib/repo/funnel-stages-repo'
import { FUNNEL_MODELS, modelStages } from '@/lib/domain/new-funnel'
import { PageHeader } from '@/components/page-header'
import { NewFunnelForm } from './new-funnel-form'

export default async function NewFunnelPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()
  if (!(await canActAs(supabase, client.id, 'gestor'))) {
    return <p className="px-4 pt-12 text-[13px] text-[var(--ct-text-2)] md:px-14">Só gestor ou owner cria funis.</p>
  }

  const [{ data: funnels, error }, presets] = await Promise.all([
    supabase.from('sales_funnels').select('id, name').eq('client_id', client.id).is('archived_at', null).order('name'),
    getStagePresets(supabase, client.id),
  ])
  if (error) throw error

  return (
    <div className="flex max-w-[1180px] flex-col gap-6 px-4 pb-24 pt-12 md:px-14">
      <PageHeader title="Novo funil" note="Uma tela só: o nome, a etiqueta e o modelo. O funil abre direto no canvas, com as etapas montadas; produtos e metas vêm logo depois, no checklist." />
      <NewFunnelForm
        context={{ client_id: client.id, client_slug: client.slug }}
        models={FUNNEL_MODELS.map((model) => ({ key: model.key, name: model.name, text: model.text, stages: modelStages(model.key, presets) }))}
        funnels={(funnels ?? []).map((funnel) => ({ id: funnel.id as string, name: funnel.name as string }))}
      />
    </div>
  )
}
