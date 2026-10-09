import { redirect } from 'next/navigation'

// "Resultado e meta" is the first section of Metas e vigias since 0106.
export default async function PlanRedirect({ params }: { params: Promise<{ clientSlug: string; funnelSlug: string }> }) {
  const { clientSlug, funnelSlug } = await params
  redirect(`/dashboard/clients/${clientSlug}/funis-venda/${funnelSlug}/metas`)
}
