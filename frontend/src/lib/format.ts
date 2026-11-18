// Number formatting utilities for NEPSE market data

/** Format a price with 2 decimal places. */
export function formatPrice(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Format a change value with +/- prefix and 2 decimals. */
export function formatChange(value: number | null | undefined): string {
  if (value == null) return '—'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}`
}

/** Format a percent value with +/- prefix and 2 decimals. */
export function formatChangePct(value: number | null | undefined): string {
  if (value == null) return '—'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

/** Format a large number with K/M/Cr suffixes. */
export function formatVolume(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value >= 1_00_00_000) return `${(value / 1_00_00_000).toFixed(2)} Cr`
  if (value >= 1_00_000) return `${(value / 1_00_000).toFixed(2)} L`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} K`
  return value.toString()
}

/** Format turnover in Rs Crore. */
export function formatTurnover(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value >= 1_00_00_000) return `Rs ${(value / 1_00_00_000).toFixed(2)} Cr`
  if (value >= 1_00_000) return `Rs ${(value / 1_00_000).toFixed(2)} L`
  return `Rs ${value.toLocaleString('en-IN')}`
}

// NPT time helpers live in nptTime.ts; re-exported here for existing imports.
export { NPT_OFFSET_SECONDS, toNPTUnix, formatNPT } from './nptTime'

/** Return CSS class for positive/negative/flat value. */
export function changeClass(value: number | null | undefined): string {
  if (value == null) return 'text-flat'
  if (value > 0) return 'text-up'
  if (value < 0) return 'text-down'
  return 'text-flat'
}

/** Return up/flat/down arrow character. */
export function changeArrow(value: number | null | undefined): string {
  if (value == null) return ''
  if (value > 0) return '▲'
  if (value < 0) return '▼'
  return '▬'
}

/** Format a raw ratio as a percentage (no +/- sign). E.g. 0.025 → "2.50%". */
export function formatPct(value: number | null | undefined, decimals = 2): string {
  if (value == null) return '—'
  return `${(value * 100).toFixed(decimals)}%`
}
