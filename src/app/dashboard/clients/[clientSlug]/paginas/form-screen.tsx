import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { canActAs } from '@/lib/view-as'
import { getAbDestinations } from '@/lib/repo/pages-repo'
import { MAX_PAGES_PER_CLIENT, isSafeProbeUrl, suggestPages } from '@/lib/domain/page-probe'
import { savePage, testPage } from './actions'
import { PageForm, type PageFormValues } from './page-form'

/** Screen C: add a page (pageId null) or edit what an existing page watches. */
export async function PageFormScreen({ clientSlug, pageId, prefillUrl, erro }: { clientSlug: string; pageId: string | null; prefillUrl?: string; erro?: string }) {
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()
  if (!(await canActAs(supabase, client.id, 'gestor'))) notFound()

  const [pagesResult, funnelsResult, destinations] = await Promise.all([
    supabase.from('pages').select('id, label, url, is_active, sales_funnel_id, watch_pixel, watch_checkout, required_text').eq('client_id', client.id),
    supabase.from('sales_funnels').select('id, name').eq('client_id', client.id).order('name'),
    getAbDestinations(supabase, client.id).catch((error) => {
      console.error('[pages-ab-destinations-failed]', { clientId: client.id }, error)
      return []
    }),
  ])
  if (pagesResult.error) throw pagesResult.error
  if (funnelsResult.error) throw funnelsResult.error
  const pages = pagesResult.data ?? []
  const page = pageId ? pages.find((item) => item.id === pageId) : null
  if (pageId && !page) notFound()

  const active = pages.filter((item) => item.is_active).length
  const initial: PageFormValues = page
    ? { label: page.label, url: page.url, salesFunnelId: page.sales_funnel_id, watchPixel: page.watch_pixel, watchCheckout: page.watch_checkout, requiredText: page.required_text }
    : { label: '', url: prefillUrl && isSafeProbeUrl(prefillUrl) ? prefillUrl : '', salesFunnelId: null, watchPixel: true, watchCheckout: true, requiredText: null }
  const context = { client_id: client.id as string, client_slug: client.slug as string }
  const base = `/dashboard/clients/${client.slug}`

  return (
    <div className="flex max-w-[1240px] flex-col gap-8 px-4 md:px-14 pb-24 pt-12">
      <PageHeader
        title={page ? `Editar ${page.label}` : 'Adicionar página'}
        note={page ? 'Mude o que a sonda confere nesta página.' : 'Teste o endereço antes de salvar: a sonda abre a página uma vez e mostra o que encontrou.'}
        actions={
          <Link href={`${base}/paginas`} className="text-[13px] text-[var(--ct-accent)]">
            ← Saúde das páginas
          </Link>
        }
      />
      {erro && <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">{erro}</p>}
      {!page && active >= MAX_PAGES_PER_CLIENT ? (
        <p className="rounded-[14px] border border-dashed border-[var(--ct-line-2)] p-6 text-sm text-[var(--ct-text-2)]">
          As {MAX_PAGES_PER_CLIENT} vagas da sonda estão em uso. Pause ou tire uma página em <Link href={`${base}/paginas`} className="text-[var(--ct-accent)]">Saúde das páginas</Link> para
          adicionar outra.
        </p>
      ) : (
        <PageForm
          initial={initial}
          projects={funnelsResult.data ?? []}
          suggestions={page ? [] : suggestPages(destinations, pages.map((item) => item.url))}
          slotsUsed={page ? active : active + 1}
          maxSlots={MAX_PAGES_PER_CLIENT}
          editing={Boolean(page)}
          saveAction={savePage.bind(null, page ? { ...context, page_id: page.id } : context)}
          testAction={testPage.bind(null, context)}
        />
      )}
    </div>
  )
}
