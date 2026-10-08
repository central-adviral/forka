import { Fragment } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { canActAs } from '@/lib/view-as'
import { getBacklog, type BacklogItem } from '@/lib/repo/backlog-repo'
import { COLUMNS, METHODS, STAGES, nextCode, readRules, withPlanTeto, type Method } from '@/lib/domain/backlog'
import { NewHypothesisWizard } from './new-hypothesis-wizard'
import { daysRunningSince } from '@/lib/domain/report-period'
import { readLinkTest, readMetaTest, readoutSummary, type CreativeRow, type LinkRow, type Verdict } from '@/lib/domain/backlog-readout'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { createItem, decideItem, deleteItem, linkAbTest, moveItem, saveRules, toggleGate, togglePublished } from './actions'

const mono = 'font-[family-name:var(--font-geist-mono)]'
const field =
  'rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'
const METHOD_DOT: Record<Method, string> = { meta: 'var(--ct-painel)', link: 'var(--ct-ab)', antes: 'var(--ct-an)' }
const RULE_FIELDS = [
  { key: 'teto', label: 'CPA teto (R$)', hint: 'Corte e vitória são medidos contra ele.', step: '0.01' },
  { key: 'mult', label: 'Corte: gasto sem venda (× teto)', hint: 'A variante que gastar isso sem nenhuma venda é marcada para pausar.', step: '0.1' },
  { key: 'min', label: 'Vitória: mínimo de compras', hint: 'CPA no teto ou abaixo e pelo menos esse número de compras de anúncio.', step: '1' },
  { key: 'conf', label: 'A/B de link: chance mínima de vencer (%)', hint: 'Calculada por pessoa, pelo motor do Teste A/B.', step: '1' },
  { key: 'minVisits', label: 'A/B de link: mínimo de visitantes por variante', hint: 'Sem esse piso, uma chance alta com pouca gente não vale como vitória.', step: '50' },
  { key: 'mde', label: 'A/B de link: menor melhora que importa (%)', hint: 'Define quantas pessoas cada lado precisa antes do veredito. Quanto menor, mais gente.', step: '1' },
  { key: 'sat', label: 'Janela de saturação de criativo (dias)', hint: 'Criativo rodando há mais tempo que isso pede decisão.', step: '1' },
] as const

const VERDICT: Record<Verdict, { text: string; tone: string }> = {
  win: { text: 'vence', tone: 'text-[var(--ct-ok)]' },
  cut: { text: 'cortar', tone: 'text-[var(--ct-crit)]' },
  measuring: { text: 'medindo', tone: 'text-[var(--ct-text-3)]' },
  no_data: { text: 'sem dados', tone: 'text-[var(--ct-text-3)]' },
}
const brl = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

interface Readout {
  summary: string | null
  meta?: ReturnType<typeof readMetaTest>
  link?: ReturnType<typeof readLinkTest>
}

// Meta tests read every tagged ad of the project's creative report since the earliest running
// start; tags are unique per project, so an older window cannot leak another test's ads. A linked
// A/B test is read from the card's own start, not the test's whole life.
async function loadReadouts(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  clientId: string,
  salesFunnelId: string,
  items: BacklogItem[],
  rules: ReturnType<typeof readRules>,
  resultado: string
): Promise<Map<string, Readout>> {
  const running = items.filter((item) => item.status === 'running')
  const meta = running.filter((item) => item.method === 'meta')
  const link = running.filter((item) => item.method === 'link' && item.abTestId)
  const since = meta
    .map((item) => (item.startedAt ? new Date(item.startedAt).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : null))
    .filter((day): day is string => Boolean(day))
    .sort()[0] ?? null
  const [creativeResult, linkReports, { data: controls }] = await Promise.all([
    meta.length > 0
      ? supabase.rpc('get_funnel_report_by_creative', { p_sales_funnel_id: salesFunnelId, p_since: since, p_until: null })
      : Promise.resolve({ data: [], error: null }),
    Promise.all(link.map((item) => supabase.rpc('get_test_report', { p_test_id: item.abTestId, p_since: item.startedAt, p_until: null }))),
    link.length > 0
      ? supabase.from('variants').select('id, test_id').eq('is_control', true).in('test_id', link.map((item) => item.abTestId!))
      : Promise.resolve({ data: [] }),
  ])
  if (creativeResult.error) console.error('[backlog-creative-readout-failed]', { salesFunnelId }, creativeResult.error)
  // A lead project (0071) measures its creatives by paid leads: they take the purchases' place.
  const creatives = ((creativeResult.data ?? []) as (CreativeRow & { leads: number })[]).map((row) =>
    resultado === 'lead' ? { ...row, sales_count: Number(row.leads ?? 0) } : row
  )
  const readouts = new Map<string, Readout>()
  for (const item of meta) {
    const read = readMetaTest(item.code, item.variants.map((variant) => variant.key), creatives, rules)
    const days = item.startedAt ? daysRunningSince(item.startedAt) : 1
    readouts.set(item.id, { meta: read, summary: readoutSummary(read.map((v) => ({ label: v.key, verdict: v.verdict })), days, rules, 'meta') })
  }
  link.forEach((item, index) => {
    const controlId = (controls ?? []).find((row) => row.test_id === item.abTestId)?.id
    const read = readLinkTest((linkReports[index].data ?? []) as LinkRow[], controlId, rules)
    const days = item.startedAt ? daysRunningSince(item.startedAt) : 1
    readouts.set(item.id, { link: read, summary: readoutSummary(read.map((v) => ({ label: v.name, verdict: v.verdict })), days, rules, 'link') })
  })
  return readouts
}

