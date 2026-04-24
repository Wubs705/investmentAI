import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, Heart, Share2, MoreHorizontal, Grid2x2, CheckCircle2 } from 'lucide-react'
import InvestmentMetrics from '../components/InvestmentMetrics'
import ComparablesTable from '../components/ComparablesTable'
import PropertyMap from '../components/Map/PropertyMap'
import { formatCurrency } from '../utils/formatters'

/* eslint-disable @typescript-eslint/no-explicit-any */

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'investment', label: 'Investment Analysis' },
  { id: 'comps', label: 'Comparable Sales' },
  { id: 'risk', label: 'Risk & AI Analysis' },
]

function scoreColor(score: number): string {
  if (score >= 75) return '#008A05'
  if (score >= 60) return '#006AFF'
  if (score >= 45) return '#E8850C'
  return '#D32F2F'
}

interface HighlightMetric {
  label: string
  value: string
  positive?: boolean
}

export default function PropertyDetailPage() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('overview')

  if (!(state as any)?.result) {
    navigate('/')
    return null
  }

  const { result, market, goal } = state as any
  const { listing, analysis, score, comps } = result
  const s: number = score?.overall_score ?? 0
  const ai = analysis?.ai_analysis
  const assumptions = ai?.assumptions

  // Highlight metrics
  const highlights: HighlightMetric[] = []
  if (goal === 'rental' && analysis?.rental) {
    const r = analysis.rental
    highlights.push(
      { label: 'Monthly Cash Flow', value: r.monthly_cash_flow != null ? `${r.monthly_cash_flow >= 0 ? '+' : ''}$${Math.abs(r.monthly_cash_flow).toFixed(0)}` : 'N/A', positive: r.monthly_cash_flow >= 0 },
      { label: 'Cap Rate', value: r.cap_rate_pct != null ? `${r.cap_rate_pct.toFixed(1)}%` : 'N/A' },
      { label: 'Cash-on-Cash', value: r.cash_on_cash_return_pct != null ? `${r.cash_on_cash_return_pct.toFixed(1)}%` : 'N/A' },
      { label: 'DSCR', value: r.dscr != null ? r.dscr.toFixed(2) : 'N/A', positive: r.dscr >= 1.2 },
    )
  } else if (goal === 'long_term' && analysis?.long_term) {
    const lt = analysis.long_term
    highlights.push(
      { label: '10yr ROI', value: lt.total_roi_10yr_pct != null ? `${lt.total_roi_10yr_pct.toFixed(1)}%` : 'N/A', positive: true },
      { label: 'Ann. Return', value: lt.annualized_return_pct != null ? `${lt.annualized_return_pct.toFixed(1)}%` : 'N/A' },
      { label: '5yr Value', value: lt.projected_value_5yr != null ? formatCurrency(lt.projected_value_5yr, { compact: true }) : 'N/A' },
      { label: '10yr Value', value: lt.projected_value_10yr != null ? formatCurrency(lt.projected_value_10yr, { compact: true }) : 'N/A', positive: true },
    )
  } else if (goal === 'fix_and_flip' && analysis?.flip) {
    const f = analysis.flip
    highlights.push(
      { label: 'Profit', value: f.potential_profit != null ? formatCurrency(f.potential_profit, { compact: true }) : 'N/A', positive: f.potential_profit > 0 },
      { label: 'ROI', value: f.roi_pct != null ? `${f.roi_pct.toFixed(1)}%` : 'N/A' },
      { label: 'ARV', value: f.arv != null ? formatCurrency(f.arv, { compact: true }) : 'N/A' },
      { label: 'Deal Score', value: f.deal_score || 'N/A', positive: f.deal_score === 'Strong Deal' },
    )
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Top bar */}
      <nav className="zillow-nav sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-6 flex items-center justify-between h-14">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to search
          </button>

          <span className="text-xl font-bold text-primary absolute left-1/2 -translate-x-1/2">InvestmentAI</span>

          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 border border-border rounded-full px-4 py-1.5 text-sm font-medium text-text-secondary hover:bg-bg-light transition-colors cursor-pointer">
              <Heart className="w-4 h-4" /> Save
            </button>
            <button className="flex items-center gap-1.5 border border-border rounded-full px-4 py-1.5 text-sm font-medium text-text-secondary hover:bg-bg-light transition-colors cursor-pointer">
              <Share2 className="w-4 h-4" /> Share
            </button>
            <button className="w-8 h-8 border border-border rounded-full flex items-center justify-center text-text-secondary hover:bg-bg-light transition-colors cursor-pointer">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* Photo gallery */}
      <div className="relative w-full h-[420px] bg-gray-100 overflow-hidden">
        {listing.photos?.[0] ? (
          <img
            src={listing.photos[0]}
            alt={listing.address}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-6xl opacity-10">🏠</span>
          </div>
        )}

        {/* Photo overlay buttons */}
        <div className="absolute bottom-4 left-4 flex gap-2">
          <button className="flex items-center gap-1.5 bg-white/90 backdrop-blur-sm border border-white/50 rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-white transition-colors cursor-pointer shadow-sm">
            <Grid2x2 className="w-4 h-4" />
            See all photos ({listing.photos?.length || 1})
          </button>
          <button className="flex items-center gap-1.5 bg-white/90 backdrop-blur-sm border border-white/50 rounded-lg px-3 py-2 text-sm font-medium text-text-primary hover:bg-white transition-colors cursor-pointer shadow-sm">
            Virtual staging
          </button>
        </div>

        {/* Photo dots */}
        {listing.photos?.length > 1 && (
          <div className="absolute bottom-4 right-4 flex gap-1">
            {listing.photos.slice(0, 5).map((_: string, i: number) => (
              <span key={i} className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-white' : 'bg-white/50'}`} />
            ))}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="max-w-[1200px] mx-auto px-6 py-6">
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
          {/* Left content */}
          <div className="flex-1 min-w-0">
            {/* Property header */}
            <div className="mb-6">
              <div className="flex items-start gap-3 mb-2">
                <h1 className="text-2xl font-bold text-text-primary flex-1">
                  {listing.address}
                  <CheckCircle2 className="w-5 h-5 text-accent inline ml-2 align-middle" />
                </h1>
                {/* Score badge */}
                <div
                  className="flex-shrink-0 w-16 h-16 rounded-full flex flex-col items-center justify-center text-white"
                  style={{ background: scoreColor(s) }}
                >
                  <span className="text-xl font-bold leading-none">{s}</span>
                  <span className="text-[10px] font-medium mt-0.5">{score?.grade}</span>
                </div>
              </div>

              <p className="text-text-secondary mb-2">
                {listing.city}, {listing.state} {listing.zip_code}
              </p>

              <div className="flex flex-wrap gap-3 text-sm text-text-secondary">
                {listing.listing_url && (
                  <a href={listing.listing_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    Visit listing website ↗
                  </a>
                )}
              </div>

              {/* Quick facts */}
              <div className="flex flex-wrap gap-6 mt-4 pt-4 border-t border-border text-sm text-text-secondary">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-primary">{listing.property_type || 'Residential'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>{listing.bedrooms} bed</span>
                </div>
                {listing.bathrooms && (
                  <div className="flex items-center gap-2">
                    <span>{listing.bathrooms} bath</span>
                  </div>
                )}
                {listing.sqft && (
                  <div className="flex items-center gap-2">
                    <span>{listing.sqft.toLocaleString()} sqft</span>
                  </div>
                )}
                {listing.year_built && (
                  <div className="flex items-center gap-2">
                    <span>Built {listing.year_built}</span>
                  </div>
                )}
                {listing.days_on_market != null && (
                  <div className="flex items-center gap-2">
                    <span>{listing.days_on_market} days on market</span>
                  </div>
                )}
              </div>
            </div>

            {/* Price */}
            <div className="text-3xl font-bold text-text-primary mb-6">
              {formatCurrency(listing.list_price)}
            </div>

            {/* Highlight Metrics */}
            {highlights.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {highlights.map((h) => (
                  <div key={h.label} className="border border-border rounded-xl p-4 text-center bg-white">
                    <div className={`text-2xl font-bold ${
                      h.positive === true ? 'text-accent' : h.positive === false ? 'text-danger' : 'text-primary'
                    }`}>
                      {h.value}
                    </div>
                    <div className="text-xs text-text-muted mt-1">{h.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Tabs */}
            <div className="border-b border-border mb-6">
              <div className="flex gap-0 overflow-x-auto">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors cursor-pointer ${
                      activeTab === tab.id
                        ? 'border-primary text-primary'
                        : 'border-transparent text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="border border-border rounded-xl p-6">
                  <h2 className="text-lg font-semibold text-text-primary mb-3">About this property</h2>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-text-muted">Property type</span>
                      <div className="font-medium text-text-primary mt-0.5">{listing.property_type || 'N/A'}</div>
                    </div>
                    <div>
                      <span className="text-text-muted">Year built</span>
                      <div className="font-medium text-text-primary mt-0.5">{listing.year_built || 'N/A'}</div>
                    </div>
                    <div>
                      <span className="text-text-muted">Bedrooms</span>
                      <div className="font-medium text-text-primary mt-0.5">{listing.bedrooms}</div>
                    </div>
                    <div>
                      <span className="text-text-muted">Bathrooms</span>
                      <div className="font-medium text-text-primary mt-0.5">{listing.bathrooms}</div>
                    </div>
                    <div>
                      <span className="text-text-muted">Square footage</span>
                      <div className="font-medium text-text-primary mt-0.5">{listing.sqft?.toLocaleString() || 'N/A'}</div>
                    </div>
                    <div>
                      <span className="text-text-muted">Days on market</span>
                      <div className="font-medium text-text-primary mt-0.5">{listing.days_on_market ?? 'N/A'}</div>
                    </div>
                  </div>
                </div>

                {listing.lat && listing.lng && (
                  <div className="border border-border rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-border">
                      <h2 className="text-lg font-semibold text-text-primary">Neighborhood</h2>
                      <p className="text-sm text-text-muted mt-0.5">{listing.city}, {listing.state}</p>
                    </div>
                    <div style={{ height: '320px' }}>
                      <PropertyMap
                        properties={[result]}
                        hoveredPropertyId={null}
                        selectedPropertyId={listing.id}
                        onHoverProperty={() => {}}
                        onSelectProperty={() => {}}
                        className="w-full h-full rounded-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'investment' && (
              <InvestmentMetrics analysis={analysis} goal={goal} market={market} listing={listing} />
            )}

            {activeTab === 'comps' && (
              <div>
                <h2 className="text-lg font-semibold text-text-primary mb-4">Comparable Sales</h2>
                <ComparablesTable comps={comps} />
              </div>
            )}

            {activeTab === 'risk' && (
              <div className="space-y-6">
                {analysis?.risks?.length > 0 && (
                  <div className="border border-border rounded-xl p-6">
                    <h2 className="text-lg font-semibold text-text-primary mb-4">Risk Assessment</h2>
                    <div className="space-y-3">
                      {analysis.risks.map((risk: any, i: number) => {
                        const isPositive = risk.type === 'positive'
                        return (
                          <div key={i} className="flex items-start gap-3">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                              isPositive ? 'bg-green-100 text-accent' : 'bg-amber-100 text-warning'
                            }`}>
                              {isPositive ? '✓' : '⚠'}
                            </div>
                            <span className="text-sm text-text-primary">{risk.message}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {assumptions && (
                  <div className="border border-blue-200 rounded-xl p-6 bg-blue-50/30">
                    <div className="flex items-center gap-2 mb-4">
                      <h2 className="text-lg font-semibold text-text-primary">AI Underwriting Assumptions</h2>
                      {assumptions.confidence && (
                        <span className="text-xs font-semibold text-primary bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                          Confidence: {assumptions.confidence}
                        </span>
                      )}
                    </div>
                    <div className="space-y-3 divide-y divide-border">
                      {[
                        ['Estimated Rehab Cost', formatCurrency(assumptions.estimated_rehab_cost ?? 0), assumptions.rehab_reasoning],
                        assumptions.expected_monthly_rent != null && ['Expected Monthly Rent', formatCurrency(assumptions.expected_monthly_rent), null],
                        assumptions.vacancy_rate_pct != null && ['Vacancy Rate', `${assumptions.vacancy_rate_pct.toFixed(1)}%`, null],
                        assumptions.maintenance_reserve_pct != null && ['Maintenance Reserve', `${assumptions.maintenance_reserve_pct.toFixed(1)}%`, null],
                        assumptions.arv_estimate != null && ['ARV Estimate', formatCurrency(assumptions.arv_estimate), null],
                        assumptions.insurance_premium_monthly != null && ['Insurance Premium', `${formatCurrency(assumptions.insurance_premium_monthly)}/mo`, null],
                      ].filter(Boolean).map((row: any, i: number) => (
                        <div key={i} className="flex items-center justify-between pt-3">
                          <div>
                            <div className="text-sm text-text-primary">{row[0]}</div>
                            {row[2] && <div className="text-xs text-text-muted mt-0.5">{row[2]}</div>}
                          </div>
                          <span className="text-sm font-semibold text-primary">{row[1]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Disclaimer */}
            <p className="text-xs text-text-muted text-center mt-12 pb-8">
              This report provides estimates for informational purposes only.
              Always conduct your own due diligence before making investment decisions.
            </p>
          </div>

          {/* Right: Actions sidebar */}
          <div className="w-full lg:w-[300px] lg:flex-shrink-0">
            <div className="lg:sticky lg:top-20">
              <button
                onClick={() => window.open(`/api/property/${listing.id}/report`, '_blank')}
                className="w-full bg-primary text-white font-semibold py-2.5 rounded-lg hover:bg-primary-dark transition-colors cursor-pointer text-sm"
              >
                Download Investment Report
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
