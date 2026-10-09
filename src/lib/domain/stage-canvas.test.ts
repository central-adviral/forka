import { describe, it, expect } from 'vitest'
import { EMPTY_TOTALS } from './funnel-stages'
import {
  NODE_WIDTH,
  SEQUENCE_GAP,
  campaignNameSuggestion,
  cleanTag,
  comboFormula,
  dropIndex,
  edgeLabel,
  measureOfWatcherMetric,
  metaFromInput,
  metaText,
  metaToInput,
  metaTone,
  passageRate,
  placeStage,
  sequenceEdges,
  stageSetupItems,
} from './stage-canvas'

const stage = (id: string, parallel = false) => ({ id, parallel })
const ids = (list: { id: string; parallel: boolean }[]) => list.map((item) => `${item.id}${item.parallel ? '*' : ''}`)

describe('placeStage', () => {
  const stages = [stage('rec', true), stage('cap'), stage('lemb'), stage('vnd')]

  it('reorders inside the sequence, counting the moving node where it is drawn', () => {
    expect(ids(placeStage(stages, stages[1], false, 3))).toEqual(['rec*', 'lemb', 'vnd', 'cap'])
    expect(ids(placeStage(stages, stages[3], false, 0))).toEqual(['rec*', 'vnd', 'cap', 'lemb'])
    expect(ids(placeStage(stages, stages[2], false, 2))).toEqual(['rec*', 'cap', 'lemb', 'vnd'])
  })

  it('moves between lanes and keeps the parallel stages first', () => {
    expect(ids(placeStage(stages, stages[0], false, 1))).toEqual(['cap', 'rec', 'lemb', 'vnd'])
    expect(ids(placeStage(stages, stages[2], true, null))).toEqual(['rec*', 'lemb*', 'cap', 'vnd'])
  })

  it('inserts a new stage at the index or at the end of its lane', () => {
    expect(ids(placeStage(stages, stage('new'), false, 1))).toEqual(['rec*', 'cap', 'new', 'lemb', 'vnd'])
    expect(ids(placeStage(stages, stage('new', true), true, null))).toEqual(['rec*', 'new*', 'cap', 'lemb', 'vnd'])
  })
})

describe('dropIndex', () => {
  it('lands before the first node whose middle is past the pointer', () => {
    expect(dropIndex(10, 3, SEQUENCE_GAP)).toBe(0)
    expect(dropIndex(NODE_WIDTH / 2 + 1, 3, SEQUENCE_GAP)).toBe(1)
    expect(dropIndex(10_000, 3, SEQUENCE_GAP)).toBe(3)
  })
})

describe('sequenceEdges', () => {
  it('joins each node to the next with the results they produce', () => {
    const edges = sequenceEdges(['lead', 'compra', 'ascensao'])
    expect(edges.map((edge) => edge.label)).toEqual(['leads → vendas', 'vendas → ascensões'])
    expect(edges[0].path.startsWith(`M${NODE_WIDTH} `)).toBe(true)
    expect(edges[0].labelX).toBe(NODE_WIDTH + SEQUENCE_GAP / 2)
    expect(sequenceEdges(['compra'])).toEqual([])
    expect(edgeLabel('alcance', 'visita')).toBe('impressões → visitas')
  })
})

describe('meta input and text', () => {
  it('reads pt-BR numbers and keeps the ascension rate as a fraction', () => {
    expect(metaFromInput('lead', '6,50')).toBe(6.5)
    expect(metaFromInput('compra', '1.234,5')).toBe(1234.5)
    expect(metaFromInput('compra', '300')).toBe(300)
    expect(metaFromInput('ascensao', '8')).toBe(0.08)
    expect(metaFromInput('lead', ' ')).toBeNull()
    expect(metaFromInput('lead', 'abc')).toBeNaN()
    expect(metaToInput('ascensao', 0.08)).toBe('8')
    expect(metaToInput('lead', 6.5)).toBe('6,5')
    expect(metaText('ascensao', 0.085)).toBe('8,5%')
    expect(metaText('lead', 6)).toMatch(/R\$\s6,00/)
  })
})

