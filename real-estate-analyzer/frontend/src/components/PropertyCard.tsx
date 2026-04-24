import { Heart } from 'lucide-react'
import { formatCurrency } from '../utils/formatters'

/* eslint-disable @typescript-eslint/no-explicit-any */

const GOAL_METRICS: Record<string, (a: any) => { label: string; value: string; positive?: boolean }[]> = {
  rental: (a) => [
    {
      label: 'Cash Flow',
      value: a?.rental?.monthly_cash_flow != null
        ? `${a.rental.monthly_cash_flow >= 0 ? '+' : ''}${formatCurrency(a.rental.monthly_cash_flow)}/mo`
        : 'N/A',
      positive: a?.rental?.monthly_cash_flow >= 0,
    },
    {
      label: 'Cap Rate',
      value: a?.rental?.cap_rate_pct != null ? `${a.rental.cap_rate_pct.toFixed(1)}%` : 'N/A',
    },
  ],
  long_term: (a) => [
    {
      label: '10yr ROI',
      value: a?.long_term?.total_roi_10yr_pct != null ? `${a.long_term.total_roi_10yr_pct.toFixed(1)}%` : 'N/A',
    },
    {
      label: 'Ann. Return',
      value: a?.long_term?.annualized_return_pct != null ? `${a.long_term.annualized_return_pct.toFixed(1)}%` : 'N/A',
    },
  ],
  fix_and_flip: (a) => [
    {
      label: 'Profit',
      value: a?.flip?.potential_profit != null ? formatCurrency(a.flip.potential_profit, { compact: true }) : 'N/A',
    },
    {
      label: 'ROI',
      value: a?.flip?.roi_pct != null ? `${a.flip.roi_pct.toFixed(1)}%` : 'N/A',
    },
  ],
}

function scoreLabel(score: number): { color: string; grade: string } {
  if (score >= 75) return { color: '#008A05', grade: 'A' }
  if (score >= 60) return { color: '#006AFF', grade: 'B' }
  if (score >= 45) return { color: '#E8850C', grade: 'C' }
  return { color: '#D32F2F', grade: 'D' }
}

// Market heat thresholds per spec — distinct from the investment-score colors
// so users can read "hot market" vs "good deal" independently.
function heatLabel(score: number): { color: string; label: string } {
  if (score >= 80) return { color: '#D32F2F', label: 'Hot' }
  if (score >= 60) return { color: '#E8850C', label: 'Warm' }
  if (score >= 40) return { color: '#E0B019', label: 'Mild' }
  return { color: '#7A8290', label: 'Cool' }
}

// Per-component bucket labels keep the tooltip readable without a legend.
function componentLabel(name: string, value: number): string {
  if (value >= 70) {
    return name === 'unemployment'
      ? 'low'
      : name === 'dom'
        ? 'fast'
        : 'strong'
  }
  if (value >= 40) return 'moderate'
  return name === 'unemployment'
    ? 'high'
    : name === 'dom'
      ? 'slow'
      : 'weak'
}

const HEAT_COMPONENT_LABELS: Record<string, string> = {
  rent_growth: 'Rent growth',
  unemployment: 'Unemployment',
  population: 'Population',
  dom: 'Days on market',
}

function buildHeatTooltip(components: Record<string, number> | undefined): string {
  if (!components) return 'Market heat score — combines rent growth, unemployment, population, and days-on-market.'
  return Object.entries(components)
    .map(([k, v]) => `${HEAT_COMPONENT_LABELS[k] ?? k}: ${componentLabel(k, v)}`)
    .join(' · ')
}

function getAiInsight(analysis: any): string | null {
  const ai = analysis?.ai_analysis
  if (!ai?.ai_available) return null
  if (ai.investment_narrative?.key_strengths?.length > 0) {
    return ai.investment_narrative.key_strengths[0]
  }
  return null
}

