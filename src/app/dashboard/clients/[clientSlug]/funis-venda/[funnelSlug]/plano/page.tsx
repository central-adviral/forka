import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getDailyFunnel } from '@/lib/repo/funnel-repo'
import { saoPauloDay } from '@/lib/repo/today-repo'
import { canActAs } from '@/lib/view-as'
import { readRules } from '@/lib/domain/backlog'
import { PROJECT_RESULTS, readResult, suggestedCost, suggestedVolume, type ProjectResult } from '@/lib/domain/project-plan'
import { savePlan } from './actions'

const LOOKBACK_DAYS = 30
const mono = 'font-[family-name:var(--font-geist-mono)]'
const field =
  'rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'
const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function ProjectPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; funnelSlug: string }>
  searchParams: Promise<{ ok?: string; erro?: string }>
}) {
  const { clientSlug, funnelSlug } = await params
  const { ok, erro } = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()
  const { data: funnel } = await supabase
    .from('sales_funnels')
    .select('id, name, slug, resultado, daily_sales_target, test_rules')
    .eq('client_id', client.id)
    .eq('slug', funnelSlug)
    .maybeSingle()
  if (!funnel) notFound()

  // The last closed days, today left out: a partial day would drag every median down.
  const since = saoPauloDay(-LOOKBACK_DAYS)
  const until = saoPauloDay(0)
  const [days, frontResult, watchersResult, canEdit] = await Promise.all([
    getDailyFunnel(supabase, funnel.id, since, until),
    supabase.rpc('get_project_front_daily', { p_sales_funnel_id: funnel.id, p_since: since, p_until: until }),
    supabase.from('watchers').select('metric, target, warn_pct, crit_pct, min_spend').eq('sales_funnel_id', funnel.id).is('front_id', null).in('metric', ['cpa_geral', 'cpl']),
    canActAs(supabase, client.id, 'gestor'),
  ])
  if (frontResult.error) throw frontResult.error
  if (watchersResult.error) throw watchersResult.error

  const leadsByDay = new Map<string, number>()
  for (const row of (frontResult.data ?? []) as { data: string; leads: number }[]) {
    leadsByDay.set(row.data, (leadsByDay.get(row.data) ?? 0) + Number(row.leads ?? 0))
  }
  const series: Record<ProjectResult, { spend: number; results: number }[]> = {
    compra: days.map((day) => ({ spend: day.spendComImposto, results: day.vendas })),
    lead: days.map((day) => ({ spend: day.spendComImposto, results: leadsByDay.get(day.data) ?? 0 })),
  }
  const found = (Object.keys(PROJECT_RESULTS) as ProjectResult[]).map((result) => {
    const total = series[result].reduce((sum, day) => sum + day.results, 0)
    const spend = series[result].reduce((sum, day) => sum + day.spend, 0)
    return { result, total, cost: total > 0 ? spend / total : null, suggestedCost: suggestedCost(series[result]), suggestedVolume: suggestedVolume(series[result]) }
  })
  const resultado = readResult(funnel.resultado)
  const current = found.find((option) => option.result === resultado)!
  const watcher = (watchersResult.data ?? []).find((row) => row.metric === PROJECT_RESULTS[resultado].costMetric) ?? (watchersResult.data ?? [])[0]
  const teto = readRules(funnel.test_rules).teto
  const context = { client_id: client.id as string, client_slug: client.slug as string, funnel_slug: funnel.slug as string, sales_funnel_id: funnel.id as string }
  const base = `/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}`

  return (
    <div className="flex max-w-[980px] flex-col gap-8 px-14 pb-24 pt-12">
      <div>
        <Link href={base} className="text-xs text-[var(--ct-text-3)] hover:text-[var(--ct-text)]">
          ‹ {funnel.name}
        </Link>
        <h1 className="mt-2.5 text-[30px] font-semibold tracking-[-0.04em]">Plano do projeto</h1>
        <p className="mt-2 max-w-[70ch] text-sm text-[var(--ct-text-2)]">
          O que este projeto produz e quanto ele pode custar. As campanhas vêm das{' '}
          <Link href={`${base}/regras`} className="text-[var(--ct-accent)]">Regras de campanha</Link> e as vendas dos{' '}
          <Link href={`${base}/produtos`} className="text-[var(--ct-accent)]">Produtos</Link>; o plano decide como as telas leem esses números e
          contra qual alvo os alertas julgam.
        </p>
      </div>

      {ok && <p role="status" className="rounded-[10px] bg-[var(--ct-ok-soft)] px-4 py-3 text-[13px] text-[var(--ct-ok)]">{ok}</p>}
      {erro && <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">{erro}</p>}

      <form action={savePlan.bind(null, context)} className="flex flex-col gap-6">
        <fieldset disabled={!canEdit} className="card-shadow flex flex-col gap-4 rounded-[18px] border border-[var(--ct-line)] px-6 py-5">
          <legend className="sr-only">Resultado</legend>
          <div className="flex flex-wrap items-baseline gap-3">
            <b className="text-[15px]">1 · Resultado</b>
            <span className={`${mono} text-[11.5px] text-[var(--ct-text-3)]`}>encontrado nos últimos {LOOKBACK_DAYS} dias fechados</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {found.map((option) => (
              <label
                key={option.result}
                className="flex cursor-pointer flex-col gap-1 rounded-[14px] border border-[var(--ct-line)] px-4 py-3 has-[:checked]:border-[var(--ct-accent)] has-[:checked]:bg-[var(--ct-accent-soft)]"
              >
                <span className="flex items-center gap-2">
                  <input type="radio" name="resultado" value={option.result} defaultChecked={option.result === resultado} />
                  <b className="text-[14px]">{PROJECT_RESULTS[option.result].label}</b>
                  <span className="text-[12px] text-[var(--ct-text-3)]">mede {PROJECT_RESULTS[option.result].cost}</span>
                </span>
                <span className={`${mono} text-[12.5px] text-[var(--ct-text-2)]`}>
                  {option.total.toLocaleString('pt-BR')} {PROJECT_RESULTS[option.result].unit}
                  {option.cost !== null ? ` · ${PROJECT_RESULTS[option.result].cost} ${currency(option.cost)}` : ''}
                </span>
                {option.total === 0 && <span className="text-[11.5px] text-[var(--ct-warn)]">sem dado no período</span>}
              </label>
            ))}
          </div>
          <p className="text-[12px] text-[var(--ct-text-3)]">
            Quando o projeto passar a produzir outra coisa (perpétuo que vira captação paga, por exemplo), crie um projeto novo com a nomenclatura nova
            das campanhas; este fica com o histórico.
          </p>
        </fieldset>

        <fieldset disabled={!canEdit} className="card-shadow grid gap-4 rounded-[18px] border border-[var(--ct-line)] px-6 py-5 md:grid-cols-2">
          <legend className="sr-only">Alvos</legend>
          <div className="flex flex-wrap items-baseline gap-3 md:col-span-2">
            <b className="text-[15px]">2 · Alvos</b>
            <span className={`${mono} text-[11.5px] text-[var(--ct-text-3)]`}>sugestão = mediana dos dias fechados</span>
          </div>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Custo-alvo por resultado ({PROJECT_RESULTS[resultado].cost})
            <input
              name="cost_target"
              inputMode="decimal"
              defaultValue={watcher ? String(watcher.target).replace('.', ',') : ''}
              placeholder={current.suggestedCost !== null ? `sugestão ${current.suggestedCost.toFixed(2).replace('.', ',')}` : 'ex.: 30,00'}
              className={`${field} ${mono}`}
            />
            <span className="text-[11px]">Vira o vigia de custo do projeto no Painel e na fila da aba Hoje. Em branco, sem vigia de custo.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Volume por dia ({PROJECT_RESULTS[resultado].perDay})
            <input
              name="daily_target"
              inputMode="numeric"
              defaultValue={funnel.daily_sales_target ?? ''}
              placeholder={current.suggestedVolume !== null ? `sugestão ${current.suggestedVolume}` : 'ex.: 80'}
              className={`${field} ${mono}`}
            />
            <span className="text-[11px]">A aba Hoje projeta o dia contra este número.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Atenção / crítico (% acima do alvo)
            <span className="flex gap-2">
              <input name="warn_pct" inputMode="decimal" defaultValue={watcher?.warn_pct ?? ''} placeholder="20" className={`${field} ${mono} w-full`} aria-label="Atenção a partir de, em %" />
              <input name="crit_pct" inputMode="decimal" defaultValue={watcher?.crit_pct ?? ''} placeholder="40" className={`${field} ${mono} w-full`} aria-label="Crítico a partir de, em %" />
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Gasto mínimo no dia para julgar
            <input name="min_spend" inputMode="decimal" defaultValue={watcher?.min_spend ?? ''} placeholder="300" className={`${field} ${mono}`} />
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--ct-text-2)] md:col-span-2">
            <input type="checkbox" name="teto_from_cost" defaultChecked={resultado === 'compra'} />
            Usar o CPA-alvo como teto dos testes (hoje {currency(teto)}). Só vale para projeto de compra.
          </label>
        </fieldset>

        {canEdit ? (
          <button type="submit" className="self-start rounded-full bg-[var(--ct-accent)] px-5 py-2.5 text-[13px] font-semibold text-[var(--ct-on-accent)]">
            Salvar plano
          </button>
        ) : (
          <p className="text-[12.5px] text-[var(--ct-text-3)]">Só gestor ou owner pode mudar o plano.</p>
        )}
      </form>
    </div>
  )
}
