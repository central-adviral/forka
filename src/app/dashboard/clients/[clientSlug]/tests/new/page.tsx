'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createTest } from '../../actions'
import { weightsSumTo100 } from '@/lib/domain/validate-weights'
import { createBrowserSupabaseClient } from '@/lib/supabase/browser'

interface VariantForm {
  name: string
  weight_pct: string
  destination_url: string
  thank_you_url: string
}

const inputClass =
  'w-full rounded-[10px] border border-white/[0.08] bg-[#1B2036] px-3.5 py-2.5 text-sm text-[#E8EAF2] placeholder:text-[#8A90A6] outline-none focus:border-[#7C6FF0]'

export default function NewTestPage() {
  const params = useParams<{ clientSlug: string }>()
  const router = useRouter()
  const [clientId, setClientId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [fallbackUrl, setFallbackUrl] = useState('')
  const [conversionMethod, setConversionMethod] = useState<'hubla_webhook' | 'thank_you_page'>('hubla_webhook')
  const [testType, setTestType] = useState<'page' | 'checkout'>('page')
  const [salesPageUrl, setSalesPageUrl] = useState('')
  const [variants, setVariants] = useState<VariantForm[]>([
    { name: 'A', weight_pct: '50', destination_url: '', thank_you_url: '' },
    { name: 'B', weight_pct: '50', destination_url: '', thank_you_url: '' },
  ])
  const [error, setError] = useState<string | null>(null)
  const [clientLoading, setClientLoading] = useState(true)

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    supabase
      .from('clients')
      .select('id')
      .eq('slug', params.clientSlug)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setError('Não foi possível carregar o cliente. Recarregue a página.')
        } else {
          setClientId(data?.id ?? null)
        }
        setClientLoading(false)
      })
  }, [params.clientSlug])

  const weightsValid = weightsSumTo100(variants.map((v) => Number(v.weight_pct)))

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!clientId) return
    if (!weightsValid) {
      setError('Os pesos das variantes devem somar 100%')
      return
    }
    if (testType === 'checkout' && !/^https?:\/\//i.test(salesPageUrl)) {
      setError('A URL da página de vendas deve começar com http:// ou https://')
      return
    }
    const invalidUrlField = variants.find((v) => !/^https?:\/\//i.test(v.destination_url))
    if (invalidUrlField) {
      setError(
        testType === 'checkout'
          ? `O link do checkout da variante ${invalidUrlField.name} deve começar com http:// ou https://`
          : `A URL de destino da variante ${invalidUrlField.name} deve começar com http:// ou https://`
      )
      return
    }
    try {
      await createTest({
        client_id: clientId,
        name,
        slug,
        fallback_url: fallbackUrl,
        conversion_method: conversionMethod,
        test_type: testType,
        sales_page_url: testType === 'checkout' ? salesPageUrl : '',
        variants: variants.map((v) => ({
          name: v.name,
          weight_pct: Number(v.weight_pct),
          destination_url: v.destination_url,
          thank_you_url: v.thank_you_url,
        })),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar teste')
      return
    }
    router.push(`/dashboard/clients/${params.clientSlug}?created=1`)
  }

  function updateVariant(index: number, field: keyof VariantForm, value: string) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)))
  }

  function removeVariant(index: number) {
    setVariants((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="p-8">
      <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
        <h1 className="font-['Space_Grotesk'] text-lg font-semibold">Novo teste</h1>
        <input required placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        <input
          required
          placeholder="Slug (ex: oferta-x)"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className={inputClass}
        />
        <p className="-mt-2 text-xs text-[#8A90A6]">
          Vira o link que você cola no anúncio: seudominio.com/r/slug — escolha algo curto e reconhecível
        </p>
        <input
          placeholder="URL de fallback (opcional)"
          value={fallbackUrl}
          onChange={(e) => setFallbackUrl(e.target.value)}
          className={inputClass}
        />
        <p className="-mt-2 text-xs text-[#8A90A6]">
          Pra onde mandar o visitante se o teste for pausado (opcional)
        </p>
        <select
          value={testType}
          onChange={(e) => setTestType(e.target.value as 'page' | 'checkout')}
          className={inputClass}
        >
          <option value="page">Teste de página</option>
          <option value="checkout">Teste de checkout</option>
        </select>
        <p className="-mt-2 text-xs text-[#8A90A6]">
          Página: cada variante é uma página de vendas diferente. Checkout: mesma página pra todos, cada
          variante é um checkout diferente
        </p>

        {testType === 'checkout' && (
          <>
            <input
              placeholder="URL da página de vendas (única para todas as variantes)"
              value={salesPageUrl}
              onChange={(e) => setSalesPageUrl(e.target.value)}
              className={inputClass}
            />
            <p className="-mt-2 text-xs text-[#8A90A6]">A única página de vendas usada por todas as variantes</p>
          </>
        )}

        <select
          value={conversionMethod}
          onChange={(e) => setConversionMethod(e.target.value as typeof conversionMethod)}
          className={inputClass}
        >
          <option value="hubla_webhook">Venda (webhook Hubla)</option>
          <option value="thank_you_page">Captura (thank-you page)</option>
        </select>

        {variants.map((variant, index) => (
          <fieldset key={index} className="space-y-2 rounded-[10px] border border-white/[0.08] p-3">
            <legend className="flex items-center gap-2 px-1 text-sm font-medium text-[#8A90A6]">
              Variante {variant.name}
              {index === 0 && (
                <span className="rounded-full bg-[#7C6FF0]/15 px-2 py-0.5 text-[10.5px] font-medium text-[#7C6FF0]">
                  controle
                </span>
              )}
              {variants.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeVariant(index)}
                  className="text-xs font-medium text-[#F76C6C] hover:underline"
                >
                  Remover
                </button>
              )}
            </legend>
            <input
              placeholder="Peso %"
              value={variant.weight_pct}
              onChange={(e) => updateVariant(index, 'weight_pct', e.target.value)}
              className={inputClass}
            />
            <p className="-mt-1 text-xs text-[#8A90A6]">
              Porcentagem do tráfego pra essa variante — a soma de todas precisa dar 100%
            </p>
            <input
              placeholder={testType === 'checkout' ? 'Link do checkout (https://pay.hub.la/...)' : 'URL de destino'}
              value={variant.destination_url}
              onChange={(e) => updateVariant(index, 'destination_url', e.target.value)}
              className={inputClass}
            />
            <p className="-mt-1 text-xs text-[#8A90A6]">
              {testType === 'checkout'
                ? 'Link de pagamento da Hubla pra essa variante'
                : 'Página de vendas dessa variante'}
            </p>
            {conversionMethod === 'thank_you_page' && (
              <>
                <input
                  placeholder="URL de thank-you"
                  value={variant.thank_you_url}
                  onChange={(e) => updateVariant(index, 'thank_you_url', e.target.value)}
                  className={inputClass}
                />
                <p className="-mt-1 text-xs text-[#8A90A6]">
                  Página que o cliente vê depois de comprar — cole o snippet do pixel nela
                </p>
              </>
            )}
          </fieldset>
        ))}

        <button
          type="button"
          onClick={() =>
            setVariants((prev) => [...prev, { name: String.fromCharCode(65 + prev.length), weight_pct: '0', destination_url: '', thank_you_url: '' }])
          }
          className="text-sm font-medium text-[#7C6FF0] hover:text-[#9C90F5]"
        >
          + Adicionar variante
        </button>

        {!weightsValid && <p className="text-sm text-[#F5B94D]">Os pesos devem somar 100%.</p>}
        {clientLoading && <p className="text-sm text-[#8A90A6]">Carregando...</p>}
        {error && <p className="text-sm text-[#F76C6C]">{error}</p>}

        <button
          type="submit"
          disabled={!clientId}
          className="rounded-[10px] bg-[#7C6FF0] px-4 py-2.5 text-sm font-semibold text-[#0B0E1A] disabled:opacity-50"
        >
          Criar teste
        </button>
      </form>
    </div>
  )
}
