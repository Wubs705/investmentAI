import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { fetchNarrative } from '../api/client'
import PropertyMap from '../components/Map/PropertyMap'
import ComparablesTable from '../components/ComparablesTable'
import { formatCurrency, signalColor } from '../utils/formatters'

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined, compact = false): string {
  if (n == null || !isFinite(n)) return '—'
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (compact && a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`
  if (compact && a >= 1000) return `${sign}$${(a / 1000).toFixed(0)}K`
  return `${sign}$${a.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

function scoreColor(s: number): string {
  if (s >= 75) return '#008A05'
  if (s >= 60) return '#2B5BE8'
  if (s >= 45) return '#C17D2A'
  return '#C23B3B'
}

// ─── design constants ────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'investment', label: 'Investment Analysis' },
  { id: 'comps',      label: 'Comparable Sales' },
  { id: 'risk',       label: 'Risk & AI Analysis' },
]

const GOALS = [
  { key: 'rental',       label: 'Rental',     live: true,  hint: 'Buy & hold · monthly cash flow' },
  { key: 'fix_and_flip', label: 'Fix & Flip', live: true,  hint: '70% rule · ARV · holding cost' },
  { key: 'long_term',    label: 'Long-Term',  live: true,  hint: '10-yr appreciation + equity' },
  { key: 'house_hack',   label: 'House Hack', live: true,  hint: 'Owner + ADU rental offset' },
  { key: 'str',          label: 'STR',        live: true,  hint: 'Nightly rate · occupancy · CF' },
  { key: 'multifamily',  label: 'Multi',      live: false, hint: 'Coming soon' },
  { key: 'commercial',   label: 'Commercial', live: false, hint: 'Coming soon' },
]

// ─── small shared components ─────────────────────────────────────────────────

function Smallcaps({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="smallcaps" style={{ color: 'var(--ink-3)', ...style }}>{children}</div>
  )
}

function MetricRow({ label, value, hint, positive }: { label: string; value: string; hint?: string | null; positive?: boolean | null }) {
  const color = positive === true ? 'var(--positive)' : positive === false ? 'var(--negative)' : 'var(--ink)'
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--rule-soft)' }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 13, fontWeight: 600, color, marginLeft: 16, textAlign: 'right' }}>{value}</div>
    </div>
  )
}

function SectionBox({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 12, overflow: 'hidden', background: 'var(--card)', marginBottom: 20 }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--rule-soft)', background: 'var(--paper-2)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', fontFamily: 'IBM Plex Mono', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{title}</div>
      </div>
      <div style={{ padding: '0 20px' }}>{children}</div>
    </div>
  )
}

// ─── highlight metrics per goal ──────────────────────────────────────────────

function getHighlights(goal: string, analysis: any): { label: string; value: string; positive?: boolean }[] {
  if (goal === 'rental' && analysis?.rental) {
    const r = analysis.rental
    return [
      { label: 'Monthly Cash Flow', value: r.monthly_cash_flow != null ? `${r.monthly_cash_flow >= 0 ? '+' : ''}${fmt$(r.monthly_cash_flow)}/mo` : 'N/A', positive: r.monthly_cash_flow >= 0 },
      { label: 'Cap Rate',          value: r.cap_rate_pct != null ? `${r.cap_rate_pct.toFixed(1)}%` : 'N/A' },
      { label: 'Cash-on-Cash',      value: r.cash_on_cash_return_pct != null ? `${r.cash_on_cash_return_pct.toFixed(1)}%` : 'N/A' },
      { label: 'DSCR',              value: r.dscr != null ? r.dscr.toFixed(2) : 'N/A', positive: r.dscr >= 1.2 },
    ]
  }
  if (goal === 'long_term' && analysis?.long_term) {
    const lt = analysis.long_term
    return [
      { label: '10yr ROI',    value: lt.total_roi_10yr_pct != null ? `${lt.total_roi_10yr_pct.toFixed(1)}%` : 'N/A', positive: true },
      { label: 'Ann. Return', value: lt.annualized_return_pct != null ? `${lt.annualized_return_pct.toFixed(1)}%` : 'N/A' },
      { label: '5yr Value',   value: lt.projected_value_5yr != null ? fmt$(lt.projected_value_5yr, true) : 'N/A' },
      { label: '10yr Value',  value: lt.projected_value_10yr != null ? fmt$(lt.projected_value_10yr, true) : 'N/A', positive: true },
    ]
  }
  if (goal === 'fix_and_flip' && analysis?.flip) {
    const f = analysis.flip
    return [
      { label: 'Profit',     value: f.potential_profit != null ? fmt$(f.potential_profit, true) : 'N/A', positive: f.potential_profit > 0 },
      { label: 'ROI',        value: f.roi_pct != null ? `${f.roi_pct.toFixed(1)}%` : 'N/A' },
      { label: 'ARV',        value: f.arv != null ? fmt$(f.arv, true) : 'N/A' },
      { label: 'Deal Score', value: f.deal_score || 'N/A', positive: f.deal_score === 'Strong Deal' },
    ]
  }
  if (goal === 'house_hack' && analysis?.house_hack) {
    const h = analysis.house_hack
    return [
      { label: 'Effective Cost', value: h.owner_net_monthly_cost != null ? `${fmt$(h.owner_net_monthly_cost)}/mo` : 'N/A' },
      { label: 'Offset %',       value: h.mortgage_offset_pct != null ? `${h.mortgage_offset_pct.toFixed(0)}%` : 'N/A', positive: true },
    ]
  }
  if (goal === 'str' && analysis?.str_metrics) {
    const s = analysis.str_metrics
    return [
      { label: 'STR Cash Flow', value: s.monthly_cash_flow != null ? `${fmt$(s.monthly_cash_flow)}/mo` : 'N/A', positive: s.monthly_cash_flow > 0 },
      { label: 'Occupancy',     value: s.occupancy_rate_pct != null ? `${s.occupancy_rate_pct.toFixed(0)}%` : 'N/A' },
      { label: 'Cap Rate',      value: s.cap_rate_pct != null ? `${s.cap_rate_pct.toFixed(1)}%` : 'N/A' },
    ]
  }
  return []
}

