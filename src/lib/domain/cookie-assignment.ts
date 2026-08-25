export const VISITOR_COOKIE = 'ir_vid'

export function assignmentCookieName(testSlug: string): string {
  return `ir_t_${testSlug}`
}

export function getOrCreateVisitorId(existing?: string): { visitorId: string; isNew: boolean } {
  if (existing) return { visitorId: existing, isNew: false }
  return { visitorId: crypto.randomUUID(), isNew: true }
}

export function readAssignedVariantId(
  cookies: Record<string, string | undefined>,
  testSlug: string
): string | undefined {
  return cookies[assignmentCookieName(testSlug)]
}
