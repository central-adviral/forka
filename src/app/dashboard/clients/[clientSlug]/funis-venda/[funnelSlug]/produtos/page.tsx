import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getClientSecrets } from '@/lib/repo/client-secrets-repo'
import { createLaunchOpsClient } from '@/lib/launchops/client'
import { fetchLaunchOpsProducts, type LaunchOpsProduct } from '@/lib/launchops/products'
import { PRODUCT_ROLES, PRODUCT_ROLE_HINT, PRODUCT_ROLE_LABEL, type ProductRole } from '@/lib/domain/product-roles'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { removeProduct, setProductRole } from './actions'
import { canActAs } from '@/lib/view-as'
import { saoPauloDay } from '@/lib/repo/today-repo'
import { brtDayBoundaryUtc } from '@/lib/domain/report-period'

const LOOKBACK_DAYS = 30

const mono = 'font-[family-name:var(--font-geist-mono)]'
const fieldClass =
  'rounded-[8px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-2.5 py-1.5 text-[12.5px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'
const buttonClass = 'rounded-[8px] border border-[var(--ct-line)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]'

const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })

export default async function ProjectProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string; funnelSlug: string }>
  searchParams: Promise<{ ok?: string; erro?: string }>
}) {
  const { clientSlug, funnelSlug } = await params
  const { ok, erro } = await searchParams
  const supabase = await createServerSupabaseClient()

  const { data: client } = await supabase.from('clients').select('id, slug, funnel_source_url').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()
  const { data: funnel } = await supabase
    .from('sales_funnels')
    .select('id, name, slug')
    .eq('client_id', client.id)
    .eq('slug', funnelSlug)
    .maybeSingle()
  if (!funnel) notFound()

  const since = brtDayBoundaryUtc(saoPauloDay(-LOOKBACK_DAYS))
  const [{ data: canEdit }, { data: productRows, error: productsError }, { data: unattributedRows, error: unattributedError }] = await Promise.all([
    canActAs(supabase, client.id, 'gestor').then((data) => ({ data })),
    supabase.from('project_products').select('produto_nome, papel').eq('sales_funnel_id', funnel.id).order('produto_nome'),
    // Sales of the client no project owns (0073): a product listed in several projects with no ad
    // on the sale, or a product no project lists any more.
    supabase.from('sales').select('produto, valor_liquido').eq('client_id', client.id).is('sales_funnel_id', null).gte('data_venda', since),
  ])
  if (productsError) throw productsError
  if (unattributedError) throw unattributedError
  const unattributed = (unattributedRows ?? []) as { produto: string | null; valor_liquido: number | null }[]
  const unattributedRevenue = unattributed.reduce((sum, row) => sum + Number(row.valor_liquido ?? 0), 0)
  const unattributedProducts = [...new Set(unattributed.map((row) => row.produto ?? '(sem produto)'))]
  const products = (productRows ?? []) as { produto_nome: string; papel: ProductRole }[]

  // The LaunchOps key is read with the service role, so only a gestor gets the catalog; RLS above
  // already proved this user can see the project.
  let catalog: LaunchOpsProduct[] = []
  let catalogError: string | null = null
  if (canEdit) {
    const { funnelSourceServiceRoleKey } = await getClientSecrets(createServiceRoleClient(), client.id)
    if (!client.funnel_source_url || !funnelSourceServiceRoleKey) {
      catalogError = 'Configure a fonte de dados do funil em Integrações para ver os produtos do LaunchOps.'
    } else {
      try {
        catalog = await fetchLaunchOpsProducts(
          createLaunchOpsClient({ url: client.funnel_source_url, serviceRoleKey: funnelSourceServiceRoleKey }),
          LOOKBACK_DAYS
        )
      } catch (err) {
        catalogError = `Não foi possível ler os produtos do LaunchOps: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }
  const catalogByName = new Map(catalog.map((product) => [product.produto_nome, product]))
  const classified = new Set(products.map((product) => product.produto_nome))
  const unclassified = catalog.filter((product) => !classified.has(product.produto_nome))

  const base = `/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}`
  const context = { client_slug: client.slug, funnel_slug: funnel.slug, sales_funnel_id: funnel.id }

  function roleSelect(defaultValue: ProductRole) {
    return (
      <select name="papel" defaultValue={defaultValue} className={fieldClass} aria-label="Papel do produto">
        {PRODUCT_ROLES.map((role) => (
          <option key={role} value={role}>
            {PRODUCT_ROLE_LABEL[role]}
          </option>
        ))}
      </select>
    )
  }

  function salesCell(name: string) {
    const product = catalogByName.get(name)
    if (!product) return <span className="text-[var(--ct-text-3)]">sem vendas</span>
    return `${product.vendas} · ${currency(product.ticket)}`
  }

  return (
    <div className="flex max-w-[1180px] flex-col gap-8 px-14 pb-24 pt-12">
      <div>
        <Link href={base} className="text-xs text-[var(--ct-text-3)] hover:text-[var(--ct-text)]">
          ‹ {funnel.name}
        </Link>
        <h1 className="mt-2.5 text-[30px] font-semibold tracking-[-0.04em]">Produtos do projeto</h1>
        <p className="mt-2 max-w-[70ch] text-sm text-[var(--ct-text-2)]">
          Só as vendas dos produtos desta lista entram no projeto. O papel define a conta: o CPA divide o investimento
          pelas vendas de <strong>entrada</strong>; faturamento e ROAS front somam entrada, order bump e upsell; a{' '}
          <strong>ascensão</strong> tem um ROAS próprio, ao lado. Um produto listado em mais de um projeto vai para o projeto do anúncio da
          venda. Tirar um produto não apaga vendas: elas passam para outro projeto que tenha o produto ou ficam sem atribuição.
        </p>
      </div>

      {unattributed.length > 0 && (
        <p className="rounded-[10px] bg-[var(--ct-warn-soft)] px-4 py-3 text-[13px] text-[var(--ct-warn)]">
          {unattributed.length.toLocaleString('pt-BR')} {unattributed.length === 1 ? 'venda' : 'vendas'} deste cliente nos últimos {LOOKBACK_DAYS} dias
          {' '}estão sem projeto ({currency(unattributedRevenue)}): {unattributedProducts.slice(0, 4).join(', ')}
          {unattributedProducts.length > 4 ? '…' : ''}. Acontece quando o produto está em mais de um projeto e a venda não traz o anúncio, ou
          quando nenhum projeto lista o produto.
        </p>
      )}

      {ok && (
        <p role="status" className="rounded-[10px] bg-[var(--ct-an-soft)] px-4 py-3 text-[13px] text-[var(--ct-an)]">
          {ok}
        </p>
      )}
      {erro && (
        <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">
          {erro}
        </p>
      )}

      <section className="rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)]">
        <h2 className="border-b border-[var(--ct-line)] px-[22px] py-4 text-sm font-semibold">No projeto</h2>
        {products.length === 0 ? (
          <p className="px-[22px] py-5 text-sm text-[var(--ct-text-2)]">Nenhum produto ainda. Adicione abaixo, a partir do LaunchOps.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-xs text-[var(--ct-text-3)]">
                <th className="px-[22px] py-2.5 font-medium">Produto</th>
                {canEdit && <th className="px-3 py-2.5 font-medium">Vendas {LOOKBACK_DAYS}d · ticket</th>}
                <th className="px-3 py-2.5 font-medium">Papel</th>
                <th className="px-[22px] py-2.5" />
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.produto_nome} className="border-t border-[var(--ct-line)]">
                  <td className="px-[22px] py-3">{product.produto_nome}</td>
                  {canEdit && <td className={`${mono} px-3 py-3`}>{salesCell(product.produto_nome)}</td>}
                  <td className="px-3 py-3">
                    {canEdit ? (
                      <form action={setProductRole.bind(null, context)} className="flex items-center gap-2">
                        <input type="hidden" name="produto_nome" value={product.produto_nome} />
                        {roleSelect(product.papel)}
                        <button type="submit" className={buttonClass}>
                          Salvar
                        </button>
                      </form>
                    ) : (
                      <span>
                        {PRODUCT_ROLE_LABEL[product.papel]} <span className="text-[var(--ct-text-3)]">· {PRODUCT_ROLE_HINT[product.papel]}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-[22px] py-3 text-right">
                    {canEdit && (
                      <ConfirmDeleteButton
                        action={removeProduct.bind(null, { ...context, produto_nome: product.produto_nome })}
                        label="Remover"
                        warning="Tirar o produto deste projeto? As vendas dele ficam guardadas: vão para outro projeto que tenha o produto ou ficam sem atribuição."
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {canEdit && (
        <section className="rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)]">
          <h2 className="border-b border-[var(--ct-line)] px-[22px] py-4 text-sm font-semibold">
            Outros produtos vendidos no LaunchOps · últimos {LOOKBACK_DAYS} dias
          </h2>
          {catalogError ? (
            <p role="alert" className="px-[22px] py-5 text-sm text-[var(--ct-crit)]">
              {catalogError}
            </p>
          ) : unclassified.length === 0 ? (
            <p className="px-[22px] py-5 text-sm text-[var(--ct-text-2)]">Todos os produtos com venda no período já estão no projeto.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-xs text-[var(--ct-text-3)]">
                  <th className="px-[22px] py-2.5 font-medium">Produto</th>
                  <th className="px-3 py-2.5 font-medium">Plataforma</th>
                  <th className="px-3 py-2.5 font-medium">Vendas · ticket</th>
                  <th className="px-[22px] py-2.5 font-medium">Adicionar como</th>
                </tr>
              </thead>
              <tbody>
                {unclassified.map((product) => (
                  <tr key={product.produto_nome} className="border-t border-[var(--ct-line)]">
                    <td className="px-[22px] py-3">{product.produto_nome}</td>
                    <td className="px-3 py-3 text-[var(--ct-text-2)]">{product.plataformas.join(', ')}</td>
                    <td className={`${mono} px-3 py-3`}>
                      {product.vendas} · {currency(product.ticket)}
                    </td>
                    <td className="px-[22px] py-3">
                      <form action={setProductRole.bind(null, context)} className="flex items-center gap-2">
                        <input type="hidden" name="produto_nome" value={product.produto_nome} />
                        {roleSelect('entrada')}
                        <button type="submit" className={buttonClass}>
                          Adicionar
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  )
}
