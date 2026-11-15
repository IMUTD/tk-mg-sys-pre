// Boxes whose paid time ends within this many days are flagged for renewal.
export const expiringDays = 7

const dayMs = 24 * 60 * 60 * 1000

export type ExpiryState = "none" | "expired" | "expiring" | "active"

const parse = (value: string | null): Date | null => {
  if (value === null) return null
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? null : time
}

export const expiryState = (value: string | null, now: Date = new Date()): ExpiryState => {
  const until = parse(value)
  if (until === null) return "none"
  const left = until.getTime() - now.getTime()
  if (left <= 0) return "expired"
  return left <= expiringDays * dayMs ? "expiring" : "active"
}

// Whole days left, rounded up so "a few hours" still reads as one day.
export const daysLeft = (value: string | null, now: Date = new Date()): number => {
  const until = parse(value)
  if (until === null) return 0
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / dayMs))
}

// Same rule as PostgreSQL `+ make_interval(months => n)`: a day past the end of the target
// month falls back to its last day (Jan 31 + 1 month = Feb 28/29).
export const addMonths = (from: Date, months: number): Date => {
  const next = new Date(from.getTime())
  const day = next.getDate()
  next.setDate(1)
  next.setMonth(next.getMonth() + months)
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(day, lastDay))
  return next
}

// Where the paid time ends after buying `months` more: unexpired time is extended,
// otherwise counting starts now (the server uses the payment time).
export const renewedUntil = (
  value: string | null,
  months: number,
  now: Date = new Date(),
): Date => {
  const until = parse(value)
  const start = until !== null && until.getTime() > now.getTime() ? until : now
  return addMonths(start, months)
}

// Sort key: never opened first, then the earliest end, so boxes needing time come first.
export const expirySortKey = (value: string | null): number =>
  parse(value)?.getTime() ?? Number.NEGATIVE_INFINITY

export const formatTime = (value: Date): string => value.toLocaleString("zh-CN", { hour12: false })
