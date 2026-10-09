// Long enough for an all-time report page, whose dozen reads share the database at once.
const TIMEOUT_MS = 20000

export function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
}
