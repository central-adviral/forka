const BOT_UA_PATTERNS = [
  'bot',
  'crawler',
  'spider',
  'slurp',
  'facebookexternalhit',
  'bingpreview',
  'curl/',
  'python-requests',
  'wget/',
  'headlesschrome',
  'pingdom',
  'uptimerobot',
]

export function isKnownBot(userAgent: string | null): boolean {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()
  return BOT_UA_PATTERNS.some((pattern) => ua.includes(pattern))
}
