import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getAlerts, getWatchers } from '@/lib/repo/watchers-repo'
import { METRICS, formatMetric, watcherScope } from '@/lib/domain/watchers'
import { WatcherTrail, type TrailPoint } from './watcher-trail'
import { WatcherStatusPill } from '@/components/watcher-status'

const mono = 'font-[family-name:var(--font-geist-mono)]'
const when = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const dayBr = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`

export default async function PainelPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase.from('clients').select('id, name, slug').eq('slug', clientSlug).maybeSingle()
  if (!client) notFound()

  const [watchers, alerts] = await Promise.all([getWatchers(supabase, client.id), getAlerts(supabase, client.id)])
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
    <div className="flex max-w-[1240px] flex-col gap-9 px-14 pb-24 pt-12">
      <div className="flex flex-wrap items-end gap-4 border-b border-[var(--ct-line)] pb-7">
        <div>
          <span className="flex items-center gap-2.5">
            <span className={`${mono} rounded-full bg-[var(--ct-accent-soft)] px-2 py-0.5 text-[10.5px] text-[var(--ct-painel)]`}>Ferramenta</span>
            <span className={`${mono} text-[10.5px] uppercase tracking-[0.08em] text-[var(--ct-text-3)]`}>
              {lastDay ? `último dia fechado ${dayBr(lastDay)}` : 'nenhuma avaliação ainda'}
            </span>
          </span>
          <h1 className="mt-2.5 text-[34px] font-semibold tracking-[-0.045em]">Painel de Controle</h1>
          <p className="mt-2 max-w-[62ch] text-sm text-[var(--ct-text-2)]">
            Os vigias de cada projeto da {client.name}. O aviso abre quando o número sai da faixa e fecha sozinho quando volta.
          </p>
        </div>
        <Link href={`${base}/metas`} className="ml-auto rounded-full border border-[var(--ct-line-2)] px-4 py-2 text-[13px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]">
          Metas e alvos
        </Link>
      </div>

      <section className="flex flex-col gap-4">
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
                  <span className={`${mono} grid h-7 w-7 place-items-center rounded-lg text-xs ${alert.severity === 'crit' ? 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]' : 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]'}`}>
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
                  </div>
                  <span className={`${mono} whitespace-nowrap text-[11px] text-[var(--ct-text-3)]`}>aberto {when(alert.openedAt)}</span>
                </div>
              )
            })}
        </div>
      </section>

      <section className="flex flex-col gap-4">
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

      {closed.length > 0 && (
        <section className="flex flex-col gap-4">
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
