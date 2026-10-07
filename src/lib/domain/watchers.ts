// The metric catalog shared by Metas e alvos, the Painel de Controle and the Hoje queue. The
// evaluation itself runs in SQL (evaluate_watchers, 0059); this file only names and formats.

export type WatcherMetric = 'cpa_geral' | 'cpa_anuncio' | 'cpl' | 'cpm' | 'ctr' | 'connect_rate' | 'investimento' | 'frequencia'
export type WatcherStatus = 'ok' | 'warn' | 'crit' | 'sem_volume' | 'sem_dado'

interface MetricInfo {
  label: string
  unit: 'brl' | 'pct' | 'x'
  /** sobe = higher is worse (costs); cai = lower is worse (rates, investment pace). */
  bad: 'sobe' | 'cai'
  projectOnly: boolean
  hint: string
}

export const METRICS: Record<WatcherMetric, MetricInfo> = {
  cpa_geral: { label: 'CPA geral', unit: 'brl', bad: 'sobe', projectOnly: true, hint: 'investimento ÷ todas as vendas de entrada' },
  cpa_anuncio: { label: 'CPA de anúncio', unit: 'brl', bad: 'sobe', projectOnly: true, hint: 'investimento ÷ vendas que a UTM liga ao anúncio' },
  cpl: { label: 'CPL', unit: 'brl', bad: 'sobe', projectOnly: false, hint: 'investimento ÷ leads pagos' },
  cpm: { label: 'CPM', unit: 'brl', bad: 'sobe', projectOnly: false, hint: 'custo por mil impressões' },
  ctr: { label: 'CTR', unit: 'pct', bad: 'cai', projectOnly: false, hint: 'cliques no link ÷ impressões' },
  connect_rate: { label: 'Connect rate', unit: 'pct', bad: 'cai', projectOnly: false, hint: 'view page ÷ cliques no link' },
  investimento: { label: 'Investimento no dia', unit: 'brl', bad: 'cai', projectOnly: false, hint: 'gasto com imposto do dia' },
  frequencia: { label: 'Frequência', unit: 'x', bad: 'sobe', projectOnly: false, hint: 'impressões ÷ alcance (aproximada)' },
}

export const STATUS_LABEL: Record<WatcherStatus, string> = {
  ok: 'na faixa',
  warn: 'atenção',
  crit: 'crítico',
  sem_volume: 'gasto abaixo do mínimo',
  sem_dado: 'sem dado',
}

export function formatMetric(metric: WatcherMetric, value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  if (METRICS[metric].unit === 'pct') return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
  if (METRICS[metric].unit === 'x') return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** What a watcher looks at, in words: a slice by name, a front, or the whole project. */
export function watcherScope(watcher: { frontName: string | null; nameFilter: string | null }): string {
  if (watcher.nameFilter) return `campanhas com "${watcher.nameFilter}"`
  return watcher.frontName ?? 'projeto inteiro'
}

/** The values where the band turns into atenção and into crítico, in the metric's bad direction. */
export function thresholds(metric: WatcherMetric, target: number, warnPct: number, critPct: number): { warn: number; crit: number } {
  const sign = METRICS[metric].bad === 'sobe' ? 1 : -1
  return { warn: target * (1 + (sign * warnPct) / 100), crit: target * (1 + (sign * critPct) / 100) }
}
