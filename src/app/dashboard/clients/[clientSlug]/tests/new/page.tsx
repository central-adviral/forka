'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { createTest } from '../../actions'
import { weightsSumTo100 } from '@/lib/domain/validate-weights'
import { createBrowserSupabaseClient } from '@/lib/supabase/browser'

interface VariantForm {
  name: string
  weight_pct: string
  destination_url: string
  thank_you_url: string
}

export default function NewTestPage() {
  const params = useParams<{ clientSlug: string }>()
  const [clientId, setClientId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [fallbackUrl, setFallbackUrl] = useState('')
  const [conversionMethod, setConversionMethod] = useState<'hubla_webhook' | 'thank_you_page'>('hubla_webhook')
  const [variants, setVariants] = useState<VariantForm[]>([
    { name: 'A', weight_pct: '50', destination_url: '', thank_you_url: '' },
    { name: 'B', weight_pct: '50', destination_url: '', thank_you_url: '' },
  ])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    supabase
      .from('clients')
      .select('id')
      .eq('slug', params.clientSlug)
      .single()
      .then(({ data }) => setClientId(data?.id ?? null))
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
    try {
      await createTest({
        client_id: clientId,
        client_slug: params.clientSlug,
        name,
        slug,
        fallback_url: fallbackUrl,
        conversion_method: conversionMethod,
        variants: variants.map((v) => ({
          name: v.name,
          weight_pct: Number(v.weight_pct),
          destination_url: v.destination_url,
          thank_you_url: v.thank_you_url,
        })),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar teste')
    }
  }

  function updateVariant(index: number, field: keyof VariantForm, value: string) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)))
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
      <h1 className="text-lg font-semibold">Novo teste</h1>
      <input required placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border px-3 py-2" />
      <input required placeholder="Slug (ex: oferta-x)" value={slug} onChange={(e) => setSlug(e.target.value)} className="w-full rounded border px-3 py-2" />
      <input placeholder="URL de fallback (opcional)" value={fallbackUrl} onChange={(e) => setFallbackUrl(e.target.value)} className="w-full rounded border px-3 py-2" />
      <select value={conversionMethod} onChange={(e) => setConversionMethod(e.target.value as typeof conversionMethod)} className="w-full rounded border px-3 py-2">
        <option value="hubla_webhook">Venda (webhook Hubla)</option>
        <option value="thank_you_page">Captura (thank-you page)</option>
      </select>

      {variants.map((variant, index) => (
        <fieldset key={index} className="space-y-2 rounded border p-3">
          <legend className="text-sm font-medium">Variante {variant.name}</legend>
          <input placeholder="Peso %" value={variant.weight_pct} onChange={(e) => updateVariant(index, 'weight_pct', e.target.value)} className="w-full rounded border px-3 py-2" />
          <input placeholder="URL de destino" value={variant.destination_url} onChange={(e) => updateVariant(index, 'destination_url', e.target.value)} className="w-full rounded border px-3 py-2" />
          {conversionMethod === 'thank_you_page' && (
            <input placeholder="URL de thank-you" value={variant.thank_you_url} onChange={(e) => updateVariant(index, 'thank_you_url', e.target.value)} className="w-full rounded border px-3 py-2" />
          )}
        </fieldset>
      ))}

      <button
        type="button"
        onClick={() => setVariants((prev) => [...prev, { name: String.fromCharCode(65 + prev.length), weight_pct: '0', destination_url: '', thank_you_url: '' }])}
        className="text-sm text-blue-600 underline"
      >
        + Adicionar variante
      </button>

      {!weightsValid && <p className="text-sm text-amber-600">Os pesos devem somar 100%.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" className="rounded bg-black px-3 py-2 text-white">
        Criar teste
      </button>
    </form>
  )
}
