import Link from 'next/link'
import { ConfirmDeleteButton } from '@/components/confirm-delete-button'
import { CopyButton } from '@/components/copy-button'
import { checkFindings, seconds, type Finding, type LpvDay, type Outage, type PageCheck, type PageStatus } from '@/lib/domain/page-probe'
import type { ProbedPage } from '@/lib/repo/pages-repo'
import { checkPageNow, removePage, setPageActive, silencePage } from './actions'
import { currency, durationLabel, mono, timeOnly, when } from './format'

export interface PageView {
  page: ProbedPage
  status: PageStatus
  silenced: boolean
  findings: Finding[]
  project: { id: string; name: string; slug: string; spendToday: number; spendRecent: number; lpv: { average: number | null; days: LpvDay[] } } | null
  outages: Outage[]
  /** The outage going on now, when the page is critical. */
  currentOutage: Outage | null
  costSinceDown: number | null
  affectedTests: string[]
}

const STATUS: Record<PageStatus, { label: string; tone: string }> = {
  critico: { label: 'fora do ar', tone: 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]' },
  atencao: { label: 'atenção', tone: 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]' },
  sem_trafego: { label: 'no ar · sem tráfego', tone: 'bg-[var(--ct-surface-3)] text-[var(--ct-text-2)]' },
  ok: { label: 'no ar', tone: 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]' },
  sem_check: { label: 'ainda não checada', tone: 'bg-[var(--ct-surface-3)] text-[var(--ct-text-2)]' },
}

const button =
  'inline-flex min-h-11 items-center rounded-[10px] border border-[var(--ct-line-2)] px-3.5 text-[12.5px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]'
const primary = 'inline-flex min-h-11 items-center rounded-[10px] bg-[var(--ct-accent)] px-3.5 text-[12.5px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110'
const META_ADS_MANAGER = 'https://adsmanager.facebook.com/adsmanager/manage/campaigns'

function checkTone(check: PageCheck, page: ProbedPage, now: Date): string {
  if (!check.ok) return 'var(--ct-crit)'
  return checkFindings(check, page.watch, now).every((finding) => finding.ok) ? 'var(--ct-ok)' : 'var(--ct-warn)'
}

