import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { getWatchers } from '@/lib/repo/watchers-repo'
import { METRICS, decimalInput, formatMetric, thresholds, watcherSource, type WatcherMetric } from '@/lib/domain/watchers'
import type { Watcher } from '@/lib/repo/watchers-repo'
import { WatcherStatusPill } from '@/components/watcher-status'
import { createWatcher, deleteWatcher, evaluateNow, toggleWatcher, updateWatcher } from './actions'
import { ScopeMetricFields } from './scope-metric-fields'
import { canActAs } from '@/lib/view-as'
import { PageHeader } from '@/components/page-header'
import { headerAction } from '@/components/header-actions'
import { resultUsesSales } from '@/lib/domain/project-plan'

const mono = 'font-[family-name:var(--font-geist-mono)]'
const field =
  'rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'
const formGrid = 'grid gap-4 md:grid-cols-3 xl:grid-cols-7'

// Target, band and minimum spend: the same inputs to create a watcher and to edit one.
function NumberFields({ watcher, focus = false }: { watcher?: Watcher; focus?: boolean }) {
  return (
    <>
      <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
        Meta
        <input name="target" required inputMode="decimal" placeholder="55,00 ou 75" autoFocus={focus} defaultValue={watcher && decimalInput(watcher.target)} className={`${field} ${mono}`} />
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
        Atenção / crítico (%)
        <span className="flex gap-2">
          <input name="warn_pct" inputMode="decimal" placeholder="20" defaultValue={watcher && decimalInput(watcher.warnPct)} className={`${field} ${mono} w-full`} aria-label="Atenção a partir de, em %" />
          <input name="crit_pct" inputMode="decimal" placeholder="40" defaultValue={watcher && decimalInput(watcher.critPct)} className={`${field} ${mono} w-full`} aria-label="Crítico a partir de, em %" />
        </span>
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
        Gasto mínimo no dia
        <input name="min_spend" inputMode="decimal" placeholder="300" defaultValue={watcher && decimalInput(watcher.minSpend)} className={`${field} ${mono}`} />
      </label>
    </>
  )
}

