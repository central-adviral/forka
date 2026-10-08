import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getAlerts, getWatchers } from '@/lib/repo/watchers-repo'
import { METRICS, alertActions, formatMetric, watcherScope } from '@/lib/domain/watchers'
import { WatcherTrail, type TrailPoint } from './watcher-trail'
import { getPagesWithChecks } from '@/lib/repo/pages-repo'
import { PAGE_SLOW_MS, isOutage, pageHealth, type PageHealth } from '@/lib/domain/page-probe'
import { canActAs } from '@/lib/view-as'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { addPage, checkPagesNow, removePage } from './actions'
import { WatcherStatusPill } from '@/components/watcher-status'
import { headerAction } from '@/components/header-actions'

const mono = 'font-[family-name:var(--font-geist-mono)]'
const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const dayBr = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`

const HEALTH: Record<PageHealth, { label: string; tone: string }> = {
  ok: { label: 'no ar', tone: 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]' },
  lenta: { label: 'lenta', tone: 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]' },
  fora: { label: 'fora do ar', tone: 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]' },
  sem_check: { label: 'ainda não checada', tone: 'bg-[var(--ct-surface-3)] text-[var(--ct-text-2)]' },
}
const field =
  'rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'

export default async function PainelPage({
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

  const [watchers, alerts, pages, canEdit] = await Promise.all([
    getWatchers(supabase, client.id),
    getAlerts(supabase, client.id),
    getPagesWithChecks(supabase, client.id),
    canActAs(supabase, client.id, 'gestor'),
  ])
  const pageContext = { client_id: client.id as string, client_slug: client.slug as string }
  // The last 14 closed days of every active watcher, from the same function the alerts use (0065).
  const TRAIL_DAYS = 14
  const trails = await Promise.all(
    watchers.map((watcher) =>
      watcher.isActive ? supabase.rpc('watcher_series', { p_watcher_id: watcher.id, p_days: TRAIL_DAYS }) : Promise.resolve({ data: null })
    )
  )
  const trailById = new Map(
    watchers.map((watcher, index) => [
      watcher.id,
      ((trails[index].data ?? []) as { day: string; value: number | null; status: TrailPoint['status'] }[]).map((point) => ({
        day: point.day,
        value: point.value === null ? null : Number(point.value),
        status: point.status,
      })),
    ])
  )
  const watcherById = new Map(watchers.map((watcher) => [watcher.id, watcher]))
  const open = alerts.filter((alert) => !alert.closedAt)
  const closed = alerts.filter((alert) => alert.closedAt)
  const byProject = new Map<string, typeof watchers>()
  for (const watcher of watchers) byProject.set(watcher.projectName, [...(byProject.get(watcher.projectName) ?? []), watcher])
  const base = `/dashboard/clients/${client.slug}`
  const lastDay = watchers.find((watcher) => watcher.lastDay)?.lastDay

  return (
    <div className="flex max-w-[1240px] flex-col gap-9 px-4 md:px-14 pb-24 pt-12">
      <PageHeader
        title="Painel de Controle"
        note={`${lastDay ? `Último dia fechado ${dayBr(lastDay)}` : 'Nenhuma avaliação ainda'}. O aviso abre quando o número sai da faixa e fecha sozinho quando volta.`}
        actions={
          <Link href={`${base}/metas`} className={headerAction}>
            Metas e alvos
          </Link>
        }
      />

      <section id="atencao" className="flex flex-col gap-4 scroll-mt-6">
        <header>
          <h2 className="text-[19px] font-semibold">Precisa da sua atenção</h2>
          <p className="mt-1 text-[13px] text-[var(--ct-text-3)]">Alertas abertos agora, do pior para o mais leve.</p>
        </header>
        <div className="card-shadow rounded-[18px] border border-[var(--ct-line)]">
          {open.length === 0 && <p className="px-6 py-5 text-[13.5px] text-[var(--ct-text-2)]">Nenhum vigia fora da faixa no último dia fechado.</p>}
          {[...open]
            .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'crit' ? -1 : 1))
            .map((alert) => {
              const watcher = watcherById.get(alert.watcherId)
              if (!watcher) return null
              return (
                <div key={alert.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-4 border-b border-[var(--ct-line)] px-6 py-5 last:border-b-0">
                  <span aria-hidden="true" className={`${mono} grid h-7 w-7 place-items-center rounded-lg text-xs ${alert.severity === 'crit' ? 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]' : 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]'}`}>
                    {alert.severity === 'crit' ? '!' : '▲'}
                  </span>
                  <div className="min-w-0">
                    <b className="text-[14px] font-semibold">
                      {watcher.projectName} · {watcherScope(watcher)} · {METRICS[watcher.metric].label} {alert.severity === 'crit' ? 'crítico' : 'em atenção'}
                    </b>
                    <p className="mt-1 text-[12.5px] text-[var(--ct-text-2)]">
                      <span className={mono}>{formatMetric(watcher.metric, alert.value)}</span> contra alvo de{' '}
                      <span className={mono}>{formatMetric(watcher.metric, watcher.target)}</span> em {dayBr(alert.day)}.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {alertActions(watcher, `/dashboard/clients/${client.slug}`, canEdit).map((action, index) => (
                        <Link
                          key={action.label}
                          href={action.href}
                          className={
                            index === 0
                              ? 'rounded-[9px] bg-[var(--ct-accent)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110'
                              : 'rounded-[9px] border border-[var(--ct-line-2)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]'
                          }
                        >
                          {action.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                  <span className={`${mono} whitespace-nowrap text-[11px] text-[var(--ct-text-3)]`}>aberto {when(alert.openedAt)}</span>
                </div>
              )
            })}
        </div>
      </section>

      <section id="vigias" className="flex flex-col gap-4 scroll-mt-6">
        <header>
          <h2 className="text-[19px] font-semibold">Vigias por projeto</h2>
          <p className="mt-1 text-[13px] text-[var(--ct-text-3)]">Cada vigia cuida de uma métrica num recorte, com alvo próprio.</p>
        </header>
        {watchers.length === 0 && (
          <p className="rounded-[18px] border border-dashed border-[var(--ct-line-2)] p-6 text-sm text-[var(--ct-text-2)]">
            Nenhum vigia ainda. Crie em <Link href={`${base}/metas`} className="text-[var(--ct-accent)]">Metas e alvos</Link>.
          </p>
        )}
        {[...byProject.entries()].map(([project, list]) => (
          <div key={project} className="card-shadow rounded-[18px] border border-[var(--ct-line)]">
            <div className="flex items-center justify-between border-b border-[var(--ct-line)] px-6 py-3.5">
              <b className="text-[14.5px] font-semibold">{project}</b>
              <Link href={`${base}/funis-venda/${list[0].projectSlug}`} className="text-[12.5px] text-[var(--ct-accent)]">Análises →</Link>
            </div>
            {list.map((watcher) => (
              <div key={watcher.id} className={`grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-5 border-b border-[var(--ct-line)] px-6 py-4 last:border-b-0 ${watcher.isActive ? '' : 'opacity-50'}`}>
                <div className="min-w-0">
                  <strong className="block text-[13.5px] font-semibold">
                    {METRICS[watcher.metric].label} · {watcherScope(watcher)}
                  </strong>
                  <span className="block text-xs text-[var(--ct-text-3)]">{METRICS[watcher.metric].hint}</span>
                </div>
                {watcher.isActive ? (
                  <WatcherTrail points={trailById.get(watcher.id) ?? []} metric={watcher.metric} target={watcher.target} warnPct={watcher.warnPct} critPct={watcher.critPct} />
                ) : (
                  <span />
                )}
                <div className="text-right text-[11px] text-[var(--ct-text-3)]">
                  <b className={`${mono} block text-[15px] font-medium text-[var(--ct-text)]`}>{formatMetric(watcher.metric, watcher.lastValue)}</b>
                  alvo {formatMetric(watcher.metric, watcher.target)}
                </div>
                {watcher.lastStatus ? <WatcherStatusPill status={watcher.isActive ? watcher.lastStatus : 'sem_dado'} /> : <span className="text-xs text-[var(--ct-text-3)]">não avaliado</span>}
              </div>
            ))}
          </div>
        ))}
      </section>

      <section id="paginas" className="flex flex-col gap-4 scroll-mt-6">
        <header className="flex flex-wrap items-end gap-3">
          <div>
            <h2 className="text-[19px] font-semibold">Páginas</h2>
            <p className="mt-1 text-[13px] text-[var(--ct-text-3)]">
              A sonda abre cada página a cada sincronização. Fora do ar duas vezes seguidas vira alerta crítico; acima de {PAGE_SLOW_MS / 1000}s para responder, atenção.
            </p>
          </div>
          {canEdit && pages.length > 0 && (
            <form action={checkPagesNow.bind(null, pageContext)} className="ml-auto">
              <button type="submit" className="rounded-full border border-[var(--ct-line-2)] px-4 py-2 text-[13px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
                Checar agora
              </button>
            </form>
          )}
        </header>
        {ok && <p role="status" className="rounded-[10px] bg-[var(--ct-ok-soft)] px-4 py-3 text-[13px] text-[var(--ct-ok)]">{ok}</p>}
        {erro && <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-3 text-[13px] text-[var(--ct-crit)]">{erro}</p>}
        <div className="card-shadow rounded-[18px] border border-[var(--ct-line)]">
          {pages.length === 0 && <p className="px-6 py-5 text-[13.5px] text-[var(--ct-text-2)]">Nenhuma página na sonda ainda.</p>}
          {pages.map((page) => {
            const health = pageHealth(page.checks)
            const last = page.checks[0]
            return (
              <div key={page.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-5 border-b border-[var(--ct-line)] px-6 py-4 last:border-b-0">
                <div className="min-w-0">
                  <strong className="block text-[13.5px] font-semibold">{page.label}</strong>
                  <a href={page.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-[var(--ct-text-3)] hover:text-[var(--ct-accent)]">
                    {page.url}
                  </a>
                </div>
                <div className="flex items-center gap-1" aria-label="Últimas checagens, da mais antiga para a mais nova">
                  {[...page.checks].reverse().map((check) => (
                    <span
                      key={check.checkedAt}
                      title={`${when(check.checkedAt)} · ${check.ok ? `${check.ttfbMs ?? '—'} ms` : check.error ?? 'falhou'}`}
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: !check.ok ? 'var(--ct-crit)' : (check.ttfbMs ?? 0) > PAGE_SLOW_MS ? 'var(--ct-warn)' : 'var(--ct-ok)' }}
                    />
                  ))}
                </div>
                <div className="text-right text-[11px] text-[var(--ct-text-3)]">
                  <b className={`${mono} block text-[14px] font-medium text-[var(--ct-text)]`}>{last?.ok && last.ttfbMs !== null ? `${(last.ttfbMs / 1000).toFixed(1).replace('.', ',')}s` : '—'}</b>
                  {last ? when(last.checkedAt) : 'nunca'}
                </div>
                <span className="flex items-center gap-3">
                  <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${HEALTH[health].tone}`}>
                    {isOutage(page.checks) ? 'fora do ar (2x)' : HEALTH[health].label}
                  </span>
                  {canEdit && (
                    <ConfirmDeleteButton action={removePage.bind(null, { ...pageContext, page_id: page.id })} label="remover" warning="Tirar a página da sonda?" />
                  )}
                </span>
              </div>
            )
          })}
        </div>
        {canEdit && (
          <form action={addPage.bind(null, pageContext)} className="card-shadow flex flex-wrap items-end gap-3 rounded-[18px] border border-dashed border-[var(--ct-line-2)] px-6 py-5">
            <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
              Nome
              <input name="label" required maxLength={60} placeholder="ex.: Página de vendas 1K" className={field} />
            </label>
            <label className="flex min-w-[280px] flex-1 flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
              Endereço (https)
              <input name="url" required type="url" placeholder="https://..." className={field} />
            </label>
            <button type="submit" className="rounded-full bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)]">
              + Página na sonda
            </button>
          </form>
        )}
      </section>

      {closed.length > 0 && (
        <section id="historico" className="flex flex-col gap-4 scroll-mt-6">
          <header>
            <h2 className="text-[19px] font-semibold">Histórico</h2>
            <p className="mt-1 text-[13px] text-[var(--ct-text-3)]">Alertas que já fecharam: quando abriu, quando voltou para a faixa.</p>
          </header>
          <div className="card-shadow overflow-x-auto rounded-[18px] border border-[var(--ct-line)]">
            <table className="w-full text-[13px]">
              <tbody>
                {closed.map((alert) => {
                  const watcher = watcherById.get(alert.watcherId)
                  if (!watcher) return null
                  return (
                    <tr key={alert.id} className="border-t border-[var(--ct-line)] first:border-t-0">
                      <td className="px-6 py-3">{watcher.projectName} · {watcherScope(watcher)} · {METRICS[watcher.metric].label}</td>
                      <td className={`${mono} px-6 py-3 text-right`}>{formatMetric(watcher.metric, alert.value)}</td>
                      <td className={`${mono} whitespace-nowrap px-6 py-3 text-right text-[var(--ct-text-3)]`}>
                        {when(alert.openedAt)} → {when(alert.closedAt!)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
