import { describe, it, expect } from 'vitest'
import { blockedMove, DEFAULT_RULES, defaultGates, nextCode, readRules, withPlanTeto } from './backlog'

describe('backlog', () => {
  it('gives the next free code, one past the highest in use', () => {
    expect(nextCode([])).toBe('T1')
    expect(nextCode(['T1', 'T7', 'T3'])).toBe('T8')
  })

  it('starts a Meta creative test with the tag the ads must carry', () => {
    expect(defaultGates('meta', 'T4')[0]).toBe('Anúncios com a tag [T4-x] no nome')
    expect(defaultGates('link', 'T4')).toEqual(['Versão nova publicada', 'Link /r criado'])
  })

  it('keeps a card out of Pronto and Rodando while a pre-requisite is open, and out of Decidido without a learning', () => {
    expect(blockedMove('ready', { gatesOpen: 1, hasLearning: false })).toMatch(/1 pré-requisito/)
    expect(blockedMove('running', { gatesOpen: 0, hasLearning: false })).toBeNull()
    expect(blockedMove('decided', { gatesOpen: 0, hasLearning: false })).toMatch(/aprendizado/)
    expect(blockedMove('queue', { gatesOpen: 3, hasLearning: false })).toBeNull()
  })

  it('reads the rules, falling back to the default for anything missing or out of range', () => {
    expect(readRules(null)).toEqual(DEFAULT_RULES)
    expect(readRules({ teto: 40, mult: 99, min: 2.5, conf: 90 })).toEqual({ ...DEFAULT_RULES, teto: 40, conf: 90 })
  })
})

describe('withPlanTeto', () => {
  it('reads the ceiling from the live CPA target of a purchase project, and keeps the stored one otherwise', () => {
    const stored = { ...DEFAULT_RULES, teto: 55 }
    expect(withPlanTeto(stored, 60, 'compra').teto).toBe(60)
    expect(withPlanTeto(stored, null, 'compra').teto).toBe(55)
    expect(withPlanTeto(stored, 8, 'lead').teto).toBe(55)
  })
})
