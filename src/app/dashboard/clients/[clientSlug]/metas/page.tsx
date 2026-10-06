import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { getWatchers } from '@/lib/repo/watchers-repo'
import { METRICS, formatMetric, thresholds, type WatcherMetric } from '@/lib/domain/watchers'
import { WatcherStatusPill } from '@/components/watcher-status'
import { createWatcher, deleteWatcher, evaluateNow, toggleWatcher } from './actions'

const mono = 'font-[family-name:var(--font-geist-mono)]'
const field =
  'rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'

export default async function MetasPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>
  searchParams: Promise<{ ok?: string; erro?: string }>
}) {
  const { clientSlug } = await params
  const { ok, erro } = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const [watchers, { data: funnels }, { data: fronts }, { data: canEdit }] = await Promise.all([
    getWatchers(supabase, client.id),
    supabase.from('sales_funnels').select('id, name').eq('client_id', client.id).order('name'),
    supabase.from('project_fronts').select('id, name, sales_funnel_id, naming_rules(kind, value), sales_funnels!project_fronts_sales_funnel_id_fkey!inner(client_id)').eq('sales_funnels.client_id', client.id).order('position'),
    supabase.rpc('has_client_role', { p_client_id: client.id, p_min_role: 'gestor' }),
  ])
  const context = { client_id: client.id as string, client_slug: client.slug as string }
  const ruleLabel = (front: { naming_rules: { kind: string; value: string }[] | null }) =>
    (front.naming_rules ?? []).filter((rule) => rule.kind === 'include').map((rule) => rule.value).join(' + ')

  return (
    <div className="flex max-w-[1240px] flex-col gap-9 px-14 pb-24 pt-12">
      <div className="flex flex-wrap items-end gap-4 border-b border-[var(--ct-line)] pb-7">
        <div>
          <span className={`${mono} text-[10.5px] uppercase tracking-[0.08em] text-[var(--ct-text-3)]`}>Configurar · {client.name}</span>
          <h1 className="mt-2.5 text-[34px] font-semibold tracking-[-0.045em]">Metas e alvos</h1>
          <p className="mt-2 max-w-[66ch] text-sm text-[var(--ct-text-2)]">
            Cada linha é um vigia: uma métrica num projeto ou numa frente, com o alvo que você aceita. A cada sincronização ele
            olha o último dia fechado (hoje ainda é parcial) e abre um alerta no Painel de Controle quando sai da faixa. O alerta
            fecha sozinho quando o número volta.
          </p>
        </div>
        {canEdit && (
          <form action={evaluateNow.bind(null, context)} className="ml-auto">
            <button type="submit" className="rounded-full border border-[var(--ct-line-2)] px-4 py-2 text-[13px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
              Avaliar agora
            </button>
          </form>
        )}
      </div>

      {ok && <p role="status" className="rounded-[10px] bg-[var(--ct-ok-soft)] px-4 py-3 text-[13px] text-[var(--ct-ok)]">{ok}</p>}
      {erro && <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">{erro}</p>}

      <div className="card-shadow overflow-x-auto rounded-[18px] border border-[var(--ct-line)]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className={`${mono} text-left text-[10.5px] uppercase tracking-[0.06em] text-[var(--ct-text-3)]`}>
              {['Métrica', 'Aplica em', 'Ruim quando', 'Alvo', 'Atenção a partir de', 'Crítico a partir de', 'Gasto mínimo', 'Último dia fechado', ''].map((head, i) => (
                <th key={head + i} className={`px-5 py-3 font-medium ${i >= 3 && i <= 7 ? 'text-right' : ''}`}>{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {watchers.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-5 text-[var(--ct-text-2)]">Nenhum vigia ainda. Crie o primeiro abaixo, por exemplo o CPA geral do perpétuo.</td>
              </tr>
            )}
            {watchers.map((watcher) => {
              const band = thresholds(watcher.metric, watcher.target, watcher.warnPct, watcher.critPct)
              return (
                <tr key={watcher.id} className={`border-t border-[var(--ct-line)] ${watcher.isActive ? '' : 'opacity-50'}`}>
                  <td className="px-5 py-3">
                    <b className="font-semibold">{METRICS[watcher.metric].label}</b>
                    <span className="block text-[11.5px] text-[var(--ct-text-3)]">{METRICS[watcher.metric].hint}</span>
                  </td>
                  <td className="px-5 py-3">
                    {watcher.projectName}
                    <span className="block text-[11.5px] text-[var(--ct-text-3)]">
                      {watcher.frontName ? `frente ${watcher.frontName} · só mídia` : 'projeto inteiro · todas as frentes + vendas'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-[var(--ct-text-2)]">{METRICS[watcher.metric].bad}</td>
                  <td className={`${mono} px-5 py-3 text-right`}>{formatMetric(watcher.metric, watcher.target)}</td>
                  <td className={`${mono} px-5 py-3 text-right text-[var(--ct-warn)]`}>{formatMetric(watcher.metric, band.warn)}</td>
                  <td className={`${mono} px-5 py-3 text-right text-[var(--ct-crit)]`}>{formatMetric(watcher.metric, band.crit)}</td>
                  <td className={`${mono} px-5 py-3 text-right`}>{watcher.minSpend > 0 ? formatMetric('investimento', watcher.minSpend) : '—'}</td>
                  <td className="px-5 py-3 text-right">
                    {watcher.lastStatus ? (
                      <span className="flex items-center justify-end gap-2">
                        <span className={mono}>{formatMetric(watcher.metric, watcher.lastValue)}</span>
                        <WatcherStatusPill status={watcher.lastStatus} />
                      </span>
                    ) : (
                      <span className="text-[var(--ct-text-3)]">ainda não avaliado</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {canEdit && (
                      <span className="flex items-center justify-end gap-3">
                        <form action={toggleWatcher.bind(null, { ...context, watcher_id: watcher.id, is_active: !watcher.isActive })}>
                          <button type="submit" className="text-xs text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
                            {watcher.isActive ? 'pausar' : 'ligar'}
                          </button>
                        </form>
                        <ConfirmDeleteButton action={deleteWatcher.bind(null, { ...context, watcher_id: watcher.id })} label="remover" warning="Remover o vigia e os alertas?" />
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <form action={createWatcher.bind(null, context)} className="card-shadow grid gap-4 rounded-[18px] border border-dashed border-[var(--ct-line-2)] px-6 py-5 md:grid-cols-3 xl:grid-cols-6">
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)] xl:col-span-2">
            Aplica em
            <select name="scope" required defaultValue="" className={field}>
              <option value="" disabled>escolher projeto ou frente</option>
              {(funnels ?? []).map((funnel) => (
                <optgroup key={funnel.id} label={funnel.name}>
                  <option value={`${funnel.id}|`}>{funnel.name} inteiro · investimento + vendas (use para CPA)</option>
                  {(fronts ?? [])
                    .filter((front) => front.sales_funnel_id === funnel.id)
                    .map((front) => (
                      <option key={front.id} value={`${funnel.id}|${front.id}`}>
                        Frente {front.name} · só investimento{ruleLabel(front) ? ` das campanhas com ${ruleLabel(front)}` : ''}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="rounded-[12px] bg-[var(--ct-surface-2)] px-4 py-3 text-xs leading-relaxed text-[var(--ct-text-2)] md:col-span-3 xl:order-last xl:col-span-6">
            <b className="text-[var(--ct-text)]">Projeto inteiro x frente</b>
            <ul className="mt-1.5 flex flex-col gap-1">
              <li>
                <b className="text-[var(--ct-text)]">Projeto inteiro</b>: soma o investimento de <i>todas</i> as frentes do projeto e conta
                <i> todas</i> as vendas dos produtos dele, de qualquer origem (anúncio, bio, sem UTM). É o único lugar com vendas,
                então CPA geral e CPA de anúncio só existem aqui.
              </li>
              <li>
                <b className="text-[var(--ct-text)]">Frente</b>: só o investimento das campanhas que casam com a regra de nome da frente.
                Uma venda não diz de qual frente veio, por isso a frente não tem vendas e serve para métricas de mídia: CPM, CTR,
                connect rate, CPL e investimento.
              </li>
              {(funnels ?? []).map((funnel) => {
                const own = (fronts ?? []).filter((front) => front.sales_funnel_id === funnel.id)
                if (own.length !== 1) return null
                return (
                  <li key={funnel.id}>
                    Hoje o {funnel.name} tem uma frente só ({own[0].name}), então o investimento dos dois é o mesmo; a diferença é que
                    o {funnel.name} inteiro também tem as vendas.
                  </li>
                )
              })}
            </ul>
          </div>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Métrica
            <select name="metric" required className={field}>
              {(Object.keys(METRICS) as WatcherMetric[]).map((metric) => (
                <option key={metric} value={metric}>{METRICS[metric].label}{METRICS[metric].projectOnly ? ' (projeto)' : ''}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Alvo
            <input name="target" required inputMode="decimal" placeholder="55,00 ou 75" className={`${field} ${mono}`} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Atenção / crítico (%)
            <span className="flex gap-2">
              <input name="warn_pct" inputMode="decimal" placeholder="20" className={`${field} ${mono} w-full`} aria-label="Atenção a partir de, em %" />
              <input name="crit_pct" inputMode="decimal" placeholder="40" className={`${field} ${mono} w-full`} aria-label="Crítico a partir de, em %" />
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
            Gasto mínimo no dia
            <input name="min_spend" inputMode="decimal" placeholder="300" className={`${field} ${mono}`} />
          </label>
          <div className="flex items-end md:col-span-3 xl:col-span-6">
            <p className="mr-auto max-w-[70ch] text-xs text-[var(--ct-text-3)]">
              Custos (CPA, CPL, CPM) ficam ruins quando sobem; CTR, connect rate e investimento, quando caem. Abaixo do gasto
              mínimo o número balança sozinho e o vigia fica calado.
            </p>
            <button type="submit" className="rounded-full bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)]">
              + Novo vigia
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
