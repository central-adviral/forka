// One object for one test: a link hypothesis creates its A/B test, so the variants are typed once.

/** The /r slug of a card's test, from its code and title: "T11 Selo de garantia" → "t11-selo-de-garantia". */
export function experimentSlug(code: string, title: string): string {
  const words = `${code} ${title}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return words.slice(0, 48).replace(/-+$/, '')
}

/** Equal whole-number weights summing to 100, the remainder on the first variants: 3 → 34, 33, 33. */
export function equalWeights(count: number): number[] {
  const base = Math.floor(100 / count)
  return Array.from({ length: count }, (_, index) => base + (index < 100 - base * count ? 1 : 0))
}

/** The A/B variant name carries the card key, so the decision always finds it: "B · Com selo". */
export function experimentVariantName(key: string, name: string): string {
  return `${key} · ${name}`
}
