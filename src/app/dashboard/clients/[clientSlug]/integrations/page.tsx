import type { ReactNode } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/page-header'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getConfiguredSecrets } from '@/lib/repo/client-secrets-repo'
import { notFound } from 'next/navigation'
import { resolveRedirectDomain } from '@/lib/domain/redirect-domain'
import { CopyButton } from '@/components/copy-button'
import { saveDomain, verifyDomain, saveHublaToken, saveFunnelDataSource, saveMetaTax } from './actions'
import { VerifyDomainButton } from './verify-domain-button'
import { canActAs } from '@/lib/view-as'

// The prototype's Integrações: one card per source the client is connected to, each with its
// status, what it feeds and the technical details; the settings open inside the card.

type Tone = 'ok' | 'warn' | 'crit' | 'off'

const PILL: Record<Tone, string> = {
  ok: 'bg-[var(--ct-ok-soft)] text-[var(--ct-ok)]',
  warn: 'bg-[var(--ct-warn-soft)] text-[var(--ct-warn)]',
  crit: 'bg-[var(--ct-crit-soft)] text-[var(--ct-crit)]',
  off: 'bg-[var(--ct-surface-3)] text-[var(--ct-text-3)]',
}

const DOMAIN_STATUS: Record<string, { label: string; tone: Tone }> = {
  unconfigured: { label: 'padrão', tone: 'off' },
  pending: { label: 'aguardando DNS', tone: 'warn' },
  verified: { label: 'verificado', tone: 'ok' },
}

// A sync older than this means the hourly run is not happening.
const STALE_SYNC_MS = 3 * 60 * 60 * 1000

function isOlderThan(iso: string, ms: number): boolean {
  return Date.now() - new Date(iso).getTime() > ms
}

const mono = 'font-[family-name:var(--font-geist-mono)]'
const field =
  'w-full rounded-[10px] border border-[var(--ct-line-2)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px] text-[var(--ct-text)] placeholder:text-[var(--ct-text-3)] outline-none focus:border-[var(--ct-accent)]'
