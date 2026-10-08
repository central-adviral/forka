// Routing rules of a variant (0084): after the draw picked the variant, the first rule that
// matches the click picks the page. No rule matching keeps the variant's own page.

export type RouteField = 'ad_name' | 'utm_source' | 'device'

export interface VariantRoute {
  id: string
  match_field: RouteField
  match_value: string
  destination_url: string
}

export interface ClickContext {
  /** utm_term: the ad's name, from the campaign link's {{ad.name}}. */
  adName: string
  utmSource: string
  userAgent: string | null
}

export const ROUTE_FIELDS: { value: RouteField; label: string; hint: string }[] = [
  { value: 'ad_name', label: 'Nome do anúncio contém', hint: 'ex.: [dor]' },
  { value: 'utm_source', label: 'Origem (utm_source) é', hint: 'ex.: instagram' },
  { value: 'device', label: 'Dispositivo é', hint: 'celular ou computador' },
]

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

const MOBILE = /Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i

export function deviceOf(userAgent: string | null): 'celular' | 'computador' {
  return userAgent && MOBILE.test(userAgent) ? 'celular' : 'computador'
}

export interface Segment {
  adName: string
  utmSource: string
  device: 'celular' | 'computador'
}

/** Whether a person of this segment meets the rule's condition, routed by it or not. */
export function routeMatches(route: Pick<VariantRoute, 'match_field' | 'match_value'>, segment: Segment): boolean {
  const value = normalize(route.match_value)
  if (route.match_field === 'ad_name') return normalize(segment.adName).includes(value)
  if (route.match_field === 'utm_source') return normalize(segment.utmSource) === value
  return segment.device === value
}

/** The first rule, in order, that matches the click; null keeps the variant's own page. */
export function matchRoute(routes: VariantRoute[], click: ClickContext): VariantRoute | null {
  const segment = { adName: click.adName, utmSource: click.utmSource, device: deviceOf(click.userAgent) }
  return routes.find((route) => routeMatches(route, segment)) ?? null
}
