// "Remover etapa" / "Remover frente": only what never took data can go for good; anything used is
// archived instead, so its history stays. Pure, shared by the canvas and the server actions.

export interface RemovalFacts {
  /** The funnel's stages, archived ones included, each with all its fronts (archived too). */
  stages: { id: string; archivedAt: string | null; fronts: { id: string; rules: number }[] }[]
  /** One entry per campaign row a front owns (campaign_fronts). */
  campaignFrontIds: string[]
  /** One entry per page linked to a front (pages.front_id). */
  pageFrontIds: string[]
  watchers: { frontId: string | null; stageId: string | null }[]
  /** One entry per backlog item placed in a stage (backlog_items.funnel_stage_id). */
  testStageIds: string[]
  combos: { stageIds: string[]; overStageId: string | null }[]
}

const count = (ids: string[], id: string) => ids.filter((item) => item === id).length
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Why a front cannot be removed ("tem etiquetas, 3 campanhas"); null when it never took data. */
export function frontInUse(frontId: string, facts: RemovalFacts): string | null {
  const front = facts.stages.flatMap((stage) => stage.fronts).find((item) => item.id === frontId)
  const parts = [
    front?.rules ? 'etiquetas' : null,
    count(facts.campaignFrontIds, frontId) ? plural(count(facts.campaignFrontIds, frontId), 'campanha', 'campanhas') : null,
    count(facts.pageFrontIds, frontId) ? plural(count(facts.pageFrontIds, frontId), 'página', 'páginas') : null,
    facts.watchers.some((watcher) => watcher.frontId === frontId) ? 'vigia' : null,
  ].filter(Boolean)
  return parts.length ? `Tem ${parts.join(', ')}` : null
}

/** Why a stage cannot be removed ("Tem 3 frentes com campanhas"); null when it and its fronts never took data. */
export function stageInUse(stageId: string, facts: RemovalFacts): string | null {
  const stage = facts.stages.find((item) => item.id === stageId)
  const fronts = stage?.fronts ?? []
  const withCampaigns = fronts.filter((front) => facts.campaignFrontIds.includes(front.id)).length
  const otherUsed = fronts.filter((front) => !facts.campaignFrontIds.includes(front.id) && frontInUse(front.id, facts)).length
  const tests = count(facts.testStageIds, stageId)
  const parts = [
    withCampaigns ? `${plural(withCampaigns, 'frente', 'frentes')} com campanhas` : null,
    otherUsed ? `${plural(otherUsed, 'frente', 'frentes')} com etiquetas, páginas ou vigias` : null,
    facts.watchers.some((watcher) => watcher.stageId === stageId) ? 'vigia da etapa' : null,
    tests ? plural(tests, 'teste', 'testes') : null,
    facts.combos.some((combo) => combo.stageIds.includes(stageId) || combo.overStageId === stageId) ? 'custo combinado' : null,
  ].filter(Boolean)
  return parts.length ? `Tem ${parts.join(', ')}` : null
}

/** The funnel keeps at least one open stage: its last one is neither removed nor archived. */
export function isLastOpenStage(stageId: string, facts: Pick<RemovalFacts, 'stages'>): boolean {
  const open = facts.stages.filter((stage) => !stage.archivedAt)
  return open.length === 1 && open[0].id === stageId
}
