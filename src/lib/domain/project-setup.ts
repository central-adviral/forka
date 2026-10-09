import type { StageMeasure } from './funnel-stages'

// The five steps that make a funnel's numbers trustworthy, with the same names as the menu (0107), in
// the order each one uses the previous. Built only from facts the Central already stores.

export type SetupStepId = 'integracoes' | 'etapas' | 'produtos' | 'metas' | 'conferir'

export interface SetupStageFact {
  name: string
  tag: string | null
  measure: StageMeasure
  /** The stage meta, or for compra the ROAS floor when it has only that. */
  hasMeta: boolean
}

export interface SetupFrontFact {
  name: string
  stageName: string
  /** Reads another funnel: it needs no rule of its own. */
  mirror: boolean
  /** Its "contém" rules. */
  includes: string[]
}

export interface SetupFacts {
  /** LaunchOps source URL and its key are set for the client. */
  launchopsConnected: boolean
  /** The Hubla webhook token is set for the client. */
  hublaConnected: boolean
  /** The funnel's open stages. */
  stages: SetupStageFact[]
  /** The funnel's open fronts. */
  fronts: SetupFrontFact[]
  /** Own fronts with no active page: optional, only said. */
  frontsWithoutPage: number
  entryProducts: number
  ascensionProducts: number
  band: { warnPct: number; critPct: number }
  /** What the quality seals still flag on the funnel (0092). */
  openSeals: string[]
}

export interface SetupStep {
  id: SetupStepId
  label: string
  done: boolean
  /** One line: what is set, or what is missing. */
  text: string
}

export interface SetupStatus {
  steps: SetupStep[]
  done: number
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const norm = (tag: string) => tag.trim().toLowerCase()

/** What "Etapas e frentes" still misses: tags (a stage's when the funnel has more than one), repeated ones, fronts. */
export function stagesMissing(stages: SetupStageFact[], fronts: SetupFrontFact[]): string[] {
  const missing: string[] = []
  if (stages.length === 0) return ['ao menos uma etapa']
  const byTag = new Map<string, string[]>()
  for (const stage of stages) {
    // One stage needs no tag to tell its campaigns apart; ascensão takes sales, not campaigns.
    if (!stage.tag && stages.length > 1 && stage.measure !== 'ascensao') missing.push(`etiqueta da etapa ${stage.name}`)
    if (stage.tag) byTag.set(norm(stage.tag), [...(byTag.get(norm(stage.tag)) ?? []), stage.name])
  }
  for (const [tag, names] of byTag) if (names.length > 1) missing.push(`etiqueta ${tag.toUpperCase()} repetida (${names.join(', ')})`)
  if (fronts.length === 0) missing.push('ao menos uma frente')
  const bySet = new Map<string, string[]>()
  for (const front of fronts) {
    if (front.mirror) continue
    if (front.includes.length === 0) {
      missing.push(`etiqueta da frente ${front.name}`)
      continue
    }
    const key = `${front.stageName}|${front.includes.map(norm).sort().join('|')}`
    bySet.set(key, [...(bySet.get(key) ?? []), front.name])
  }
  for (const names of bySet.values()) if (names.length > 1) missing.push(`frentes ${names.join(' e ')} com a mesma etiqueta`)
  return missing
}

export function projectSetupStatus(facts: SetupFacts): SetupStatus {
  const integrations = facts.launchopsConnected && facts.hublaConnected
  const missingSources = [!facts.launchopsConnected && 'LaunchOps', !facts.hublaConnected && 'Hubla'].filter(Boolean).join(' e ')

  const missing = stagesMissing(facts.stages, facts.fronts)
  const pages = facts.frontsWithoutPage > 0 ? `; ${plural(facts.frontsWithoutPage, 'frente sem página', 'frentes sem página')} (opcional)` : ''

  const sells = facts.stages.some((stage) => stage.measure === 'compra')
  const ascends = facts.stages.some((stage) => stage.measure === 'ascensao')
  const productsDone = facts.stages.length > 0 && (!sells || facts.entryProducts > 0) && (!ascends || facts.ascensionProducts > 0)
  const productsText =
    facts.stages.length === 0
      ? 'Monte as etapas antes: o produto conta na etapa de compra.'
      : sells && facts.entryProducts === 0
      ? 'Nenhum produto de entrada: nenhuma venda conta ainda.'
      : ascends && facts.ascensionProducts === 0
        ? 'Há etapa de ascensão sem produto de ascensão.'
        : !sells && !ascends
          ? 'Sem etapa de compra: o funil não conta vendas.'
          : `${plural(facts.entryProducts, 'produto', 'produtos')} de entrada${ascends ? `, ${plural(facts.ascensionProducts, 'de ascensão', 'de ascensão')}` : ''}.`

  const noMeta = facts.stages.filter((stage) => !stage.hasMeta).map((stage) => stage.name)
  const metasDone = facts.stages.length > 0 && noMeta.length === 0
  const band = `faixa +${facts.band.warnPct.toLocaleString('pt-BR')}% / +${facts.band.critPct.toLocaleString('pt-BR')}%`

  const steps: SetupStep[] = [
    { id: 'integracoes', label: 'Integrações', done: integrations, text: integrations ? 'LaunchOps e Hubla conectados (vale para o cliente todo).' : `Falta conectar ${missingSources}.` },
    {
      id: 'etapas',
      label: 'Etapas e frentes',
      done: missing.length === 0,
      text: missing.length ? `Falta: ${missing.join(', ')}.` : `${plural(facts.stages.length, 'etapa', 'etapas')}, ${plural(facts.fronts.length, 'frente', 'frentes')}${pages}.`,
    },
    { id: 'produtos', label: 'Produtos', done: productsDone, text: productsText },
    {
      id: 'metas',
      label: 'Metas e vigias',
      done: metasDone,
      text: facts.stages.length === 0 ? 'Monte as etapas antes das metas.' : noMeta.length ? `Falta a meta de: ${noMeta.join(', ')} (edite no canvas).` : `Toda etapa tem meta; ${band}.`,
    },
  ]
  const pendingBefore = steps.filter((step) => !step.done).length
  steps.push({
    id: 'conferir',
    label: 'Conferir',
    done: pendingBefore === 0 && facts.openSeals.length === 0,
    text:
      facts.openSeals.length > 0
        ? `Falta resolver: ${facts.openSeals.join('; ')}.`
        : pendingBefore > 0
          ? 'Conclua os passos acima; o mapa abaixo mostra o que entra em cada número.'
          : 'Tudo certo: cada número do funil mostra de onde vem.',
  })
  return { steps, done: steps.filter((step) => step.done).length }
}
