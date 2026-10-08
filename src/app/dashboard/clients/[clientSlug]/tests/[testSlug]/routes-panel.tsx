import { ROUTE_FIELDS } from '@/lib/domain/routing'
import { readRoutes, type RouteReadoutVariant, type SegmentRow, type Totals } from '@/lib/domain/route-readout'
import { TH_CLASS, TD_CLASS, TR_CLASS } from './report-cells'

const money = (cents: number) => `R$ ${(cents / 100).toFixed(2)}`
const rate = (totals: Totals) => (totals.people > 0 ? `${((totals.buyers / totals.people) * 100).toFixed(1)}%` : '—')
const perPerson = (totals: Totals) => (totals.people > 0 ? money(totals.revenueCents / totals.people) : '—')
const fieldLabel = (value: string) => ROUTE_FIELDS.find((option) => option.value === value)?.label ?? value

export function RoutesPanel({ variants, segments }: { variants: RouteReadoutVariant[]; segments: SegmentRow[] }) {
  const readout = readRoutes(variants, segments)
  const controlName = variants.find((variant) => variant.is_control)?.name ?? 'controle'

  return (
    <div className="mx-6 mb-6">
      <h2 className="mb-1 mt-8 font-[family-name:var(--font-sora)] text-lg font-semibold">Por regra de destino</h2>
      <p className="mb-4 max-w-[760px] text-[13px] text-[var(--ct-text-2)]">
        Cada regra é comparada com o mesmo público no {controlName}: quem tem a mesma condição (anúncio, origem ou dispositivo) e caiu no controle. Assim a
        diferença é da página, não do anúncio. Conte a partir do dia em que as regras foram criadas: antes disso ninguém foi roteado.
      </p>
      {readout.map(({ variant, lines }) => (
        <div key={variant.id} className="mb-6 overflow-x-auto rounded-2xl border border-[var(--ct-line)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--ct-line)] bg-[var(--ct-surface-2)] text-left">
                <th className={TH_CLASS}>{variant.name}</th>
                <th className={TH_CLASS}>Pessoas</th>
                <th className={TH_CLASS}>Compradores</th>
                <th className={TH_CLASS}>Conversão</th>
                <th className={TH_CLASS}>R$/pessoa</th>
                <th className={TH_CLASS}>Mesmo público no {controlName}</th>
                <th className={TH_CLASS}>Chance de ganhar</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.route?.id ?? 'variant-page'} className={TR_CLASS}>
                  <td className={TD_CLASS}>
                    {line.route ? (
                      <>
                        <span className="text-[var(--ct-text-2)]">{fieldLabel(line.route.match_field)}</span> <b>{line.route.match_value}</b>
                        <div className="max-w-[280px] truncate text-[12px] text-[var(--ct-text-3)]">{line.route.destination_url}</div>
                      </>
                    ) : (
                      <span className="text-[var(--ct-text-2)]">Sem regra (página da variante)</span>
                    )}
                  </td>
                  <td className={TD_CLASS}>{line.routed.people}</td>
                  <td className={TD_CLASS}>{line.routed.buyers}</td>
                  <td className={TD_CLASS}>{rate(line.routed)}</td>
                  <td className={TD_CLASS}>{perPerson(line.routed)}</td>
                  <td className={TD_CLASS}>
                    {line.sameAudience ? `${rate(line.sameAudience)} de ${line.sameAudience.people} · ${perPerson(line.sameAudience)}/pessoa` : '—'}
                  </td>
                  <td className={TD_CLASS}>
                    {line.chance === null ? '—' : `${Math.round(line.chance * 100)}%`}
                    {line.thin && line.chance !== null && <span className="ml-1.5 text-[11px] text-[var(--ct-warn)]">amostra pequena</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
