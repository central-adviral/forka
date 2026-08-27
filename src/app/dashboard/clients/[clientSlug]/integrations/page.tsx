import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { resolveRedirectDomain } from '@/lib/domain/redirect-domain'
import { CopyButton } from '@/components/copy-button'
import { saveDomain, verifyDomain, saveHublaToken } from './actions'

const STATUS_LABEL: Record<string, string> = {
  unconfigured: 'Não configurado',
  pending: 'Aguardando DNS',
  verified: 'Verificado',
}

const STATUS_COLOR: Record<string, string> = {
  unconfigured: '#8A90A6',
  pending: '#F5B94D',
  verified: '#2DD4A8',
}

export default async function IntegrationsPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params
  const supabase = await createServerSupabaseClient()
  const { data: client } = await supabase
    .from('clients')
    .select('id, slug, custom_domain, domain_status, hubla_webhook_token')
    .eq('slug', clientSlug)
    .maybeSingle()

  if (!client) notFound()

  const defaultDomain = process.env.NEXT_PUBLIC_REDIRECT_DOMAIN ?? ''
  const activeDomain = resolveRedirectDomain(
    { customDomain: client.custom_domain, domainStatus: client.domain_status as 'unconfigured' | 'pending' | 'verified' },
    defaultDomain
  )
  const webhookUrl = `https://${activeDomain}/api/webhooks/hubla/${client.slug}`

  return (
    <div className="max-w-xl space-y-8 p-8">
      <div>
        <a
          href={`/dashboard/clients/${client.slug}`}
          className="mb-1 flex items-center gap-1 text-xs text-[#8A90A6] hover:text-[#E8EAF2]"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M6.5 2L3 5L6.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Testes
        </a>
        <h1 className="font-['Space_Grotesk'] text-xl font-semibold">Integrações</h1>
      </div>

      <section className="space-y-4 rounded-2xl border border-white/[0.08] p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-['Space_Grotesk'] text-base font-semibold">Domínio</h2>
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
            className="flex-1 rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] placeholder:text-[#8A90A6] outline-none focus:border-[#7C6FF0]"
          />
          <button
            type="submit"
            className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-[#0B0E1A]"
          >
            Salvar
          </button>
        </form>

        {client.custom_domain && (
          <>
            <div className="rounded-[10px] border border-white/[0.08] bg-[#1B2036] p-3 font-['JetBrains_Mono'] text-xs text-[#8A90A6]">
              Tipo: CNAME
              <br />
              Nome: {client.custom_domain.split('.')[0]}
              <br />
              Valor: cname.vercel-dns.com
            </div>

            <form action={verifyDomain.bind(null, { client_id: client.id, client_slug: client.slug })}>
              <button
                type="submit"
                className="rounded-[10px] border border-white/[0.08] px-4 py-2.5 text-sm font-medium text-[#8A90A6]"
              >
                Verificar
              </button>
            </form>

            <p className="text-xs text-[#8A90A6]">
              Depois que o DNS estiver verificado, avise o responsável técnico para finalizar o registro do
              domínio — esse último passo ainda é manual.
            </p>
          </>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-white/[0.08] p-5">
        <h2 className="font-['Space_Grotesk'] text-base font-semibold">Hubla</h2>

        <form action={saveHublaToken.bind(null, { client_id: client.id, client_slug: client.slug })} className="flex gap-2">
          <input
            name="hubla_webhook_token"
            placeholder="Token do webhook"
            defaultValue={client.hubla_webhook_token ?? ''}
            className="flex-1 rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] placeholder:text-[#8A90A6] outline-none focus:border-[#7C6FF0]"
          />
          <button
            type="submit"
            className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-[#0B0E1A]"
          >
            Salvar
          </button>
        </form>

        <div>
          <p className="mb-1 text-xs text-[#8A90A6]">Cole esta URL no painel da Hubla:</p>
          <div className="flex items-center gap-2">
            <p className="flex-1 break-all rounded-[10px] border border-white/[0.08] bg-[#1B2036] p-3 font-['JetBrains_Mono'] text-xs text-[#4F8EF7]">
              {webhookUrl}
            </p>
            <CopyButton text={webhookUrl} />
          </div>
        </div>
      </section>
    </div>
  )
}