interface PropertyCardProps {
  result: any
  goal: string
  onClick: () => void
  isHovered?: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export default function PropertyCard({ result, goal, onClick, isHovered, onMouseEnter, onMouseLeave }: PropertyCardProps) {
  const { listing, analysis, score } = result
  const s: number = score?.overall_score ?? 0
  const { color: scoreColor } = scoreLabel(s)
  const heatScore: number | null = typeof score?.heat_score === 'number' ? score.heat_score : null
  const heatComponents: Record<string, number> | undefined = score?.heat_score_components
  const heatBadge = heatScore != null ? heatLabel(heatScore) : null
  const heatTooltip = heatScore != null ? `Market Heat ${heatScore} — ${buildHeatTooltip(heatComponents)}` : ''
  const metricFn = GOAL_METRICS[goal] || GOAL_METRICS.rental
  const metrics = metricFn(analysis)
  const aiInsight = getAiInsight(analysis)
  const dom = listing.days_on_market

  return (
    <div
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`bg-white border rounded-xl overflow-hidden cursor-pointer hover:shadow-md transition-all group ${
        isHovered ? 'border-primary shadow-md ring-2 ring-primary/20' : 'border-border'
      }`}
    >
      {/* Photo */}
      <div className="relative w-full h-44 bg-gray-100 overflow-hidden">
        {listing.photos?.[0] ? (
          <img
            src={listing.photos[0]}
            alt={listing.address}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-100">
            <span className="text-4xl opacity-20">🏠</span>
          </div>
        )}

        {/* Status badges */}
        <div className="absolute top-2 left-2 flex gap-1.5">
          {dom != null && dom <= 3 && (
            <span className="zillow-badge zillow-badge-green">New</span>
          )}
          {listing.source === 'demo' && (
            <span className="zillow-badge zillow-badge-gray">Demo</span>
          )}
        </div>

        {/* Heart + score */}
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          {/* Heat badge — sits left of the investment score so the eye reads
              "market context" before "deal quality". */}
          {heatBadge && (
            <span
              className="text-white text-xs font-bold px-2 py-0.5 rounded"
              style={{ background: heatBadge.color }}
              title={heatTooltip}
              data-testid="heat-badge"
            >
              {heatBadge.label} {heatScore}
            </span>
          )}
          {/* Score badge */}
          <span
            className="text-white text-xs font-bold px-2 py-0.5 rounded"
            style={{ background: scoreColor }}
          >
            {s}
          </span>
          {/* Heart */}
          <button
            onClick={(e) => e.stopPropagation()}
            className="w-7 h-7 bg-white rounded-full flex items-center justify-center shadow hover:bg-gray-50 transition-colors cursor-pointer"
          >
            <Heart className="w-3.5 h-3.5 text-gray-500" />
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        {/* Price */}
        <div className="flex items-start justify-between mb-1">
          <span className="text-xl font-bold text-text-primary">{formatCurrency(listing.list_price)}</span>
          {goal === 'rental' && (
            <span className="text-xs text-text-muted mt-1">Fees may apply</span>
          )}
        </div>

        {/* Beds / Baths / Sqft */}
        <div className="text-sm text-text-secondary mb-1">
          <span className="font-medium text-text-primary">{listing.bedrooms} bd</span>
          <span className="mx-1 text-text-muted">|</span>
          <span className="font-medium text-text-primary">{listing.bathrooms} ba</span>
          <span className="mx-1 text-text-muted">|</span>
          <span>{listing.sqft?.toLocaleString()} sqft</span>
          {listing.property_type && (
            <>
              <span className="mx-1 text-text-muted">·</span>
              <span>{listing.property_type}</span>
            </>
          )}
        </div>

        {/* Address */}
        <div className="text-sm text-text-secondary truncate mb-3">
          {listing.address}, {listing.city}, {listing.state} {listing.zip_code}
        </div>

        {/* Investment metrics */}
        <div className="flex gap-4 pt-3 border-t border-border">
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col">
              <span className="text-[10px] font-medium text-text-muted uppercase tracking-wide">{m.label}</span>
              <span className={`text-sm font-semibold ${
                m.positive === true ? 'text-accent' : m.positive === false ? 'text-danger' : 'text-primary'
              }`}>
                {m.value}
              </span>
            </div>
          ))}
          {dom != null && (
            <div className="flex flex-col ml-auto text-right">
              <span className="text-[10px] font-medium text-text-muted uppercase tracking-wide">On market</span>
              <span className="text-sm text-text-secondary">{dom}d</span>
            </div>
          )}
        </div>

        {/* AI insight */}
        {aiInsight && (
          <div className="mt-2 pt-2 border-t border-border">
            <span className="text-[11px] text-primary font-medium">
              ✦ {aiInsight}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
