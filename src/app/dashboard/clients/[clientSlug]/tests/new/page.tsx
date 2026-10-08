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
  'w-full rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3.5 py-2.5 text-sm text-[var(--ct-text)] placeholder:text-[var(--ct-text-2)] outline-none focus:border-[var(--ct-accent)]'

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
  const [funnels, setFunnels] = useState<{ id: string; name: string }[]>([])
  const [salesFunnelId, setSalesFunnelId] = useState('')
  const [occupant, setOccupant] = useState<{ key: string; name: string } | null>(null)
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
      .then(async ({ data, error }) => {
        if (error) {
          setError('Não foi possível carregar o cliente. Recarregue a página.')
        } else {
          setClientId(data?.id ?? null)
          const { data: projects } = await supabase.from('sales_funnels').select('id, name').eq('client_id', data.id).is('archived_at', null).order('name')
          setFunnels(projects ?? [])
        }
        setClientLoading(false)
      })
  }, [params.clientSlug])

  // Several tests of one type can run in a project (0087); the gestor is told which one already runs,
  // so the two get different ads. The answer is kept with the project and type it was asked for.
  const layerKey = `${salesFunnelId}:${testType}`
  useEffect(() => {
    if (!salesFunnelId) return
    let cancelled = false
    createBrowserSupabaseClient()
      .from('tests')
      .select('name')
      .eq('sales_funnel_id', salesFunnelId)
      .eq('test_type', testType)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setOccupant(data ? { key: `${salesFunnelId}:${testType}`, name: data.name } : null)
      })
    return () => {
      cancelled = true
    }
  }, [salesFunnelId, testType])
  const layerTakenBy = salesFunnelId && occupant?.key === layerKey ? occupant.name : null

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
        sales_funnel_id: salesFunnelId,
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
    router.push(`/dashboard/clients/${params.clientSlug}/tests?created=1`)
  }

  function updateVariant(index: number, field: keyof VariantForm, value: string) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)))
  }

  function removeVariant(index: number) {
    setVariants((prev) => prev.filter((_, i) => i !== index))
  }

  const testTypes = [
    { value: 'page' as const, title: 'Teste de página', text: 'Cada variante é uma página de vendas diferente.', glyph: '▤' },
    { value: 'checkout' as const, title: 'Teste de checkout', text: 'Mesma página para todos; cada variante é um checkout.', glyph: '▣' },
  ]
  const methods = [
    { value: 'hubla_webhook' as const, title: 'Venda', text: 'A Hubla avisa cada compra pelo webhook.' },
    { value: 'thank_you_page' as const, title: 'Captura', text: 'Conta quem chega na página de obrigado.' },
  ]

  return (
    <div className="px-4 py-8 sm:px-8">
      <form onSubmit={handleSubmit} className="mx-auto flex max-w-[760px] flex-col gap-5 pb-24">
        <div>
          <h1 className="font-[family-name:var(--font-sora)] text-[22px] font-semibold">Novo teste</h1>
          <p className="mt-1 text-[13px] text-[var(--ct-text-2)]">Um link que sorteia cada pessoa entre as variantes e mede qual vende mais.</p>
        </div>

        <Section step={1} title="O teste">
          <Field label="Nome">
            <input required placeholder="ex: Selo de garantia na oferta" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Link do anúncio" hint="Curto e reconhecível. É o que vai no anúncio.">
            <div className="flex items-stretch overflow-hidden rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] focus-within:border-[var(--ct-accent)]">
              <span className="flex items-center border-r border-[var(--ct-line)] px-3 font-[family-name:var(--font-geist-mono)] text-[12.5px] text-[var(--ct-text-3)]">/r/</span>
              <input
                required
                placeholder="oferta-x"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="w-full bg-transparent px-3 py-2.5 font-[family-name:var(--font-geist-mono)] text-sm text-[var(--ct-text)] outline-none placeholder:text-[var(--ct-text-3)]"
              />
            </div>
          </Field>
          <Field
            label="Projeto"
            hint="Com projeto, a venda só conta para os testes dele, e testes de página e de checkout rodam juntos."
          >
            <select value={salesFunnelId} onChange={(e) => setSalesFunnelId(e.target.value)} className={inputClass}>
              <option value="">Sem projeto</option>
              {funnels.map((funnel) => (
                <option key={funnel.id} value={funnel.id}>
                  {funnel.name}
                </option>
              ))}
            </select>
          </Field>
          {layerTakenBy && (
            <p className="rounded-[10px] bg-[var(--ct-an-soft)] px-3 py-2 text-xs text-[var(--ct-an)]">
              Este projeto já roda o teste de {testType === 'checkout' ? 'checkout' : 'página'} <b>{layerTakenBy}</b>. Os dois podem rodar juntos: use anúncios
              diferentes em cada link. Quem passar pelos dois links conta nos dois testes.
            </p>
          )}
        </Section>

        <Section step={2} title="O que você vai testar">
          <div role="radiogroup" aria-label="Tipo de teste" className="grid gap-3 sm:grid-cols-2">
            {testTypes.map((option) => (
              <Choice key={option.value} name="test_type" checked={testType === option.value} onChange={() => setTestType(option.value)}>
                <span className="text-[20px] leading-none text-[var(--ct-accent)]" aria-hidden>
                  {option.glyph}
                </span>
                <b className="mt-2 block text-[14px]">{option.title}</b>
                <span className="mt-0.5 block text-[12.5px] text-[var(--ct-text-2)]">{option.text}</span>
              </Choice>
            ))}
          </div>
          {testType === 'checkout' && (
            <Field label="Página de vendas" hint="A única página usada por todas as variantes.">
              <input placeholder="https://" value={salesPageUrl} onChange={(e) => setSalesPageUrl(e.target.value)} className={inputClass} />
            </Field>
          )}
        </Section>

        <Section step={3} title="Como contar a conversão">
          <div role="radiogroup" aria-label="Conversão" className="grid gap-3 sm:grid-cols-2">
            {methods.map((option) => (
              <Choice key={option.value} name="conversion_method" checked={conversionMethod === option.value} onChange={() => setConversionMethod(option.value)}>
                <b className="block text-[14px]">{option.title}</b>
                <span className="mt-0.5 block text-[12.5px] text-[var(--ct-text-2)]">{option.text}</span>
              </Choice>
            ))}
          </div>
        </Section>

        <Section step={4} title="Variantes">
          <div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-[var(--ct-surface-3)]" aria-hidden>
              {variants.map((variant, index) => (
                <div key={index} style={{ width: `${Math.max(0, Number(variant.weight_pct) || 0)}%`, background: VARIANT_COLORS[index % VARIANT_COLORS.length] }} />
              ))}
            </div>
            <p className={`mt-1.5 text-[12px] ${weightsValid ? 'text-[var(--ct-text-3)]' : 'text-[var(--ct-warn)]'}`}>
              {variants.map((variant) => `${variant.name} ${variant.weight_pct || 0}%`).join(' · ')}
              {weightsValid ? '' : ' — os pesos precisam somar 100%'}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {variants.map((variant, index) => (
              <div key={index} className="flex flex-col gap-3 rounded-[12px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] p-4">
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold text-[var(--ct-on-accent)]"
                    style={{ background: VARIANT_COLORS[index % VARIANT_COLORS.length] }}
                  >
                    {variant.name}
                  </span>
                  <b className="text-[14px]">Variante {variant.name}</b>
                  {index === 0 && (
                    <span className="rounded-full bg-[var(--ct-accent)]/15 px-2 py-0.5 text-[10.5px] font-medium text-[var(--ct-accent)]">controle</span>
                  )}
                  {variants.length > 2 && (
                    <button type="button" onClick={() => removeVariant(index)} className="ml-auto text-xs font-medium text-[var(--ct-crit)] hover:underline">
                      Remover
                    </button>
                  )}
                </div>
                <Field label="Tráfego">
                  <div className="flex items-stretch overflow-hidden rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface)] focus-within:border-[var(--ct-accent)]">
                    <input
                      inputMode="numeric"
                      aria-label={`Peso da variante ${variant.name}`}
                      value={variant.weight_pct}
                      onChange={(e) => updateVariant(index, 'weight_pct', e.target.value)}
                      className="w-full bg-transparent px-3 py-2 text-sm text-[var(--ct-text)] outline-none"
                    />
                    <span className="flex items-center px-3 text-[12.5px] text-[var(--ct-text-3)]">%</span>
                  </div>
                </Field>
                <Field label={testType === 'checkout' ? 'Link do checkout' : 'Página de vendas'}>
                  <input
                    placeholder={testType === 'checkout' ? 'https://pay.hub.la/...' : 'https://'}
                    value={variant.destination_url}
                    onChange={(e) => updateVariant(index, 'destination_url', e.target.value)}
                    className={inputClass}
                  />
                </Field>
                {conversionMethod === 'thank_you_page' && (
                  <Field label="Página de obrigado" hint="Cole nela o snippet do pixel.">
                    <input placeholder="https://" value={variant.thank_you_url} onChange={(e) => updateVariant(index, 'thank_you_url', e.target.value)} className={inputClass} />
                  </Field>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setVariants((prev) => [...prev, { name: String.fromCharCode(65 + prev.length), weight_pct: '0', destination_url: '', thank_you_url: '' }])
              }
              className="flex min-h-[120px] items-center justify-center rounded-[12px] border border-dashed border-[var(--ct-line-2)] text-sm font-medium text-[var(--ct-accent)] hover:bg-[var(--ct-surface-2)]"
            >
              + Adicionar variante
            </button>
          </div>
        </Section>

        <details className="rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-5 py-4">
          <summary className="cursor-pointer text-[13px] font-medium text-[var(--ct-text-2)]">Avançado</summary>
          <div className="mt-3">
            <Field label="Página se o teste for pausado" hint="Opcional. Sem ela, o link pausado manda para o controle.">
              <input placeholder="https://" value={fallbackUrl} onChange={(e) => setFallbackUrl(e.target.value)} className={inputClass} />
            </Field>
          </div>
        </details>

        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-[var(--ct-line)] bg-[var(--ct-bg)]/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-[14px] sm:border">
          {clientLoading && <p className="text-sm text-[var(--ct-text-2)]">Carregando...</p>}
          {error && <p role="alert" className="text-sm text-[var(--ct-crit)]">{error}</p>}
          <button
            type="submit"
            disabled={!clientId}
            className="ml-auto rounded-full bg-[var(--ct-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--ct-on-accent)] hover:brightness-110 disabled:opacity-50"
          >
            Criar teste
          </button>
        </div>
      </form>
    </div>
  )
}

const VARIANT_COLORS = ['var(--ct-accent)', 'var(--ct-an)', 'var(--ct-ok)', 'var(--ct-warn)', 'var(--ct-crit)']

function Section({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-[14px] border border-[var(--ct-line)] bg-[var(--ct-surface)] px-5 py-5">
      <h2 className="flex items-center gap-2.5 text-[15px] font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--ct-surface-3)] font-[family-name:var(--font-geist-mono)] text-[12px] text-[var(--ct-text-2)]">
          {step}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-[var(--ct-text-2)]">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-[var(--ct-text-3)]">{hint}</span>}
    </label>
  )
}

function Choice({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label
      className={`cursor-pointer rounded-[12px] border p-4 transition-colors ${
        checked ? 'border-[var(--ct-accent)] bg-[var(--ct-accent)]/10' : 'border-[var(--ct-line)] bg-[var(--ct-surface-2)] hover:border-[var(--ct-line-2)]'
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      {children}
    </label>
  )
}