function cardStatus(item: BacklogItem): { text: string; tone: string } {
  const open = item.gates.filter((gate) => !gate.doneAt).length
  if (item.status === 'decided') {
    const winner = item.variants.find((variant) => variant.key === item.winnerKey)
    return { text: winner ? `venceu ${winner.key} · ${winner.name}` : 'decidido sem vencedor', tone: 'text-[var(--ct-ok)]' }
  }
  if (item.status === 'running') return { text: `rodando há ${item.startedAt ? daysRunningSince(item.startedAt) : 1} dias`, tone: 'text-[var(--ct-accent)]' }
  if (open > 0) return { text: `${open} ${open === 1 ? 'pré-requisito' : 'pré-requisitos'} em aberto`, tone: 'text-[var(--ct-warn)]' }
  return { text: 'pronto para subir', tone: 'text-[var(--ct-ok)]' }
}

export default async function BacklogPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>
  searchParams: Promise<{ projeto?: string; aba?: string; item?: string; nova?: string; ok?: string; erro?: string }>
}) {
  const { clientSlug } = await params
  const { projeto, aba, item: itemCode, nova, ok, erro } = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()
  const { data: funnels } = await supabase
    .from('sales_funnels')
    .select('id, name, slug, is_active, test_rules, resultado')
    .eq('client_id', client.id)
    .order('name')
  const funnel = (funnels ?? []).find((row) => row.slug === projeto) ?? (funnels ?? []).find((row) => row.is_active) ?? (funnels ?? [])[0]
  const base = `/dashboard/clients/${client.slug}/backlog`
  if (!funnel) {
    return (
      <div className="px-4 md:px-14 pt-12 text-sm text-[var(--ct-text-2)]">
        Crie um projeto em <Link className="text-[var(--ct-accent)]" href={`/dashboard/clients/${client.slug}/funis-venda`}>Análises</Link> para começar o backlog de testes.
      </div>
    )
  }

  const [items, canEdit, { data: costWatcher }] = await Promise.all([
    getBacklog(supabase, funnel.id),
    canActAs(supabase, client.id, 'gestor'),
    supabase.from('watchers').select('target').eq('sales_funnel_id', funnel.id).is('front_id', null).eq('metric', 'cpa_geral').maybeSingle(),
  ])
  const costTarget = costWatcher ? Number(costWatcher.target) : null
  const rules = withPlanTeto(readRules(funnel.test_rules), costTarget, funnel.resultado)
  const tetoFromPlan = rules.teto === costTarget && funnel.resultado === 'compra'
  const [readouts, { data: abTests }] = await Promise.all([
    loadReadouts(supabase, client.id, funnel.id, items, rules, funnel.resultado),
    supabase.from('tests').select('id, name').eq('client_id', client.id).order('name'),
  ])
  const tab = aba === 'regras' && canEdit ? 'regras' : 'backlog'
  const selected = items.find((item) => item.code === itemCode) ?? null
  const selectedReadout = selected ? readouts.get(selected.id) : undefined
  const context = { client_id: client.id as string, client_slug: client.slug as string, sales_funnel_id: funnel.id as string, funnel_slug: funnel.slug as string }
  const href = (extra: string) => `${base}?projeto=${funnel.slug}${extra}`
  const running = items.filter((item) => item.status === 'running').length

  return (
    <div className="flex max-w-[1440px] flex-col gap-7 px-10 pb-24 pt-10">
      <div className="flex flex-wrap items-end gap-4 border-b border-[var(--ct-line)] pb-6">
        <div>
          <span className="flex items-center gap-2.5">
            <span className={`${mono} rounded-full bg-[var(--ct-ab-soft)] px-2 py-0.5 text-[10.5px] text-[var(--ct-ab)]`}>Ferramenta</span>
            <span className={`${mono} text-[10.5px] uppercase tracking-[0.08em] text-[var(--ct-text-3)]`}>{funnel.name}</span>
          </span>
          <h1 className="mt-2.5 text-[34px] font-semibold tracking-[-0.045em]">Testes</h1>
          <p className="mt-2 max-w-[62ch] text-sm text-[var(--ct-text-2)]">O que testar, o que está rodando e o que já foi decidido.</p>
        </div>
        {canEdit && (
          <Link href={href('&nova=1')} className="ml-auto rounded-full bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)]">
            + Nova hipótese
          </Link>
        )}
      </div>

      {(funnels ?? []).length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-[var(--ct-text-2)]">Projeto:</span>
          {(funnels ?? []).map((row) => (
            <a
              key={row.id}
              href={`${base}?projeto=${row.slug}`}
              aria-current={row.id === funnel.id ? 'page' : undefined}
              className={`rounded-full border px-3 py-1 text-[12.5px] font-medium ${row.id === funnel.id ? 'border-[var(--ct-accent)] bg-[var(--ct-accent-soft)]' : 'border-[var(--ct-line)] text-[var(--ct-text-2)]'}`}
            >
              {row.name}
            </a>
          ))}
        </div>
      )}

      <nav className="inline-flex gap-0.5 self-start rounded-full border border-[var(--ct-line)] bg-[var(--ct-surface-2)] p-1">
        {[
          { label: 'Backlog', target: href(''), active: tab === 'backlog', show: true },
          { label: 'Regras do jogo', target: href('&aba=regras'), active: tab === 'regras', show: canEdit },
          { label: 'Funis de teste', target: `/dashboard/clients/${client.slug}/tests`, active: false, show: true },
        ]
          .filter((option) => option.show)
          .map((option) => (
            <a
              key={option.label}
              href={option.target}
              aria-current={option.active ? 'page' : undefined}
              className={`rounded-full px-4 py-2 text-[13px] font-medium ${option.active ? 'bg-[var(--ct-surface-3)] text-[var(--ct-text)]' : 'text-[var(--ct-text-2)]'}`}
            >
              {option.label}
            </a>
          ))}
      </nav>

      {ok && <p role="status" className="rounded-[10px] bg-[var(--ct-ok-soft)] px-4 py-3 text-[13px] text-[var(--ct-ok)]">{ok}</p>}
      {erro && <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">{erro}</p>}

      {tab === 'backlog' && (
        <>
          <div className="flex flex-wrap gap-2">
            {COLUMNS.map((column) => (
              <span key={column.status} className="rounded-full border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3 py-1 text-[12.5px] text-[var(--ct-text-2)]">
                {column.label} <b className={`${mono} font-medium text-[var(--ct-text)]`}>{items.filter((item) => item.status === column.status).length}</b>
              </span>
            ))}
            {running > 0 && <span className="rounded-full bg-[var(--ct-ab-soft)] px-3 py-1 text-[12.5px] text-[var(--ct-ab)]">{running} rodando agora</span>}
          </div>

          {nova === '1' && canEdit && (
            <NewHypothesisWizard
              action={createItem.bind(null, context)}
              cancelHref={href('')}
              nextCode={nextCode(items.map((item) => item.code))}
              stages={Object.entries(STAGES).map(([value, label]) => ({ value, label }))}
              methods={Object.entries(METHODS).map(([value, label]) => ({ value, label }))}
            />
          )}

          <div className="grid gap-3 overflow-x-auto pb-2 [grid-template-columns:repeat(4,minmax(220px,1fr))]">
            {COLUMNS.map((column) => {
              const cards = items.filter((item) => item.status === column.status)
              return (
                <div key={column.status} className="flex min-h-[240px] flex-col gap-2 rounded-[14px] bg-[var(--ct-surface-2)] p-2">
                  <div className="flex items-baseline gap-2 px-1.5 pt-1">
                    <b className="text-[12.5px]">{column.label}</b>
                    <span className={`${mono} ml-auto text-[11px] text-[var(--ct-text-3)]`}>{cards.length}</span>
                  </div>
                  <span className="-mt-1 px-1.5 text-[11px] text-[var(--ct-text-3)]">{column.hint}</span>
                  {cards.length === 0 && <div className="rounded-[14px] border border-dashed border-[var(--ct-line-2)] p-3 text-center text-[12px] text-[var(--ct-text-3)]">vazio</div>}
                  {cards.map((item) => {
                    const status = cardStatus(item)
                    return (
                      <Link
                        key={item.id}
                        href={href(`&item=${item.code}`)}
                        aria-current={selected?.id === item.id ? 'true' : undefined}
                        className={`flex flex-col gap-1.5 rounded-[14px] border bg-[var(--ct-surface)] px-3 py-3 ${selected?.id === item.id ? 'border-[var(--ct-accent)]' : 'border-[var(--ct-line)] hover:border-[var(--ct-line-2)]'}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`${mono} text-[11px] text-[var(--ct-text-3)]`}>{item.code}</span>
                          <span className="h-[7px] w-[7px] rounded-full" style={{ background: METHOD_DOT[item.method] }} title={METHODS[item.method]} />
                          <span className={`${mono} ml-auto text-[11px] text-[var(--ct-text-3)]`}>ICE {item.ice.toLocaleString('pt-BR')}</span>
                        </span>
                        <b className="text-[13px] leading-snug">{item.title}</b>
                        <span className="text-[11.5px] text-[var(--ct-text-3)]">
                          {STAGES[item.stage]}{item.owner ? ` · ${item.owner}` : ''}{item.published ? ' · publicado' : ''}
                        </span>
                        <span className={`text-[11.5px] ${status.tone}`}>{status.text}</span>
                        {readouts.get(item.id)?.summary && (
                          <span className="rounded-[8px] bg-[var(--ct-warn-soft)] px-2 py-1 text-[11.5px] font-medium text-[var(--ct-warn)]">{readouts.get(item.id)!.summary}</span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-4 text-[12px] text-[var(--ct-text-3)]">
            {(Object.keys(METHODS) as Method[]).map((method) => (
              <span key={method} className="flex items-center gap-1.5">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: METHOD_DOT[method] }} />
                {METHODS[method]}
              </span>
            ))}
          </div>
        </>
      )}

      {tab === 'regras' && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <form action={saveRules.bind(null, context)} className="card-shadow flex flex-col gap-5 rounded-[18px] border border-[var(--ct-line)] px-6 py-6">
            {RULE_FIELDS.map((rule) => (
              <label key={rule.key} className="flex flex-col gap-1.5 border-b border-[var(--ct-line)] pb-5 text-[13px] font-semibold last:border-b-0 last:pb-0">
                {rule.label}
                <input
                  name={rule.key}
                  type="number"
                  step={rule.step}
                  defaultValue={rules[rule.key]}
                  required
                  readOnly={rule.key === 'teto' && tetoFromPlan}
                  className={`${field} ${mono} max-w-[180px] font-normal read-only:opacity-70`}
                />
                {rule.key === 'teto' && tetoFromPlan ? (
                  <span className="text-[12px] font-normal text-[var(--ct-text-3)]">
                    Vem do CPA-alvo do{' '}
                    <Link className="text-[var(--ct-accent)]" href={`/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}/plano`}>
                      Plano
                    </Link>
                    : mudou lá, muda aqui.
                  </span>
                ) : (
                  <span className="text-[12px] font-normal text-[var(--ct-text-3)]">{rule.hint}</span>
                )}
              </label>
            ))}
            <button type="submit" className="self-start rounded-full bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)]">Salvar regras</button>
          </form>
          <div className="card-shadow flex flex-col gap-3 rounded-[18px] border border-[var(--ct-line)] px-6 py-6 text-[13px]">
            <b className="text-[15px]">Como as regras leem um teste</b>
            {[
              ['Corte', `variante com R$ ${(rules.teto * rules.mult).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} gastos e nenhuma venda`],
              ['Vitória de criativo', `CPA de até R$ ${rules.teto.toLocaleString('pt-BR')} com ${rules.min}+ compras`],
              ['Vitória de A/B de link', `chance de ${rules.conf}%+, ${rules.min}+ conversões e a amostra para ver ${rules.mde}% de melhora (mín. ${rules.minVisits.toLocaleString('pt-BR')} pessoas)`],
              ['Saturação', `criativo rodando há mais de ${rules.sat} dias pede decisão`],
            ].map(([label, text]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-[var(--ct-line)] pb-3 last:border-b-0 last:pb-0">
                <span className="text-[var(--ct-text-2)]">{label}</span>
                <b className={`${mono} text-right font-medium`}>{text}</b>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && tab === 'backlog' && (
        <>
          <Link href={href('')} aria-label="Fechar" className="fixed inset-0 z-40 bg-black/35" />
          <aside className="fixed bottom-3.5 right-3.5 top-3.5 z-50 flex w-[min(460px,calc(100vw-28px))] flex-col overflow-hidden rounded-[22px] border border-[var(--ct-line-2)] bg-[var(--ct-surface)] shadow-[var(--ct-shadow)]" aria-label={`Teste ${selected.code}`}>
            <div className="flex items-center gap-2 border-b border-[var(--ct-line)] px-5 py-4">
              <span className={`${mono} text-[12px] text-[var(--ct-text-3)]`}>{selected.code}</span>
              <span className="rounded-full bg-[var(--ct-surface-3)] px-2 py-0.5 text-[11px] text-[var(--ct-text-2)]">{COLUMNS.find((column) => column.status === selected.status)!.label}</span>
              <Link href={href('')} className="ml-auto text-[13px] text-[var(--ct-text-3)] hover:text-[var(--ct-text)]">Fechar ✕</Link>
            </div>
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
              <div>
                <h2 className="text-[20px] font-semibold">{selected.title}</h2>
                <p className="mt-1.5 text-[12.5px] text-[var(--ct-text-3)]">
                  {STAGES[selected.stage]} · {METHODS[selected.method]} · ICE {selected.ice.toLocaleString('pt-BR')} (I{selected.impact} C{selected.confidence} F{selected.ease}){selected.owner ? ` · ${selected.owner}` : ''}
                </p>
              </div>
              {selected.hypothesis && <p className="text-[13.5px] leading-relaxed text-[var(--ct-text-2)]">{selected.hypothesis}</p>}
              {selected.metric && (
                <p className="text-[12.5px] text-[var(--ct-text-2)]">
                  <span className="text-[var(--ct-text-3)]">Decide por:</span> {selected.metric}
                </p>
              )}

              <div className="flex flex-col">
                <span className={`${mono} mb-1 text-[10.5px] uppercase tracking-[0.08em] text-[var(--ct-text-3)]`}>Variantes</span>
                {selected.variants.map((variant, index) => (
                  <div key={variant.id} className="flex items-center gap-3 border-b border-[var(--ct-line)] py-2.5 text-[13px] last:border-b-0">
                    <span className={`${mono} text-[var(--ct-text-3)]`}>{variant.key}</span>
                    <span className={variant.status === 'winner' ? 'font-semibold text-[var(--ct-ok)]' : ''}>{variant.name}</span>
                    {index === 0 && <span className="text-[11px] text-[var(--ct-text-3)]">controle</span>}
                    {selected.method === 'meta' && <span className={`${mono} ml-auto text-[11px] text-[var(--ct-text-3)]`}>[{selected.code}-{variant.key}]</span>}
                    {variant.status === 'winner' && <span className="ml-auto rounded-full bg-[var(--ct-ok-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ct-ok)]">vencedora</span>}
                  </div>
                ))}
                {selected.method === 'meta' && selected.status !== 'decided' && (
                  <p className="mt-2 text-[11.5px] text-[var(--ct-text-3)]">Coloque a tag no nome do anúncio de cada variante. Com o teste em Rodando, a Central mede cada tag sozinha.</p>
                )}
              </div>

              {selectedReadout?.meta && (
                <div className="flex flex-col rounded-[14px] border border-[var(--ct-line)] px-4 py-3">
                  <span className="text-[12.5px] font-semibold">Medição por tag · desde o início do teste</span>
                  <div className={`${mono} mt-2 grid grid-cols-[28px_1fr_1fr_1fr_70px] gap-x-2 gap-y-1.5 text-[12px]`}>
                    <span className="text-[var(--ct-text-3)]" />
                    <span className="text-[var(--ct-text-3)]">gasto</span>
                    <span className="text-[var(--ct-text-3)]">compras</span>
                    <span className="text-[var(--ct-text-3)]">CPA</span>
                    <span />
                    {selectedReadout.meta.map((variant) => (
                      <Fragment key={variant.key}>
                        <span className="text-[var(--ct-text-3)]">{variant.key}</span>
                        <span>{variant.ads > 0 ? brl(variant.spend) : '—'}</span>
                        <span>{variant.ads > 0 ? variant.sales : '—'}</span>
                        <span>{variant.cpa !== null ? brl(variant.cpa) : '—'}</span>
                        <span className={VERDICT[variant.verdict].tone}>{VERDICT[variant.verdict].text}</span>
                      </Fragment>
                    ))}
                  </div>
                  <p className="mt-2.5 text-[11.5px] text-[var(--ct-text-3)]">
                    Gasto com imposto, compras de entrada. Corta com {brl(rules.teto * rules.mult)} sem venda; vence com CPA até {brl(rules.teto)} e {rules.min}+ compras. É sugestão: a decisão é sua.
                  </p>
                </div>
              )}

              {selected.method === 'link' && selected.status !== 'decided' && (
                <div className="flex flex-col gap-2 rounded-[14px] border border-[var(--ct-line)] px-4 py-3">
                  <span className="text-[12.5px] font-semibold">Teste A/B que mede este card</span>
                  {canEdit ? (
                    <form action={linkAbTest.bind(null, { ...context, item_id: selected.id, code: selected.code })} className="flex items-center gap-2">
                      <select name="ab_test_id" defaultValue={selected.abTestId ?? ''} className={`${field} flex-1 py-1.5 text-[12.5px]`} aria-label="Teste A/B vinculado">
                        <option value="">nenhum</option>
                        {(abTests ?? []).map((test) => <option key={test.id} value={test.id}>{test.name}</option>)}
                      </select>
                      <button type="submit" className="rounded-full border border-[var(--ct-line-2)] px-3 py-1.5 text-[12.5px]">Vincular</button>
                    </form>
                  ) : (
                    <span className="text-[12.5px] text-[var(--ct-text-2)]">{(abTests ?? []).find((test) => test.id === selected.abTestId)?.name ?? 'nenhum'}</span>
                  )}
                  {selectedReadout?.link && (
                    <div className={`${mono} mt-1 grid grid-cols-[1fr_70px_70px_60px_70px] gap-x-2 gap-y-1.5 text-[12px]`}>
                      <span className="text-[var(--ct-text-3)]" />
                      <span className="text-[var(--ct-text-3)]">pessoas</span>
                      <span className="text-[var(--ct-text-3)]">conv.</span>
                      <span className="text-[var(--ct-text-3)]">chance</span>
                      <span />
                      {selectedReadout.link.map((variant) => (
                        <Fragment key={variant.name}>
                          <span className="truncate font-[family-name:var(--font-geist-sans)]">{variant.name}{variant.isControl ? ' (controle)' : ''}</span>
                          <span>{variant.visits.toLocaleString('pt-BR')}</span>
                          <span>{variant.conversions.toLocaleString('pt-BR')}</span>
                          <span>{variant.chance !== null ? `${Math.round(variant.chance * 100)}%` : '—'}</span>
                          <span className={VERDICT[variant.verdict].tone}>{variant.isControl ? '' : VERDICT[variant.verdict].text}</span>
                        </Fragment>
                      ))}
                    </div>
                  )}
                  {selectedReadout?.link && (
                    <p className="text-[12px] text-[var(--ct-text-2)]">
                      {selectedReadout.link[0]?.needed == null
                        ? 'Amostra: aparece quando o controle tiver a primeira conversão.'
                        : `Amostra: ${Math.min(...selectedReadout.link.map((variant) => variant.visits)).toLocaleString('pt-BR')} de ${selectedReadout.link[0].needed.toLocaleString('pt-BR')} pessoas no lado com menos gente. Antes disso a chance oscila e não vale como veredito.`}
                    </p>
                  )}
                  <p className="text-[11.5px] text-[var(--ct-text-3)]">
                    {selected.status === 'running'
                      ? `Vence com ${rules.conf}%+ de chance, ${rules.min}+ conversões e a amostra completa nos dois lados. É sugestão: a decisão é sua.`
                      : 'A medição começa quando o card for para Rodando.'}
                  </p>
                </div>
              )}

              {selected.status !== 'decided' && (
                <div className="flex flex-col rounded-[14px] border border-[var(--ct-line)] px-4 py-3">
                  <span className="text-[12.5px] font-semibold">
                    Pré-requisitos · {selected.gates.filter((gate) => gate.doneAt).length}/{selected.gates.length}
                  </span>
                  {selected.gates.map((gate) =>
                    canEdit ? (
                      <form key={gate.id} action={toggleGate.bind(null, { ...context, gate_id: gate.id, done: !gate.doneAt, code: selected.code })}>
                        <button type="submit" className="flex w-full items-center gap-2.5 py-2 text-left text-[12.5px] text-[var(--ct-text-2)]">
                          <span className={`grid h-4 w-4 place-items-center rounded border ${gate.doneAt ? 'border-[var(--ct-accent)] bg-[var(--ct-accent)] text-[var(--ct-on-accent)]' : 'border-[var(--ct-line-2)]'}`}>{gate.doneAt ? '✓' : ''}</span>
                          <span className={gate.doneAt ? 'text-[var(--ct-text-3)] line-through' : ''}>{gate.label}</span>
                        </button>
                      </form>
                    ) : (
                      <span key={gate.id} className="py-2 text-[12.5px] text-[var(--ct-text-2)]">{gate.doneAt ? '✓' : '○'} {gate.label}</span>
                    )
                  )}
                </div>
              )}

              {selected.status === 'decided' && (
                <div className="rounded-[14px] bg-[var(--ct-ok-soft)] px-4 py-3 text-[13px]">
                  <span className={`${mono} mb-1 block text-[10.5px] uppercase tracking-[0.06em] text-[var(--ct-ok)]`}>Aprendizado</span>
                  {selected.learning}
                  {selected.result && <span className="mt-2 block text-[12px] text-[var(--ct-text-2)]">Resultado: {selected.result}</span>}
                </div>
              )}

              {canEdit && (selected.status === 'running' || selected.status === 'ready') && (
                <form action={decideItem.bind(null, { ...context, item_id: selected.id, code: selected.code })} className="flex flex-col gap-3 rounded-[14px] border border-[var(--ct-line)] px-4 py-4">
                  <b className="text-[13px]">Decidir o teste</b>
                  <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                    Vencedora
                    <select name="winner_key" className={field} defaultValue="">
                      <option value="">nenhuma (empate ou inconclusivo)</option>
                      {selected.variants.map((variant) => (
                        <option key={variant.id} value={variant.key}>{variant.key} · {variant.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                    Resultado em uma linha
                    <input name="result" maxLength={300} placeholder="ex.: C com CPA de R$ 48 contra R$ 61 do controle, 23 compras" className={field} />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                    Aprendizado (obrigatório)
                    <textarea name="learning" required minLength={10} rows={3} placeholder="O que este teste ensinou e onde vale aplicar de novo." className={field} />
                  </label>
                  <button type="submit" className="self-start rounded-full bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)]">Marcar como decidido</button>
                </form>
              )}
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ct-line)] px-5 py-3.5">
                {selected.status !== 'decided' && (
                  <form action={moveItem.bind(null, { ...context, item_id: selected.id, code: selected.code })} className="flex items-center gap-2">
                    <select name="to" defaultValue={selected.status} className={`${field} py-1.5 text-[12.5px]`} aria-label="Mover para a coluna">
                      {COLUMNS.filter((column) => column.status !== 'decided').map((column) => (
                        <option key={column.status} value={column.status}>{column.label}</option>
                      ))}
                    </select>
                    <button type="submit" className="rounded-full border border-[var(--ct-line-2)] px-3 py-1.5 text-[12.5px]">Mover</button>
                  </form>
                )}
                <form action={togglePublished.bind(null, { ...context, item_id: selected.id, code: selected.code, published: !selected.published })}>
                  <button type="submit" className="rounded-full border border-[var(--ct-line-2)] px-3 py-1.5 text-[12.5px]">
                    {selected.published ? 'Tirar da visão do cliente' : 'Publicar para o cliente'}
                  </button>
                </form>
                <span className="ml-auto">
                  <ConfirmDeleteButton action={deleteItem.bind(null, { ...context, item_id: selected.id, code: selected.code })} label="excluir" warning="Excluir a hipótese?" />
                </span>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  )
}
