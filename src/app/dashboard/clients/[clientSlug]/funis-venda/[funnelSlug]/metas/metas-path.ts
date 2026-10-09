import { redirect } from 'next/navigation'

export interface MetasContext {
  client_id: string
  client_slug: string
  funnel_slug: string
  sales_funnel_id: string
}

export function metasPath(context: Pick<MetasContext, 'client_slug' | 'funnel_slug'>): string {
  return `/dashboard/clients/${context.client_slug}/funis-venda/${context.funnel_slug}/metas`
}

export function back(context: Pick<MetasContext, 'client_slug' | 'funnel_slug'>, param: 'ok' | 'erro', message: string): never {
  redirect(`${metasPath(context)}?${param}=${encodeURIComponent(message)}`)
}
