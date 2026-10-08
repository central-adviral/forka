import { ROUTE_FIELDS, type VariantRoute } from '@/lib/domain/routing'
import { addRoute, deleteRoute } from '../actions'

// "Regras de destino": per variant, the pages a person goes to by the ad's name, the source or the
// device. The draw stays as it is; the rule only picks the page after it.

const field =
  'rounded-[10px] border border-[var(--ct-line)] bg-[var(--ct-surface-2)] px-3 py-2 text-[13px] text-[var(--ct-text)] outline-none focus:border-[var(--ct-accent)]'
const label = (value: string) => ROUTE_FIELDS.find((option) => option.value === value)?.label ?? value

export function RoutesEditor({
  clientSlug,
  testSlug,
  testId,
  variants,
  error,
}: {
  clientSlug: string
  testSlug: string
  testId: string
  variants: { id: string; name: string; destination_url: string; variant_routes: (VariantRoute & { position: number })[] }[]
  error?: string
}) {
  return (
    <section id="rotas" className="mx-auto mt-10 flex max-w-[720px] flex-col gap-4 px-4 pb-24">
      <div>
        <h2 className="text-[18px] font-semibold">Destinos</h2>
        <p className="mt-1 text-[13px] text-[var(--ct-text-2)]">
          O link continua sorteando a variante pelo peso. Depois do sorteio, o primeiro destino da variante que bater com o clique escolhe a página. Sem destino
          que bata, vale a página da variante. Use para &quot;página casada × genérica&quot;: o controle fica com a página genérica e a variante casada manda
          cada criativo para a sua página.
        </p>
      </div>
      {error && <p role="alert" className="rounded-[10px] bg-[var(--ct-crit-soft)] px-4 py-2.5 text-[13px] text-[var(--ct-crit)]">{error}</p>}

      {variants.map((variant) => (
        <div key={variant.id} className="flex flex-col gap-3 rounded-2xl border border-[var(--ct-line)] bg-[var(--ct-surface)] px-5 py-4">
          <div>
            <b className="text-[14px]">{variant.name}</b>
            <p className="truncate text-[12px] text-[var(--ct-text-3)]">Sem destino que bata: {variant.destination_url}</p>
          </div>
          {variant.variant_routes.length > 0 && (
            <ol className="flex flex-col gap-1.5">
              {[...variant.variant_routes].sort((a, b) => a.position - b.position).map((route, index) => (
                <li key={route.id} className="flex flex-wrap items-center gap-2 rounded-[10px] bg-[var(--ct-surface-2)] px-3 py-2 text-[12.5px]">
                  <span className="font-[family-name:var(--font-geist-mono)] text-[var(--ct-text-3)]">{index + 1}.</span>
                  <span className="text-[var(--ct-text-2)]">{label(route.match_field)}</span>
                  <b>{route.match_value}</b>
                  <span className="text-[var(--ct-text-3)]">→</span>
                  <span className="min-w-0 flex-1 truncate">{route.destination_url}</span>
                  <form action={deleteRoute.bind(null, { client_slug: clientSlug, test_slug: testSlug, route_id: route.id })}>
                    <button type="submit" className="text-[12px] text-[var(--ct-crit)]">remover</button>
                  </form>
                </li>
              ))}
            </ol>
          )}
          <form
            action={addRoute.bind(null, { client_slug: clientSlug, test_slug: testSlug, test_id: testId, variant_id: variant.id })}
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_auto]"
          >
            <select name="match_field" className={field} aria-label="Condição">
              {ROUTE_FIELDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input name="match_value" required placeholder="[dor], instagram, celular" className={field} aria-label="Valor" />
            <input name="destination_url" required placeholder="https:// página para onde vai" className={field} aria-label="Página de destino" />
            <button type="submit" className="rounded-full border border-[var(--ct-line-2)] px-3 py-2 text-[12.5px]">Adicionar destino</button>
          </form>
        </div>
      ))}
    </section>
  )
}
