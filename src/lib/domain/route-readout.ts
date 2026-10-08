import { probabilityToBeatControl } from './significance'
import { routeMatches, type Segment, type VariantRoute } from './routing'
import { THIN_CELL_VISITORS } from './creative-matrix'

// Reads each routing rule against the same audience in the control: "[dor] on B, pain page" next
// to "[dor] on A, generic page". All of A would mix the page with the ad.

export interface SegmentRow {
  variant_id: string
  route_id: string | null
  ad_name: string
  utm_source: string
  device: Segment['device']
  people: number
  buyers: number
  revenue_cents: number
}

export interface Totals {
  people: number
  buyers: number
  revenueCents: number
}

export interface RouteLine {
  /** Null is the variant's own page: people no rule caught. */
  route: VariantRoute | null
  routed: Totals
  /** The control's people who meet the same condition and no earlier rule; null on the control itself. */
  sameAudience: Totals | null
  chance: number | null
  thin: boolean
}

export interface RouteReadoutVariant {
  id: string
  name: string
  is_control: boolean
  routes: VariantRoute[]
}

const sum = (rows: SegmentRow[]): Totals =>
  rows.reduce((total, row) => ({ people: total.people + row.people, buyers: total.buyers + row.buyers, revenueCents: total.revenueCents + row.revenue_cents }), {
    people: 0,
    buyers: 0,
    revenueCents: 0,
  })

const segmentOf = (row: SegmentRow): Segment => ({ adName: row.ad_name, utmSource: row.utm_source, device: row.device })

export function readRoutes(variants: RouteReadoutVariant[], segments: SegmentRow[]): { variant: RouteReadoutVariant; lines: RouteLine[] }[] {
  const control = variants.find((variant) => variant.is_control)
  const controlRows = control ? segments.filter((row) => row.variant_id === control.id) : []

  return variants
    .filter((variant) => variant.routes.length > 0)
    .map((variant) => {
      const own = segments.filter((row) => row.variant_id === variant.id)
      const isControl = variant.id === control?.id
      // First match wins in /r, so the twin of rule i excludes whoever an earlier rule would catch.
      const twinOf = (index: number | null) =>
        controlRows.filter((row) => {
          const earlier = variant.routes.slice(0, index ?? variant.routes.length)
          if (earlier.some((route) => routeMatches(route, segmentOf(row)))) return false
          return index === null || routeMatches(variant.routes[index], segmentOf(row))
        })
      const line = (route: VariantRoute | null, index: number | null): RouteLine => {
        const routed = sum(own.filter((row) => row.route_id === (route?.id ?? null)))
        const sameAudience = isControl || !control ? null : sum(twinOf(index))
        return {
          route,
          routed,
          sameAudience,
          chance: sameAudience
            ? probabilityToBeatControl({ visits: sameAudience.people, conversions: sameAudience.buyers }, { visits: routed.people, conversions: routed.buyers })
            : null,
          thin: routed.people < THIN_CELL_VISITORS || (sameAudience !== null && sameAudience.people < THIN_CELL_VISITORS),
        }
      }
      return { variant, lines: [...variant.routes.map((route, index) => line(route, index)), line(null, null)] }
    })
}
