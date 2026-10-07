import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getConfiguredSecrets } from '@/lib/repo/client-secrets-repo'
import { notFound } from 'next/navigation'
import { resolveRedirectDomain } from '@/lib/domain/redirect-domain'
import { CopyButton } from '@/components/copy-button'
import { saveDomain, verifyDomain, saveHublaToken, saveFunnelDataSource, saveMetaTax } from './actions'
import { VerifyDomainButton } from './verify-domain-button'
import { canActAs } from '@/lib/view-as'

const STATUS_LABEL: Record<string, string> = {
  unconfigured: 'Não configurado',
  pending: 'Aguardando DNS',
  verified: 'Verificado',
}

const STATUS_COLOR: Record<string, string> = {
  unconfigured: 'var(--ct-text-2)',
  pending: 'var(--ct-warn)',
  verified: 'var(--ct-ok)',
}

export default async function IntegrationsPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase
    .from('clients')
    .select('id, slug, custom_domain, domain_status, funnel_source_url')
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
  const { data: taxRates } = await supabase
    .from('client_tax_rates')
    .select('valid_from, factor')
    .eq('client_id', client.id)
    .order('valid_from', { ascending: false })

  return (
    <div className="max-w-xl space-y-8 p-8">
      <div>
        <a
          href={`/dashboard/clients/${client.slug}`}
          className="mb-1 flex items-center gap-1 text-xs text-[var(--ct-text-2)] hover:text-[var(--ct-text)]"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M6.5 2L3 5L6.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Testes
        </a>
        <h1 className="font-[family-name:var(--font-sora)] text-xl font-semibold">Integrações</h1>
      </div>

      <section className="space-y-4 rounded-2xl border border-[var(--ct-line)] p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-sora)] text-base font-semibold">Domínio</h2>
          <span
            className="rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ color: STATUS_COLOR[client.domain_status], border: `1px solid ${STATUS_COLOR[client.domain_status]}55` }}
          >
            {STATUS_LABEL[client.domain_status]}
          </span>
        </div>

        <form action={saveDomain.bind(null, { client_id: client.id, client_slug: client.slug })} className="flex gap-2">
          <input
            name="custom_domain"
            placeholder="ir.seudominio.com"
            defaultValue={client.custom_domain ?? ''}
            className="flex-1 rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3.5 py-2.5 text-sm text-[var(--ct-text)] placeholder:text-[var(--ct-text-2)] outline-none focus:border-[var(--ct-accent)]"
          />
          <button
            type="submit"
            className="rounded-[10px] bg-[var(--ct-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--ct-on-accent)]"
          >
            Salvar
          </button>
        </form>
        <p className="-mt-2 text-xs text-[var(--ct-text-2)]">
          Aparece nos links dos seus testes no lugar do domínio padrão
        </p>

        {client.custom_domain && (
          <>
            <div className="rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] p-3 font-[family-name:var(--font-geist-mono)] text-xs text-[var(--ct-text-2)]">
              Tipo: CNAME
              <br />
              Nome: {client.custom_domain}
              <br />
              Valor: cname.vercel-dns.com
            </div>
            <p className="text-xs text-[var(--ct-text-2)]">
              Alguns provedores de DNS pedem só a parte antes do seu domínio raiz (ex: só &quot;ir&quot; em vez do
              domínio completo) — se o campo &quot;Nome&quot; recusar o valor completo, use apenas o prefixo.
            </p>

            <VerifyDomainButton verifyAction={verifyDomain.bind(null, { client_id: client.id, client_slug: client.slug })} />
          </>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-[var(--ct-line)] p-5">
        <h2 className="font-[family-name:var(--font-sora)] text-base font-semibold">Hubla</h2>

        <form action={saveHublaToken.bind(null, { client_id: client.id, client_slug: client.slug })} className="flex gap-2">
          <input
            name="hubla_webhook_token"
            placeholder={hasHublaToken ? 'token configurado · cole um novo pra substituir' : 'Token do webhook'}
            className="flex-1 rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3.5 py-2.5 text-sm text-[var(--ct-text)] placeholder:text-[var(--ct-text-2)] outline-none focus:border-[var(--ct-accent)]"
          />
          <button
            type="submit"
            className="rounded-[10px] bg-[var(--ct-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--ct-on-accent)]"
          >
            Salvar
          </button>
        </form>
        <p className="-mt-2 text-xs text-[var(--ct-text-2)]">Copie da aba Autenticação do webhook, no painel da Hubla</p>

        <div>
          <p className="mb-1 text-xs text-[var(--ct-text-2)]">Cole esta URL no painel da Hubla:</p>
          <div className="flex items-center gap-2">
            <p className="flex-1 break-all rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] p-3 font-[family-name:var(--font-geist-mono)] text-xs text-[var(--ct-an)]">
              {webhookUrl}
            </p>
            <CopyButton text={webhookUrl} />
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-[var(--ct-line)] p-5">
        <h2 className="font-[family-name:var(--font-sora)] text-base font-semibold">Fonte de dados do Funil de Vendas</h2>

        <form action={saveFunnelDataSource.bind(null, { client_id: client.id, client_slug: client.slug })} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[var(--ct-text-2)]">URL</label>
            <input
              name="funnel_source_url"
              placeholder="https://xxxxx.supabase.co"
              defaultValue={client.funnel_source_url ?? ''}
              className="w-full rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3.5 py-2.5 text-sm text-[var(--ct-text)] placeholder:text-[var(--ct-text-2)] outline-none focus:border-[var(--ct-accent)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--ct-text-2)]">Chave de acesso</label>
            <input
              type="password"
              name="funnel_source_service_role_key"
              placeholder={
                hasFunnelSourceKey ? 'chave configurada · cole uma nova pra substituir' : 'chave de acesso'
              }
              className="w-full rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3.5 py-2.5 text-sm text-[var(--ct-text)] placeholder:text-[var(--ct-text-2)] outline-none focus:border-[var(--ct-accent)]"
            />
          </div>
          <button
            type="submit"
            className="rounded-[10px] bg-[var(--ct-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--ct-on-accent)]"
          >
            Salvar
          </button>
        </form>
        <p className="-mt-2 text-xs text-[var(--ct-text-2)]">
          Usada pela sincronização automática de vendas e gasto de mídia dos funis deste cliente. Cada funil de
          venda tem seu próprio mapeamento de operação/produto, configurado na tela do funil.
        </p>
      </section>

      <section className="space-y-4 rounded-2xl border border-[var(--ct-line)] p-5">
        <h2 className="font-[family-name:var(--font-sora)] text-base font-semibold">Imposto do Meta</h2>
        <p className="text-xs text-[var(--ct-text-2)]">
          O gasto chega do Meta sem imposto. O percentual daqui entra no investimento, no CPA e no ROAS a partir da data
          informada; os dias anteriores mantêm a taxa que valia antes.
        </p>
        {(taxRates ?? []).length > 0 ? (
          <ul className="space-y-1 text-[13px]">
            {(taxRates ?? []).map((rate) => (
              <li key={rate.valid_from} className="font-[family-name:var(--font-geist-mono)] tabular-nums">
                {((Number(rate.factor) - 1) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% desde{' '}
                {rate.valid_from.split('-').reverse().join('/')}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--ct-warn)]">Nenhum imposto configurado: o investimento aparece sem imposto.</p>
        )}
        <form action={saveMetaTax.bind(null, { client_id: client.id, client_slug: client.slug })} className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--ct-text-2)]">
            Imposto (%)
            <input
              name="percent"
              inputMode="decimal"
              required
              placeholder="13,8"
              className="mt-1 block w-28 rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3.5 py-2.5 text-sm text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]"
            />
          </label>
          <label className="text-xs text-[var(--ct-text-2)]">
            Vale a partir de
            <input
              type="date"
              name="valid_from"
              required
              className="mt-1 block rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3.5 py-2.5 text-sm text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]"
            />
          </label>
          <button type="submit" className="rounded-[10px] bg-[var(--ct-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--ct-on-accent)]">
            Salvar imposto
          </button>
        </form>
      </section>
    </div>
  )
}
