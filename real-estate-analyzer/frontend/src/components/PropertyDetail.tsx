import { useState } from 'react'
import { formatCurrency, scoreColor, scoreTextColor } from '../utils/formatters'
import InvestmentMetrics from './InvestmentMetrics'
import ComparablesTable from './ComparablesTable'
import MarketOverview from './MarketOverview'
import { MetalButton, Button } from './ui/liquid-glass-button'

/* eslint-disable @typescript-eslint/no-explicit-any */

const TABS = ['Analysis', 'Comparables', 'Market', 'Risks'] as const

interface RiskItemProps {
  risk: { type: string; message: string }
}

function RiskItem({ risk }: RiskItemProps) {
  const isPositive = risk.type === 'positive'
  return (
    <div className={`flex gap-3 p-3 rounded-lg ${isPositive ? 'bg-accent/20 border border-accent/30' : 'bg-warning/20 border border-warning/30'}`}>
      <span className={`text-lg flex-shrink-0 ${isPositive ? 'text-accent' : 'text-warning'}`}>
        {isPositive ? '\u2713' : '\u26A0'}
      </span>
      <p className={`text-sm ${isPositive ? 'text-accent' : 'text-warning'}`}>{risk.message}</p>
    </div>
  )
}

interface PropertyDetailProps {
  result: any
  market: any
  goal: string
  onClose: () => void
}

export default function PropertyDetail({ result, market, goal, onClose }: PropertyDetailProps) {
  const [activeTab, setActiveTab] = useState<string>('Analysis')
  const { listing, analysis, score, comps } = result
  const s: number = score?.overall_score ?? 0

  function downloadReport() {
    window.open(`/api/property/${listing.id}/report`, '_blank')
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-2xl glass-panel flex flex-col overflow-hidden rounded-none border-r-0 border-y-0">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-700/30">
          <div className="flex-1 min-w-0 pr-4">
            <div className="text-xl font-bold text-text-primary truncate">{listing.address}</div>
            <div className="text-sm text-text-secondary">{listing.city}, {listing.state} {listing.zip_code}</div>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="text-2xl font-extrabold text-text-primary">{formatCurrency(listing.list_price)}</span>
              <span className="text-sm text-text-secondary">{listing.bedrooms}bd · {listing.bathrooms}ba · {listing.sqft?.toLocaleString()} sqft</span>
              {listing.source === 'demo' && (
                <span className="text-xs bg-warning/20 text-warning px-2 py-0.5 rounded-full border border-warning/30">Demo Data</span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <div className={`${scoreColor(s)} text-white text-2xl font-extrabold w-14 h-14 rounded-full flex items-center justify-center shadow`}>
              {s}
            </div>
            <div className={`text-xs font-semibold ${scoreTextColor(s)}`}>{score?.grade} · {score?.summary?.split('.')[0]}</div>
          </div>
        </div>

        {/* Quick specs bar */}
        <div className="px-5 py-2.5 bg-slate-800/40 border-b border-slate-700/30 flex gap-4 text-xs text-text-secondary flex-wrap">
          {listing.year_built && <span>Built {listing.year_built}</span>}
          <span>{listing.property_type}</span>
          {listing.days_on_market != null && <span>{listing.days_on_market}d on market</span>}
          {listing.hoa_monthly && <span>HOA ${listing.hoa_monthly}/mo</span>}
          {listing.price_per_sqft && <span>${listing.price_per_sqft.toFixed(0)}/sqft</span>}
          {listing.listing_url && (
            <a href={listing.listing_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              View listing ↗
            </a>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700/30">
          {TABS.map((tab) => (
            <Button
              key={tab}
              variant="ghost"
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-sm font-medium rounded-none border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab}
            </Button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'Analysis' && (
            <div className="space-y-4">
              {listing.description && (
                <div className="glass-surface p-4 text-sm text-text-secondary leading-relaxed">
                  {listing.description}
                </div>
              )}
              <InvestmentMetrics analysis={analysis} goal={goal} market={market} listing={listing} />
            </div>
          )}

          {activeTab === 'Comparables' && (
            <ComparablesTable comps={comps} />
          )}

          {activeTab === 'Market' && (
            <div className="space-y-4">
              <MarketOverview market={market} />
              {analysis?.ai_analysis?.ai_available && analysis.ai_analysis.market_commentary?.commentary && (
                <div className="glass-surface overflow-hidden">
                  <div className="px-4 py-3 bg-slate-800/40 border-b border-slate-700/30">
                    <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                      <span>AI Market Commentary</span>
                      <span className="text-amber-400 text-base">{'\u2726'}</span>
                      <span className="text-xs font-normal text-text-muted">Powered by Claude</span>
                    </h3>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
                      {analysis.ai_analysis.market_commentary.commentary}
                    </p>
                    {analysis.ai_analysis.market_commentary.outlook && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-text-muted">Outlook:</span>
                        <span className={`inline-block text-xs font-semibold px-2.5 py-1 glass-chip ${
                          analysis.ai_analysis.market_commentary.outlook === 'Bullish'
                            ? 'text-accent'
                            : analysis.ai_analysis.market_commentary.outlook === 'Bearish'
                            ? 'text-danger'
                            : 'text-text-secondary'
                        }`}>
                          {analysis.ai_analysis.market_commentary.outlook}
                        </span>
                      </div>
                    )}
                    {analysis.ai_analysis.market_commentary.key_trends?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">Key Trends</div>
                        <ul className="space-y-1.5">
                          {analysis.ai_analysis.market_commentary.key_trends.map((trend: string, i: number) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-text-primary px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
                              <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-primary" />
                              {trend}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'Risks' && (
            <div className="space-y-3">
              {analysis?.risks?.length > 0 ? (
                <>
                  <p className="text-xs text-text-muted mb-2">
                    {analysis.risks.filter((r: any) => r.type === 'positive').length} positive signals ·{' '}
                    {analysis.risks.filter((r: any) => r.type === 'warning').length} risk factors
                  </p>
                  {analysis.risks
                    .sort((a: any, b: any) => (b.type === 'positive' ? -1 : 1))
                    .map((risk: any, i: number) => (
                      <RiskItem key={i} risk={risk} />
                    ))}
                </>
              ) : (
                <div className="text-center py-10 text-text-muted text-sm">No risk factors identified.</div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700/30 bg-slate-800/40 flex items-center justify-between gap-3">
          <p className="text-xs text-text-muted flex-1">
            Estimates for informational purposes only. Always conduct your own due diligence.
          </p>
          <MetalButton variant="primary" onClick={downloadReport}>
            Download PDF
          </MetalButton>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
