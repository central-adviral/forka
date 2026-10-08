import { PageFormScreen } from '../form-screen'

export default async function NovaPaginaPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>
  searchParams: Promise<{ url?: string; erro?: string }>
}) {
  const { clientSlug } = await params
  const { url, erro } = await searchParams
  return <PageFormScreen clientSlug={clientSlug} pageId={null} prefillUrl={url} erro={erro} />
}
