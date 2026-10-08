import { describe, it, expect } from 'vitest'
import { readRoutes, type SegmentRow } from './route-readout'
import type { VariantRoute } from './routing'

const dor: VariantRoute = { id: 'dor', match_field: 'ad_name', match_value: '[dor]', destination_url: 'https://x.com/dor' }
const cel: VariantRoute = { id: 'cel', match_field: 'device', match_value: 'celular', destination_url: 'https://x.com/curta' }
const row = (variant_id: string, route_id: string | null, ad_name: string, device: SegmentRow['device'], people: number, buyers: number): SegmentRow => ({
  variant_id,
  route_id,
  ad_name,
  utm_source: 'facebookads',
  device,
  people,
  buyers,
  revenue_cents: buyers * 10000,
})

const variants = [
  { id: 'a', name: 'A · genérica', is_control: true, routes: [] },
  { id: 'b', name: 'B · casada', is_control: false, routes: [dor, cel] },
]
const segments = [
  row('a', null, 'UGC [dor]', 'celular', 400, 8),
  row('a', null, 'Estúdio [ganho]', 'celular', 300, 6),
  row('a', null, 'Estúdio [ganho]', 'computador', 200, 4),
  row('b', 'dor', 'UGC [DOR]', 'celular', 400, 20),
  row('b', 'cel', 'Estúdio [ganho]', 'celular', 300, 6),
  row('b', null, 'Estúdio [ganho]', 'computador', 200, 4),
]

describe('readRoutes', () => {
  const [b] = readRoutes(variants, segments)

  it('reads only variants with rules, one line per rule plus the variant page', () => {
    expect(b.variant.id).toBe('b')
    expect(b.lines.map((line) => line.route?.id ?? null)).toEqual(['dor', 'cel', null])
  })

  it('compares a rule with the same audience in the control, not all of it', () => {
    expect(b.lines[0].routed).toEqual({ people: 400, buyers: 20, revenueCents: 200000 })
    expect(b.lines[0].sameAudience).toEqual({ people: 400, buyers: 8, revenueCents: 80000 })
    expect(b.lines[0].chance).toBeGreaterThan(0.95)
  })

  it('leaves out of a later rule whoever an earlier rule catches', () => {
    // The [dor] phones were caught by the [dor] rule; the phone rule twin is only the [ganho] phones.
    expect(b.lines[1].sameAudience?.people).toBe(300)
    expect(b.lines[2].sameAudience?.people).toBe(200)
  })

  it('flags a thin sample and gives no comparison to rules on the control', () => {
    expect(b.lines[2].thin).toBe(true)
    const [onControl] = readRoutes([{ ...variants[0], routes: [dor] }, variants[1]], segments)
    expect(onControl.lines[0].sameAudience).toBeNull()
    expect(onControl.lines[0].chance).toBeNull()
  })
})
