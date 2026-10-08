import { PageFormScreen } from '../form-screen'

export default async function NovaPaginaPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>
  searchParams: Promise<{ url?: string; erro?: string; projeto?: string; frente?: string }>
}) {
  const { clientSlug } = await params
  const { url, erro, projeto, frente } = await searchParams
  return <PageFormScreen clientSlug={clientSlug} pageId={null} prefillUrl={url} prefillProjectId={projeto} prefillFrontId={frente} erro={erro} />
}
