import { Fragment } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { canActAs } from '@/lib/view-as'
import { getBacklog, type BacklogItem } from '@/lib/repo/backlog-repo'
import { AUTO_LINK_GATE, COLUMNS, TAG_LOOKBACK_DAYS, isAutoTagGate, METHODS, STAGES, nextCode, readRules, withPlanTeto, type Method } from '@/lib/domain/backlog'
import { NewHypothesisWizard } from './new-hypothesis-wizard'
import { daysRunningSince } from '@/lib/domain/report-period'
import { type Verdict } from '@/lib/domain/backlog-readout'
import { findTaggedCards, loadReadouts, readoutKind, type Readout, type VerdictKind } from '@/lib/repo/backlog-readout-repo'
import { linkVerdict, matchTestVariant } from '@/lib/domain/experiment-decision'
import { LANES, cardProgress, laneOf, recentlyDecided } from '@/lib/domain/board'
import { PLAYBOOK, PLAYBOOK_DONTS, playbookStep } from '@/lib/domain/playbook'
import { Board, type BoardLane } from './board'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { createItem, decideItem, deleteItem, dropItem, linkAbTest, moveItem, saveRules, toggleGate, togglePublished } from './actions'
import { PageHeader } from '@/components/page-header'
import { headerPrimaryAction } from '@/components/header-actions'

const mono = 'font-[family-name:var(--font-geist-mono)]'
const field =
  'rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'
const METHOD_DOT: Record<Method, string> = { meta: 'var(--ct-painel)', link: 'var(--ct-ab)', antes: 'var(--ct-an)' }
const RULE_FIELDS = [
  { key: 'teto', label: 'CPA teto (R$)', hint: 'Corte e vitória são medidos contra ele.', step: '0.01' },
  { key: 'mult', label: 'Corte: gasto sem venda (× teto)', hint: 'A variante que gastar isso sem venda, ou com CPA acima disso, é marcada para pausar.', step: '0.1' },
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

// The card pill takes the verdict's color: green for a win, red for a cut, amber when the days
// ran out without one (only then is there a summary without a win or a cut).
const PILL: Record<VerdictKind, string> = {
  win: 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]',
  cut: 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]',
  decide: 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]',
}

