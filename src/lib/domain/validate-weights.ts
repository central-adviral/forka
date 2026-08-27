export function weightsSumTo100(weights: number[]): boolean {
  const total = weights.reduce((sum, w) => sum + w, 0)
  return Math.abs(total - 100) <= 0.01
}
