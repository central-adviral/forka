export type TestType = 'page' | 'checkout'

export interface EntryDestinationInput {
  testType: TestType
  salesPageUrl: string | null
  variantDestinationUrl: string
}

export function resolveEntryDestination(input: EntryDestinationInput): string {
  if (input.testType === 'checkout' && input.salesPageUrl) {
    return input.salesPageUrl
  }
  return input.variantDestinationUrl
}

export function withTrackingId(url: string, trackingId: string | null): string {
  if (!trackingId) return url
  const parsed = new URL(url)
  parsed.searchParams.set('utm_content', trackingId)
  return parsed.toString()
}
