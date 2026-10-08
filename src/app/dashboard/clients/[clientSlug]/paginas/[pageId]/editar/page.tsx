import { PageFormScreen } from '../../form-screen'

export default async function EditarPaginaPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; pageId: string }>
  searchParams: Promise<{ erro?: string }>
}) {
  const { clientSlug, pageId } = await params
  const { erro } = await searchParams
  return <PageFormScreen clientSlug={clientSlug} pageId={pageId} erro={erro} />
}
