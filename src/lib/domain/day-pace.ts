// Sales so far today, carried to the end of the São Paulo day at the same rate. Too early in the
// day the rate is noise, so no projection is offered before 06:00.
export function projectDay(salesSoFar: number, at: Date): number | null {
  const minutes = ((at.getUTCHours() - 3 + 24) % 24) * 60 + at.getUTCMinutes()
  if (minutes < 6 * 60) return null
  return Math.round((salesSoFar * 24 * 60) / minutes)
}
