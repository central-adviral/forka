import { describe, it, expect } from 'vitest'
import {
  effectiveBand,
  effectiveFrontMeta,
  effectiveTestTeto,
  effectiveWatcherTarget,
  followersLine,
  frontPrincipalMeta,
  resultStage,
  stageFollowers,
  tetoChanged,
  watcherReader,
  type FrontMetas,
  type StageMetas,
} from './targets'

const CAP: StageMetas = { id: 'cap', measure: 'lead', position: 1, archivedAt: null, meta: 6, metaRoas: null }
const VND: StageMetas = { id: 'vnd', measure: 'compra', position: 2, archivedAt: null, meta: 55, metaRoas: 2 }
const RCAR: StageMetas = { id: 'rcar', measure: 'compra', position: 3, archivedAt: null, meta: 30, metaRoas: null }
const REC: StageMetas = { id: 'rec', measure: 'alcance', position: 0, archivedAt: null, meta: 12, metaRoas: null }
const stages = [REC, CAP, VND, RCAR]
const front = (patch: Partial<FrontMetas>): FrontMetas => ({ stageId: 'cap', metricaPrincipal: null, alvoPrincipal: null, metricaSecundaria: null, alvoSecundaria: null, ...patch })

describe('effective metas: each level follows the one above unless it has its own (0106)', () => {
  it('finds the result stage: the first open stage of the measure', () => {
    expect(resultStage(stages, 'compra')?.id).toBe('vnd')
    expect(resultStage([{ ...VND, archivedAt: '2026-10-01' }, RCAR], 'compra')?.id).toBe('rcar')
    expect(resultStage(stages, 'visita')).toBeUndefined()
  })

  it('a front follows its stage, unless it set its own meta for that metric', () => {
    expect(effectiveFrontMeta(front({}), stages, 'cpl')).toEqual({ value: 6, source: 'etapa', stageId: 'cap' })
    expect(effectiveFrontMeta(front({ metricaPrincipal: 'lead', alvoPrincipal: 4.5 }), stages, 'cpl')).toEqual({ value: 4.5, source: 'frente', stageId: null })
    // A metric the stage does not carry has nothing to follow.
    expect(effectiveFrontMeta(front({}), stages, 'ctr').value).toBeNull()
    expect(frontPrincipalMeta(front({ metricaPrincipal: 'lead' }), CAP)).toEqual({ value: 6, source: 'etapa' })
    expect(frontPrincipalMeta(front({ metricaPrincipal: 'lead', alvoPrincipal: 4.5 }), CAP)).toEqual({ value: 4.5, source: 'especifica' })
  })

  it('a watcher judges with its own target, else its front, its stage or the funnel result stage', () => {
    const fronts = new Map([['f1', front({ stageId: 'vnd', metricaPrincipal: 'compra', alvoPrincipal: 48 })], ['f2', front({ stageId: 'vnd' })]])
    expect(effectiveWatcherTarget({ metric: 'cpl', target: 7, frontId: null, stageId: null }, stages, fronts)).toEqual({ value: 7, source: 'especifica', stageId: null })
    expect(effectiveWatcherTarget({ metric: 'cpa_anuncio', target: null, frontId: 'f1', stageId: null }, stages, fronts)).toMatchObject({ value: 48, source: 'frente' })
    expect(effectiveWatcherTarget({ metric: 'cpa_anuncio', target: null, frontId: 'f2', stageId: null }, stages, fronts)).toMatchObject({ value: 55, source: 'etapa', stageId: 'vnd' })
    expect(effectiveWatcherTarget({ metric: 'roas', target: null, frontId: 'f2', stageId: null }, stages, fronts)).toMatchObject({ value: 2, source: 'etapa' })
    expect(effectiveWatcherTarget({ metric: 'cpa_geral', target: null, frontId: null, stageId: 'rcar' }, stages, fronts)).toMatchObject({ value: 30, stageId: 'rcar' })
    // The funnel's result watcher (CPA geral) follows the first compra stage.
    expect(effectiveWatcherTarget({ metric: 'cpa_geral', target: null, frontId: null, stageId: null }, stages, fronts)).toMatchObject({ value: 55, stageId: 'vnd' })
    expect(effectiveWatcherTarget({ metric: 'custo_checkout', target: null, frontId: null, stageId: null }, stages, fronts)).toEqual({ value: null, source: null, stageId: null })
  })

  it('a watcher band is its own pair, else the funnel faixa padrão', () => {
    expect(effectiveBand({ warnPct: null, critPct: null }, { warnPct: 15, critPct: 35 })).toEqual({ warnPct: 15, critPct: 35, own: false })
    expect(effectiveBand({ warnPct: 5, critPct: 10 }, { warnPct: 15, critPct: 35 })).toEqual({ warnPct: 5, critPct: 10, own: true })
  })
})