const pillTone = (readout: Readout) => PILL[readoutKind(readout)]

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
  searchParams: Promise<{ projeto?: string; aba?: string; item?: string; nova?: string; ok?: string; erro?: string; decididos?: string; metodo?: string }>
}) {
  const { clientSlug } = await params
  const { projeto, aba, item: itemCode, nova, ok, erro, decididos, metodo } = await searchParams
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

  const [loadedItems, canEdit, { data: costWatcher }] = await Promise.all([
    getBacklog(supabase, funnel.id),
    canActAs(supabase, client.id, 'gestor'),
    supabase.from('watchers').select('target').eq('sales_funnel_id', funnel.id).is('front_id', null).eq('metric', 'cpa_geral').maybeSingle(),
  ])
  // The Meta tag gate the Central checks itself: an ad with the card's tag spent in the last days.
  // Shown done on the board and in the drawer; the move stores it (moveItem).
  const waitingMeta = loadedItems.filter((item) => item.method === 'meta' && (item.status === 'queue' || item.status === 'ready'))
  const tagged = await findTaggedCards(supabase, funnel.id, waitingMeta.map((item) => item.code)).catch((error) => {
    console.error('[backlog-tag-check-failed]', { salesFunnelId: funnel.id }, error)
    return new Set<string>()
  })
  const items = loadedItems.map((item) =>
    tagged.has(item.code) ? { ...item, gates: item.gates.map((gate) => (isAutoTagGate(gate.label) && !gate.doneAt ? { ...gate, doneAt: 'auto' } : gate)) } : item
  )
  const costTarget = costWatcher ? Number(costWatcher.target) : null
  const rules = withPlanTeto(readRules(funnel.test_rules), costTarget, funnel.resultado)
  const tetoFromPlan = rules.teto === costTarget && funnel.resultado === 'compra'
  const [readouts, { data: abTests }] = await Promise.all([
    loadReadouts(supabase, funnel.id, items, rules, funnel.resultado),
    supabase.from('tests').select('id, name, slug, sales_funnel_id').eq('client_id', client.id).is('archived_at', null).order('name'),
  ])
  const tab = aba === 'regras' && canEdit ? 'regras' : 'backlog'
  const selected = items.find((item) => item.code === itemCode) ?? null
  const selectedReadout = selected ? readouts.get(selected.id) : undefined
  // The verdict card: what the rules say about the running card, and which variant the decision
  // form starts on, so "Declarar vencedora" is one click away from the evidence.
  const selectedTest = selected?.abTestId ? (abTests ?? []).find((test) => test.id === selected.abTestId) : undefined
  const selectedDays = selected?.startedAt ? daysRunningSince(selected.startedAt) : 0
  const verdict = selected?.status === 'running' && selectedReadout?.link ? linkVerdict(selectedReadout.link, selectedDays, Boolean(selectedTest?.sales_funnel_id)) : null
  const suggestedKey = verdict
    ? (selected!.variants.find((variant) => matchTestVariant(variant, [{ id: 'winner', name: verdict.winnerName }]) === 'winner')?.key ?? '')
    : (selectedReadout?.meta?.find((variant) => variant.verdict === 'win')?.key ?? '')
  const context = { client_id: client.id as string, client_slug: client.slug as string, sales_funnel_id: funnel.id as string, funnel_slug: funnel.slug as string }
  // The board can show one method at a time; the filter rides along every link of the board.
  const methodFilter = (Object.keys(METHODS) as Method[]).find((method) => method === metodo) ?? null
  const href = (extra: string) => `${base}?projeto=${funnel.slug}${methodFilter ? `&metodo=${methodFilter}` : ''}${extra}`
  const decidedWithLearning = items.filter((item) => item.status === 'decided' && item.learning)
  const running = items.filter((item) => item.status === 'running').length
  // The board: "Pede decisão" collects running cards whose rules spoke; Decidido keeps the last 30
  // days unless every decision was asked for.
  const now = new Date()
  const showAllDecided = decididos === 'todos'
  const hiddenDecided = items.filter((item) => !recentlyDecided(item, now)).length
  const lanes: BoardLane[] = LANES.map((column) => ({
    ...column,
    hint: column.lane === 'decided' && showAllDecided ? 'todos os decididos' : column.hint,
    cards: items
      .filter((item) => (!methodFilter || item.method === methodFilter) && laneOf(item, Boolean(readouts.get(item.id)?.summary)) === column.lane && (showAllDecided || recentlyDecided(item, now)))
      .map((item) => {
        const readout = readouts.get(item.id)
        return {
          id: item.id,
          code: item.code,
          title: item.title,
          href: href(`&item=${item.code}`),
          selected: selected?.id === item.id,
          methodColor: METHOD_DOT[item.method],
          methodLabel: METHODS[item.method],
          ice: item.ice.toLocaleString('pt-BR'),
          meta: `${STAGES[item.stage]}${item.owner ? ` · ${item.owner}` : ''}${item.published ? ' · publicado' : ''}`,
          status: cardStatus(item),
          pill: readout?.summary ? { text: readout.summary, tone: pillTone(readout) } : null,
          progress: item.status === 'running' ? cardProgress(readout, rules) : null,
        }
      }),
    footer:
      column.lane === 'decided' && (hiddenDecided > 0 || showAllDecided)
        ? showAllDecided
          ? { text: 'Mostrar só os últimos 30 dias', href: href('') }
          : { text: `+ ${hiddenDecided} ${hiddenDecided === 1 ? 'decidido antigo' : 'decididos antigos'}`, href: href('&decididos=todos') }
        : undefined,
  }))

  return (
    <div className="flex max-w-[1440px] flex-col gap-7 px-10 pb-24 pt-10">
      <PageHeader
        title="Testes"
        note={`Projeto ${funnel.name}. Para trocar, use o seletor de projeto no menu.`}
        actions={
          canEdit && (
            <Link href={href('&nova=1')} className={headerPrimaryAction}>
              + Nova hipótese
            </Link>
          )
        }
      />


      {ok && <p role="status" className="rounded-[10px] bg-[var(--ct-ok-soft)] px-4 py-3 text-[13px] text-[var(--ct-ok)]">{ok}</p>}
      {erro && <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">{erro}</p>}

      {tab === 'backlog' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {[{ value: null, label: 'Todos' }, ...(Object.entries(METHODS) as [Method, string][]).map(([value, label]) => ({ value, label }))].map((option) => {
              const count = items.filter((item) => !option.value || item.method === option.value).length
              const active = option.value === methodFilter
              return (
                <Link
                  key={option.label}
                  href={`${base}?projeto=${funnel.slug}${option.value ? `&metodo=${option.value}` : ''}`}
                  aria-current={active ? 'true' : undefined}
                  className={`rounded-full border px-3 py-1 text-[12.5px] ${active ? 'border-[var(--ct-accent)] text-[var(--ct-accent)]' : 'border-[var(--ct-line)] bg-[var(--ct-surface-2)] text-[var(--ct-text-2)]'}`}
                >
                  {option.label} <b className={`${mono} font-medium`}>{count}</b>
                </Link>
              )
            })}
            {running > 0 && <span className="rounded-full bg-[var(--ct-ab-soft)] px-3 py-1 text-[12.5px] text-[var(--ct-ab)]">{running} rodando agora</span>}
            <Link href={`/dashboard/clients/${client.slug}/aprendizados?todos=1&periodo=tudo`} className="ml-auto text-[12.5px] text-[var(--ct-accent)]">
              Aprendizados ({decidedWithLearning.length}) →
            </Link>
          </div>

          {nova === '1' && canEdit && (
            <NewHypothesisWizard
              action={createItem.bind(null, context)}
              cancelHref={href('')}
              nextCode={nextCode(items.map((item) => item.code))}
              stages={Object.entries(STAGES).map(([value, label]) => ({ value, label }))}
              methods={Object.entries(METHODS).map(([value, label]) => ({ value, label }))}
              serverError={erro}
              defaultConversion={funnel.resultado === 'lead' ? 'thank_you_page' : 'hubla_webhook'}
              rules={rules}
              learnings={decidedWithLearning.map((item) => ({ code: item.code, title: item.title, learning: item.learning!, result: item.result }))}
            />
          )}

          <Board lanes={lanes} move={canEdit ? dropItem.bind(null, context) : null} />
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
              ['Corte', `variante com R$ ${(rules.teto * rules.mult).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} gastos sem venda ou com CPA acima disso`],
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

              {selected.status === 'running' && selectedReadout?.summary && (
                <div className={`flex flex-col gap-2 rounded-[14px] px-4 py-3.5 ${verdict ? 'bg-[var(--ct-ok-soft)]' : pillTone(selectedReadout)}`}>
                  <span className={`${mono} text-[10.5px] uppercase tracking-[0.08em]`}>regra do jogo · {selectedReadout.summary}</span>
                  {verdict ? (
                    <>
                      <b className="text-[17px] text-[var(--ct-text)]">
                        {verdict.winnerName} vence: {verdict.liftPct >= 0 ? '+' : ''}{verdict.liftPct}% de conversão
                      </b>
                      <span className="text-[12.5px] text-[var(--ct-text-2)]">{verdict.chancePct}% de chance de bater o controle. Por que dá para confiar:</span>
                      <ul className="flex flex-col gap-1 text-[12.5px] text-[var(--ct-text)]">
                        {verdict.checks.map((check) => (
                          <li key={check.label} className="flex items-baseline gap-2">
                            <span className={check.ok ? 'text-[var(--ct-ok)]' : 'text-[var(--ct-warn)]'}>{check.ok ? '✓' : '!'}</span>
                            <span>{check.label}</span>
                            <span className={`${mono} ml-auto text-right text-[11.5px] text-[var(--ct-text-3)]`}>{check.value}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <span className="text-[12.5px] text-[var(--ct-text)]">
                      {readoutKind(selectedReadout) === 'cut' ? 'Uma variante gastou o limite sem vender: pause os anúncios dela e decida.' : 'A regra do jogo pede uma decisão.'}
                    </span>
                  )}
                  {canEdit && (
                    <a href="#decidir" className="self-start rounded-full bg-[var(--ct-accent)] px-3.5 py-1.5 text-[12.5px] font-semibold text-[var(--ct-on-accent)]">
                      {suggestedKey ? `Declarar vencedora ${suggestedKey}` : 'Decidir'}
                    </a>
                  )}
                </div>
              )}

              {selected.status === 'running' && (() => {
                const step = playbookStep(selectedDays)
                return (
                  <div className="flex flex-col gap-2 rounded-[14px] border border-[var(--ct-line)] px-4 py-3">
                    <span className="text-[12.5px] font-semibold">Calendário do teste · dia {selectedDays}</span>
                    <ol className="flex flex-col gap-1 text-[12px]">
                      {PLAYBOOK.map((item, index) => (
                        <li key={item.label} className={index === step ? 'text-[var(--ct-text)]' : 'text-[var(--ct-text-3)]'}>
                          <b className={index === step ? 'text-[var(--ct-accent)]' : ''}>{index < step ? '✓ ' : index === step ? '→ ' : ''}{item.label}</b>
                          {index === step && <span className="block text-[var(--ct-text-2)]">{item.text}</span>}
                        </li>
                      ))}
                    </ol>
                    <p className="text-[11.5px] text-[var(--ct-text-3)]">Enquanto roda, não: {PLAYBOOK_DONTS.join(' · ')}.</p>
                  </div>
                )
              })()}

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
                  {selectedTest && (
                    <span className="flex flex-wrap gap-4 text-[12.5px]">
                      <Link href={`/dashboard/clients/${client.slug}/tests/${selectedTest.slug}/link`} className="text-[var(--ct-accent)]">
                        Pegar o link /r →
                      </Link>
                      <Link href={`/dashboard/clients/${client.slug}/tests/${selectedTest.slug}`} className="text-[var(--ct-accent)]">
                        Abrir o relatório →
                      </Link>
                    </span>
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
                    gate.label === AUTO_LINK_GATE || isAutoTagGate(gate.label) ? (
                      <span key={gate.id} className="flex items-center gap-2.5 py-2 text-[12.5px] text-[var(--ct-text-2)]">
                        <span className={`grid h-4 w-4 place-items-center rounded border ${gate.doneAt ? 'border-[var(--ct-ok)] bg-[var(--ct-ok)] text-[var(--ct-on-accent)]' : 'border-[var(--ct-line-2)]'}`}>{gate.doneAt ? '✓' : ''}</span>
                        <span className={gate.doneAt ? 'text-[var(--ct-text-3)] line-through' : ''}>{gate.label}</span>
                        <span className={`${mono} ml-auto rounded-full bg-[var(--ct-surface-3)] px-2 py-0.5 text-[10.5px] text-[var(--ct-text-3)]`} title={gate.label === AUTO_LINK_GATE ? 'A Central marca sozinha quando o card tem teste A/B vinculado' : `A Central marca sozinha quando um anúncio com a tag gasta (últimos ${TAG_LOOKBACK_DAYS} dias)`}>auto</span>
                      </span>
                    ) : canEdit ? (
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
                <form id="decidir" action={decideItem.bind(null, { ...context, item_id: selected.id, code: selected.code })} className="flex scroll-mt-4 flex-col gap-3 rounded-[14px] border border-[var(--ct-line)] px-4 py-4">
                  <b className="text-[13px]">Decidir o teste</b>
                  <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                    Vencedora
                    <select name="winner_key" className={field} defaultValue={suggestedKey}>
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
                  <fieldset className="flex flex-col gap-2 text-[12.5px] text-[var(--ct-text-2)]">
                    <legend className="mb-1 text-xs text-[var(--ct-text-3)]">O que fazer agora (vale quando houver vencedora)</legend>
                    {selectedTest && (
                      <>
                        <label className="flex items-start gap-2">
                          <input type="checkbox" name="send_traffic" defaultChecked className="mt-0.5" />
                          <span>Mandar 100% do tráfego para a vencedora. O link /r continua o mesmo; os anúncios não mudam.</span>
                        </label>
                        <label className="flex items-start gap-2">
                          <input type="checkbox" name="make_control" defaultChecked className="mt-0.5" />
                          <span>Tornar a vencedora o novo controle do teste.</span>
                        </label>
                      </>
                    )}
                    <label className="flex items-start gap-2">
                      <input type="checkbox" name="publish" defaultChecked={selected.published} className="mt-0.5" />
                      <span>Publicar o resultado para o cliente.</span>
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                      Ideia de continuação (opcional: entra na Fila com a vencedora de controle)
                      <input name="follow_up" maxLength={120} placeholder="ex.: Ancoragem também no checkout" className={field} />
                    </label>
                  </fieldset>
                  <button type="submit" className="self-start rounded-full bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)]">Confirmar decisão</button>
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
