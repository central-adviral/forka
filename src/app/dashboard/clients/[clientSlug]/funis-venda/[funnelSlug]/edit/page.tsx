import { redirect } from 'next/navigation'

// "Editar funil" became the funnel header of the Configurar screens (0107); old links land on the checklist.
export default async function EditSalesFunnelPage({ params }: { params: Promise<{ clientSlug: string; funnelSlug: string }> }) {
  const { clientSlug, funnelSlug } = await params
  redirect(`/dashboard/clients/${clientSlug}/funis-venda/${funnelSlug}/configurar`)
}
