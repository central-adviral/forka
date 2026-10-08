// The board of the Testes 2.0 redesign: five lanes, one of them derived. "Pede decisão" is not a
// stored status: it is a running card whose rules already speak, so it leaves Rodando by itself.
import type { BacklogStatus, TestRules } from './backlog'
import type { LinkVariantRead, MetaVariantRead } from './backlog-readout'

export type Lane = BacklogStatus | 'decide'

export const LANES: { lane: Lane; label: string; hint: string }[] = [
  { lane: 'queue', label: 'Fila', hint: 'ordenados por ICE' },
  { lane: 'ready', label: 'Pronto pra subir', hint: 'checklist completo' },
  { lane: 'running', label: 'Rodando', hint: 'amostra · dias' },
  { lane: 'decide', label: 'Pede decisão', hint: 'os critérios de decisão bateram' },
  { lane: 'decided', label: 'Decidido', hint: 'últimos 30 dias' },
]

/** Days a decided card stays on the board; older ones live in the learnings list. */
export const DECIDED_WINDOW_DAYS = 30

export function laneOf(item: { status: BacklogStatus }, rulesSpoke: boolean): Lane {
  return item.status === 'running' && rulesSpoke ? 'decide' : item.status
}

export function recentlyDecided(item: { status: BacklogStatus; decidedAt: string | null }, now: Date): boolean {
  if (item.status !== 'decided') return true
  if (!item.decidedAt) return false
  return now.getTime() - new Date(item.decidedAt).getTime() <= DECIDED_WINDOW_DAYS * 86_400_000
}

export interface CardProgress {
  done: number
  target: number
  label: string
}

const fmt = (n: number) => n.toLocaleString('pt-BR')

/**
 * How far a running card is from a verdict, without opening it: people on the thinnest side of a
 * link test against the sample it needs, or purchases of the best creative against the rules' minimum.
 */
export function cardProgress(read: { link?: LinkVariantRead[]; meta?: MetaVariantRead[] } | undefined, rules: TestRules): CardProgress | null {
  if (read?.link?.length) {
    const needed = read.link[0].needed
    if (!needed) return null
    const thinnest = Math.min(...read.link.map((variant) => variant.visits))
    return { done: thinnest, target: needed, label: `${fmt(thinnest)} / ${fmt(needed)} pessoas` }
  }
  if (read?.meta?.length) {
    const best = Math.max(...read.meta.map((variant) => variant.sales))
    return { done: best, target: rules.min, label: `${fmt(best)} / ${fmt(rules.min)} compras` }
  }
  return null
}
