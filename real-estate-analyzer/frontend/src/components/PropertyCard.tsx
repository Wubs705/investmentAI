/* eslint-disable @typescript-eslint/no-explicit-any */

function fmt$(n: number | null | undefined, compact = false): string {
  if (n == null || !isFinite(n)) return '—'
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (compact && a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`
  if (compact && a >= 1000) return `${sign}$${(a / 1000).toFixed(0)}K`
  return `${sign}$${a.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function scoreColor(s: number): string {
  if (s >= 75) return '#008A05'
  if (s >= 60) return '#2B5BE8'
  if (s >= 45) return '#C17D2A'
  return '#C23B3B'
}

function heatColor(s: number): string {
  if (s >= 80) return '#C23B3B'
  if (s >= 60) return '#C17D2A'
  if (s >= 40) return '#B8A020'
  return '#6B7A8D'
}

function heatLabel(s: number): string {
  if (s >= 80) return 'Hot'
  if (s >= 60) return 'Warm'
  if (s >= 40) return 'Mild'
  return 'Cool'
}

function goalMetrics(a: any, goal: string): { label: string; value: string; tone?: 'positive' | 'negative' }[] {
  if (goal === 'rental' && a?.rental) return [
    { label: 'Cash Flow', value: a.rental.monthly_cash_flow != null ? `${a.rental.monthly_cash_flow >= 0 ? '+' : ''}${fmt$(a.rental.monthly_cash_flow)}/mo` : 'N/A', tone: a.rental.monthly_cash_flow >= 0 ? 'positive' : 'negative' },
    { label: 'Cap Rate',  value: a.rental.cap_rate_pct != null ? `${a.rental.cap_rate_pct.toFixed(1)}%` : 'N/A' },
    { label: 'CoC',       value: a.rental.cash_on_cash_return_pct != null ? `${a.rental.cash_on_cash_return_pct.toFixed(1)}%` : 'N/A' },
  ]
  if (goal === 'long_term' && a?.long_term) return [
    { label: '10yr ROI', value: a.long_term.total_roi_10yr_pct != null ? `${a.long_term.total_roi_10yr_pct.toFixed(1)}%` : 'N/A', tone: 'positive' },
    { label: 'Ann. Ret.', value: a.long_term.annualized_return_pct != null ? `${a.long_term.annualized_return_pct.toFixed(1)}%` : 'N/A' },
  ]
  if (goal === 'fix_and_flip' && a?.flip) return [
    { label: 'Profit', value: a.flip.potential_profit != null ? fmt$(a.flip.potential_profit, true) : 'N/A', tone: a.flip.potential_profit > 0 ? 'positive' : 'negative' },
    { label: 'ROI',    value: a.flip.roi_pct != null ? `${a.flip.roi_pct.toFixed(1)}%` : 'N/A' },
    { label: 'Deal',   value: a.flip.deal_score || 'N/A' },
  ]
  if (goal === 'house_hack' && a?.house_hack) return [
    { label: 'Effective Cost', value: a.house_hack.owner_net_monthly_cost != null ? `${fmt$(a.house_hack.owner_net_monthly_cost)}/mo` : 'N/A' },
    { label: 'Offset %',      value: a.house_hack.mortgage_offset_pct != null ? `${a.house_hack.mortgage_offset_pct.toFixed(0)}%` : 'N/A', tone: 'positive' },
  ]
  if (goal === 'str' && a?.str_metrics) return [
    { label: 'STR CF',  value: a.str_metrics.monthly_cash_flow != null ? `${fmt$(a.str_metrics.monthly_cash_flow)}/mo` : 'N/A', tone: a.str_metrics.monthly_cash_flow > 0 ? 'positive' : 'negative' },
    { label: 'Occ.',    value: a.str_metrics.occupancy_rate_pct != null ? `${a.str_metrics.occupancy_rate_pct.toFixed(0)}%` : 'N/A' },
  ]
  return []
}

function getAiInsight(analysis: any): string | null {
  const ai = analysis?.ai_analysis
  if (!ai?.ai_available) return null
  return ai.investment_narrative?.key_strengths?.[0] ?? null
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
  const heatScore: number | null = typeof score?.heat_score === 'number' ? score.heat_score : null
  const metrics = goalMetrics(analysis, goal)
  const aiInsight = getAiInsight(analysis)
  const dom = listing.days_on_market

  const cardStyle: React.CSSProperties = {
    background: 'var(--card)',
    border: isHovered ? '1px solid var(--accent)' : '1px solid var(--rule-soft)',
    borderRadius: 12,
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'box-shadow .2s, border-color .2s',
    boxShadow: isHovered ? '0 0 0 2px var(--accent), 0 4px 20px rgba(30,26,21,0.12)' : 'none',
  }

  return (
    <div style={cardStyle} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onClick={onClick}>
      {/* Photo / placeholder */}
      <div style={{ position: 'relative', height: 160, background: 'var(--paper-2)', overflow: 'hidden' }}>
        {listing.photos?.[0] ? (
          <img src={listing.photos[0]} alt={listing.address} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        ) : (
          <div className="photo-stripe" style={{ width: '100%', height: '100%', position: 'relative' }}>
            <div style={{ position: 'absolute', bottom: 8, left: 10, fontFamily: 'IBM Plex Mono', fontSize: 9, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
              {listing.property_type || 'Residential'}
            </div>
          </div>
        )}

        {/* Top-left badges */}
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 5 }}>
          {dom != null && dom <= 7 && (
            <span style={{ background: 'var(--positive)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, fontFamily: 'IBM Plex Mono' }}>NEW</span>
          )}
          {listing.source === 'mock' && (
            <span style={{ background: 'var(--paper-2)', color: 'var(--ink-3)', fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, fontFamily: 'IBM Plex Mono', border: '1px solid var(--rule)' }}>DEMO</span>
          )}
        </div>

        {/* Top-right: heat + score */}
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
          {heatScore != null && (
            <span style={{ background: heatColor(heatScore), color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, fontFamily: 'IBM Plex Mono' }}>
              {heatLabel(heatScore)} {heatScore}
            </span>
          )}
          <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', width: 36, height: 36, background: scoreColor(s), color: '#fff', fontWeight: 700, fontSize: 13, lineHeight: 1, fontFamily: 'IBM Plex Mono' }}>
            {s}
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '14px 16px' }}>
        {/* Price + DOM */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
          <div className="font-serif" style={{ fontSize: 22, lineHeight: 1, color: 'var(--ink)' }}>{fmt$(listing.list_price)}</div>
          {dom != null && <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color: 'var(--ink-3)' }}>{dom}d on mkt</div>}
        </div>

        {/* Facts */}
        <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 2 }}>
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{listing.bedrooms} bd</span>
          <span style={{ margin: '0 5px', color: 'var(--ink-4)' }}>|</span>
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{listing.bathrooms} ba</span>
          <span style={{ margin: '0 5px', color: 'var(--ink-4)' }}>|</span>
          <span>{listing.sqft?.toLocaleString()} sqft</span>
        </div>

        {/* Address */}
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {listing.address}, {listing.city}, {listing.state}
        </div>

        {/* Goal metrics */}
        {metrics.length > 0 && (
          <div style={{ display: 'flex', gap: 14, paddingTop: 10, borderTop: '1px solid var(--rule-soft)', marginBottom: aiInsight ? 10 : 0 }}>
            {metrics.map((m) => (
              <div key={m.label}>
                <div className="smallcaps" style={{ color: 'var(--ink-4)', marginBottom: 2 }}>{m.label}</div>
                <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 13, fontWeight: 600, color: m.tone === 'positive' ? 'var(--positive)' : m.tone === 'negative' ? 'var(--negative)' : 'var(--ink-2)' }}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* AI insight */}
        {aiInsight && (
          <div style={{ fontSize: 12, color: 'var(--accent)', paddingTop: 8, borderTop: '1px solid var(--rule-soft)', fontWeight: 500 }}>
            ✦ {aiInsight}
          </div>
        )}

        {/* View button */}
        <button
          onClick={(e) => { e.stopPropagation(); onClick() }}
          style={{ width: '100%', marginTop: 12, padding: '8px 0', background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 13, borderRadius: 8, border: 'none', cursor: 'pointer', transition: 'opacity .15s' }}
          onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.88')}
          onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
        >
          View deep analysis →
        </button>
      </div>
    </div>
  )
}