describe('the teto of a test', () => {
  it('follows the meta of its stage, in the stage cost', () => {
    expect(effectiveTestTeto({ teto: null, funnelStageId: 'cap' }, stages, 'compra', null)).toEqual({ value: 6, source: 'etapa', medida: 'cpl' })
    expect(effectiveTestTeto({ teto: null, funnelStageId: 'vnd' }, stages, 'compra', null)).toEqual({ value: 55, source: 'etapa', medida: 'cpa' })
    expect(effectiveTestTeto({ teto: null, funnelStageId: 'rec' }, stages, 'compra', null)).toEqual({ value: 12, source: 'etapa', medida: 'cpm' })
    // Without a stage it takes the funnel result's.
    expect(effectiveTestTeto({ teto: null, funnelStageId: null }, stages, 'lead', null)).toMatchObject({ value: 6, medida: 'cpl' })
  })

  it('a compra stage with only a ROAS meta judges by ROAS', () => {
    const roasOnly = [{ ...VND, meta: null }]
    expect(effectiveTestTeto({ teto: null, funnelStageId: 'vnd' }, roasOnly, 'compra', null)).toEqual({ value: 2, source: 'etapa', medida: 'roas' })
    // An override or a teto of its own is a CPA, the money cost of the stage.
    expect(effectiveTestTeto({ teto: null, funnelStageId: 'vnd' }, roasOnly, 'compra', 50)).toEqual({ value: 50, source: 'criterios', medida: 'cpa' })
  })

  it('the Critérios override and a teto of its own win over the stage, in that order', () => {
    expect(effectiveTestTeto({ teto: null, funnelStageId: 'cap' }, stages, 'compra', 9)).toEqual({ value: 9, source: 'criterios', medida: 'cpl' })
    expect(effectiveTestTeto({ teto: 4, funnelStageId: 'cap' }, stages, 'compra', 9)).toEqual({ value: 4, source: 'especifica', medida: 'cpl' })
  })

  it('an ascension stage decides no creative, and a stage without meta gives no teto', () => {
    const asc: StageMetas = { id: 'asc', measure: 'ascensao', position: 9, archivedAt: null, meta: 0.1, metaRoas: null }
    expect(effectiveTestTeto({ teto: null, funnelStageId: 'asc' }, [...stages, asc], 'compra', null)).toEqual({ value: null, source: null, medida: null })
    expect(effectiveTestTeto({ teto: null, funnelStageId: 'cap' }, [{ ...CAP, meta: null }], 'compra', null)).toEqual({ value: null, source: null, medida: 'cpl' })
  })

  it('a running test shows the change only when today it would get another teto', () => {
    expect(tetoChanged({ value: 55, medida: 'cpa' }, { value: 55, source: 'etapa', medida: 'cpa' })).toBe(false)
    expect(tetoChanged({ value: 55, medida: 'cpa' }, { value: 60, source: 'etapa', medida: 'cpa' })).toBe(true)
    expect(tetoChanged({ value: 55, medida: 'cpa' }, { value: 55, source: 'etapa', medida: 'roas' })).toBe(true)
    expect(tetoChanged({ value: null, medida: null }, { value: 60, source: 'etapa', medida: 'cpa' })).toBe(false)
  })
})

describe('who a stage meta change reaches', () => {
  it('counts the places that follow the stage and the specific ones that stay', () => {
    const fronts = new Map([['f1', front({ stageId: 'cap', metricaPrincipal: 'lead', alvoPrincipal: 5 })], ['f2', front({ stageId: 'cap' })]])
    const readers = [
      { stageId: 'cap', follows: true },
      { stageId: 'cap', follows: false },
      watcherReader({ metric: 'cpl', target: null, frontId: null, stageId: null }, stages, fronts)!,
      watcherReader({ metric: 'cpl', target: null, frontId: 'f1', stageId: null }, stages, fronts)!,
      watcherReader({ metric: 'cpl', target: null, frontId: 'f2', stageId: null }, stages, fronts)!,
      watcherReader({ metric: 'cpm', target: 9, frontId: null, stageId: 'rec' }, stages, fronts)!,
    ]
    expect(watcherReader({ metric: 'ctr', target: 1, frontId: null, stageId: null }, stages, fronts)).toBeNull()
    // The front f1 has its own CPL: its watcher follows the front, not the stage.
    expect(stageFollowers('cap', readers)).toEqual({ following: 3, specific: 2 })
    expect(followersLine({ following: 3, specific: 2 })).toBe('3 lugares seguem esta meta; 2 são específicos e não mudam.')
    expect(followersLine({ following: 1, specific: 0 })).toBe('1 lugar segue esta meta.')
  })
})
