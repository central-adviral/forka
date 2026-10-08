import { describe, it, expect } from 'vitest'
import { DEFAULT_RULES } from './backlog'
import { cardProgress, laneOf, recentlyDecided } from './board'
import type { LinkVariantRead, MetaVariantRead } from './backlog-readout'

describe('laneOf', () => {
  it('moves a running card whose rules spoke to "Pede decisão", and nothing else', () => {
    expect(laneOf({ status: 'running' }, true)).toBe('decide')
    expect(laneOf({ status: 'running' }, false)).toBe('running')
    expect(laneOf({ status: 'ready' }, true)).toBe('ready')
    expect(laneOf({ status: 'decided' }, true)).toBe('decided')
  })
})

describe('recentlyDecided', () => {
  const now = new Date('2026-10-08T12:00:00Z')
  it('keeps decided cards of the last 30 days on the board', () => {
    expect(recentlyDecided({ status: 'decided', decidedAt: '2026-09-20T12:00:00Z' }, now)).toBe(true)
    expect(recentlyDecided({ status: 'decided', decidedAt: '2026-08-20T12:00:00Z' }, now)).toBe(false)
  })

  it('never hides a card that is not decided', () => {
    expect(recentlyDecided({ status: 'queue', decidedAt: null }, now)).toBe(true)
  })
})

describe('cardProgress', () => {
  it('shows the thinnest side of a link test against the sample it needs', () => {
    const link = [
      { visits: 4470, needed: 7700 },
      { visits: 4520, needed: 7700 },
    ] as LinkVariantRead[]
    expect(cardProgress({ link }, DEFAULT_RULES)).toEqual({ done: 4470, target: 7700, label: '4.470 / 7.700 pessoas' })
  })

  it('shows the best creative purchases against the minimum of a Meta test', () => {
    const meta = [{ sales: 4 }, { sales: 2 }] as MetaVariantRead[]
    expect(cardProgress({ meta }, DEFAULT_RULES)).toEqual({ done: 4, target: 10, label: '4 / 10 compras' })
  })

  it('has no progress while the sample cannot be sized', () => {
    expect(cardProgress({ link: [{ visits: 30, needed: null }] as LinkVariantRead[] }, DEFAULT_RULES)).toBeNull()
    expect(cardProgress(undefined, DEFAULT_RULES)).toBeNull()
  })
})
