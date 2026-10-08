import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { headerAction, headerPrimaryAction } from '@/components/header-actions'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { canActAs } from '@/lib/view-as'
import { getAbDestinations, getPagesWithChecks } from '@/lib/repo/pages-repo'
import { getDailyFunnel } from '@/lib/repo/funnel-repo'
import { saoPauloDay } from '@/lib/repo/today-repo'
import { brtDayBoundaryUtc } from '@/lib/domain/report-period'
import {
  CERT_WARN_DAYS,
  LPV_DROP,
  MAX_PAGES_PER_CLIENT,
  NO_TRAFFIC_DAYS,
  PAGE_SLOW_MS,
  availability,
  checkFindings,
  isSilenced,
  lpvSignal,
  outageCost,
  outages,
  pageStatus,
  suggestPages,
  testsPointingTo,
} from '@/lib/domain/page-probe'
import { checkPagesNow } from './actions'
import { PageRow, type PageView } from './page-row'
import { currency, durationLabel, mono, when } from './format'

type Filter = 'todas' | 'problema' | 'sem_trafego'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'problema', label: 'Com problema' },
  { value: 'sem_trafego', label: 'Sem tráfego' },
]

export default async function PaginasPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>
  searchParams: Promise<{ ok?: string; erro?: string; filtro?: string }>
}) {
  const { clientSlug } = await params
  const { ok, erro, filtro } = await searchParams
  const filter: Filter = filtro === 'problema' || filtro === 'sem_trafego' ? filtro : 'todas'
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const [pages, canEdit, funnelsResult, destinations] = await Promise.all([
    getPagesWithChecks(supabase, client.id, { sinceDays: 7 }),
    canActAs(supabase, client.id, 'gestor'),
    supabase.from('sales_funnels').select('id, slug, name').eq('client_id', client.id),
    // Suggestions are a convenience: a failed read only hides them.
    getAbDestinations(supabase, client.id).catch((error) => {
      console.error('[pages-ab-destinations-failed]', { clientId: client.id }, error)
      return []
    }),
  ])
  if (funnelsResult.error) throw funnelsResult.error
  const funnels = funnelsResult.data ?? []

  const now = new Date()
  const today = saoPauloDay(0, now)
  const lastThreeDays = saoPauloDay(-(NO_TRAFFIC_DAYS - 1), now)
  const hoursIntoDay = (now.getTime() - new Date(brtDayBoundaryUtc(today)).getTime()) / 3_600_000
  const linkedIds = [...new Set(pages.flatMap((page) => (page.salesFunnelId ? [page.salesFunnelId] : [])))]
  const dailies = await Promise.all(linkedIds.map((id) => getDailyFunnel(supabase, id, saoPauloDay(-7, now), saoPauloDay(1, now))))
  const projectById = new Map(
    linkedIds.map((id, index) => {
      const funnel = funnels.find((item) => item.id === id)
      const days = dailies[index]
      return [
        id,
        {
          id,
          name: funnel?.name ?? 'Projeto',
          slug: funnel?.slug ?? '',
          spendToday: days.find((day) => day.data === today)?.spendComImposto ?? 0,
          spendRecent: days.filter((day) => day.data >= lastThreeDays).reduce((sum, day) => sum + day.spendComImposto, 0),
          // Closed days only: today's views lag behind its clicks.
          lpv: lpvSignal(days.filter((day) => day.data < today).map((day) => ({ day: day.data, linkClicks: day.linkClicks, landingPageViews: day.landingPageViews }))),
        },
      ]
    })
  )

  const views: PageView[] = pages.map((page) => {
    const project = page.salesFunnelId ? (projectById.get(page.salesFunnelId) ?? null) : null
    const status = page.isActive ? pageStatus(page.checks, page.watch, now, project ? project.spendRecent : null) : 'sem_check'
    const pageOutages = outages(page.checks)
    const current = status === 'critico' ? (pageOutages.find((outage) => outage.until === null) ?? null) : null
    return {
      page,
      status,
      silenced: isSilenced(page.silencedUntil, now),
      findings: page.checks[0] ? checkFindings(page.checks[0], page.watch, now) : [],
      project,
      outages: pageOutages,
      currentOutage: current,
      costSinceDown: current && project ? outageCost(project.spendToday, hoursIntoDay, new Date(current.since), now) : null,
      affectedTests: testsPointingTo(destinations, page.url),
    }
  })
  const activeViews = views.filter((view) => view.page.isActive)
  const problem = (view: PageView) => view.status === 'critico' || view.status === 'atencao'
  const shown = views.filter((view) => (filter === 'problema' ? problem(view) : filter === 'sem_trafego' ? view.status === 'sem_trafego' : true))
  const count = (status: PageView['status']) => activeViews.filter((view) => view.status === status).length

  const allChecks = activeViews.flatMap((view) => view.page.checks)
  const uptime = availability(allChecks)
  const lastOutage = activeViews
    .flatMap((view) => view.outages.map((outage) => ({ ...outage, label: view.page.label })))
    .sort((a, b) => b.since.localeCompare(a.since))[0]
  const lastCheckAt = allChecks.map((check) => check.checkedAt).sort().at(-1)
  // A project with two problem pages counts its spend once.
  const spendAtRisk = [...new Set(activeViews.filter(problem).flatMap((view) => (view.project ? [view.project.id] : [])))].reduce(
    (sum, id) => sum + (projectById.get(id)?.spendToday ?? 0),
    0
  )
  const suggestions = suggestPages(destinations, pages.map((page) => page.url))
  const base = `/dashboard/clients/${client.slug}`
  const context = { client_id: client.id as string, client_slug: client.slug as string }

  return (
    <div className="flex max-w-[1240px] flex-col gap-8 px-4 md:px-14 pb-24 pt-12">
      <PageHeader
        title="Saúde das páginas"
        note="A sonda abre cada página como um visitante: confere se abre, para onde redireciona, o certificado, o pixel, o botão de compra e o texto que você pedir."
        actions={
          canEdit && (
            <>
              {pages.length > 0 && (
                <form action={checkPagesNow.bind(null, context)}>
                  <button type="submit" className={`${headerAction} min-h-11`}>
                    Checar agora
                  </button>
                </form>
              )}
              <Link href={`${base}/paginas/nova`} className={`${headerPrimaryAction} inline-flex min-h-11 items-center`}>
                + Adicionar página
              </Link>
            </>
          )
        }
      />

      {ok && <p role="status" className="rounded-[10px] bg-[var(--ct-ok-soft)] px-4 py-3 text-[13px] text-[var(--ct-ok)]">{ok}</p>}
      {erro && <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">{erro}</p>}

      <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-4">
        <Card label="Agora" foot={`${count('sem_trafego')} no ar sem tráfego`}>
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[15px]">
            <span className="text-[var(--ct-crit)]"><b className={`${mono} text-2xl font-medium`}>{count('critico')}</b> fora</span>
            <span className="text-[var(--ct-warn)]"><b className={`${mono} text-2xl font-medium`}>{count('atencao')}</b> atenção</span>
            <span className="text-[var(--ct-ok)]"><b className={`${mono} text-2xl font-medium`}>{count('ok') + count('sem_trafego')}</b> no ar</span>
          </span>
        </Card>
        <Card
          label="Disponibilidade em 7 dias"
          foot={lastOutage ? `última queda: ${lastOutage.label}, ${when(lastOutage.since)}${lastOutage.until ? ` (${durationLabel(new Date(lastOutage.until).getTime() - new Date(lastOutage.since).getTime())})` : ', ainda fora'}` : 'nenhuma queda'}
        >
          <b className={`${mono} text-2xl font-medium`}>{uptime === null ? '—' : `${(uptime * 100).toFixed(1).replace('.', ',')}%`}</b>
        </Card>
        <Card label="Última checagem" foot="a cada hora · a cada 5 min se alguma cair">
          <b className={`${mono} text-2xl font-medium`}>{lastCheckAt ? when(lastCheckAt) : 'nunca'}</b>
        </Card>
        <Card label="Gasto indo para páginas com problema" foot="hoje, com imposto, dos projetos ligados">
          <b className={`${mono} text-2xl font-medium ${spendAtRisk > 0 ? 'text-[var(--ct-crit)]' : ''}`}>{currency(spendAtRisk)}</b>
        </Card>
      </div>

      {canEdit && suggestions.length > 0 && (
        <aside className="flex flex-wrap items-center gap-3 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-accent-soft)] px-5 py-4 text-[13px]">
          <span className="min-w-0 flex-1">
            <b className="font-semibold">{suggestions.length === 1 ? '1 página dos seus testes A/B' : `${suggestions.length} páginas dos seus testes A/B`} ainda fora da sonda.</b>{' '}
            <span className="text-[var(--ct-text-2)]">{suggestions[0].source}: {suggestions[0].url}</span>
          </span>
          <Link
            href={`${base}/paginas/nova?url=${encodeURIComponent(suggestions[0].url)}`}
            className="inline-flex min-h-11 items-center rounded-full border border-[var(--ct-line-2)] px-4 text-[13px] font-medium hover:text-[var(--ct-text)]"
          >
            Adicionar esta
          </Link>
          {suggestions.length > 1 && (
            <Link href={`${base}/paginas/nova`} className="text-[12.5px] text-[var(--ct-accent)]">
              Ver todas
            </Link>
          )}
        </aside>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          {FILTERS.map((option) => (
            <Link
              key={option.value}
              href={option.value === 'todas' ? `${base}/paginas` : `${base}/paginas?filtro=${option.value}`}
              aria-current={filter === option.value ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-3.5 font-medium ${filter === option.value ? 'bg-[var(--ct-accent-soft)] text-[var(--ct-text)]' : 'text-[var(--ct-text-2)] hover:text-[var(--ct-text)]'}`}
            >
              {option.label}
            </Link>
          ))}
          <span className="ml-auto text-[var(--ct-text-3)]">
            {activeViews.length} de {MAX_PAGES_PER_CLIENT} vagas usadas
          </span>
        </div>

        <div className="card-shadow rounded-[18px] border border-[var(--ct-line)]">
          {pages.length === 0 && (
            <p className="px-6 py-5 text-[13.5px] text-[var(--ct-text-2)]">
              Nenhuma página na sonda ainda.{' '}
              {canEdit && <Link href={`${base}/paginas/nova`} className="text-[var(--ct-accent)]">Adicione a primeira</Link>}
            </p>
          )}
          {pages.length > 0 && shown.length === 0 && <p className="px-6 py-5 text-[13.5px] text-[var(--ct-text-2)]">Nenhuma página neste filtro.</p>}
          {shown.map((view) => (
            <PageRow key={view.page.id} view={view} base={base} context={context} canEdit={canEdit} now={now} />
          ))}
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--ct-text-3)]">
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[var(--ct-ok)]" /> checagem ok</span>
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[var(--ct-warn)]" /> abriu com aviso</span>
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[var(--ct-crit)]" /> não abriu</span>
        </p>
      </section>

      <footer className="rounded-[14px] border border-[var(--ct-line)] px-5 py-4 text-[12px] leading-relaxed text-[var(--ct-text-3)]">
        <b className="font-semibold text-[var(--ct-text-2)]">Como a sonda decide.</b> Fora do ar: não abriu em 2 checagens seguidas, ou a cadeia de redirecionamentos termina
        em erro. Atenção: servidor acima de {PAGE_SLOW_MS / 1000}s, certificado vencendo em menos de {CERT_WARN_DAYS} dias, ou pixel, botão de compra ou texto vigiado
        ausentes. Sem tráfego: o projeto ligado não gastou nos últimos {NO_TRAFFIC_DAYS} dias. Quem clica chega: dia com visualizações por clique {LPV_DROP * 100}% abaixo da
        média de 7 dias fica marcado. Página silenciada continua sendo checada, mas não avisa.
      </footer>
    </div>
  )
}

function Card({ label, foot, children }: { label: string; foot: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-[22px] py-5">
      <span className="text-xs text-[var(--ct-text-3)]">{label}</span>
      {children}
      <span className="text-xs text-[var(--ct-text-3)]">{foot}</span>
    </div>
  )
}
