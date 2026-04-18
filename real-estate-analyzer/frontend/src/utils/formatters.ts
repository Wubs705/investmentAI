/**
 * Currency, percentage, and number formatting utilities.
 */

interface FormatCurrencyOpts {
  compact?: boolean
  decimals?: number
}

export function formatCurrency(value: number | null | undefined, opts: FormatCurrencyOpts = {}): string {
  if (value == null || isNaN(value)) return 'N/A'
  const { compact = false, decimals = 0 } = opts
  if (compact && Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`
  }
  if (compact && Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null || isNaN(value)) return 'N/A'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value == null || isNaN(value)) return 'N/A'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'N/A'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Returns a Tailwind color class based on a numeric value relative to thresholds. */
export function signalColor(
  value: number | null | undefined,
  goodThreshold: number,
  badThreshold: number,
  higherIsBetter = true,
): string {
  if (value == null) return 'text-text-secondary'
  const isGood = higherIsBetter ? value >= goodThreshold : value <= goodThreshold
  const isBad = higherIsBetter ? value <= badThreshold : value >= badThreshold
  if (isGood) return 'text-accent'
  if (isBad) return 'text-danger'
  return 'text-warning'
}

export function scoreColor(score: number): string {
  if (score >= 75) return 'bg-green-500'
  if (score >= 60) return 'bg-amber-500'
  if (score >= 45) return 'bg-orange-500'
  return 'bg-red-500'
}

export function scoreTextColor(score: number): string {
  if (score >= 75) return 'text-green-700'
  if (score >= 60) return 'text-amber-700'
  if (score >= 45) return 'text-orange-700'
  return 'text-red-700'
}

export function scoreBgLight(score: number): string {
  if (score >= 75) return 'bg-green-50 border-green-200'
  if (score >= 60) return 'bg-amber-50 border-amber-200'
  if (score >= 45) return 'bg-orange-50 border-orange-200'
  return 'bg-red-50 border-red-200'
}
