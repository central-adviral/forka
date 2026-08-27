export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 1

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export function computeFitZoom(
  containerWidth: number,
  containerHeight: number,
  contentWidth: number,
  contentHeight: number
): number {
  const scale = Math.min(containerWidth / contentWidth, containerHeight / contentHeight, MAX_ZOOM)
  return Math.max(MIN_ZOOM, scale)
}
