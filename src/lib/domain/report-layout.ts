export interface ReportVariantInput {
  id: string
  name: string
  weightPct: number
  visits: number
  uniqueVisitors: number
  conversions: number
  revenueCents: number
  destinationUrl: string
}

export interface ReportNode {
  x: number
  y: number
  w: number
  h: number
}

export interface ReportVariantLayout {
  id: string
  name: string
  weightPct: number
  visits: number
  uniqueVisitors: number
  conversions: number
  revenueCents: number
  ratePct: number
  destinationUrl: string
  isLeader: boolean
  node: ReportNode
  trafficEdge: { path: string; strokeWidth: number }
  conversionNode: ReportNode
  conversionEdge: { path: string; strokeWidth: number; color: string }
}

export interface ReportLayout {
  canvasWidth: number
  canvasHeight: number
  entryNode: ReportNode
  variants: ReportVariantLayout[]
  fallback: { node: ReportNode; edge: { path: string } } | null
}

const CANVAS_WIDTH = 1360
const CANVAS_HEIGHT = 732
const ENTRY = { x: 40, w: 240, h: 150 }
const VARIANT = { x: 360, w: 300, h: 210, gap: 26 }
const CONVERSION = { x: 760, w: 220, h: 110 }

function bezier(fromX: number, fromY: number, toX: number, toY: number): string {
  const midX = (fromX + toX) / 2
  return `M${fromX},${fromY} C${midX},${fromY} ${midX},${toY} ${toX},${toY}`
}

export function computeReportLayout(variants: ReportVariantInput[], fallbackConfigured: boolean): ReportLayout {
  if (variants.length === 0) {
    throw new Error('computeReportLayout requires at least one variant')
  }

  const totalVariantHeight = variants.length * VARIANT.h + (variants.length - 1) * VARIANT.gap
  const PAD = 40 // vertical breathing room above/below the variant stack when it's the tallest column
  const canvasHeight = Math.max(CANVAS_HEIGHT, totalVariantHeight + PAD * 2)
  const variantStartY = (canvasHeight - totalVariantHeight) / 2
  const entryNode: ReportNode = { x: ENTRY.x, y: (canvasHeight - ENTRY.h) / 2, w: ENTRY.w, h: ENTRY.h }
  const entryCenterY = entryNode.y + entryNode.h / 2
  const entryRightX = entryNode.x + entryNode.w

  const maxVisits = Math.max(1, ...variants.map((v) => v.visits))
  const rates = variants.map((v) => (v.visits > 0 ? v.conversions / v.visits : -1))
  const bestRate = Math.max(...rates)
  const leaderIndex = bestRate > 0 ? rates.indexOf(bestRate) : -1

  const variantLayouts: ReportVariantLayout[] = variants.map((variant, index) => {
    const node: ReportNode = {
      x: VARIANT.x,
      y: variantStartY + index * (VARIANT.h + VARIANT.gap),
      w: VARIANT.w,
      h: VARIANT.h,
    }
    const centerY = node.y + node.h / 2
    const isLeader = index === leaderIndex

    const conversionNode: ReportNode = {
      x: CONVERSION.x,
      y: centerY - CONVERSION.h / 2,
      w: CONVERSION.w,
      h: CONVERSION.h,
    }

    return {
      id: variant.id,
      name: variant.name,
      weightPct: variant.weightPct,
      visits: variant.visits,
      uniqueVisitors: variant.uniqueVisitors,
      conversions: variant.conversions,
      revenueCents: variant.revenueCents,
      ratePct: variant.visits > 0 ? (variant.conversions / variant.visits) * 100 : 0,
      destinationUrl: variant.destinationUrl,
      isLeader,
      node,
      trafficEdge: {
        path: bezier(entryRightX, entryCenterY, node.x, centerY),
        strokeWidth: 2.5 + (variant.visits / maxVisits) * 4.5,
      },
      conversionNode,
      conversionEdge: {
        path: bezier(node.x + node.w, centerY, conversionNode.x, centerY),
        strokeWidth: isLeader ? 5 : 3.5,
        color: isLeader ? '#F5B94D' : '#2DD4A8',
      },
    }
  })

  const fallback = fallbackConfigured
    ? {
        node: { x: entryNode.x + 160, y: entryNode.y + entryNode.h + 60, w: 230, h: 60 },
        edge: {
          path: `M${entryNode.x + 120},${entryNode.y + entryNode.h} L${entryNode.x + 120},${entryNode.y + entryNode.h + 90}`,
        },
      }
    : null

  return { canvasWidth: CANVAS_WIDTH, canvasHeight, entryNode, variants: variantLayouts, fallback }
}
