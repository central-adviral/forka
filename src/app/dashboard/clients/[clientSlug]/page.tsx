import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { deleteClient } from '../actions'
import { findBestVariant } from '@/lib/repo/client-hub-repo'
import { getClientDaily, saoPauloDay, type ClientDay } from '@/lib/repo/today-repo'
import { buildAttention, type AttentionItem } from '@/lib/domain/attention'
import { getAlerts, getWatchers } from '@/lib/repo/watchers-repo'
import { METRICS, formatMetric, watcherScope } from '@/lib/domain/watchers'
import { projectDay } from '@/lib/domain/day-pace'
import { getPagesWithChecks } from '@/lib/repo/pages-repo'
import { isOutage, pageHealth } from '@/lib/domain/page-probe'
import { canActAs } from '@/lib/view-as'

const PERIODS = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7d', label: '7 dias' },
] as const
type Period = (typeof PERIODS)[number]['value']

const TOOL_LABEL: Record<AttentionItem['tool'], string> = {
  painel: 'Painel de Controle',
  analises: 'Análises',
  ab: 'Teste A/B',
  config: 'Configurar',
}
const TOOL_TONE: Record<AttentionItem['tool'], string> = {
  painel: 'bg-[var(--ct-accent-soft)] text-[var(--ct-painel)]',
  analises: 'bg-[var(--ct-an-soft)] text-[var(--ct-an)]',
  ab: 'bg-[var(--ct-ab-soft)] text-[var(--ct-ab)]',
  config: 'bg-[var(--ct-surface-3)] text-[var(--ct-text-2)]',
}
const SEVERITY_TONE: Record<AttentionItem['severity'], { box: string; mark: string }> = {
  crit: { box: 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]', mark: '!' },
  warn: { box: 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]', mark: '▲' },
  ok: { box: 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]', mark: '✓' },
}

const mono = 'font-[family-name:var(--font-geist-mono)]'
const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const currency2 = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const timeBr = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })

