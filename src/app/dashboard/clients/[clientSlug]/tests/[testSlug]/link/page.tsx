import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { resolveRedirectDomain } from '@/lib/domain/redirect-domain'
import { buildCampaignUrl, META_ADS_TEMPLATE, TRACKED_URL_PARAMS } from '@/lib/domain/campaign-link'
import { CopyButton } from '@/components/copy-button'
import { LinkChecker } from './link-checker'

// The name slots read as one colour and the id slots as another, because that is the whole rule:
// four vagas carry a name a person reads, the id is what the machine joins on.
const ID_SLOTS = new Set(['utm_campaign', 'fb_ad_id', 'fb_adset_id', 'fb_campaign_id'])

function MacroLine({ url }: { url: string }) {
  const [base, query] = url.split('?')
  return (
    <p className="break-all font-[family-name:var(--font-geist-mono)] text-xs leading-relaxed text-[var(--ct-text-2)]">
      <span className="text-[var(--ct-text)]">{base}</span>
      {query && '?'}
      {query?.split('&').map((pair, index) => {
        const [key, value] = pair.split('=')
        return (
          <span key={key}>
            {index > 0 && '&'}
            <span className="text-[var(--ct-text-2)]">{key}</span>=
            <span className={ID_SLOTS.has(key) ? 'text-[var(--ct-warn)]' : 'text-[var(--ct-accent)]'}>{value}</span>
          </span>
        )
      })}
    </p>
  )
}

