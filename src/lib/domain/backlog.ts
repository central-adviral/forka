// The test backlog (0068): what each column means and what a card needs to move into it.

export const STAGES = {
  anuncio: 'Anúncio',
  pagina: 'Página',
  checkout: 'Checkout',
  oferta: 'Oferta',
  formato: 'Formato',
  obrigado: 'Obrigado',
  ativacao: 'Ativação',
  upsell: 'Upsell',
} as const
export type Stage = keyof typeof STAGES

export const METHODS = { meta: 'Criativo Meta Ads', link: 'Link A/B', antes: 'Antes e depois' } as const
export type Method = keyof typeof METHODS

export const COLUMNS = [
  { status: 'queue', label: 'Fila', hint: 'ordenada por ICE' },
  { status: 'ready', label: 'Pronto pra subir', hint: 'pré-requisitos ok' },
  { status: 'running', label: 'Rodando', hint: 'medido sozinho' },
  { status: 'decided', label: 'Decidido', hint: 'com aprendizado' },
] as const
export type BacklogStatus = (typeof COLUMNS)[number]['status']

/** The link gate the Central checks by itself, when the card gets its A/B test. */
export const AUTO_LINK_GATE = 'Link /r criado'

/** The Meta gate the Central checks by itself: an ad carrying the card's tag is spending. */
export const isAutoTagGate = (label: string) => label.startsWith('Anúncios com a tag [')

/** Days of the creative report read to find a card's tagged ads. */
export const TAG_LOOKBACK_DAYS = 7

/** What has to be true before a test of each method can go live. */
export function defaultGates(method: Method, code: string): string[] {
  if (method === 'meta') return [`Anúncios com a tag [${code}-x] no nome`, 'Copy aprovada sem promessa de faturamento']
  if (method === 'link') return ['Versão nova publicada', AUTO_LINK_GATE]
  return ['Data de início definida', 'Mudança publicada']
}

/** The next free code of a project: T1, T2, … one past the highest in use. */
export function nextCode(codes: string[]): string {
  const highest = codes.reduce((max, code) => Math.max(max, Number(code.replace(/^T/, '')) || 0), 0)
  return `T${highest + 1}`
}

export interface MoveCheck {
  gatesOpen: number
  hasLearning: boolean
}

/** Why a card cannot go to a column, or null when it can. */
export function blockedMove(to: BacklogStatus, check: MoveCheck): string | null {
  if ((to === 'ready' || to === 'running') && check.gatesOpen > 0) {
    return `Faltam ${check.gatesOpen} ${check.gatesOpen === 1 ? 'pré-requisito' : 'pré-requisitos'} para subir o teste.`
  }
  if (to === 'decided' && !check.hasLearning) return 'Decida pela gaveta do teste: todo teste decidido deixa um aprendizado.'
  return null
}

export interface TestRules {
  /** CPA ceiling the cut and the win are measured against. */
  teto: number
  /** A variant that spends mult × teto with no sale gets marked for pausing. */
  mult: number
  /** A creative wins with CPA ≤ teto and at least this many ad purchases. */
  min: number
  /** Link A/B: minimum chance to beat the control, in %. */
  conf: number
  /** Link A/B: minimum visitors per variant before a win counts. */
  minVisits: number
  /** Link A/B: smallest lift worth detecting, in % over the control's rate; sets the sample each side needs. */
  mde: number
  /** Days a creative can run before it asks for a decision. */
  sat: number
}

export const DEFAULT_RULES: TestRules = { teto: 55, mult: 1.5, min: 10, conf: 95, minVisits: 500, mde: 30, sat: 10 }

export const RULE_LIMITS: Record<keyof TestRules, [number, number, boolean]> = {
  teto: [1, 100000, false],
  mult: [0.5, 10, false],
  min: [1, 1000, true],
  conf: [50, 99, true],
  minVisits: [50, 100000, true],
  mde: [5, 200, true],
  sat: [1, 90, true],
}

/**
 * The test ceiling of a purchase project is its CPA target, read live from the project's cost
 * watcher (the one the Plano and Metas edit), so a target changed in one place is the ceiling
 * everywhere. Only a lead project, or one without a target, keeps the ceiling stored in its rules.
 */
export function withPlanTeto(rules: TestRules, costTarget: number | null, resultado: string): TestRules {
  return resultado === 'compra' && costTarget !== null && costTarget > 0 ? { ...rules, teto: costTarget } : rules
}

/** Reads the project's rules, falling back to the default for any missing or out-of-range number. */
export function readRules(raw: unknown): TestRules {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rules = { ...DEFAULT_RULES }
  for (const key of Object.keys(RULE_LIMITS) as (keyof TestRules)[]) {
    const value = Number(source[key])
    const [min, max, integer] = RULE_LIMITS[key]
    if (Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))) rules[key] = value
  }
  return rules
}
