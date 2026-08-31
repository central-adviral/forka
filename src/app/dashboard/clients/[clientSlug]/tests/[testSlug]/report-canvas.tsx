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
    <div ref={containerRef} className="relative m-6 h-[640px] flex-shrink-0 overflow-auto rounded-2xl border border-white/[0.08]">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-[10px] border border-white/[0.08] bg-[#141829] px-1.5 py-1.5">
        <button
          type="button"
          onClick={() => zoomBy(-ZOOM_STEP)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-sm font-medium text-[#8A90A6] hover:text-[#E8EAF2]"
          aria-label="Diminuir zoom"
        >
          −
        </button>
        <span className="w-10 text-center font-['JetBrains_Mono'] text-[11px] text-[#8A90A6]">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => zoomBy(ZOOM_STEP)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-sm font-medium text-[#8A90A6] hover:text-[#E8EAF2]"
          aria-label="Aumentar zoom"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setAutoFit(true)}
          className="ml-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-[#8A90A6] hover:text-[#E8EAF2]"
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
              stroke="#F76C6C"
              strokeWidth={2}
              strokeDasharray="5 5"
              strokeLinecap="round"
              opacity={0.5}
            />
          )}
        </svg>

        <div
          className="absolute rounded-xl border border-white/[0.08] bg-[#141829] p-[18px]"
          style={{ left: layout.entryNode.x + 20, top: layout.entryNode.y + 20, width: layout.entryNode.w, height: layout.entryNode.h }}
        >
          <div className="mb-2.5 font-['JetBrains_Mono'] text-[10.5px] uppercase tracking-widest text-[#8A90A6]">
            Link do teste
          </div>
          <div className="mb-4 break-all font-['JetBrains_Mono'] text-[12.5px] text-[#4F8EF7]">{redirectUrl}</div>
          <div className="font-['Space_Grotesk'] text-[22px] font-semibold">{totalVisits}</div>
          <div className="text-[11.5px] text-[#8A90A6]">acessos totais</div>
        </div>

        {layout.fallback && (
          <div
            className="absolute rounded-[10px] border border-[#F76C6C]/30 bg-[#141829] px-3.5 py-2.5 opacity-85"
            style={{ left: layout.fallback.node.x + 20, top: layout.fallback.node.y + 20, width: layout.fallback.node.w }}
          >
            <div className="mb-0.5 text-[10.5px] uppercase tracking-wide text-[#F76C6C]">Fallback</div>
            <div className="font-['JetBrains_Mono'] text-[11.5px] text-[#8A90A6]">{fallbackUrl}</div>
          </div>
        )}

        {layout.variants.map((variant) => (
          <div key={variant.id}>
            <div
              className={`absolute rounded-xl border bg-[#141829] p-[18px_20px] ${
                variant.isLeader
                  ? 'border-[#F5B94D] shadow-[0_0_0_3px_rgba(245,185,77,0.14),0_0_32px_rgba(245,185,77,0.18)]'
                  : 'border-white/[0.08]'
              }`}
              style={{ left: variant.node.x + 20, top: variant.node.y + 20, width: variant.node.w, height: variant.node.h }}
            >
              <div className="mb-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-[#4F8EF7]" />
                  <span className="font-['Space_Grotesk'] text-[15px] font-semibold">
                    {assetLabel} {variant.name}
                  </span>
                  {variant.isLeader && (
                    <span className="rounded-full bg-[#F5B94D]/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#F5B94D]">
                      Líder
                    </span>
                  )}
                </div>
                <span className="rounded-full bg-[#1B2036] px-2.5 py-0.5 font-['JetBrains_Mono'] text-[11.5px] text-[#8A90A6]">
                  alvo {variant.weightPct}%
                </span>
              </div>
              <div className="mb-3.5 flex gap-7">
                <div>
                  <div className="font-['JetBrains_Mono'] text-base font-medium">{variant.visits}</div>
                  <div className="text-[11px] text-[#8A90A6]">acessos</div>
                </div>
                <div>
                  <div className="font-['JetBrains_Mono'] text-base font-medium">{variant.conversions}</div>
                  <div className="text-[11px] text-[#8A90A6]">conversões</div>
                </div>
                <div>
                  <div className="font-['JetBrains_Mono'] text-base font-medium">
                    R$ {(variant.visits > 0 ? variant.revenueCents / variant.visits / 100 : 0).toFixed(2)}
                  </div>
                  <div className="text-[11px] text-[#8A90A6]">R$/clique</div>
                </div>
              </div>
              <div className="truncate border-t border-white/[0.08] pt-3 font-['JetBrains_Mono'] text-xs text-[#8A90A6]">
                {variant.destinationUrl}
              </div>
            </div>

            <div
              className={`absolute flex flex-col justify-center rounded-xl border bg-[#141829] p-4 ${
                variant.isLeader ? 'border-[#F5B94D] shadow-[0_0_24px_rgba(245,185,77,0.14)]' : 'border-white/[0.08]'
              }`}
              style={{
                left: variant.conversionNode.x + 20,
                top: variant.conversionNode.y + 20,
                width: variant.conversionNode.w,
                height: variant.conversionNode.h,
              }}
            >
              <div className="mb-2 text-[10.5px] uppercase tracking-wide text-[#8A90A6]">Conversão</div>
              <div
                className="font-['JetBrains_Mono'] text-[26px] font-semibold leading-none"
                style={{ color: variant.isLeader ? '#F5B94D' : '#2DD4A8' }}
              >
                {variant.ratePct.toFixed(1)}%
              </div>
              <div className="mt-1 text-[11.5px] text-[#8A90A6]">
                {variant.conversions} vendas · {confidenceLabelById.get(variant.id)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
