// The "Precisa da sua atenção" queue of the Hoje screen: one list, worst first, built only from
// facts the Central already holds. Each item says what is wrong and where to fix it.

export type AttentionSeverity = 'crit' | 'warn' | 'ok'

export interface AttentionItem {
  severity: AttentionSeverity
  title: string
  detail: string
  tool: 'painel' | 'analises' | 'ab' | 'config'
  href: string
  /** The button's word when it is more specific than "Resolver". */
  action?: string
}

export interface AttentionInput {
  base: string
  now: Date
  /** Newest Meta updated_at among today's campaign rows; null when nothing arrived today. */
  metaDataAt: string | null
  lastRun: { finishedAt: string | null; error: string | null } | null
  conflicts: { name: string; spend: number }[]
  unclassified: { count: number; spend: number }
  rulesHref: string | null
  bestVariant: { testName: string; testSlug: string; variantName: string; liftPct: number } | null
  /** Sales of the last days no project owns (0073): a product in several projects with no ad, or in none. */
  unattributed?: { count: number; revenue: number }
  /** Open watcher alerts (0059), already worded. */
  watcherAlerts?: { severity: 'warn' | 'crit'; title: string; detail: string }[]
  /** Running backlog cards whose rules already speak: a win, a cut or a saturated creative. */
  testVerdicts?: { code: string; title: string; summary: string; kind: 'win' | 'cut' | 'decide'; projectSlug: string; daysRunning: number }[]
  /** Active tests whose traffic does not split by the weights since the last weight change. */
  skewedDraws?: { testName: string; testSlug: string; name: string; actualPct: number; expectedPct: number }[]
  /** Cards with the checklist complete, waiting to go live. */
  readyCards?: { code: string; title: string; href: string; hasLink: boolean }[]
}

const STALE_AFTER_MS = 2 * 60 * 60 * 1000
const SEVERITY_ORDER: Record<AttentionSeverity, number> = { crit: 0, warn: 1, ok: 2 }

function hourInSaoPaulo(now: Date): number {
  return Number(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false })) % 24
}

const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export function buildAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = []

  if (input.lastRun?.error) {
    items.push({
      severity: 'crit',
      title: 'A última leitura do LaunchOps falhou',
      detail: input.lastRun.error,
      tool: 'config',
      href: `${input.base}/integrations`,
    })
  } else if (!input.lastRun) {
    items.push({
      severity: 'warn',
      title: 'As campanhas deste cliente ainda não foram lidas',
      detail: 'Use “Atualizar agora” num projeto para fazer a primeira leitura, que traz os últimos 60 dias.',
      tool: 'analises',
      href: `${input.base}/funis-venda`,
    })
  }

  // Business hours only: at 3am no fresh Meta data is expected and an alert would be noise.
  const hour = hourInSaoPaulo(input.now)
  if (input.lastRun && hour >= 9 && hour < 23) {
    const age = input.metaDataAt ? input.now.getTime() - new Date(input.metaDataAt).getTime() : Infinity
    if (age > STALE_AFTER_MS) {
      items.push({
        severity: 'warn',
        title: 'Dados do Meta parados',
        detail: input.metaDataAt
          ? `O último gasto chegou às ${new Date(input.metaDataAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}, há mais de 2 horas. Os números de hoje podem estar atrasados.`
          : 'Nenhum gasto de hoje chegou ainda. Os números de hoje podem estar atrasados.',
        tool: 'config',
        href: `${input.base}/integrations`,
      })
    }
  }

  for (const alert of input.watcherAlerts ?? []) {
    items.push({ severity: alert.severity, title: alert.title, detail: alert.detail, tool: 'painel', href: `${input.base}/painel` })
  }

  if (input.conflicts.length > 0) {
    const spend = input.conflicts.reduce((sum, conflict) => sum + conflict.spend, 0)
    items.push({
      severity: 'warn',
      title: `${input.conflicts.length} ${input.conflicts.length === 1 ? 'campanha disputada' : 'campanhas disputadas'} por duas frentes`,
      detail: `${currency(spend)} que nenhuma frente conta até alguém escolher o dono. Ex.: ${input.conflicts[0].name}.`,
      tool: 'config',
      href: input.rulesHref ?? `${input.base}/funis-venda`,
    })
  }

  if (input.unclassified.count > 0) {
    items.push({
      severity: 'warn',
      title: 'Gasto sem frente',
      detail: `${input.unclassified.count} ${input.unclassified.count === 1 ? 'campanha soma' : 'campanhas somam'} ${currency(input.unclassified.spend)} nos últimos 30 dias, em Não classificado.`,
      tool: 'config',
      href: input.rulesHref ?? `${input.base}/funis-venda`,
    })
  }

  if (input.unattributed && input.unattributed.count > 0) {
    items.push({
      severity: 'warn',
      title: 'Vendas sem projeto',
      detail: `${input.unattributed.count} ${input.unattributed.count === 1 ? 'venda' : 'vendas'} (${currency(input.unattributed.revenue)}) nos últimos 7 dias não entraram em nenhum projeto: o produto está em mais de um projeto e a venda não traz o anúncio, ou nenhum projeto lista o produto.`,
      tool: 'config',
      href: `${input.base}/funis-venda`,
    })
  }

  // A cut is money still going out on a variant that lost; a win or saturation waits for a decision.
  for (const verdict of input.testVerdicts ?? []) {
    items.push({
      severity: verdict.kind === 'cut' ? 'crit' : 'warn',
      title: `${verdict.code} · ${verdict.summary}`,
      detail: `${verdict.title} · ${verdict.daysRunning} ${verdict.daysRunning === 1 ? 'dia' : 'dias'} rodando. A regra do jogo bateu: decida no card.`,
      tool: 'ab',
      href: `${input.base}/backlog?projeto=${verdict.projectSlug}&item=${verdict.code}`,
      action: 'Decidir',
    })
  }

  // A skewed draw makes every number of the test wrong: usually an ad with the wrong link.
  for (const draw of input.skewedDraws ?? []) {
    items.push({
      severity: 'crit',
      title: `${draw.testName} · sorteio fora do peso`,
      detail: `${draw.name} recebeu ${draw.actualPct}% das pessoas contra ${draw.expectedPct}% previsto. Confira o link dos anúncios antes de ler o resultado.`,
      tool: 'ab',
      href: `${input.base}/tests/${draw.testSlug}/link`,
      action: 'Ver link',
    })
  }

  for (const card of input.readyCards ?? []) {
    items.push({
      severity: 'ok',
      title: `${card.code} · pronto pra subir`,
      detail: `${card.title}. Checklist completo${card.hasLink ? ': falta colar o link nos anúncios e levar o card para Rodando.' : '.'}`,
      tool: 'ab',
      href: card.href,
      action: card.hasLink ? 'Pegar link' : 'Abrir card',
    })
  }

  if (input.bestVariant && input.bestVariant.liftPct > 0) {
    items.push({
      severity: 'ok',
      title: `${input.bestVariant.testName}: ${input.bestVariant.variantName} na frente`,
      detail: `Converte ${input.bestVariant.liftPct.toFixed(0)}% acima do controle.`,
      tool: 'ab',
      href: `${input.base}/tests/${input.bestVariant.testSlug}`,
      action: 'Ver teste',
    })
  }

  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}
