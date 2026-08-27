import { describe, it, expect } from 'vitest'
import { clampZoom, computeFitZoom, MIN_ZOOM, MAX_ZOOM } from './canvas-zoom'

describe('clampZoom', () => {
  it('passes through values within range', () => {
    expect(clampZoom(0.5)).toBe(0.5)
  })

  it('floors below MIN_ZOOM', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM)
  })

  it('caps above MAX_ZOOM', () => {
    expect(clampZoom(5)).toBe(MAX_ZOOM)
  })
})

describe('computeFitZoom', () => {
  it('shrinks to fit when the content is bigger than the container', () => {
    expect(computeFitZoom(700, 400, 1400, 800)).toBe(0.5)
  })

  it('uses the more restrictive dimension when width and height ratios differ', () => {
    expect(computeFitZoom(700, 200, 1400, 800)).toBe(0.25)
  })

  it('never scales up past MAX_ZOOM when the container is bigger than the content', () => {
    expect(computeFitZoom(2000, 2000, 1400, 800)).toBe(MAX_ZOOM)
  })

  it('never scales below MIN_ZOOM even for a tiny container', () => {
    expect(computeFitZoom(10, 10, 1400, 800)).toBe(MIN_ZOOM)
  })
})
