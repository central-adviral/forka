import { describe, it, expect } from 'vitest'
import { weightsSumTo100 } from './validate-weights'

describe('weightsSumTo100', () => {
  it('accepts weights that sum to 100', () => {
    expect(weightsSumTo100([50, 30, 20])).toBe(true)
  })
  it('rejects weights that do not sum to 100', () => {
    expect(weightsSumTo100([50, 40])).toBe(false)
  })
  it('rejects an empty list', () => {
    expect(weightsSumTo100([])).toBe(false)
  })
  it('tolerates floating point rounding', () => {
    expect(weightsSumTo100([33.34, 33.33, 33.33])).toBe(true)
  })
  it('rejects a total the server-side RPC would reject, so client and server agree', () => {
    expect(weightsSumTo100([50.01, 50.01])).toBe(false)
  })
})