// ─── Overview tab ────────────────────────────────────────────────────────────

function OverviewTab({ listing, analysis, market, result }: any) {
  const universal = analysis?.universal
  const listPrice = listing.list_price
  const downPct = universal && listPrice > 0 ? Math.round((universal.down_payment_amount / listPrice) * 100) : 20
  const isCash = downPct >= 100

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left col */}
      <div className="lg:col-span-2 space-y-5">
        {/* Property details */}
        <SectionBox title="Property Details">
          <div className="grid grid-cols-2 gap-x-8">
            {[
              ['Property type', listing.property_type || 'N/A'],
              ['Year built',    listing.year_built || 'N/A'],
              ['Bedrooms',      listing.bedrooms],
              ['Bathrooms',     listing.bathrooms],
              ['Square footage', listing.sqft?.toLocaleString() || 'N/A'],
              ['Lot size',      listing.lot_size || 'N/A'],
              ['Days on market', listing.days_on_market ?? 'N/A'],
              ['Flood zone',    listing.flood_zone || 'N/A'],
            ].map(([label, value]) => (
              <MetricRow key={String(label)} label={String(label)} value={String(value)} />
            ))}
          </div>
        </SectionBox>

        {/* Listing description */}
        {listing.description && (
          <SectionBox title="Listing Description">
            <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ink-2)', padding: '14px 0' }}>{listing.description}</p>
          </SectionBox>
        )}

        {/* Neighborhood map */}
        {listing.lat && listing.lng && (
          <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--rule-soft)', background: 'var(--paper-2)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', fontFamily: 'IBM Plex Mono', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Neighborhood</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{listing.city}, {listing.state}</div>
            </div>
            <div style={{ height: 280 }}>
              <PropertyMap properties={[result]} hoveredPropertyId={null} selectedPropertyId={listing.id} onHoverProperty={() => {}} onSelectProperty={() => {}} className="w-full h-full rounded-none" />
            </div>
          </div>
        )}
      </div>

      {/* Right col */}
      <div className="space-y-5">
        {/* Price card */}
        <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 12, background: 'var(--card)', overflow: 'hidden' }}>
          <div style={{ padding: 20 }}>
            <Smallcaps style={{ marginBottom: 6 }}>List price</Smallcaps>
            <div className="font-serif tracking-display" style={{ fontSize: 42, lineHeight: 1, color: 'var(--ink)' }}>
              {fmt$(listPrice, true)}
            </div>
            {universal?.price_vs_market_pct != null && (
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, marginTop: 8, color: universal.price_vs_market_pct < 0 ? 'var(--positive)' : 'var(--negative)' }}>
                {fmtPct(universal.price_vs_market_pct)} vs AI fair value {fmt$(universal.estimated_market_value, true)}
              </div>
            )}
            {universal?.price_per_sqft && (
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
                ${Math.round(universal.price_per_sqft)}/sqft
                {universal.area_median_price_per_sqft && ` · Market ${fmt$(universal.area_median_price_per_sqft)}/sqft`}
              </div>
            )}
          </div>
        </div>

        {/* Financing snapshot */}
        {universal && (
          <SectionBox title="Financing Snapshot">
            <MetricRow label={isCash ? 'Cash Investment' : `Down Payment (${downPct}%)`} value={fmt$(universal.down_payment_amount)} />
            {!isCash && <MetricRow label="P&I Payment" value={`${fmt$(universal.monthly_mortgage_payment)}/mo`} />}
            <MetricRow label="Tax + Insurance" value={`${fmt$(universal.property_tax_monthly + universal.insurance_estimate_monthly)}/mo`} />
            <MetricRow label="PITI Total" value={`${fmt$(universal.total_monthly_cost)}/mo`} />
          </SectionBox>
        )}

        {/* Market snapshot */}
        {market && (() => {
          const ei = market.economic_indicators
          const pt = market.price_trends
          const rm = market.rental_market
          return (
            <SectionBox title="Market Snapshot">
              {ei?.median_home_value    && <MetricRow label="Median home value" value={fmt$(ei.median_home_value, true)} />}
              {pt?.yoy_appreciation_pct != null && <MetricRow label="YoY appreciation" value={`${pt.yoy_appreciation_pct > 0 ? '+' : ''}${pt.yoy_appreciation_pct.toFixed(1)}%`} positive={pt.yoy_appreciation_pct > 0} />}
              {rm?.median_rent_2br      && <MetricRow label="Median 2BR rent"   value={fmt$(rm.median_rent_2br)} />}
              {ei?.mortgage_rate_30yr   && <MetricRow label="30yr rate"         value={`${ei.mortgage_rate_30yr.toFixed(2)}%`} />}
            </SectionBox>
          )
        })()}

        {/* Visit listing */}
        {listing.listing_url && (
          <a href={listing.listing_url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textAlign: 'center', padding: '10px', borderRadius: 8, border: '1px solid var(--rule)', fontSize: 13, color: 'var(--ink-2)', fontWeight: 500 }}>
            Visit listing ↗
          </a>
        )}
      </div>
    </div>
  )
}