function sum(days: ClientDay[], key: 'spendComImposto' | 'leads' | 'vendas' | 'vendasAnuncio' | 'receitaLiquida'): number {
  return days.reduce((total, day) => total + day[key], 0)
}

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  const points = values.map((value, i) => `${((i / (values.length - 1)) * 64).toFixed(1)},${(20 - (value / max) * 18).toFixed(1)}`).join(' ')
  return (
    <svg viewBox="0 0 64 22" className="h-[22px] w-16 flex-none" aria-hidden="true">
      <polyline points={points} fill="none" style={{ stroke: color }} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default async function TodayPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>
  searchParams: Promise<{ periodo?: string }>
}) {
  const { clientSlug } = await params
  const { periodo } = await searchParams
  const period: Period = periodo === 'ontem' || periodo === '7d' ? periodo : 'hoje'
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const today = saoPauloDay(0)
  const week = { since: saoPauloDay(-6), until: saoPauloDay(1) }
  const monthSince = saoPauloDay(-29)
  const base = `/dashboard/clients/${client.slug}`

  const [weekDays, campaignsResult, lastRunResult, funnelsResult, { data: activeTests }, { data: isOwner }] = await Promise.all([
    getClientDaily(supabase, client.id, week.since, week.until),
    supabase.rpc('get_client_campaigns', { p_client_id: client.id, p_since: monthSince, p_until: week.until }),
    supabase.from('sync_runs').select('finished_at, error').eq('client_id', client.id).not('finished_at', 'is', null).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sales_funnels').select('slug, name, is_active, daily_sales_target').eq('client_id', client.id).order('name'),
    supabase.from('tests').select('id, name').eq('client_id', client.id).eq('status', 'active'),
    canActAs(supabase, client.id, 'owner').then((data) => ({ data })),
  ])
  // A failed read must not pass for a quiet day: no conflicts, no unclassified spend, no sync.
  const readError = campaignsResult.error ?? lastRunResult.error ?? funnelsResult.error
  if (readError) throw readError
  const campaigns = campaignsResult.data
  const lastRun = lastRunResult.data
  const funnels = funnelsResult.data
  const [bestVariant, watchers, alerts, pages] = await Promise.all([
    findBestVariant(supabase, activeTests ?? [], monthSince, week.until).catch(() => null),
    getWatchers(supabase, client.id),
    getAlerts(supabase, client.id),
    getPagesWithChecks(supabase, client.id, 2),
  ])
  // A page the ads point to that is down or slow (0066) goes to the same queue as the watchers.
  const pageAlerts = pages.flatMap((page) => {
    const health = pageHealth(page.checks)
    if (!page.isActive || health === 'ok' || health === 'sem_check') return []
    const last = page.checks[0]
    return [{
      severity: (isOutage(page.checks) ? 'crit' : 'warn') as 'crit' | 'warn',
      title: `${page.label} ${health === 'fora' ? 'fora do ar' : 'lenta'}`,
      detail: health === 'fora' ? `${last.error ?? 'Não respondeu'} na última checagem.` : `${((last.ttfbMs ?? 0) / 1000).toFixed(1).replace('.', ',')}s para responder na última checagem.`,
    }]
  })
  const watcherById = new Map(watchers.map((watcher) => [watcher.id, watcher]))
  const watcherAlerts = alerts.flatMap((alert) => {
    const watcher = watcherById.get(alert.watcherId)
    if (alert.closedAt || !watcher) return []
    const scope = `${watcher.projectName} · ${watcherScope(watcher)}`
    return [{
      severity: alert.severity,
      title: `${scope} · ${METRICS[watcher.metric].label} ${alert.severity === 'crit' ? 'crítico' : 'em atenção'}`,
      detail: `${formatMetric(watcher.metric, alert.value)} contra alvo de ${formatMetric(watcher.metric, watcher.target)} no último dia fechado.`,
    }]
  })

  const periodDays =
    period === 'hoje' ? weekDays.filter((day) => day.data === today)
    : period === 'ontem' ? weekDays.filter((day) => day.data === saoPauloDay(-1))
    : weekDays
  const todayRow = weekDays.find((day) => day.data === today)
  const metaDataAt = todayRow?.dadosAte ?? null
  const partial = period !== 'ontem' && Boolean(todayRow?.dadosAte)

  const spend = sum(periodDays, 'spendComImposto')
  const vendas = sum(periodDays, 'vendas')
  const vendasAnuncio = sum(periodDays, 'vendasAnuncio')
  const leads = sum(periodDays, 'leads')

  const classified = (campaigns ?? []) as { campaign_name: string; spend: number; front_ids: string[]; suggested_front_ids: string[] }[]
  const conflicts = classified.filter((c) => c.front_ids.length === 0 && c.suggested_front_ids.length > 1)
  const orphans = classified.filter((c) => c.front_ids.length === 0 && c.suggested_front_ids.length === 0)
  const firstProject = (funnels ?? [])[0]
  const attention = buildAttention({
    base,
    now: new Date(),
    metaDataAt,
    lastRun: lastRun ? { finishedAt: lastRun.finished_at, error: lastRun.error } : null,
    conflicts: conflicts.map((c) => ({ name: c.campaign_name, spend: Number(c.spend) })),
    unclassified: { count: orphans.length, spend: orphans.reduce((total, c) => total + Number(c.spend), 0) },
    rulesHref: firstProject ? `${base}/funis-venda/${firstProject.slug}/regras` : null,
    bestVariant,
    watcherAlerts: [...watcherAlerts, ...pageAlerts],
  })

  // The day's target is the sum of the active projects' targets; the projection uses the sales up
  // to the last Meta pull, the same cut the partial CPA uses.
  const dailyTarget = (funnels ?? []).filter((funnel) => funnel.is_active).reduce((total, funnel) => total + (funnel.daily_sales_target ?? 0), 0)
  const projected = period === 'hoje' ? projectDay(vendas, metaDataAt ? new Date(metaDataAt) : new Date()) : null
  const salesFoot =
    dailyTarget > 0 && period !== '7d'
      ? `meta ${dailyTarget.toLocaleString('pt-BR')}${projected !== null ? ` · projeção ${projected.toLocaleString('pt-BR')}` : ''}`
      : `${vendasAnuncio.toLocaleString('pt-BR')} de anúncio`
  const salesTag = dailyTarget > 0 && projected !== null ? (projected >= dailyTarget ? 'no ritmo' : 'abaixo do ritmo') : 'todas'

  const weekdayLabel = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' })
  const sparkOf = (key: 'spendComImposto' | 'vendas' | 'leads') => weekDays.map((day) => day[key])
  const kpis = [
    { label: 'Investimento', tag: 'c/ imposto', value: currency(spend), foot: `${currency(sum(weekDays, 'spendComImposto'))} em 7 dias`, spark: sparkOf('spendComImposto'), color: 'var(--ct-an)' },
    { label: 'Vendas de entrada', tag: salesTag, value: vendas.toLocaleString('pt-BR'), foot: salesFoot, spark: sparkOf('vendas'), color: 'var(--ct-ok)' },
    { label: 'CPA geral', tag: partial ? 'parcial' : 'todas', value: vendas > 0 ? currency2(spend / vendas) : '—', foot: vendasAnuncio > 0 ? `de anúncio ${currency2(spend / vendasAnuncio)}` : 'sem venda de anúncio', spark: [], color: '' },
    { label: 'Leads', tag: 'pagos', value: leads.toLocaleString('pt-BR'), foot: 'leads de anúncio, sem duplicata', spark: sparkOf('leads'), color: 'var(--ct-painel)' },
    { label: 'CPL', tag: partial ? 'parcial' : 'pagos', value: leads > 0 ? currency2(spend / leads) : '—', foot: 'investimento ÷ leads', spark: [], color: '' },
  ]

  const maxVendas = Math.max(...weekDays.map((day) => day.vendas), 1)

  return (
    <div className="flex max-w-[1320px] flex-col gap-9 px-14 pb-24 pt-12">
      <div className="flex flex-wrap items-end gap-4 border-b border-[var(--ct-line)] pb-7">
        <div>
          <span className={`${mono} text-[10.5px] uppercase tracking-[0.08em] text-[var(--ct-text-3)]`}>
            {client.name} · {weekdayLabel}
          </span>
          <h1 className="mt-2.5 text-[34px] font-semibold tracking-[-0.045em]">Hoje</h1>
          <p className="mt-2 max-w-[62ch] text-sm text-[var(--ct-text-2)]">
            O dia do cliente nas três ferramentas.
            {metaDataAt ? ` Gasto do Meta até ${timeBr(metaDataAt)}.` : ' O gasto de hoje ainda não chegou do Meta.'}
          </p>
        </div>
        <div className="ml-auto flex gap-0.5 rounded-full border border-[var(--ct-line)] bg-[var(--ct-surface-2)] p-1" role="group" aria-label="Período">
          {PERIODS.map((option) => (
            <Link
              key={option.value}
              href={option.value === 'hoje' ? base : `${base}?periodo=${option.value}`}
              aria-current={period === option.value ? 'page' : undefined}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium ${
                period === option.value ? 'bg-[var(--ct-surface-3)] text-[var(--ct-text)]' : 'text-[var(--ct-text-3)] hover:text-[var(--ct-text)]'
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-[18px] md:grid-cols-3 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="card-shadow flex flex-col gap-1.5 rounded-[18px] border border-[var(--ct-line)] px-[22px] py-5">
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ct-text-3)]">
              {kpi.label}
              <span className={`${mono} rounded border border-[var(--ct-line)] px-1 text-[10px] font-normal normal-case tracking-normal ${kpi.tag === 'parcial' ? 'text-[var(--ct-warn)]' : ''}`}>
                {kpi.tag}
              </span>
            </span>
            <span className={`${mono} text-[26px] font-medium tracking-[-0.04em]`}>{kpi.value}</span>
            <span className="flex items-end justify-between gap-2 text-xs text-[var(--ct-text-3)]">
              {kpi.foot}
              {kpi.spark.length > 0 && <Spark values={kpi.spark} color={kpi.color} />}
            </span>
          </div>
        ))}
      </div>

      {partial && todayRow?.dadosAte && (
        <p className="-mt-4 border-l-2 border-[var(--ct-line-2)] pl-3 text-[12.5px] text-[var(--ct-text-3)]">
          Hoje é parcial: as vendas entram até {timeBr(todayRow.dadosAte)}, o horário do último gasto do Meta, para o CPA comparar igual com
          igual.{todayRow.vendasAposDados > 0 && ` ${todayRow.vendasAposDados} chegaram depois e entram no próximo pull.`} O CPA geral conta
          todas as vendas de entrada; o de anúncio, só as que a UTM liga ao anúncio.
        </p>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-4">
          <header>
            <h2 className="text-[19px] font-semibold">Precisa da sua atenção</h2>
            <p className="mt-1 text-[13px] text-[var(--ct-text-3)]">Uma fila só, das três ferramentas. Some daqui quando o problema é resolvido.</p>
          </header>
          <div className="card-shadow rounded-[18px] border border-[var(--ct-line)]">
            {attention.length === 0 && (
              <p className="px-6 py-5 text-[13.5px] text-[var(--ct-text-2)]">Nada fora do lugar: dados em dia e toda campanha com gasto tem dono.</p>
            )}
            {attention.map((item, i) => (
              <div key={`${item.title}-${i}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 border-b border-[var(--ct-line)] px-6 py-5 last:border-b-0">
                <span className={`${mono} grid h-7 w-7 place-items-center rounded-lg text-xs ${SEVERITY_TONE[item.severity].box}`}>
                  {SEVERITY_TONE[item.severity].mark}
                </span>
                <div className="min-w-0">
                  <b className="text-[14px] font-semibold">{item.title}</b>
                  <p className="mt-1 break-words text-[12.5px] text-[var(--ct-text-2)]">{item.detail}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <span className={`${mono} rounded-full px-2 py-0.5 text-[10.5px] ${TOOL_TONE[item.tool]}`}>{TOOL_LABEL[item.tool]}</span>
                    <Link href={item.href} className="rounded-md border border-[var(--ct-line-2)] px-2.5 py-0.5 text-xs font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
                      Resolver
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <header className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-[19px] font-semibold">Vendas de entrada por dia</h2>
              <p className="mt-1 text-[13px] text-[var(--ct-text-3)]">últimos 7 dias · todas as origens</p>
            </div>
            <Link href={`${base}/funis-venda`} className="text-[12.5px] font-medium text-[var(--ct-accent)]">
              Análises →
            </Link>
          </header>
          <div className="card-shadow rounded-[18px] border border-[var(--ct-line)] px-6 pb-4 pt-6">
            <div className="flex h-[150px] items-end gap-2" role="img" aria-label="Vendas de entrada por dia nos últimos 7 dias">
              {weekDays.map((day) => {
                const isToday = day.data === today
                return (
                  <div key={day.data} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                    <span className={`${mono} text-[10.5px] text-[var(--ct-text-2)]`}>{day.vendas}</span>
                    <span
                      className="block w-full rounded-t-[5px] rounded-b-[2px]"
                      style={{ height: `${Math.max(2, (day.vendas / maxVendas) * 100)}%`, background: 'var(--ct-an)', opacity: isToday ? 0.4 : 0.85 }}
                    />
                    <span className={`${mono} text-[10px] text-[var(--ct-text-3)]`}>{isToday ? 'hoje' : `${day.data.slice(8, 10)}/${day.data.slice(5, 7)}`}</span>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--ct-text-3)]">
              <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: 'var(--ct-an)' }} />dia fechado</span>
              <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-sm opacity-40" style={{ background: 'var(--ct-an)' }} />hoje, parcial</span>
            </div>
          </div>
        </section>
      </div>

      <section className="flex flex-col gap-4">
        <header>
          <h2 className="text-[19px] font-semibold">Ferramentas</h2>
          <p className="mt-1 text-[13px] text-[var(--ct-text-3)]">Cada uma é a ferramenta completa. Aqui fica o resumo.</p>
        </header>
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { href: `${base}/funis-venda`, title: 'Análises', color: 'var(--ct-an)', stat: `${(funnels ?? []).filter((f) => f.is_active).length} projetos ativos`, text: 'Frentes, funil, origem das vendas e criativos de cada projeto.' },
            { href: `${base}/tests`, title: 'Teste A/B', color: 'var(--ct-ab)', stat: `${(activeTests ?? []).length} testes rodando`, text: 'Sorteio no clique, venda devolvida ao anúncio e veredito com probabilidade.' },
            { href: firstProject ? `${base}/funis-venda/${firstProject.slug}/regras` : `${base}/funis-venda`, title: 'Regras de campanha', color: 'var(--ct-painel)', stat: `${conflicts.length + orphans.length} campanhas sem dono`, text: 'Quem é dono de cada campanha, e o que fica em Não classificado.' },
          ].map((door) => (
            <Link
              key={door.title}
              href={door.href}
              className="card-shadow relative flex flex-col gap-3 overflow-hidden rounded-[18px] border border-[var(--ct-line)] px-6 py-5 hover:border-[var(--ct-line-2)]"
            >
              <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: door.color }} />
              <span className="flex items-center justify-between">
                <b className="text-[15px] font-semibold">{door.title}</b>
                <span className={`${mono} text-xs text-[var(--ct-text-3)]`}>→</span>
              </span>
              <span className={`${mono} text-[17px] font-medium tracking-[-0.03em]`}>{door.stat}</span>
              <span className="border-t border-[var(--ct-line)] pt-2.5 text-[12.5px] text-[var(--ct-text-2)]">{door.text}</span>
            </Link>
          ))}
        </div>
      </section>

      {isOwner === true && (
        <div className="flex justify-end">
          <ConfirmDeleteButton action={deleteClient.bind(null, client.id)} label="Excluir cliente" />
        </div>
      )}
    </div>
  )
}