export default async function MetasPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>
  searchParams: Promise<{ ok?: string; erro?: string; editar?: string }>
}) {
  const { clientSlug } = await params
  const { ok, erro, editar } = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()
  // Configuration is internal to the agency: the client never reads it, even by typing the address.
  if (!(await canActAs(supabase, client.id, 'analista'))) notFound()

  const [allWatchers, { data: funnels }, { data: fronts }, { data: canEdit }] = await Promise.all([
    getWatchers(supabase, client.id),
    supabase.from('sales_funnels').select('id, name, slug, resultado').eq('client_id', client.id).is('archived_at', null).order('name'),
    supabase.from('project_fronts').select('id, name, sales_funnel_id, naming_rules(kind, value), sales_funnels!project_fronts_sales_funnel_id_fkey!inner(client_id)').eq('sales_funnels.client_id', client.id).is('archived_at', null).order('position'),
    canActAs(supabase, client.id, 'gestor').then((data) => ({ data })),
  ])
  // Watchers of archived projects or fronts are not evaluated (0100): listed apart, read-only.
  const watchers = allWatchers.filter((watcher) => !watcher.archived)
  const archivedWatchers = allWatchers.filter((watcher) => watcher.archived)
  const context = { client_id: client.id as string, client_slug: client.slug as string }
  const ruleLabel = (front: { naming_rules: { kind: string; value: string }[] | null }) =>
    (front.naming_rules ?? []).filter((rule) => rule.kind === 'include').map((rule) => rule.value).join(' + ')
  const metasHref = `/dashboard/clients/${client.slug}/metas`
  const projectOptions = (funnels ?? []).map((funnel) => ({
    funnelId: funnel.id as string,
    funnelName: funnel.name as string,
    rulesHref: `/dashboard/clients/${client.slug}/funis-venda/${funnel.slug}/regras`,
    resultado: resultUsesSales(funnel.resultado) ? ('compra' as const) : ('lead' as const),
    fronts: (fronts ?? [])
      .filter((front) => front.sales_funnel_id === funnel.id)
      .map((front) => ({ id: front.id as string, name: front.name as string, rule: ruleLabel(front) })),
  }))
  const metricOptions = (Object.keys(METRICS) as WatcherMetric[]).map((metric) => ({
    value: metric,
    label: METRICS[metric].label,
    projectOnly: METRICS[metric].projectOnly,
    salesOnly: METRICS[metric].salesOnly,
  }))
  // A plan or front watcher keeps the metric its source names; the link goes where that is set.
  const sourceLink = (watcher: Watcher) => {
    const project = `/dashboard/clients/${client.slug}/funis-venda/${watcher.projectSlug}`
    return watcherSource(watcher) === 'plano'
      ? { href: `${project}/plano`, label: 'métrica de Resultado e meta', edit: 'mudar em Resultado e meta' }
      : { href: `${project}/regras`, label: 'métrica da frente', edit: 'mudar na frente' }
  }

  return (
    <div className="flex max-w-[1240px] flex-col gap-9 px-4 md:px-14 pb-24 pt-12">
      <PageHeader
        title="Metas e vigias"
        note="Cada vigia é uma métrica de um funil, com a meta que você aceita. As campanhas são as das Frentes e etiquetas, as mesmas das Análises; a frente é um recorte opcional. A cada sincronização ele olha o último dia fechado e abre um alerta em Alertas quando sai da faixa; o alerta fecha sozinho quando o número volta."
        actions={
          canEdit && (
            <form action={evaluateNow.bind(null, context)}>
              <button type="submit" className={headerAction}>
                Avaliar agora
              </button>
            </form>
          )
        }
      />

      {ok && <p role="status" className="rounded-[10px] bg-[var(--ct-ok-soft)] px-4 py-3 text-[13px] text-[var(--ct-ok)]">{ok}</p>}
      {erro && <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">{erro}</p>}

      <div className="card-shadow overflow-x-auto rounded-[18px] border border-[var(--ct-line)]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className={`${mono} text-left text-[10.5px] uppercase tracking-[0.06em] text-[var(--ct-text-3)]`}>
              {['Métrica', 'Aplica em', 'Ruim quando', 'Meta', 'Atenção a partir de', 'Crítico a partir de', 'Gasto mínimo', 'Último dia fechado', ''].map((head, i) => (
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
              const managed = watcherSource(watcher) !== 'livre'
              if (canEdit && editar === watcher.id) {
                const link = sourceLink(watcher)
                return (
                  <tr key={watcher.id} className="border-t border-[var(--ct-line)] bg-[var(--ct-surface-2)]">
                    <td colSpan={9} className="px-5 py-4">
                      <form action={updateWatcher.bind(null, { ...context, watcher_id: watcher.id })} aria-label={`Editar vigia de ${METRICS[watcher.metric].label}`} className={formGrid}>
                        {managed ? (
                          <p className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)] md:col-span-3 xl:col-span-4">
                            Métrica
                            <span className="text-[13px] text-[var(--ct-text)]">
                              {METRICS[watcher.metric].label} · {watcher.projectName}
                              {watcher.frontName ? ` · frente ${watcher.frontName}` : ''}
                            </span>
                            <span className="text-[11px]">
                              É a {link.label}: a meta salva aqui vale lá também. Para trocar a métrica,{' '}
                              <Link href={link.href} className="text-[var(--ct-accent)] hover:underline">
                                {link.edit}
                              </Link>
                              .
                            </span>
                          </p>
                        ) : (
                          <ScopeMetricFields
                            fieldClass={field}
                            projects={projectOptions}
                            metrics={metricOptions}
                            initial={{ funnelId: watcher.funnelId, frontId: watcher.frontId ?? '', metric: watcher.metric }}
                          />
                        )}
                        <NumberFields watcher={watcher} focus />
                        <div className="flex items-center justify-end gap-4 md:col-span-3 xl:col-span-7">
                          <p className="mr-auto max-w-[70ch] text-xs text-[var(--ct-text-3)]">Ao salvar, o vigia é julgado de novo no último dia fechado com o meta nova; um alerta que deixou de valer fecha.</p>
                          <Link href={metasHref} className="text-xs text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
                            cancelar
                          </Link>
                          <button type="submit" className="rounded-full bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)]">
                            Salvar vigia
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )
              }
              return (
                <tr key={watcher.id} className={`border-t border-[var(--ct-line)] ${watcher.isActive ? '' : 'opacity-50'}`}>
                  <td className="px-5 py-3">
                    <b className="font-semibold">{METRICS[watcher.metric].label}</b>
                    <span className="block text-[11.5px] text-[var(--ct-text-3)]">{METRICS[watcher.metric].hint}</span>
                    {managed && <span className="block text-[11.5px] text-[var(--ct-text-3)]">{sourceLink(watcher).label}</span>}
                  </td>
                  <td className="px-5 py-3">
                    {watcher.projectName}
                    <span className="block text-[11.5px] text-[var(--ct-text-3)]">
                      {watcher.frontName ? `frente ${watcher.frontName} · só mídia` : 'todas as frentes · investimento + vendas'}
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
                        <Link href={`${metasHref}?editar=${watcher.id}`} className="text-xs text-[var(--ct-text-2)] hover:text-[var(--ct-text)]" aria-label={`Editar vigia de ${METRICS[watcher.metric].label}`}>
                          editar
                        </Link>
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

      {archivedWatchers.length > 0 && (
        <details className="-mt-5">
          <summary className="cursor-pointer text-[12.5px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
            Vigias de funis/frentes arquivados ({archivedWatchers.length})
          </summary>
          <p className="mt-2 text-[12px] text-[var(--ct-text-3)]">Não são avaliados enquanto o funil ou a frente estiver arquivado. Restaure para voltar a mexer neles.</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {archivedWatchers.map((watcher) => (
              <li key={watcher.id} className="flex flex-wrap items-baseline gap-x-3 text-[12.5px] text-[var(--ct-text-2)]">
                <b className="font-semibold text-[var(--ct-text)]">{METRICS[watcher.metric].label}</b>
                <span>
                  {watcher.projectName}
                  {watcher.frontName ? ` · frente ${watcher.frontName}` : ''}
                </span>
                <span className={mono}>meta {formatMetric(watcher.metric, watcher.target)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {canEdit && (
        <form action={createWatcher.bind(null, context)} className={`card-shadow ${formGrid} rounded-[18px] border border-dashed border-[var(--ct-line-2)] px-6 py-5`}>
          <ScopeMetricFields fieldClass={field} projects={projectOptions} metrics={metricOptions} />
          <NumberFields />
          <div className="flex items-end md:col-span-3 xl:col-span-7">
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
