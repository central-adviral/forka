'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReportLayout } from '@/lib/domain/report-layout'
import { clampZoom, computeFitZoom } from '@/lib/domain/canvas-zoom'

const ZOOM_STEP = 0.1
const CANVAS_PADDING = 40

export function ReportCanvas({
  layout,
  redirectUrl,
  totalVisits,
  fallbackUrl,
  confidenceLabelById,
  assetLabel,
}: {
  layout: ReportLayout
  redirectUrl: string
  totalVisits: number
  fallbackUrl: string | null
  confidenceLabelById: Map<string, string>
  assetLabel: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [autoFit, setAutoFit] = useState(true)

  const fullWidth = layout.canvasWidth + CANVAS_PADDING
  const fullHeight = layout.canvasHeight + CANVAS_PADDING

  useEffect(() => {
    const container = containerRef.current
    if (!container || !autoFit) return

    function computeFit() {
      if (!container) return
      setZoom(computeFitZoom(container.clientWidth, container.clientHeight, fullWidth, fullHeight))
    }

    computeFit()
    const observer = new ResizeObserver(computeFit)
    observer.observe(container)
    return () => observer.disconnect()
  }, [autoFit, fullWidth, fullHeight])

  function zoomBy(delta: number) {
    setAutoFit(false)
    setZoom((current) => clampZoom(current + delta))
  }

  return (
    <div
      ref={containerRef}
      className="relative m-4 h-[440px] flex-shrink-0 sm:m-6 sm:h-[720px] overflow-auto rounded-2xl border border-[var(--ct-line)]"
      style={{
        // Two faint pools of light — violet where traffic enters, amber near the leader — so the
        // canvas has depth instead of reading as a flat panel.
        background:
          'radial-gradient(120% 90% at 8% 10%, rgba(124,111,240,0.08), transparent 55%), radial-gradient(90% 70% at 92% 85%, rgba(245,185,77,0.06), transparent 55%), var(--ct-bg)',
      }}
    >
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-[10px] border border-[var(--ct-line)] card-shadow bg-[var(--ct-surface-3)] px-1.5 py-1.5">
        <button
          type="button"
          onClick={() => zoomBy(-ZOOM_STEP)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-sm font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]"
          aria-label="Diminuir zoom"
        >
          −
        </button>
        <span className="w-10 text-center font-[family-name:var(--font-geist-mono)] text-[11px] text-[var(--ct-text-2)]">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => zoomBy(ZOOM_STEP)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-sm font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]"
          aria-label="Aumentar zoom"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setAutoFit(true)}
          className="ml-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-[var(--ct-text-2)] hover:text-[var(--ct-text)]"
        >
          Ajustar
        </button>
      </div>

      <div
        style={{
          width: fullWidth,
          height: fullHeight,
          transform: `scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <svg
          width={layout.canvasWidth}
          height={layout.canvasHeight}
          viewBox={`0 0 ${layout.canvasWidth} ${layout.canvasHeight}`}
          className="absolute left-5 top-5"
          fill="none"
        >
          {layout.variants.map((variant) => (
            <path
              key={`traffic-${variant.id}`}
              className="flow-edge"
              d={variant.trafficEdge.path}
              stroke="#4F8EF7"
              strokeWidth={variant.trafficEdge.strokeWidth}
              strokeLinecap="round"
              opacity={0.55}
            />
          ))}
          {layout.variants.map((variant) => (
            <path
              key={`conversion-${variant.id}`}
              d={variant.conversionEdge.path}
              stroke={variant.conversionEdge.color}
              strokeWidth={variant.conversionEdge.strokeWidth}
              strokeLinecap="round"
              opacity={0.8}
            />
          ))}
          {layout.fallback && (
            <path
              d={layout.fallback.edge.path}
              stroke="#FF7A73"
              strokeWidth={2}
              strokeDasharray="5 5"
              strokeLinecap="round"
              opacity={0.5}
            />
          )}
        </svg>

        <div
          className="absolute rounded-xl border border-[var(--ct-line)] card-shadow bg-[var(--ct-surface-3)] p-[18px]"
          style={{ left: layout.entryNode.x + 20, top: layout.entryNode.y + 20, width: layout.entryNode.w, height: layout.entryNode.h }}
        >
          <div className="mb-2.5 font-[family-name:var(--font-geist-mono)] text-[10.5px] uppercase tracking-widest text-[var(--ct-text-2)]">
            Link do teste
          </div>
          <div className="mb-4 break-all font-[family-name:var(--font-geist-mono)] text-[12.5px] text-[var(--ct-an)]">{redirectUrl}</div>
          <div className="font-[family-name:var(--font-sora)] text-[22px] font-semibold">{totalVisits}</div>
          <div className="text-[11.5px] text-[var(--ct-text-2)]">acessos totais</div>
        </div>

        {layout.fallback && (
          <div
            className="absolute rounded-[10px] border border-[var(--ct-crit)]/30 card-shadow bg-[var(--ct-surface-3)] px-3.5 py-2.5 opacity-85"
            style={{ left: layout.fallback.node.x + 20, top: layout.fallback.node.y + 20, width: layout.fallback.node.w }}
          >
            <div className="mb-0.5 text-[10.5px] uppercase tracking-wide text-[var(--ct-crit)]">Fallback</div>
            <div className="font-[family-name:var(--font-geist-mono)] text-[11.5px] text-[var(--ct-text-2)]">{fallbackUrl}</div>
          </div>
        )}

        {layout.variants.map((variant) => (
          <div key={variant.id}>
            <div
              className={`absolute rounded-xl border card-shadow bg-[var(--ct-surface-3)] p-[18px_20px] ${
                variant.isLeader
                  ? 'border-[var(--ct-warn)] shadow-[0_0_0_3px_rgba(245,185,77,0.14),0_0_32px_rgba(245,185,77,0.18),0_10px_28px_-12px_rgba(0,0,0,0.6)]'
                  : 'border-[var(--ct-line)]'
              }`}
              style={{ left: variant.node.x + 20, top: variant.node.y + 20, width: variant.node.w, height: variant.node.h }}
            >
              <div className="mb-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--ct-an)]" />
                  <span className="font-[family-name:var(--font-sora)] text-[15px] font-semibold">
                    {assetLabel} {variant.name}
                  </span>
                  {variant.isLeader && (
                    <span className="rounded-full bg-[var(--ct-warn)]/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ct-warn)]">
                      Líder
                    </span>
                  )}
                </div>
                <span className="rounded-full bg-[var(--ct-surface-2)] px-2.5 py-0.5 font-[family-name:var(--font-geist-mono)] text-[11.5px] text-[var(--ct-text-2)]">
                  alvo {variant.weightPct}%
                </span>
              </div>
              <div className="mb-3.5 grid grid-cols-2 gap-x-7 gap-y-2.5">
                <div>
                  <div className="font-[family-name:var(--font-geist-mono)] text-base font-medium">{variant.visits}</div>
                  <div className="text-[11px] text-[var(--ct-text-2)]">acessos</div>
                </div>
                <div>
                  <div className="font-[family-name:var(--font-geist-mono)] text-base font-medium">{variant.conversions}</div>
                  <div className="text-[11px] text-[var(--ct-text-2)]">conversões</div>
                </div>
                <div>
                  <div className="font-[family-name:var(--font-geist-mono)] text-base font-medium">
                    R$ {(variant.visits > 0 ? variant.revenueCents / variant.visits / 100 : 0).toFixed(2)}
                  </div>
                  <div className="text-[11px] text-[var(--ct-text-2)]">R$/clique</div>
                </div>
                <div>
                  <div className="font-[family-name:var(--font-geist-mono)] text-base font-medium">
                    R${' '}
                    {(variant.uniqueVisitors > 0
                      ? variant.revenueCents / variant.uniqueVisitors / 100
                      : 0
                    ).toFixed(2)}
                  </div>
                  <div className="text-[11px] text-[var(--ct-text-2)]">R$/acesso</div>
                </div>
              </div>
              <div className="truncate border-t border-[var(--ct-line)] pt-3 font-[family-name:var(--font-geist-mono)] text-xs text-[var(--ct-text-2)]">
                {variant.destinationUrl}
              </div>
            </div>

            <div
              className={`absolute flex flex-col justify-center rounded-xl border card-shadow bg-[var(--ct-surface-3)] p-4 ${
                variant.isLeader
                  ? 'border-[var(--ct-warn)] shadow-[0_0_24px_rgba(245,185,77,0.14),0_10px_28px_-12px_rgba(0,0,0,0.6)]'
                  : 'border-[var(--ct-line)]'
              }`}
              style={{
                left: variant.conversionNode.x + 20,
                top: variant.conversionNode.y + 20,
                width: variant.conversionNode.w,
                height: variant.conversionNode.h,
              }}
            >
              <div className="mb-2 text-[10.5px] uppercase tracking-wide text-[var(--ct-text-2)]">Conversão</div>
              <div
                className="font-[family-name:var(--font-geist-mono)] text-[26px] font-semibold leading-none"
                style={{ color: variant.isLeader ? 'var(--ct-warn)' : 'var(--ct-ok)' }}
              >
                {variant.ratePct.toFixed(1)}%
              </div>
              <div className="mt-1 text-[11.5px] text-[var(--ct-text-2)]">
                {variant.conversions} vendas · {confidenceLabelById.get(variant.id)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
