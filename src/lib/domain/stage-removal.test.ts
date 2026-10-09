import { describe, it, expect } from 'vitest'
import { frontInUse, isLastOpenStage, stageInUse, type RemovalFacts } from './stage-removal'

const facts = (patch: Partial<RemovalFacts> = {}): RemovalFacts => ({
  stages: [
    { id: 'cap', archivedAt: null, fronts: [{ id: 'f1', rules: 0 }, { id: 'f2', rules: 0 }] },
    { id: 'vnd', archivedAt: null, fronts: [{ id: 'f3', rules: 0 }] },
    { id: 'old', archivedAt: '2026-10-01', fronts: [] },
  ],
  campaignFrontIds: [],
  pageFrontIds: [],
  watchers: [],
  testStageIds: [],
  combos: [],
  ...patch,
})

describe('stage and front removal', () => {
  it('lets a stage and a front that never took data go', () => {
    expect(stageInUse('cap', facts())).toBeNull()
    expect(frontInUse('f1', facts())).toBeNull()
  })

  it('says why a front is in use: etiquetas, campanhas, páginas, vigias', () => {
    const used = facts({
      stages: [{ id: 'cap', archivedAt: null, fronts: [{ id: 'f1', rules: 2 }] }],
      campaignFrontIds: ['f1', 'f1', 'f1'],
      pageFrontIds: ['f1'],
      watchers: [{ frontId: 'f1', stageId: null }],
    })
    expect(frontInUse('f1', used)).toBe('Tem etiquetas, 3 campanhas, 1 página, vigia')
  })

  it('says why a stage is in use: its fronts, its vigias, its tests and the combos', () => {
    expect(stageInUse('cap', facts({ campaignFrontIds: ['f1', 'f2', 'f2'] }))).toBe('Tem 2 frentes com campanhas')
    expect(stageInUse('cap', facts({ pageFrontIds: ['f2'] }))).toBe('Tem 1 frente com etiquetas, páginas ou vigias')
    expect(stageInUse('vnd', facts({ watchers: [{ frontId: null, stageId: 'vnd' }] }))).toBe('Tem vigia da etapa')
    expect(stageInUse('vnd', facts({ testStageIds: ['vnd', 'vnd'] }))).toBe('Tem 2 testes')
    expect(stageInUse('vnd', facts({ combos: [{ stageIds: ['cap'], overStageId: 'vnd' }] }))).toBe('Tem custo combinado')
    expect(stageInUse('cap', facts({ combos: [{ stageIds: ['cap'], overStageId: null }] }))).toBe('Tem custo combinado')
  })

  it('keeps the last open stage, archived ones not counted', () => {
    expect(isLastOpenStage('cap', facts())).toBe(false)
    const one = facts({ stages: [facts().stages[0], facts().stages[2]] })
    expect(isLastOpenStage('cap', one)).toBe(true)
  })
})
