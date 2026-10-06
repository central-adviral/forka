'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { weightsSumTo100 } from '@/lib/domain/validate-weights'
import { updateTest } from '../actions'

interface VariantForm {
  id: string
  name: string
  weight_pct: string
  destination_url: string
  thank_you_url: string
}

const inputClass =
  'w-full rounded-[10px] border border-white/[0.08] bg-[#111114] px-3.5 py-2.5 text-sm text-[#EDEDF0] placeholder:text-[#A1A1AA] outline-none focus:border-[#8B9BFF]'

export function EditTestForm({
  clientSlug,
  test,
  variants: initialVariants,
}: {
  clientSlug: string
  test: {
    id: string
    name: string
    slug: string
    fallback_url: string | null
    test_type: 'page' | 'checkout'
    sales_page_url: string | null
  }
  variants: { id: string; name: string; weight_pct: number; destination_url: string; thank_you_url: string | null }[]
}) {
  const router = useRouter()
  const [fallbackUrl, setFallbackUrl] = useState(test.fallback_url ?? '')
  const [salesPageUrl, setSalesPageUrl] = useState(test.sales_page_url ?? '')
  const [variants, setVariants] = useState<VariantForm[]>(
    initialVariants.map((v) => ({
      id: v.id,
      name: v.name,
      weight_pct: String(v.weight_pct),
      destination_url: v.destination_url,
      thank_you_url: v.thank_you_url ?? '',
    }))
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const weightsValid = weightsSumTo100(variants.map((v) => Number(v.weight_pct)))

  function updateVariant(index: number, field: 'weight_pct' | 'destination_url' | 'thank_you_url', value: string) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!weightsValid) {
      setError('Os pesos das variantes devem somar 100%')
      return
    }
    setSaving(true)
    try {
      await updateTest({
        test_id: test.id,
        client_slug: clientSlug,
        test_slug: test.slug,
        fallback_url: fallbackUrl,
        test_type: test.test_type,
        sales_page_url: salesPageUrl,
        variants: variants.map((v) => ({
          id: v.id,
          weight_pct: Number(v.weight_pct),
          destination_url: v.destination_url,
          thank_you_url: v.thank_you_url,
        })),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar teste')
      setSaving(false)
      return
    }
    router.push(`/dashboard/clients/${clientSlug}/tests/${test.slug}`)
  }

  return (
    <div className="p-8">
      <a
        href={`/dashboard/clients/${clientSlug}/tests/${test.slug}`}
        className="mb-4 flex items-center gap-1 text-xs text-[#A1A1AA] hover:text-[#EDEDF0]"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M6.5 2L3 5L6.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {test.name}
      </a>

      <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
        <h1 className="font-['Space_Grotesk'] text-lg font-semibold">Editar teste — {test.name}</h1>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[#A1A1AA]">URL de fallback (opcional)</label>
          <input
            placeholder="URL de fallback (opcional)"
            value={fallbackUrl}
            onChange={(e) => setFallbackUrl(e.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-[#A1A1AA]">Pra onde mandar o visitante se o teste for pausado</p>
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[#A1A1AA]">Tipo de teste</label>
          <p className="rounded-[10px] border border-white/[0.08] bg-[#111114] px-3.5 py-2.5 text-sm text-[#A1A1AA]">
            {test.test_type === 'checkout' ? 'Teste de checkout' : 'Teste de página'} — não pode ser alterado
            depois de criado
          </p>
        </div>

        {test.test_type === 'checkout' && (
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[#A1A1AA]">URL da página de vendas</label>
            <input
              placeholder="URL da página de vendas"
              value={salesPageUrl}
              onChange={(e) => setSalesPageUrl(e.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-[#A1A1AA]">A única página de vendas usada por todas as variantes</p>
          </div>
        )}

        {variants.map((variant, index) => (
          <fieldset key={variant.id} className="space-y-2 rounded-[10px] border border-white/[0.08] p-3">
            <legend className="px-1 text-sm font-medium text-[#A1A1AA]">Variante {variant.name}</legend>
            <input
              placeholder="Peso %"
              value={variant.weight_pct}
              onChange={(e) => updateVariant(index, 'weight_pct', e.target.value)}
              className={inputClass}
            />
            <p className="-mt-1 text-xs text-[#A1A1AA]">
              Porcentagem do tráfego pra essa variante — a soma de todas precisa dar 100%
            </p>
            <input
              placeholder={test.test_type === 'checkout' ? 'Link do checkout' : 'URL de destino'}
              value={variant.destination_url}
              onChange={(e) => updateVariant(index, 'destination_url', e.target.value)}
              className={inputClass}
            />
            <p className="-mt-1 text-xs text-[#A1A1AA]">
              {test.test_type === 'checkout'
                ? 'Link de pagamento da Hubla pra essa variante'
                : 'Página de vendas dessa variante'}
            </p>
            <input
              placeholder="URL de thank-you (opcional)"
              value={variant.thank_you_url}
              onChange={(e) => updateVariant(index, 'thank_you_url', e.target.value)}
              className={inputClass}
            />
            <p className="-mt-1 text-xs text-[#A1A1AA]">
              Página que o cliente vê depois de comprar — cole o snippet do pixel nela
            </p>
          </fieldset>
        ))}

        {!weightsValid && <p className="text-sm text-[#F2B866]">Os pesos devem somar 100%.</p>}
        {error && <p className="text-sm text-[#FF7A73]">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-[10px] bg-[#8B9BFF] px-4 py-2.5 text-sm font-semibold text-[#000000] disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
          <a
            href={`/dashboard/clients/${clientSlug}/tests/${test.slug}`}
            className="flex items-center rounded-[10px] border border-white/[0.08] px-4 py-2.5 text-sm font-medium text-[#A1A1AA]"
          >
            Cancelar
          </a>
        </div>
      </form>
    </div>
  )
}