// ─── Investment Analysis tab ──────────────────────────────────────────────────

function InvestmentTab({ analysis, goal, market, listing, score }: any) {
  const [loadedNarrative, setLoadedNarrative] = useState<any>(null)
  const [narrativeLoading, setNarrativeLoading] = useState(false)
  const [narrativeError, setNarrativeError] = useState<string | null>(null)

  const baseAi = analysis?.ai_analysis
  const ai = loadedNarrative ? { ...baseAi, ...loadedNarrative } : baseAi
  const universal = analysis?.universal
  const rental = analysis?.rental
  const longTerm = analysis?.long_term
  const flip = analysis?.flip
  const houseHack = analysis?.house_hack
  const strMetrics = analysis?.str_metrics
  const assumptions = ai?.assumptions

  const listPrice = listing?.list_price || 0
  const downPct = universal && listPrice > 0 ? Math.round((universal.down_payment_amount / listPrice) * 100) : 20
  const isCash = downPct >= 100

  async function handleGenerate() {
    if (!listing?.id) return
    setNarrativeLoading(true)
    setNarrativeError(null)
    try {
      const data = await fetchNarrative(listing.id, goal)
      setLoadedNarrative(data)
    } catch (e: any) {
      const detail = e?.response?.data?.detail
      setNarrativeError(typeof detail === 'string' ? detail : 'Failed to generate analysis. Try again.')
    } finally {
      setNarrativeLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* AI methodology strip */}
      <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 12, overflow: 'hidden', background: 'var(--card)' }}>
        <div className="grid grid-cols-1 md:grid-cols-3">
          {[
            { n: '01', role: 'Extraction',  model: 'Claude Haiku 4.5',      input: 'Listing text', output: 'Assumptions',   detail: 'Rehab signals, rent comps, condition flags', cost: '~$0.0004' },
            { n: '02', role: 'Calculation', model: 'Deterministic Engine',   input: 'Assumptions',  output: 'Numbers',       detail: 'Cash flow, cap rate, DSCR, flip MAO, STR yield', cost: 'Free' },
            { n: '03', role: 'Narrative',   model: 'Claude Sonnet 4.6',      input: 'Numbers',      output: 'Investment memo', detail: 'On-demand broker memo. Cached 24h — charged once.', cost: '~$0.012' },
          ].map((s, i) => (
            <div key={s.n} style={{ padding: 20, borderLeft: i > 0 ? '1px solid var(--rule-soft)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, letterSpacing: '0.2em', color: 'var(--ink-4)' }}>{s.n}</span>
                  <span className="smallcaps">{s.role}</span>
                </div>
                <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color: 'var(--ink-4)' }}>{s.cost}</span>
              </div>
              <div className="font-serif tracking-display" style={{ fontSize: 16, lineHeight: 1.15, color: 'var(--ink)', marginBottom: 4 }}>{s.model}</div>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>
                {s.input} <span style={{ color: 'var(--ink-4)' }}>→</span> {s.output}
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>{s.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Generate / narrative */}
      <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20, background: 'var(--card)', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <Smallcaps style={{ marginBottom: 4 }}>AI Investment Narrative</Smallcaps>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
            {narrativeError || 'Fires Claude Sonnet for a broker-style investment memo. Cached server-side for 24h.'}
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={narrativeLoading || !!loadedNarrative}
          style={{ background: loadedNarrative ? 'var(--positive)' : 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 999, padding: '10px 20px', fontSize: 13, fontWeight: 500, cursor: narrativeLoading ? 'wait' : 'pointer', opacity: narrativeLoading ? 0.6 : 1, whiteSpace: 'nowrap' }}
        >
          {narrativeLoading ? 'Generating…' : loadedNarrative ? '✓ Generated' : 'Generate →'}
        </button>
      </div>

      {/* AI narrative output */}
      {ai?.ai_available && ai.investment_narrative && (
        <SectionBox title="Analyst Report · Claude Sonnet 4.6">
          <div style={{ padding: '16px 0' }}>
            {ai.investment_narrative.narrative && (
              <p style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--ink-2)', marginBottom: 20 }}>{ai.investment_narrative.narrative}</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {ai.investment_narrative.key_strengths?.length > 0 && (
                <div>
                  <Smallcaps style={{ color: 'var(--positive)', marginBottom: 10 }}>— Key Strengths</Smallcaps>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {ai.investment_narrative.key_strengths.map((s: string, i: number) => (
                      <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color: 'var(--positive)', paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {ai.investment_narrative.key_concerns?.length > 0 && (
                <div>
                  <Smallcaps style={{ color: 'var(--negative)', marginBottom: 10 }}>— Key Concerns</Smallcaps>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {ai.investment_narrative.key_concerns.map((s: string, i: number) => (
                      <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, color: 'var(--negative)', paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </SectionBox>
      )}

      {/* Property Financials */}
      {universal && (
        <SectionBox title={`Property Financials · ${isCash ? 'All Cash' : `${downPct}% Down`}`}>
          <MetricRow label="Estimated Market Value" value={fmt$(universal.estimated_market_value)} hint="Based on comparable sales" positive={universal.price_vs_market_pct != null && universal.price_vs_market_pct < -5 ? true : null} />
          <MetricRow label="Price vs Market" value={fmtPct(universal.price_vs_market_pct)} hint="vs comparable sold properties" positive={universal.price_vs_market_pct != null && universal.price_vs_market_pct < 0 ? true : false} />
          <MetricRow label="Price per sqft" value={universal.price_per_sqft ? `$${Math.round(universal.price_per_sqft)}` : '—'} hint={universal.area_median_price_per_sqft ? `Area median $${Math.round(universal.area_median_price_per_sqft)}/sqft` : null} />
          {isCash
            ? <MetricRow label="Cash Investment" value={fmt$(universal.down_payment_amount)} />
            : <>
                <MetricRow label={`Down Payment (${downPct}%)`} value={fmt$(universal.down_payment_amount)} />
                <MetricRow label="Loan Amount" value={fmt$(universal.loan_amount)} />
                <MetricRow label="Monthly Mortgage (P&I)" value={`${fmt$(universal.monthly_mortgage_payment)}/mo`} hint="30yr fixed at current rate" />
              </>
          }
          <MetricRow label="Monthly Tax" value={`${fmt$(universal.property_tax_monthly)}/mo`} />
          <MetricRow label="Monthly Insurance" value={`${fmt$(universal.insurance_estimate_monthly)}/mo`} />
          <MetricRow label="Total Monthly (PITI)" value={`${fmt$(universal.total_monthly_cost)}/mo`} />
        </SectionBox>
      )}

      {/* Goal-specific analysis */}
      {goal === 'rental' && rental && (
        <SectionBox title="Rental Analysis">
          <MetricRow label="Est. Monthly Rent" value={`${fmt$(rental.estimated_monthly_rent)}/mo`} hint="HUD FMR + local market" />
          <MetricRow label="Monthly Cash Flow" value={`${fmt$(rental.monthly_cash_flow)}/mo`} hint="After all expenses" positive={rental.monthly_cash_flow >= 0} />
          <MetricRow label="Cap Rate" value={rental.cap_rate_pct != null ? `${rental.cap_rate_pct.toFixed(2)}%` : 'N/A'} hint="NOI / Purchase Price" positive={rental.cap_rate_pct >= 6} />
          <MetricRow label="Cash-on-Cash Return" value={rental.cash_on_cash_return_pct != null ? `${rental.cash_on_cash_return_pct.toFixed(2)}%` : 'N/A'} hint="Annual CF / cash invested" />
          <MetricRow label="DSCR" value={rental.dscr != null ? rental.dscr.toFixed(2) : 'N/A'} hint=">1.25 is strong" positive={rental.dscr >= 1.25} />
          <MetricRow label="GRM" value={rental.gross_rent_multiplier != null ? `${rental.gross_rent_multiplier.toFixed(1)}x` : 'N/A'} hint="Price / Annual Rent (lower = better)" />
          <MetricRow label="Rent-to-Price" value={rental.rent_to_price_ratio_pct != null ? `${rental.rent_to_price_ratio_pct.toFixed(2)}%` : 'N/A'} hint="Target: >0.6%/mo" />
          <MetricRow label="Break-Even Occupancy" value={rental.break_even_occupancy_pct != null ? `${rental.break_even_occupancy_pct.toFixed(1)}%` : 'N/A'} />
        </SectionBox>
      )}

      {goal === 'long_term' && longTerm && (
        <SectionBox title="Long-Term Hold Projections">
          <MetricRow label="5-Year Projected Value"  value={fmt$(longTerm.projected_value_5yr, true)} />
          <MetricRow label="10-Year Projected Value" value={fmt$(longTerm.projected_value_10yr, true)} positive />
          <MetricRow label="5-Year Appreciation"     value={longTerm.appreciation_5yr_pct != null ? `${longTerm.appreciation_5yr_pct.toFixed(1)}%` : 'N/A'} />
          <MetricRow label="10-Year Appreciation"    value={longTerm.appreciation_10yr_pct != null ? `${longTerm.appreciation_10yr_pct.toFixed(1)}%` : 'N/A'} positive />
          <MetricRow label="Projected Equity (10yr)" value={fmt$(longTerm.projected_equity_10yr, true)} positive />
          <MetricRow label="Total ROI (10yr)"        value={longTerm.total_roi_10yr_pct != null ? `${longTerm.total_roi_10yr_pct.toFixed(1)}%` : 'N/A'} positive />
          <MetricRow label="Annualized Return"       value={longTerm.annualized_return_pct != null ? `${longTerm.annualized_return_pct.toFixed(1)}%` : 'N/A'} />
        </SectionBox>
      )}

      {goal === 'fix_and_flip' && flip && (
        <SectionBox title="Fix & Flip Analysis">
          <MetricRow label="ARV (After-Repair Value)" value={fmt$(flip.arv)} hint="Estimated post-renovation value" />
          <MetricRow label="Estimated Rehab Cost"     value={fmt$(flip.estimated_rehab_cost)} />
          <MetricRow label="Maximum Allowable Offer"  value={fmt$(flip.mao)} hint="ARV × 70% − Rehab (70% rule)" />
          <MetricRow label="Potential Profit"         value={fmt$(flip.potential_profit, true)} positive={flip.potential_profit > 0} />
          <MetricRow label="ROI on Flip"              value={flip.roi_pct != null ? `${flip.roi_pct.toFixed(1)}%` : 'N/A'} positive={flip.roi_pct > 15} />
          <MetricRow label="Deal Score"               value={flip.deal_score || 'N/A'} positive={flip.deal_score === 'Strong Deal'} />
          <MetricRow label="Holding Period"           value={flip.holding_months ? `${flip.holding_months} months` : 'N/A'} />
        </SectionBox>
      )}

      {goal === 'house_hack' && houseHack && (
        <SectionBox title="House Hack Analysis">
          <MetricRow label="Monthly Rental Income"    value={`${fmt$(houseHack.total_rental_income_monthly)}/mo`} positive />
          <MetricRow label="Mortgage Offset"          value={houseHack.mortgage_offset_pct != null ? `${houseHack.mortgage_offset_pct.toFixed(1)}%` : 'N/A'} positive={houseHack.mortgage_offset_pct >= 75} />
          <MetricRow label="Owner Net Monthly Cost"   value={`${fmt$(houseHack.owner_net_monthly_cost)}/mo`} positive={houseHack.owner_net_monthly_cost <= 0} />
          <MetricRow label="Monthly Savings vs Rent"  value={houseHack.monthly_savings_vs_renting != null ? fmt$(houseHack.monthly_savings_vs_renting) : 'N/A'} positive />
          <MetricRow label="Cash-on-Cash Return"      value={houseHack.cash_on_cash_return_pct != null ? `${houseHack.cash_on_cash_return_pct.toFixed(1)}%` : 'N/A'} />
        </SectionBox>
      )}

      {goal === 'str' && strMetrics && (
        <SectionBox title="Short-Term Rental Analysis">
          <MetricRow label="Est. Nightly Rate"        value={`${fmt$(strMetrics.estimated_nightly_rate)}/night`} />
          <MetricRow label="Occupancy Rate"           value={strMetrics.occupancy_rate_pct != null ? `${strMetrics.occupancy_rate_pct.toFixed(1)}%` : 'N/A'} positive={strMetrics.occupancy_rate_pct >= 65} />
          <MetricRow label="Gross Monthly Revenue"    value={`${fmt$(strMetrics.gross_monthly_revenue)}/mo`} positive />
          <MetricRow label="Monthly Cash Flow"        value={`${fmt$(strMetrics.monthly_cash_flow)}/mo`} positive={strMetrics.monthly_cash_flow > 0} />
          <MetricRow label="Cap Rate"                 value={strMetrics.cap_rate_pct != null ? `${strMetrics.cap_rate_pct.toFixed(2)}%` : 'N/A'} />
          <MetricRow label="Break-Even Occupancy"     value={strMetrics.break_even_occupancy_pct != null ? `${strMetrics.break_even_occupancy_pct.toFixed(1)}%` : 'N/A'} />
          <MetricRow label="STR vs LTR Premium"       value={strMetrics.str_vs_ltr_premium_pct != null ? `${strMetrics.str_vs_ltr_premium_pct > 0 ? '+' : ''}${strMetrics.str_vs_ltr_premium_pct.toFixed(1)}%` : 'N/A'} positive={strMetrics.str_vs_ltr_premium_pct > 0} />
        </SectionBox>
      )}

      {/* AI assumptions */}
      {assumptions && (
        <SectionBox title={`AI Underwriting Assumptions · Confidence ${assumptions.confidence || 'N/A'}`}>
          {[
            ['Estimated Rehab Cost',  fmt$(assumptions.estimated_rehab_cost),                       assumptions.rehab_reasoning],
            assumptions.expected_monthly_rent != null && ['Expected Monthly Rent', `${fmt$(assumptions.expected_monthly_rent)}/mo`, 'HUD FMR + local comps'],
            assumptions.vacancy_rate_pct != null && ['Vacancy Rate', `${assumptions.vacancy_rate_pct.toFixed(1)}%`, null],
            assumptions.maintenance_reserve_pct != null && ['Maintenance Reserve', `${assumptions.maintenance_reserve_pct.toFixed(1)}%/yr`, 'Annual %'],
            assumptions.capex_reserve_pct != null && ['CapEx Reserve', `${assumptions.capex_reserve_pct.toFixed(1)}%/yr`, 'Roof, HVAC, appliances'],
            assumptions.arv_estimate != null && ['ARV Estimate', fmt$(assumptions.arv_estimate), 'For flip math'],
            assumptions.insurance_premium_monthly != null && ['Insurance', `${fmt$(assumptions.insurance_premium_monthly)}/mo`, null],
            assumptions.property_manager_fee_pct != null && ['Mgmt Fee', `${assumptions.property_manager_fee_pct.toFixed(1)}%`, '% of collected rent'],
            assumptions.str_nightly_rate != null && ['STR Nightly Rate', `${fmt$(assumptions.str_nightly_rate)}/night`, 'AirDNA comparable'],
            assumptions.str_occupancy_rate_pct != null && ['STR Occupancy', `${assumptions.str_occupancy_rate_pct.toFixed(0)}%`, 'Expected occupancy'],
          ].filter(Boolean).map((row: any, i: number) => (
            <MetricRow key={i} label={row[0]} value={row[1]} hint={row[2]} />
          ))}
        </SectionBox>
      )}
    </div>
  )
}

// ─── Risk & AI tab ────────────────────────────────────────────────────────────

function RiskTab({ analysis }: any) {
  const ai = analysis?.ai_analysis
  const intel = ai?.listing_intelligence
  const risks = analysis?.risks || []

  return (
    <div className="space-y-5">
      {/* Risk register */}
      {risks.length > 0 && (
        <SectionBox title="Risk Assessment">
          {risks.map((risk: any, i: number) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--rule-soft)' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: risk.type === 'positive' ? 'rgba(107,122,66,0.12)' : 'rgba(182,137,52,0.12)', color: risk.type === 'positive' ? 'var(--positive)' : 'var(--warn)' }}>
                {risk.type === 'positive' ? '✓' : '⚠'}
              </div>
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{risk.message}</span>
            </div>
          ))}
        </SectionBox>
      )}

      {/* AI listing intelligence */}
      {intel && (
        <>
          {intel.red_flags?.length > 0 && (
            <SectionBox title="Red Flags">
              {intel.red_flags.map((flag: string, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13, color: 'var(--ink-2)', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', alignItems: 'flex-start' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--negative)', flexShrink: 0, marginTop: 5 }} />
                  {flag}
                </div>
              ))}
            </SectionBox>
          )}

          {intel.renovation_signals?.length > 0 && (
            <SectionBox title="Renovation Signals">
              {intel.renovation_signals.map((item: string, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13, color: 'var(--ink-2)', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', alignItems: 'flex-start' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warn)', flexShrink: 0, marginTop: 5 }} />
                  {item}
                </div>
              ))}
            </SectionBox>
          )}

          {intel.motivated_seller_signals?.length > 0 && (
            <SectionBox title="Motivated-Seller Signals">
              {intel.motivated_seller_signals.map((item: string, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13, color: 'var(--ink-2)', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', alignItems: 'flex-start' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--positive)', flexShrink: 0, marginTop: 5 }} />
                  {item}
                </div>
              ))}
            </SectionBox>
          )}
        </>
      )}

      {/* Inspection budget */}
      <SectionBox title="Suggested Inspection Budget">
        {[
          ['General inspection',  525],
          ['Sewer scope',         250],
          ['Electrical panel',    300],
          ['Crawlspace / foundation', 275],
          ['Roof inspection',     175],
        ].map(([label, cost]) => (
          <MetricRow key={String(label)} label={String(label)} value={`$${cost}`} />
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', fontWeight: 700, fontFamily: 'IBM Plex Mono', fontSize: 13, borderTop: '2px solid var(--rule)', marginTop: 4 }}>
          <span style={{ color: 'var(--ink-2)' }}>Total recommended</span>
          <span style={{ color: 'var(--ink)' }}>$1,525</span>
        </div>
      </SectionBox>

      {/* AI assumptions (editable) */}
      {analysis?.ai_analysis?.assumptions && (
        <SectionBox title="AI Assumptions · Override to re-run engine">
          <div style={{ padding: '12px 0 4px', fontSize: 12, color: 'var(--ink-3)' }}>
            Overriding an assumption will re-run the deterministic engine without a second AI call. Not yet wired in this UI — coming soon.
          </div>
          {Object.entries(analysis.ai_analysis.assumptions).filter(([k]) => !['confidence', 'rehab_reasoning'].includes(k)).map(([key, val]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-2)', textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{String(val)}</span>
                <button style={{ fontSize: 11, color: 'var(--ink-3)', background: 'transparent', border: '1px solid var(--rule)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>override ↗</button>
              </div>
            </div>
          ))}
        </SectionBox>
      )}
    </div>
  )
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function PropertyDetailPage() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('overview')
  const [activeGoal, setActiveGoal] = useState<string | null>(null)

  if (!(state as any)?.result) {
    navigate('/')
    return null
  }

  const { result, market, goal: initialGoal } = state as any
  const { listing, analysis, score, comps } = result
  const goal = activeGoal || initialGoal || 'rental'
  const s: number = score?.overall_score ?? 0
  const highlights = getHighlights(goal, analysis)

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>

      {/* ── Header ───────────────────────────────────────────────── */}
      <header style={{ borderBottom: '1px solid var(--rule)', position: 'sticky', top: 0, zIndex: 40, background: 'var(--paper)' }}>
        <div className="max-w-[1320px] mx-auto px-8 py-4 flex items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <button onClick={() => navigate(-1)} className="flex items-center gap-2" style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.15em', textTransform: 'uppercase', background: 'transparent', border: 'none', cursor: 'pointer' }}>
              ← Back
            </button>
            <a href="/" className="flex items-baseline gap-2" style={{ textDecoration: 'none' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M4 11 L12 4 L20 11 L20 20 L14 20 L14 14 L10 14 L10 20 L4 20 Z" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round"/>
                <circle cx="12" cy="4" r="1.2" fill="var(--accent)"/>
              </svg>
              <span className="font-serif tracking-display" style={{ fontSize: 18, color: 'var(--ink)' }}>Cornice</span>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--ink-3)', marginLeft: 4 }}>/ Investment AI</span>
            </a>
          </div>
          <div className="flex items-center gap-3">
            <button style={{ border: '1px solid var(--rule)', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 500, color: 'var(--ink)', background: 'transparent', cursor: 'pointer' }}>
              Save deal
            </button>
            <button
              onClick={() => window.open(`/api/property/${listing.id}/report`, '_blank')}
              style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 999, padding: '9px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >
              Download report ↓
            </button>
          </div>
        </div>
      </header>

      {/* ── Breadcrumb ───────────────────────────────────────────── */}
      <div className="max-w-[1320px] mx-auto px-8 pt-5 flex items-center justify-between">
        <div className="flex items-center gap-2" style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>← Back to search</button>
          <span>/</span>
          <span>{listing.state}</span>
          <span>/</span>
          <span>{listing.city}</span>
          <span>/</span>
          <span style={{ color: 'var(--ink)' }}>{listing.address}</span>
        </div>
        {listing.days_on_market != null && (
          <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--ink-3)' }}>
            {listing.days_on_market} days on market
          </div>
        )}
      </div>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="max-w-[1320px] mx-auto px-8 pt-6 pb-10">
        {/* Masthead */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 32, marginBottom: 24 }}>
          <div style={{ maxWidth: 680 }}>
            <h1 className="font-serif tracking-display" style={{ fontSize: 'clamp(36px,5vw,64px)', lineHeight: 0.95, color: 'var(--ink)', marginBottom: 12 }}>
              {listing.address}.
            </h1>
            <div style={{ fontSize: 15, color: 'var(--ink-2)' }}>
              {listing.city}, {listing.state} · {listing.property_type || 'Residential'} · built {listing.year_built || '—'}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <Smallcaps style={{ marginBottom: 4 }}>List price</Smallcaps>
            <div className="font-serif tracking-display" style={{ fontSize: 'clamp(28px,4vw,48px)', lineHeight: 1, color: 'var(--ink)' }}>
              {fmt$(listing.list_price, true)}
            </div>
            {analysis?.universal?.price_vs_market_pct != null && (
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, marginTop: 6, color: analysis.universal.price_vs_market_pct < 0 ? 'var(--positive)' : 'var(--negative)' }}>
                {fmtPct(analysis.universal.price_vs_market_pct)} vs AI fair value
              </div>
            )}
            {/* Score circle */}
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: scoreColor(s), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'IBM Plex Mono', lineHeight: 1 }}>{s}</span>
                <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono', marginTop: 2 }}>{score?.grade}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Photo grid */}
        <div className="grid grid-cols-12 gap-3 mb-6">
          <div className="col-span-12 lg:col-span-8 rounded-xl overflow-hidden" style={{ height: 280, background: 'var(--paper-3)', position: 'relative' }}>
            {listing.photos?.[0]
              ? <img src={listing.photos[0]} alt={listing.address} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div className="photo-stripe" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Front elevation</span>
                </div>
            }
          </div>
          <div className="col-span-12 lg:col-span-4 grid grid-rows-2 gap-3">
            {[1, 2].map((i) => (
              <div key={i} className="rounded-xl overflow-hidden" style={{ height: 134, background: 'var(--paper-2)', position: 'relative' }}>
                {listing.photos?.[i]
                  ? <img src={listing.photos[i]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div className="photo-stripe" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{i === 1 ? 'Living' : 'Kitchen'}</span>
                    </div>
                }
              </div>
            ))}
          </div>
        </div>

        {/* Fact band */}
        <div className="grid grid-cols-2 md:grid-cols-7 gap-4 pt-5" style={{ borderTop: '1px solid var(--rule-soft)' }}>
          {[
            ['Beds',       listing.bedrooms],
            ['Baths',      listing.bathrooms],
            ['Sqft',       listing.sqft?.toLocaleString() || '—'],
            ['Lot',        listing.lot_size ? `${listing.lot_size} ac` : '—'],
            ['Year built', listing.year_built || '—'],
            ['Walk score', listing.walk_score || '—'],
            ['School',     listing.school_rating ? `${listing.school_rating}/10` : '—'],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <Smallcaps style={{ marginBottom: 4 }}>{label}</Smallcaps>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 14, color: 'var(--ink)' }}>{value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Highlight metrics ────────────────────────────────────── */}
      {highlights.length > 0 && (
        <div style={{ background: 'var(--paper-2)', borderTop: '1px solid var(--rule-soft)', borderBottom: '1px solid var(--rule-soft)' }}>
          <div className="max-w-[1320px] mx-auto px-8 py-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {highlights.map((h) => (
                <div key={h.label} style={{ background: 'var(--card)', border: '1px solid var(--rule-soft)', borderLeft: '3px solid var(--accent)', borderRadius: 10, padding: 16 }}>
                  <Smallcaps style={{ marginBottom: 6 }}>{h.label}</Smallcaps>
                  <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 20, fontWeight: 700, lineHeight: 1, color: h.positive === true ? 'var(--positive)' : h.positive === false ? 'var(--negative)' : 'var(--ink)' }}>
                    {h.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Sticky tab bar ───────────────────────────────────────── */}
      <div style={{ borderBottom: '1px solid var(--rule-soft)', background: 'var(--paper)', position: 'sticky', top: 57, zIndex: 30 }}>
        <div className="max-w-[1320px] mx-auto px-8 flex items-center justify-between">
          <div className="flex overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '14px 20px',
                  fontSize: 14,
                  fontWeight: 500,
                  marginBottom: -1,
                  color: activeTab === tab.id ? 'var(--ink)' : 'var(--ink-3)',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === tab.id ? '2px solid var(--ink)' : '2px solid transparent',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'color .15s',
                } as React.CSSProperties}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Goal switcher */}
          <div className="hidden md:flex items-center gap-2 flex-wrap py-2">
            <Smallcaps style={{ marginRight: 4 }}>Goal</Smallcaps>
            {GOALS.map((g) => (
              <button
                key={g.key}
                disabled={!g.live}
                onClick={() => g.live && setActiveGoal(g.key)}
                title={g.hint}
                style={{
                  padding: '5px 12px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: g.live ? 'pointer' : 'not-allowed',
                  border: `1px solid ${goal === g.key ? 'var(--ink)' : 'var(--rule)'}`,
                  background: goal === g.key ? 'var(--ink)' : 'transparent',
                  color: !g.live ? 'var(--ink-4)' : goal === g.key ? 'var(--paper)' : 'var(--ink-2)',
                  opacity: !g.live ? 0.55 : 1,
                  transition: 'all .15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {g.label}
                {!g.live && <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 9, letterSpacing: '0.1em', color: 'var(--ink-4)' }}>· soon</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab content ──────────────────────────────────────────── */}
      <div className="max-w-[1320px] mx-auto px-8 py-10">
        {activeTab === 'overview' && (
          <OverviewTab listing={listing} analysis={analysis} market={market} result={result} />
        )}
        {activeTab === 'investment' && (
          <InvestmentTab analysis={analysis} goal={goal} market={market} listing={listing} score={s} />
        )}
        {activeTab === 'comps' && (
          <div>
            <div className="font-serif tracking-display mb-6" style={{ fontSize: 28, color: 'var(--ink)' }}>Comparable Sales</div>
            <ComparablesTable comps={comps} />
          </div>
        )}
        {activeTab === 'risk' && (
          <RiskTab analysis={analysis} />
        )}

        {/* Disclaimer */}
        <p style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'center', marginTop: 48, paddingBottom: 32 }}>
          This report provides estimates for informational purposes only.
          Always conduct your own due diligence before making investment decisions.
        </p>
      </div>
    </div>
  )
}
