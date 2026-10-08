// Deciding a link experiment where the evidence is: the decision on the card also acts on the A/B
// test that measured it. The link /r stays the same, so the ads need no change.
import type { LinkVariantRead } from './backlog-readout'
import { detectSampleRatioMismatch } from './srm-check'
import { MIN_CYCLE_DAYS } from './test-trust'

const normalize = (text: string) => text.trim().toLowerCase()

/**
 * The A/B variant a card variant stands for: same name, or named by its key ("B", "B · Ancorado").
 * Null when nothing matches, and then the decision cannot touch the traffic.
 */
export function matchTestVariant(cardVariant: { key: string; name: string }, testVariants: { id: string; name: string }[]): string | null {
  const key = cardVariant.key.toLowerCase()
  const byName = testVariants.find((variant) => normalize(variant.name) === normalize(cardVariant.name))
  if (byName) return byName.id
  const byKey = testVariants.find((variant) => {
    const name = normalize(variant.name)
    return name === key || new RegExp(`^${key}[\\s·\\-–:]`).test(name)
  })
  return byKey?.id ?? null
}

export interface VerdictCheck {
  ok: boolean
  label: string
  value: string
}

export interface LinkVerdict {
  winnerName: string
  liftPct: number
  chancePct: number
  checks: VerdictCheck[]
}

const fmt = (n: number) => n.toLocaleString('pt-BR')

/**
 * The verdict card of a link experiment the rules call a win: who won, by how much, and why it
 * can be trusted. Null while no variant wins.
 */
export function linkVerdict(read: LinkVariantRead[], daysRunning: number, hasProject: boolean): LinkVerdict | null {
  const control = read.find((variant) => variant.isControl)
  const winner = read
    .filter((variant) => variant.verdict === 'win' && variant.chance !== null)
    .sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0))[0]
  if (!control || !winner) return null
  const rate = (variant: LinkVariantRead) => (variant.visits > 0 ? variant.conversions / variant.visits : 0)
  const controlRate = rate(control)
  const srm = detectSampleRatioMismatch(read.map((variant) => ({ weightPct: variant.weightPct, visits: variant.visits })))
  const needed = winner.needed ?? 0
  return {
    winnerName: winner.name,
    liftPct: controlRate > 0 ? Math.round(((rate(winner) - controlRate) / controlRate) * 100) : 0,
    chancePct: Math.round((winner.chance ?? 0) * 100),
    checks: [
      { ok: control.visits >= needed && winner.visits >= needed, label: 'Amostra', value: `${fmt(winner.visits)} e ${fmt(control.visits)} pessoas · meta ${fmt(needed)}` },
      { ok: srm === 'ok', label: 'Sorteio no peso', value: srm === 'ok' ? 'ok' : srm === 'mismatch' ? 'fora do peso' : 'não conferido' },
      { ok: daysRunning >= MIN_CYCLE_DAYS, label: `Ciclo de ${MIN_CYCLE_DAYS}+ dias`, value: `${daysRunning} ${daysRunning === 1 ? 'dia' : 'dias'}` },
      { ok: hasProject, label: 'Venda do próprio funil', value: hasProject ? 'teste no funil' : 'teste sem funil: a venda pode contar em outro' },
      { ok: true, label: 'Reembolsos', value: 'descontados (webhook da Hubla)' },
    ],
  }
}