describe('names', () => {
  it('cleans tags and suggests campaign names', () => {
    expect(cleanTag(' cap 2 ')).toBe('CAP2')
    expect(cleanTag('  ')).toBeNull()
    expect(campaignNameSuggestion('CAP', '[FRIO]')).toBe('CAP | [FRIO] | nome do criativo')
    expect(campaignNameSuggestion(null, 'FRIO')).toBe('FRIO | nome do criativo')
  })

  it('writes the combo formula', () => {
    const stages = [
      { id: 'a', name: 'Captação', measure: 'lead' as const },
      { id: 'b', name: 'Vendas', measure: 'compra' as const },
    ]
    expect(comboFormula({ stageIds: ['a', 'b'], over: 'stage', overStageId: 'b' }, stages)).toBe('(Captação + Vendas) ÷ vendas de Vendas')
    expect(comboFormula({ stageIds: ['a', 'b'], over: 'receita', overStageId: null }, stages)).toBe('receita ÷ gasto (Captação + Vendas)')
    expect(comboFormula({ stageIds: [], over: 'stage', overStageId: 'gone' }, stages)).toBe('(nenhuma etapa) ÷ ?')
  })
})

describe('stageSetupItems', () => {
  it('lists missing metas, fronts without contém, repeated tags and an ascension with no sale', () => {
    expect(
      stageSetupItems([
        { name: 'Captação', tag: 'CAP', measure: 'lead', meta: 6, fronts: [{ name: 'Frio', mirror: false, includes: 0 }, { name: 'Espelho', mirror: true, includes: 0 }] },
        { name: 'Lembrete', tag: 'cap', measure: 'alcance', meta: null, fronts: [] },
        { name: 'Ascensão', tag: null, measure: 'ascensao', meta: 0.08, fronts: [] },
      ])
    ).toEqual([
      'etiqueta "contém" da frente Frio',
      'meta da etapa Lembrete',
      'etiqueta CAP repetida (Captação, Lembrete)',
      'uma etapa de compra para a ascensão',
    ])
    expect(stageSetupItems([{ name: 'Vendas', tag: 'VND', measure: 'compra', meta: 300, fronts: [{ name: 'Frio', mirror: false, includes: 1 }] }])).toEqual([])
  })
})

describe('watchers, tones and passage', () => {
  it('maps the plan metrics to stage measures', () => {
    expect(measureOfWatcherMetric('cpa_geral')).toBe('compra')
    expect(measureOfWatcherMetric('roas')).toBe('compra')
    expect(measureOfWatcherMetric('cpl')).toBe('lead')
    expect(measureOfWatcherMetric('ctr')).toBeNull()
  })

  it('tones a cost against its ceiling and the rate against its floor', () => {
    expect(metaTone('compra', 100, 120)).toBe('ok')
    expect(metaTone('compra', 130, 120)).toBe('warn')
    expect(metaTone('compra', 200, 120)).toBe('crit')
    expect(metaTone('ascensao', 0.07, 0.08)).toBe('warn')
    expect(metaTone('ascensao', 0.02, 0.08)).toBe('crit')
    expect(metaTone('lead', 5, null)).toBeNull()
  })

  it('divides the next result by this one, impressions counted one by one', () => {
    expect(passageRate({ measure: 'lead', totals: { ...EMPTY_TOTALS, leads: 200 } }, { measure: 'compra', totals: { ...EMPTY_TOTALS, vendas: 10 } })).toBe(0.05)
    expect(passageRate({ measure: 'alcance', totals: { ...EMPTY_TOTALS, impressions: 10_000 } }, { measure: 'lead', totals: { ...EMPTY_TOTALS, leads: 50 } })).toBe(0.005)
    expect(passageRate({ measure: 'lead', totals: EMPTY_TOTALS }, { measure: 'compra', totals: EMPTY_TOTALS })).toBeNull()
  })
})
