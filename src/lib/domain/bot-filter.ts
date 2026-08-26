const BOT_UA_PATTERNS = [
  'googlebot',
  'bingbot',
  'slackbot',
  'yandexbot',
  'duckduckbot',
  'applebot',
  'twitterbot',
  'telegrambot',
  'discordbot',
  'petalbot',
  'ahrefsbot',
  'semrushbot',
  'slurp',
  'bot/',
  'crawler',
  'spider',
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