const primary = 'rounded-full bg-[var(--ct-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--ct-on-accent)] hover:brightness-110'

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`ml-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium ${PILL[tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  )
}

function IntegrationCard({
  logo,
  name,
  status,
  tone,
  description,
  details,
  settings,
  dashed,
}: {
  logo: string
  name: string
  status: string
  tone: Tone
  description: ReactNode
  details?: [string, ReactNode][]
  settings?: ReactNode
  dashed?: boolean
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-3.5 rounded-[22px] border bg-[var(--ct-surface)] px-6 py-[22px] shadow-[var(--ct-shadow)] ${
        dashed ? 'border-dashed border-[var(--ct-line-2)]' : 'border-[var(--ct-line)]'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span className={`${mono} grid h-[30px] w-[30px] flex-none place-items-center rounded-[8px] bg-[var(--ct-surface-3)] text-[11px] font-medium`}>{logo}</span>
        <b className="text-[14px] font-semibold">{name}</b>
        <Pill tone={tone}>{status}</Pill>
      </div>
      <p className="text-[12.5px] leading-relaxed text-[var(--ct-text-2)]">{description}</p>
      {details && details.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-[var(--ct-line)] pt-2.5 text-[12px]">
          {details.map(([label, value]) => (
            <div key={label} className="flex min-w-0 justify-between gap-3">
              <span className="flex-none text-[var(--ct-text-3)]">{label}</span>
              <code className={`${mono} min-w-0 text-right text-[11.5px] text-[var(--ct-text-2)] [overflow-wrap:anywhere]`}>{value}</code>
            </div>
          ))}
        </div>
      )}
      {settings && (
        <details className="group mt-auto border-t border-[var(--ct-line)] pt-2.5">
          <summary className="cursor-pointer list-none text-[12.5px] font-medium text-[var(--ct-accent)] [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Configurar</span>
            <span className="hidden group-open:inline">Fechar</span>
          </summary>
          <div className="mt-3 flex flex-col gap-3">{settings}</div>
        </details>
      )}
    </div>
  )
}

const timeBr = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default async function IntegrationsPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, slug, custom_domain, domain_status, funnel_source_url')
    .eq('slug', clientSlug)
    .maybeSingle()

  if (!client) notFound()
  // Read-only members can see the client row, so seeing it no longer proves they may configure it.
  const isOwner = await canActAs(supabase, client.id, 'owner')
  if (isOwner !== true) notFound()

  // The secrets themselves never reach this component -- only whether each one is set. The owner
  // check above, on the user's own session, is what clears this service-role read.
  const { hasHublaToken, hasFunnelSourceKey } = await getConfiguredSecrets(createServiceRoleClient(), client.id)

  const defaultDomain = process.env.NEXT_PUBLIC_REDIRECT_DOMAIN ?? ''
  const activeDomain = resolveRedirectDomain(
    { customDomain: client.custom_domain, domainStatus: client.domain_status as 'unconfigured' | 'pending' | 'verified' },
    defaultDomain
  )
  const webhookUrl = `https://${activeDomain}/api/webhooks/hubla/${client.slug}`
  const [{ data: taxRates }, { data: lastOk }, { data: lastRun }] = await Promise.all([
    supabase.from('client_tax_rates').select('valid_from, factor').eq('client_id', client.id).order('valid_from', { ascending: false }),
    supabase.from('sync_runs').select('finished_at').eq('client_id', client.id).is('error', null).not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sync_runs').select('finished_at, error').eq('client_id', client.id).not('finished_at', 'is', null).order('started_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const sourceConfigured = Boolean(client.funnel_source_url && hasFunnelSourceKey)
  const lastOkAt = (lastOk?.finished_at as string | undefined) ?? null
  const source: { label: string; tone: Tone } = !sourceConfigured
    ? { label: 'não configurado', tone: 'off' }
    : lastRun?.error
      ? { label: 'última leitura falhou', tone: 'crit' }
      : !lastOkAt
        ? { label: 'aguardando leitura', tone: 'warn' }
        : isOlderThan(lastOkAt, STALE_SYNC_MS)
          ? { label: 'leitura atrasada', tone: 'warn' }
          : { label: 'conectado', tone: 'ok' }
  const domain = DOMAIN_STATUS[client.domain_status] ?? DOMAIN_STATUS.unconfigured
  const currentTax = (taxRates ?? [])[0]
  const percent = (factor: number) => `${((Number(factor) - 1) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
  const context = { client_id: client.id as string, client_slug: client.slug as string }

  return (
    <div className="flex max-w-[1320px] flex-col gap-9 px-4 md:px-14 pb-24 pt-12">
      <PageHeader
        note={client.name}
        title="Integrações"
        description={`Conectadas uma vez por cliente. Todos os projetos da ${client.name} usam estas fontes.`}
      />

      <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        <IntegrationCard
          logo="Lo"
          name="LaunchOps · Meta e vendas"
          status={source.label}
          tone={source.tone}
          description="Gasto do Meta por anúncio, leads pagos e vendas da Hubla. A Central relê a janela dos últimos 7 dias a cada sincronização, de hora em hora."
          details={[
            ['Via', 'LaunchOps (só leitura)'],
            ['Gasto', 'anuncio_dia · por anúncio'],
            ['Última leitura ok', lastOkAt ? timeBr(lastOkAt) : '—'],
            ...(lastRun?.error ? [['Erro', String(lastRun.error)] as [string, ReactNode]] : []),
          ]}
          settings={
            <form action={saveFunnelDataSource.bind(null, context)} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                URL do LaunchOps
                <input name="funnel_source_url" placeholder="https://xxxxx.supabase.co" defaultValue={client.funnel_source_url ?? ''} className={field} />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                Chave de acesso
                <input
                  type="password"
                  name="funnel_source_service_role_key"
                  placeholder={hasFunnelSourceKey ? 'chave configurada · cole uma nova para substituir' : 'chave de acesso'}
                  className={field}
                />
              </label>
              <button type="submit" className={`${primary} self-start`}>
                Salvar
              </button>
            </form>
          }
        />

        <IntegrationCard
          logo="Hu"
          name="Hubla"
          status={hasHublaToken ? 'token configurado' : 'sem token'}
          tone={hasHublaToken ? 'ok' : 'warn'}
          description="Webhook de pagamento: liga cada venda ao clique do teste A/B que a trouxe."
          details={[
            ['URL', webhookUrl],
            ['Token', hasHublaToken ? 'configurado' : 'falta colar'],
          ]}
          settings={
            <>
              <div className="flex items-center gap-2">
                <code className={`${mono} min-w-0 flex-1 break-all rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3 py-2 text-[11.5px] text-[var(--ct-an)]`}>
                  {webhookUrl}
                </code>
                <CopyButton text={webhookUrl} />
              </div>
              <form action={saveHublaToken.bind(null, context)} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                  Token do webhook (aba Autenticação, no painel da Hubla)
                  <input
                    name="hubla_webhook_token"
                    placeholder={hasHublaToken ? 'token configurado · cole um novo para substituir' : 'token do webhook'}
                    className={field}
                  />
                </label>
                <button type="submit" className={`${primary} self-start`}>
                  Salvar
                </button>
              </form>
            </>
          }
        />

        <IntegrationCard
          logo="Rt"
          name="Domínio de rastreio"
          status={domain.label}
          tone={domain.tone}
          description="Os links de teste e as UTMs passam por este domínio. Nada a instalar nas páginas."
          details={[
            ['Domínio', activeDomain || '—'],
            ...(client.custom_domain ? [['CNAME', 'cname.vercel-dns.com'] as [string, ReactNode]] : []),
          ]}
          settings={
            <>
              <form action={saveDomain.bind(null, context)} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                  Domínio próprio
                  <input name="custom_domain" placeholder="ir.seudominio.com" defaultValue={client.custom_domain ?? ''} className={field} />
                </label>
                <button type="submit" className={`${primary} self-start`}>
                  Salvar
                </button>
              </form>
              {client.custom_domain && (
                <>
                  <p className="text-[12px] text-[var(--ct-text-3)]">
                    Crie um CNAME com nome <code className={mono}>{client.custom_domain}</code> e valor <code className={mono}>cname.vercel-dns.com</code>. Se o
                    provedor recusar o nome completo, use só o prefixo (ex.: &quot;ir&quot;).
                  </p>
                  <VerifyDomainButton verifyAction={verifyDomain.bind(null, context)} />
                </>
              )}
            </>
          }
        />

        <IntegrationCard
          logo="%"
          name="Imposto do Meta"
          status={currentTax ? `${percent(currentTax.factor)} vigente` : 'sem imposto'}
          tone={currentTax ? 'ok' : 'warn'}
          description="O gasto chega do Meta sem imposto. A taxa entra no investimento, no CPA e no ROAS a partir da data; os dias anteriores mantêm a taxa que valia antes."
          details={(taxRates ?? []).map((rate) => [`desde ${rate.valid_from.split('-').reverse().join('/')}`, percent(rate.factor)] as [string, ReactNode])}
          settings={
            <form action={saveMetaTax.bind(null, context)} className="flex flex-wrap items-end gap-3">
              <label className="flex w-24 flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                Imposto (%)
                <input name="percent" inputMode="decimal" required placeholder="13,8" className={`${field} ${mono}`} />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-[var(--ct-text-3)]">
                Vale a partir de
                <input type="date" name="valid_from" required className={field} />
              </label>
              <button type="submit" className={primary}>
                Salvar
              </button>
            </form>
          }
        />

        <IntegrationCard
          logo="Wa"
          name="Alertas no WhatsApp"
          status="em breve"
          tone="off"
          description="Críticos na hora, atenção num resumo do dia. Depende da escolha do provedor de envio."
        />

        <IntegrationCard
          logo="+"
          name="Adicionar fonte"
          status="em breve"
          tone="off"
          dashed
          description="Google Ads, TikTok Ads, Kiwify, Eduzz. Cada fonte nova entra como um conector com a mesma interface."
        />
      </div>
    </div>
  )
}