export default async function TestLinkPage({
  params,
}: {
  params: Promise<{ clientSlug: string; testSlug: string }>
}) {
  const { clientSlug, testSlug } = await params
  const supabase = await createServerSupabaseClient()

  const { data: test, error: testError } = await supabase
    .from('tests')
    .select('id, name, slug, test_type, conversion_method, clients(custom_domain, domain_status)')
    .eq('slug', testSlug)
    .maybeSingle()

  if (testError) {
    console.error('[test-link-fetch-failed]', { testSlug }, testError)
    return (
      <div className="p-8">
        <p className="text-sm text-[var(--ct-text-2)]">
          Não foi possível carregar este teste agora. Tente novamente em instantes.
        </p>
      </div>
    )
  }
  if (!test) notFound()

  const { data: pixelVariants, error: pixelVariantsError } =
    test.conversion_method === 'thank_you_page'
      ? await supabase.from('variants').select('id, name, thank_you_url').eq('test_id', test.id)
      : { data: null, error: null }
  if (pixelVariantsError) {
    console.error('[test-link-fetch-failed]', { testId: test.id, query: 'pixelVariants' }, pixelVariantsError)
  }

  const clientDomain = test.clients as unknown as {
    custom_domain: string | null
    domain_status: 'unconfigured' | 'pending' | 'verified'
  } | null
  const activeDomain = resolveRedirectDomain(
    {
      customDomain: clientDomain?.custom_domain ?? null,
      domainStatus: clientDomain?.domain_status ?? 'unconfigured',
    },
    process.env.NEXT_PUBLIC_REDIRECT_DOMAIN ?? ''
  )
  const redirectUrl = `https://${activeDomain}/r/${test.slug}`
  const checkoutLinkUrl = `https://${activeDomain}/c/${test.slug}`
  const campaignUrl = buildCampaignUrl(redirectUrl, META_ADS_TEMPLATE)
  const assetLabel = test.test_type === 'checkout' ? 'Checkout' : 'Página'

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex h-[88px] flex-shrink-0 items-center justify-between border-b border-[var(--ct-line)] px-8">
        <div>
          <a
            href={`/dashboard/clients/${clientSlug}/tests/${test.slug}`}
            className="mb-1 flex items-center gap-1 text-xs text-[var(--ct-text-2)] hover:text-[var(--ct-text)]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M6.5 2L3 5L6.5 8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {test.name}
          </a>
          <h1 className="font-[family-name:var(--font-sora)] text-[19px] font-semibold">Link e rastreio</h1>
        </div>
      </div>

      <div className="mx-6 mb-6 mt-6">
        <h2 className="mb-1 font-[family-name:var(--font-sora)] text-lg font-semibold">Link da campanha</h2>
        <p className="mb-3 text-xs text-[var(--ct-text-2)]">
          Cole este endereço no campo <em>Site</em> do anúncio. As chaves duplas o Meta preenche no clique.
        </p>
        <div className="rounded-[10px] border border-[var(--ct-line)] p-3">
          <div className="mb-3 flex items-start gap-1.5">
            <MacroLine url={campaignUrl} />
            <CopyButton text={campaignUrl} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TRACKED_URL_PARAMS.map((key) => (
              <span
                key={key}
                className="rounded-md border border-[var(--ct-ok)]/30 bg-[var(--ct-ok)]/[0.09] px-2 py-1 font-[family-name:var(--font-geist-mono)] text-[11px] text-[var(--ct-ok)]"
              >
                ✓ {key}
              </span>
            ))}
          </div>
          <p className="mt-3 rounded-lg border-l-2 border-[var(--ct-warn)] bg-[var(--ct-warn)]/[0.07] px-3 py-2 text-xs text-[var(--ct-text-2)]">
            <strong className="text-[var(--ct-warn)]">A vaga do id é a utm_campaign.</strong> Quatro vagas carregam
            nome — o que uma pessoa lê, e que muda quando alguém renomeia. Uma carrega id, que a máquina cruza
            e que nunca muda. Um id basta: sabendo o anúncio, a tabela de gasto entrega conjunto e campanha.
          </p>
        </div>
      </div>

      <div className="mx-6 mb-6">
        <h2 className="mb-1 font-[family-name:var(--font-sora)] text-lg font-semibold">Link simples</h2>
        <p className="mb-3 text-xs text-[var(--ct-text-2)]">
          Sem parâmetro nenhum. Serve pra bio, e-mail ou qualquer lugar onde não exista anúncio pra rastrear —
          o sorteio da variante funciona igual, só não dá pra dizer de onde veio.
        </p>
        <div className="rounded-[10px] border border-[var(--ct-line)] p-3">
          <div className="flex items-center gap-1.5">
            <p className="break-all font-[family-name:var(--font-geist-mono)] text-xs text-[var(--ct-an)]">{redirectUrl}</p>
            <CopyButton text={redirectUrl} />
          </div>
        </div>
      </div>

      <div className="mx-6 mb-6">
        <div className="rounded-[10px] border border-[var(--ct-line)] p-4">
          <LinkChecker />
        </div>
      </div>

      {test.test_type === 'checkout' && (
        <div className="mx-6 mb-6">
          <h2 className="mb-2 font-[family-name:var(--font-sora)] text-lg font-semibold">Link do botão de comprar</h2>
          <div className="rounded-[10px] border border-[var(--ct-line)] p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <p className="break-all font-[family-name:var(--font-geist-mono)] text-xs text-[var(--ct-an)]">{checkoutLinkUrl}</p>
              <CopyButton text={checkoutLinkUrl} />
            </div>
            <p className="text-xs text-[var(--ct-text-2)]">
              Cole este endereço no botão de comprar da página de vendas. Se a página tiver vários botões de
              compra, todos recebem o mesmo endereço. Trocar os checkouts ou os pesos depois não exige mexer na
              página de novo.
            </p>
          </div>
        </div>
      )}

      {pixelVariants && pixelVariants.length > 0 && (
        <div className="mx-6 mb-6">
          <h2 className="mb-2 font-[family-name:var(--font-sora)] text-lg font-semibold">
            Pixel de conversão (thank-you page)
          </h2>
          {pixelVariants.map((variant) => {
            const isSafeUrl = variant.thank_you_url ? /^https?:\/\//i.test(variant.thank_you_url) : false
            return (
              <div key={variant.id} className="mb-4 rounded-[10px] border border-[var(--ct-line)] p-3">
                <p className="mb-2 text-sm text-[var(--ct-text-2)]">
                  {assetLabel} {variant.name}
                  {variant.thank_you_url && isSafeUrl ? (
                    <>
                      {' '}
                      — cole na página:{' '}
                      <a
                        className="text-[var(--ct-an)] underline"
                        href={variant.thank_you_url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {variant.thank_you_url}
                      </a>
                    </>
                  ) : variant.thank_you_url ? (
                    <> — URL de thank-you configurada tem um formato inválido: {variant.thank_you_url}</>
                  ) : (
                    <> — nenhuma URL de thank-you configurada para esta {assetLabel.toLowerCase()}</>
                  )}
                </p>
                <p className="mb-2 text-xs text-[var(--ct-text-2)]">
                  Importante: seu construtor de página/funil precisa estar configurado para repassar os
                  parâmetros da URL original no redirecionamento pra esta página, senão o pixel nunca recebe o
                  tracking id.
                </p>
                <pre className="overflow-x-auto rounded bg-[var(--ct-surface-2)] p-2 text-xs">
                  <code>{`<script>
  (function () {
    var params = new URLSearchParams(window.location.search);
    var tid = params.get('utm_content') || params.get('tid');
    if (tid) {
      var img = new Image();
      img.src = 'https://${activeDomain}/ty/${test.slug}?tid=' + encodeURIComponent(tid);
    }
  })();
</script>`}</code>
                </pre>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