export function PageRow({
  view,
  base,
  context,
  canEdit,
  now,
}: {
  view: PageView
  base: string
  context: { client_id: string; client_slug: string }
  canEdit: boolean
  now: Date
}) {
  const { page, status, findings } = view
  const last = page.checks[0]
  const strip = page.checks.slice(0, 24).reverse()
  const passing = findings.filter((finding) => finding.ok).length
  const pageContext = { ...context, page_id: page.id }
  const pill = page.isActive ? STATUS[status] : { label: 'pausada', tone: 'bg-[var(--ct-surface-3)] text-[var(--ct-text-2)]' }

  return (
    <details id={`pagina-${page.id}`} open={status === 'critico' && page.isActive} className="group scroll-mt-6 border-b border-[var(--ct-line)] last:border-b-0">
      <summary className={`grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 px-6 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto_auto] ${page.isActive ? '' : 'opacity-60'}`}>
        <div className="min-w-0">
          <strong className="block text-[13.5px] font-semibold">{page.label}</strong>
          <span className="block truncate text-xs text-[var(--ct-text-3)]">{page.url}</span>
          <span className="mt-0.5 block text-[11.5px] text-[var(--ct-text-3)]">
            {view.project ? (
              <>
                {view.project.name} · <span className={mono}>{currency(view.project.spendToday)}</span> hoje
              </>
            ) : (
              'sem projeto ligado'
            )}
          </span>
        </div>
        <div className="order-last col-span-2 flex items-center gap-[3px] md:order-none md:col-span-1" aria-label={`Últimas ${strip.length} checagens, da mais antiga para a mais nova: ${strip.filter((check) => !check.ok).length} falharam`}>
          {strip.map((check) => (
            <span
              key={check.checkedAt}
              title={`${when(check.checkedAt)} · ${check.ok ? (check.ttfbMs !== null ? seconds(check.ttfbMs) : 'ok') : (check.error ?? 'falhou')}`}
              className="h-4 w-1.5 rounded-sm"
              style={{ background: checkTone(check, page, now) }}
            />
          ))}
          {strip.length === 0 && <span className="text-xs text-[var(--ct-text-3)]">sem checagens</span>}
        </div>
        <div className="hidden text-right text-[11px] text-[var(--ct-text-3)] md:block">
          <b className={`${mono} block text-[14px] font-medium text-[var(--ct-text)]`}>{last?.ok && last.ttfbMs !== null ? seconds(last.ttfbMs) : '—'}</b>
          servidor
        </div>
        <div className="hidden text-right text-[11px] text-[var(--ct-text-3)] md:block">
          <b className={`${mono} block text-[14px] font-medium text-[var(--ct-text)]`}>{findings.length > 0 ? `${passing}/${findings.length}` : '—'}</b>
          conferências ok
        </div>
        <span className="flex flex-col items-end gap-1">
          <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${pill.tone}`}>{pill.label}</span>
          {view.silenced && page.silencedUntil && <span className="text-[11px] text-[var(--ct-text-3)]">silenciada até {timeOnly(page.silencedUntil)}</span>}
        </span>
      </summary>

      <div className="flex flex-col gap-5 border-t border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-6 py-5">
        {status === 'critico' && page.isActive && view.currentOutage && <Incident view={view} now={now} canEdit={canEdit} pageContext={pageContext} />}

        <div className="grid gap-5 md:grid-cols-3">
          <section aria-labelledby={`confere-${page.id}`}>
            <h3 id={`confere-${page.id}`} className="text-[13px] font-semibold">O que a sonda confere</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-[12.5px]">
              {findings.map((finding) => (
                <li key={finding.id} className="flex items-start gap-2">
                  <span className={`mt-0.5 rounded-full px-1.5 text-[10.5px] font-semibold ${finding.ok ? 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]' : 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]'}`}>
                    {finding.ok ? 'ok' : 'atenção'}
                  </span>
                  <span>
                    <b className="font-medium">{finding.label}</b> <span className="text-[var(--ct-text-2)]">{finding.detail}</span>
                  </span>
                </li>
              ))}
              {findings.length === 0 && <li className="text-[var(--ct-text-3)]">Ainda não checada.</li>}
            </ul>
            {(!page.watch.watchPixel || !page.watch.watchCheckout || !page.watch.requiredText) && (
              <p className="mt-2 text-[11.5px] text-[var(--ct-text-3)]">
                Não vigiado:{' '}
                {[!page.watch.watchPixel && 'pixel', !page.watch.watchCheckout && 'botão de compra', !page.watch.requiredText && 'texto obrigatório'].filter(Boolean).join(', ')}.
              </p>
            )}
          </section>

          <section aria-labelledby={`chega-${page.id}`}>
            <h3 id={`chega-${page.id}`} className="text-[13px] font-semibold">Quem clica chega na página?</h3>
            {view.project && view.project.lpv.average !== null ? (
              <>
                <p className="mt-1 text-[11.5px] text-[var(--ct-text-3)]">
                  Visualizações da página por clique no link, 7 dias. Média <span className={mono}>{Math.round(view.project.lpv.average * 100)}%</span>.
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {view.project.lpv.days.map((day) => (
                    <li key={day.day} className="grid grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-2 text-[11.5px]">
                      <span className={`${mono} text-[var(--ct-text-3)]`}>{`${day.day.slice(8, 10)}/${day.day.slice(5, 7)}`}</span>
                      <span className="h-2 rounded-full bg-[var(--ct-surface-3)]">
                        <span
                          className="block h-2 rounded-full"
                          style={{ width: `${Math.min(100, Math.round((day.rate ?? 0) * 100))}%`, background: day.dropped ? 'var(--ct-crit)' : 'var(--ct-an)' }}
                        />
                      </span>
                      <span className={`${mono} text-right ${day.dropped ? 'text-[var(--ct-crit)]' : ''}`}>
                        {day.rate === null ? '—' : `${Math.round(day.rate * 100)}%`}
                        {day.dropped && <span className="sr-only"> (queda)</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                {view.project.lpv.days.some((day) => day.dropped) && (
                  <p className="mt-2 text-[11.5px] text-[var(--ct-crit)]">Dia marcado: muita gente clicou e não chegou. Página lenta ou fora em parte do dia?</p>
                )}
              </>
            ) : (
              <p className="mt-2 text-[12.5px] text-[var(--ct-text-3)]">
                {view.project ? 'Sem cliques no link nos últimos 7 dias.' : 'Ligue a página a um projeto para ver se quem clica chega.'}
              </p>
            )}
          </section>

          <section aria-labelledby={`historico-${page.id}`}>
            <h3 id={`historico-${page.id}`} className="text-[13px] font-semibold">Projeto e histórico</h3>
            <p className="mt-2 text-[12.5px] text-[var(--ct-text-2)]">
              {view.project ? (
                <>
                  <Link href={`${base}/funis-venda/${view.project.slug}`} className="text-[var(--ct-accent)]">{view.project.name}</Link> ·{' '}
                  <span className={mono}>{currency(view.project.spendToday)}</span> gastos hoje
                </>
              ) : (
                'Sem projeto ligado.'
              )}
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-[12px]">
              {view.outages.slice(0, 5).map((outage) => (
                <li key={outage.since} className="flex justify-between gap-3">
                  <span className={mono}>{when(outage.since)}</span>
                  <span className="text-[var(--ct-text-2)]">
                    {outage.until ? `fora por ${durationLabel(new Date(outage.until).getTime() - new Date(outage.since).getTime())}` : 'ainda fora'}
                  </span>
                </li>
              ))}
              {view.outages.length === 0 && <li className="text-[var(--ct-text-3)]">Nenhuma queda nos últimos 7 dias.</li>}
            </ul>
          </section>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a href={page.url} target="_blank" rel="noopener noreferrer" className={button}>
            Abrir página
          </a>
          {canEdit && (
            <>
              <Link href={`${base}/paginas/${page.id}/editar`} className={button}>
                Editar o que vigiar
              </Link>
              <form action={setPageActive.bind(null, { ...pageContext, active: !page.isActive })}>
                <button type="submit" className={button}>
                  {page.isActive ? 'Pausar sonda' : 'Retomar sonda'}
                </button>
              </form>
              {view.silenced && (
                <form action={silencePage.bind(null, { ...pageContext, hours: 0 })}>
                  <button type="submit" className={button}>
                    Reativar aviso
                  </button>
                </form>
              )}
              <span className="ml-auto">
                <ConfirmDeleteButton action={removePage.bind(null, pageContext)} label="Tirar da sonda" warning="Tirar a página e o histórico dela da sonda?" />
              </span>
            </>
          )}
        </div>
      </div>
    </details>
  )
}

function Incident({
  view,
  now,
  canEdit,
  pageContext,
}: {
  view: PageView
  now: Date
  canEdit: boolean
  pageContext: { client_id: string; client_slug: string; page_id: string }
}) {
  const { page } = view
  const outage = view.currentOutage!
  const last = page.checks[0]
  const timeline = page.checks.filter((check) => check.checkedAt >= outage.since)
  const lastOk = page.checks.find((check) => check.ok)
  const message = `Oi! A página ${page.label} (${page.url}) está fora do ar desde ${when(outage.since)}. Já estamos verificando, e quem clica nos anúncios agora não consegue ver a oferta. Aviso assim que voltar.`

  return (
    <section aria-labelledby={`incidente-${page.id}`} className="flex flex-col gap-4 rounded-[14px] border border-[var(--ct-crit)]/40 bg-[var(--ct-crit-soft)] p-5">
      <h3 id={`incidente-${page.id}`} className="text-[14px] font-semibold text-[var(--ct-crit)]">
        Página fora do ar{view.silenced ? ' · silenciada para manutenção' : ''}
      </h3>
      <dl className="grid gap-4 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[var(--ct-text-3)]">O que a sonda vê</dt>
          <dd className="mt-1 font-medium">
            {last.error ?? 'não respondeu'}
            {last.redirects > 0 && <span className="block text-[11.5px] text-[var(--ct-text-2)]">depois de {last.redirects} redirecionamento{last.redirects > 1 ? 's' : ''}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--ct-text-3)]">Fora do ar há</dt>
          <dd className="mt-1 font-medium">
            <span className={mono}>{durationLabel(now.getTime() - new Date(outage.since).getTime())}</span>
            <span className="block text-[11.5px] text-[var(--ct-text-2)]">desde {when(outage.since)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-[var(--ct-text-3)]">Gasto do projeto desde a queda</dt>
          <dd className="mt-1 font-medium">
            {view.costSinceDown !== null ? (
              <>
                <span className={mono}>~{currency(view.costSinceDown)}</span>
                <span className="block text-[11.5px] text-[var(--ct-text-2)]">estimado pelo ritmo de gasto de hoje</span>
              </>
            ) : (
              <span className="text-[var(--ct-text-2)]">sem projeto ligado</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--ct-text-3)]">Também afetado</dt>
          <dd className="mt-1 font-medium">{view.affectedTests.length > 0 ? view.affectedTests.map((name) => `Teste A/B ${name}`).join(', ') : 'nenhum teste A/B aponta para cá'}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <a href={page.url} target="_blank" rel="noopener noreferrer" className={button}>
          Abrir a página
        </a>
        {canEdit && (
          <form action={checkPageNow.bind(null, pageContext)}>
            <button type="submit" className={primary}>
              Checar de novo
            </button>
          </form>
        )}
        <a href={META_ADS_MANAGER} target="_blank" rel="noopener noreferrer" className={button}>
          Campanhas no Gerenciador
        </a>
        {canEdit && !view.silenced && (
          <form action={silencePage.bind(null, { ...pageContext, hours: 1 })}>
            <button type="submit" className={button}>
              Manutenção planejada: silenciar 1h
            </button>
          </form>
        )}
      </div>

      <details className="rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-4 py-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-[12.5px] font-medium">Avisar o cliente</summary>
        <div className="mt-2 flex items-start gap-2">
          <p className="flex-1 text-[12.5px] text-[var(--ct-text-2)]">{message}</p>
          <CopyButton text={message} />
        </div>
      </details>

      <div>
        <h4 className="text-[12.5px] font-semibold">Checagens desde a última vez no ar</h4>
        <ol className="mt-2 flex flex-col gap-1 text-[12px]">
          {timeline.map((check) => (
            <li key={check.checkedAt} className="flex gap-3">
              <span className={`${mono} text-[var(--ct-text-3)]`}>{when(check.checkedAt)}</span>
              <span className="text-[var(--ct-crit)]">{check.error ?? 'falhou'}</span>
            </li>
          ))}
          {lastOk && (
            <li className="flex gap-3">
              <span className={`${mono} text-[var(--ct-text-3)]`}>{when(lastOk.checkedAt)}</span>
              <span className="text-[var(--ct-ok)]">no ar{lastOk.ttfbMs !== null ? `, ${seconds(lastOk.ttfbMs)}` : ''}</span>
            </li>
          )}
        </ol>
      </div>

      <p className="text-[11.5px] text-[var(--ct-text-3)]">
        Onde o aviso chega: Hoje e Carteira{view.silenced ? ' (pausado durante a manutenção)' : ''}. E-mail: em breve.
      </p>
    </section>
  )
}
