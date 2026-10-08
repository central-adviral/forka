import { describe, it, expect } from 'vitest'
import { alertActions, decimalInput, formatMetric, thresholds, watcherScope, watcherSource } from './watchers'

describe('thresholds', () => {
  it('puts the bands above the target for a cost', () => {
    expect(thresholds('cpa_geral', 55, 20, 40)).toEqual({ warn: 66, crit: 77 })
  })

  it('puts the bands below the target for a rate', () => {
    const band = thresholds('connect_rate', 75, 10, 20)
    expect(band.warn).toBeCloseTo(67.5)
    expect(band.crit).toBeCloseTo(60)
  })
})

describe('formatMetric', () => {
  it('formats costs as reais and rates as percent', () => {
    expect(formatMetric('cpl', 7.4)).toBe('R$ 7,40')
    expect(formatMetric('ctr', 1.234)).toBe('1,2%')
    expect(formatMetric('cpl', null)).toBe('—')
  })
})

describe('slice and frequency (0065)', () => {
  it('names what the watcher looks at: a slice by name first, then the front, then the project', () => {
    expect(watcherScope({ frontName: 'Perpétuo' })).toBe('Perpétuo')
    expect(watcherScope({ frontName: null })).toBe('todas as frentes')
  })

  it('formats frequency as times, and a rising frequency is the bad side', () => {
    expect(formatMetric('frequencia', 2.5)).toBe('2,50x')
    const band = thresholds('frequencia', 3, 20, 40)
    expect(band.warn).toBeCloseTo(3.6)
    expect(band.crit).toBeCloseTo(4.2)
  })
})

describe('alertActions', () => {
  const base = '/dashboard/clients/voe'
  it('sends a cost alert to the creatives tab of the last 7 days, and the editor to the target', () => {
    expect(alertActions({ metric: 'cpa_anuncio', projectSlug: '1k', frontId: null }, base, true)).toEqual([
      { label: 'Ver criativos', href: '/dashboard/clients/voe/funis-venda/1k?periodo=7d&aba=criativos' },
      { label: 'Abrir funil', href: '/dashboard/clients/voe/funis-venda/1k?periodo=7d' },
      { label: 'Ajustar meta', href: '/dashboard/clients/voe/metas' },
    ])
  })

  it('sends a media alert to traffic, and a front-scoped one to its front; no target link for read-only roles', () => {
    expect(alertActions({ metric: 'ctr', projectSlug: '1k', frontId: null }, base, false)[0]).toEqual({
      label: 'Ver tráfego',
      href: '/dashboard/clients/voe/funis-venda/1k?periodo=7d&aba=trafego',
    })
    const scoped = alertActions({ metric: 'frequencia', projectSlug: '1k', frontId: 'f-1' }, base, false)
    expect(scoped[0]).toEqual({ label: 'Ver a frente', href: '/dashboard/clients/voe/funis-venda/1k?periodo=7d&aba=frentes&frente=f-1' })
    expect(scoped.map((action) => action.label)).not.toContain('Ajustar meta')
  })
})

describe('watcherSource', () => {
  it('leaves a watcher created in Metas to itself', () => {
    expect(watcherSource({ planRole: null, frontId: null })).toBe('livre')
    expect(watcherSource({ planRole: null, frontId: 'front-1' })).toBe('livre')
  })

  it('sends a project plan watcher to the Plano and a front one to the front', () => {
    expect(watcherSource({ planRole: 'principal', frontId: null })).toBe('plano')
    expect(watcherSource({ planRole: 'secundaria', frontId: null })).toBe('plano')
    expect(watcherSource({ planRole: 'secundaria', frontId: 'front-1' })).toBe('frente')
  })
})

describe('decimalInput', () => {
  it('writes what the Metas form parses back to the same number', () => {
    expect(decimalInput(55.5)).toBe('55,5')
    expect(decimalInput(1200)).toBe('1200')
    expect(Number(decimalInput(1234.75).replace(/\./g, '').replace(',', '.'))).toBe(1234.75)
  })
})
