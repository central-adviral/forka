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

/** The first rule, in order, that matches the click; null keeps the variant's own page. */
export function matchRoute(routes: VariantRoute[], click: ClickContext): VariantRoute | null {
  return (
    routes.find((route) => {
      const value = normalize(route.match_value)
      if (route.match_field === 'ad_name') return normalize(click.adName).includes(value)
      if (route.match_field === 'utm_source') return normalize(click.utmSource) === value
      return deviceOf(click.userAgent) === value
    }) ?? null
  )
}
