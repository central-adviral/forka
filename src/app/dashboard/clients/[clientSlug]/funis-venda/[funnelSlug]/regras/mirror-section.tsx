'use client'

import { useState } from 'react'
import { MIRROR_MEASURES, type StageMeasure } from '@/lib/domain/funnel-stages'
import { PRODUCT_ROLES, PRODUCT_ROLE_LABEL, type ProductRole } from '@/lib/domain/product-roles'
import { DrawerSection, field, label, primaryButton, smallButton } from './stage-drawer'
import type { MirrorFields } from './stage-actions'
import type { CanvasStage } from './canvas-types'

export interface MirrorSource {
  id: string
  name: string
  products: string[]
}

const COUNTS_AS: Record<StageMeasure, string> = {
  alcance: '',
  lead: 'Cada comprador conta como lead desta etapa: o CPL é o gasto da etapa ÷ compradores.',
  visita: '',
  compra: 'Cada venda espelhada conta como venda desta etapa.',
  ascensao: 'Cada venda espelhada conta como ascensão desta etapa, seja qual for o papel dela no funil de origem.',
}

/** "Espelhar vendas de outro funil" (0108) in the stage drawer. */
export function MirrorSection({
  stage,
  sources,
  canEdit,
  pending,
  onSave,
}: {
  stage: CanvasStage
  sources: MirrorSource[]
  canEdit: boolean
  pending: boolean
  onSave: (fields: MirrorFields) => void
}) {
  const [funnelId, setFunnelId] = useState(stage.mirror?.funnelId ?? '')
  const [papeis, setPapeis] = useState<ProductRole[]>(stage.mirror?.papeis ?? ['entrada'])
  const [products, setProducts] = useState<string[]>(stage.mirror?.products ?? [])

  if (!MIRROR_MEASURES.includes(stage.measure)) {
    return (
      <DrawerSection title="Espelhar vendas de outro funil">
        <p className="text-[12.5px] text-[var(--ct-text-3)]">Só etapas de lead, compra ou ascensão espelham vendas.</p>
      </DrawerSection>
    )
  }

  // A source archived after it was chosen stays listed, so the choice reads as it is.
  const options = stage.mirror && !sources.some((source) => source.id === stage.mirror!.funnelId)
    ? [...sources, { id: stage.mirror.funnelId, name: stage.mirror.funnelName, products: [] }]
    : sources
  const source = options.find((option) => option.id === funnelId)
  const productOptions = [...new Set([...(source?.products ?? []), ...products])].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])

  return (
    <DrawerSection title="Espelhar vendas de outro funil">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(funnelId ? { funnelId, papeis, products } : null)
        }}
      >
        <fieldset disabled={!canEdit || pending} className="flex flex-col gap-3">
          <label className={label}>
            Funil de origem
            <select
              value={funnelId}
              onChange={(event) => {
                setFunnelId(event.target.value)
                setProducts([])
              }}
              className={field}
            >
              <option value="">nenhum: só as vendas deste funil</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          {funnelId && (
            <>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 text-xs font-medium text-[var(--ct-text-2)]">Papéis que contam</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {PRODUCT_ROLES.map((role) => (
                    <label key={role} className="flex items-center gap-1.5 text-[12.5px] text-[var(--ct-text-2)]">
                      <input type="checkbox" checked={papeis.includes(role)} onChange={() => setPapeis((current) => toggle(current, role))} />
                      {PRODUCT_ROLE_LABEL[role]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 text-xs font-medium text-[var(--ct-text-2)]">Produtos (opcional)</legend>
                {productOptions.length === 0 ? (
                  <p className="text-[12px] text-[var(--ct-text-3)]">O funil de origem ainda não tem produtos: contam todos dos papéis marcados.</p>
                ) : (
                  <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                    {productOptions.map((product) => (
                      <label key={product} className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-[var(--ct-text-2)]">
                        <input type="checkbox" checked={products.includes(product)} onChange={() => setProducts((current) => toggle(current, product))} />
                        <span className="truncate" title={product}>
                          {product}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-[12px] text-[var(--ct-text-3)]">Nenhum marcado: contam todos os produtos dos papéis marcados.</p>
              </fieldset>
              <p className="text-[12px] text-[var(--ct-text-3)]">{COUNTS_AS[stage.measure]}</p>
            </>
          )}
          <p className="text-[12px] text-[var(--ct-text-3)]">As vendas continuam no funil de origem; aqui elas só aparecem nesta etapa, dentro da janela.</p>
          {canEdit && (
            <div className="flex flex-wrap gap-1.5">
              <button type="submit" className={primaryButton} disabled={Boolean(funnelId) && papeis.length === 0}>
                {pending ? 'Salvando…' : 'Salvar espelho'}
              </button>
              {stage.mirror && (
                <button type="button" className={smallButton} onClick={() => onSave(null)}>
                  Parar de espelhar
                </button>
              )}
            </div>
          )}
        </fieldset>
      </form>
    </DrawerSection>
  )
}
