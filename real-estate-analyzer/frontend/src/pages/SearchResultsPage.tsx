import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import PropertyCard from '../components/PropertyCard'
import PropertyMap from '../components/Map/PropertyMap'
import LoadingState from '../components/LoadingState'
import { usePropertySearch } from '../hooks/usePropertySearch'

/* eslint-disable @typescript-eslint/no-explicit-any */

function fmt$(n: number | null | undefined, compact = false): string {
  if (n == null || !isFinite(n)) return '—'
  const a = Math.abs(n)
  if (compact && a >= 1_000_000) return `$${(a / 1_000_000).toFixed(1)}M`
  if (compact && a >= 1000) return `$${(a / 1000).toFixed(0)}K`
  return `$${a.toLocaleString()}`
}

const SORT_OPTIONS = [
  { value: 'score',      label: 'Recommended' },
  { value: 'price_asc',  label: 'Price: Low → High' },
  { value: 'price_desc', label: 'Price: High → Low' },
  { value: 'dom',        label: 'Newest Listings' },
]

const GOAL_LABELS: Record<string, string> = {
  rental:       'Rental Income',
  fix_and_flip: 'Fix & Flip',
  long_term:    'Long-Term Hold',
  house_hack:   'House Hack',
  str:          'Short-Term Rental',
}

function sortResults(results: any[], sortBy: string): any[] {
  const arr = [...results]
  switch (sortBy) {
    case 'price_asc':  return arr.sort((a, b) => a.listing.list_price - b.listing.list_price)
    case 'price_desc': return arr.sort((a, b) => b.listing.list_price - a.listing.list_price)
    case 'dom':        return arr.sort((a, b) => (a.listing.days_on_market ?? 999) - (b.listing.days_on_market ?? 999))
    default:           return arr.sort((a, b) => (b.score?.overall_score ?? 0) - (a.score?.overall_score ?? 0))
  }
}

function FilterPill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 20, padding: '6px 14px', fontSize: 12, background: 'var(--paper)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ color: 'var(--ink-3)' }}>{label}:</span>
      {children}
    </div>
  )
}

export default function SearchResultsPage() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const criteria = (state as any)?.criteria

  const { results, loading, error, search, steps, stepIndex } = usePropertySearch()
  const [sortBy, setSortBy]             = useState('score')
  const [propTypeFilter, setPropTypeFilter] = useState('all')
  const [minBeds, setMinBeds]           = useState(0)
  const [hoveredPropertyId, setHoveredPropertyId]   = useState<string | null>(null)
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)
  const listPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (criteria) search(criteria)
  }, [criteria, search])

  const handleSelectProperty = useCallback((id: string) => {
    setSelectedPropertyId(id)
    const el = listPanelRef.current?.querySelector(`[data-property-id="${id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  if (!criteria) {
    navigate('/')
    return null
  }

  const hasResults = results && results.properties?.length > 0
  const market = results?.market_snapshot
  const loc = results?.location
  const locationLabel = loc ? `${loc.city}, ${loc.state_code}` : criteria.location
  const goalLabel = GOAL_LABELS[criteria.investment_goal] || 'Rental'
  const searchSummary = `${locationLabel} · ${fmt$(criteria.budget_min, true)} – ${fmt$(criteria.budget_max, true)} · ${goalLabel}`

  const rawPropTypes: string[] = hasResults
    ? (results.properties as any[]).map((r: any) => r.listing.property_type as string).filter(Boolean)
    : []
  const propTypes: string[] = ['all', ...Array.from(new Set(rawPropTypes))]

  const filtered = (results?.properties || []).filter((r: any) => {
    if (propTypeFilter !== 'all' && r.listing.property_type !== propTypeFilter) return false
    if (r.listing.bedrooms < minBeds) return false
    return true
  })
  const sorted = sortResults(filtered, sortBy)

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>

      {/* Sticky navbar */}
      <Navbar compact searchSummary={searchSummary} />

      {/* Filter bar */}
      <div style={{ background: 'var(--paper)', borderBottom: '1px solid var(--rule-soft)', position: 'sticky', top: 56, zIndex: 20 }}>
        <div className="max-w-[1440px] mx-auto px-6 py-3 flex items-center gap-2 flex-wrap">
          {/* Location chip */}
          <div style={{ border: '1px solid var(--rule)', borderRadius: 20, padding: '6px 14px', fontSize: 12, background: 'var(--paper)', color: 'var(--ink-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {locationLabel}
          </div>

          {/* Goal chip (disabled) */}
          <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 20, padding: '6px 14px', fontSize: 12, background: 'var(--paper-2)', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
            {goalLabel}
          </div>

          {/* Beds filter */}
          <FilterPill label="Beds">
            <select value={minBeds} onChange={(e) => setMinBeds(Number(e.target.value))} style={{ background: 'transparent', border: 'none', outline: 'none', fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}>
              {[{ value: 0, label: 'Any' }, { value: 1, label: '1+' }, { value: 2, label: '2+' }, { value: 3, label: '3+' }, { value: 4, label: '4+' }].map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </FilterPill>

          {/* Property type filter */}
          {propTypes.length > 2 && (
            <FilterPill label="Type">
              <select value={propTypeFilter} onChange={(e) => setPropTypeFilter(e.target.value)} style={{ background: 'transparent', border: 'none', outline: 'none', fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}>
                {propTypes.map((t) => <option key={t} value={t}>{t === 'all' ? 'Any' : t}</option>)}
              </select>
            </FilterPill>
          )}

          <div className="flex-1" />

          {/* Sort */}
          <FilterPill label="Sort">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ background: 'transparent', border: 'none', outline: 'none', fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}>
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FilterPill>

          {/* Save search */}
          <button style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Save search
          </button>
        </div>
      </div>

      {/* Market banner */}
      {market && (() => {
        const ei = market.economic_indicators
        const pt = market.price_trends
        const rm = market.rental_market
        const items: string[] = []
        if (ei?.median_home_value)      items.push(`Median ${fmt$(ei.median_home_value, true)}`)
        if (pt?.yoy_appreciation_pct != null) items.push(`YoY ${pt.yoy_appreciation_pct > 0 ? '+' : ''}${pt.yoy_appreciation_pct.toFixed(1)}%`)
        if (rm?.median_rent_2br)        items.push(`2BR Rent ${fmt$(rm.median_rent_2br)}`)
        if (ei?.mortgage_rate_30yr)     items.push(`Rate ${ei.mortgage_rate_30yr.toFixed(2)}%`)
        if (ei?.median_days_on_market)  items.push(`Avg DOM ${ei.median_days_on_market}d`)
        if (items.length === 0) return null
        return (
          <div style={{ background: 'color-mix(in srgb, var(--accent) 8%, var(--paper))', borderBottom: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)', padding: '8px 24px', display: 'flex', gap: 24, overflowX: 'auto' }}>
            {items.map((item) => (
              <span key={item} style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{item}</span>
            ))}
          </div>
        )
      })()}

      {/* Main split: map left, listings right */}
      <div className="flex flex-1" style={{ height: 'calc(100vh - 112px)' }}>
        {/* Map (52%) */}
        <div className="hidden lg:block lg:w-[52%] sticky top-0" style={{ height: 'calc(100vh - 112px)' }}>
          <PropertyMap
            properties={sorted.filter((r: any) => r.listing.lat && r.listing.lng)}
            hoveredPropertyId={hoveredPropertyId}
            selectedPropertyId={selectedPropertyId}
            onHoverProperty={setHoveredPropertyId}
            onSelectProperty={handleSelectProperty}
            className="w-full h-full rounded-none"
          />
        </div>

        {/* Listings (48%) */}
        <div ref={listPanelRef} className="w-full lg:w-[48%] overflow-y-auto" style={{ background: 'var(--paper-2)' }}>
          {/* Results header */}
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--paper)' }}>
            <div>
              <div className="font-serif" style={{ fontSize: 18, color: 'var(--ink)' }}>
                {loading ? 'Searching…' : `${locationLabel} listings`}
              </div>
              {!loading && (
                <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                  {sorted.length} {sorted.length === 1 ? 'property' : 'properties'} · {goalLabel}
                </div>
              )}
            </div>
            <button onClick={() => navigate('/')} style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--ink-3)', background: 'transparent', border: '1px solid var(--rule)', borderRadius: 20, padding: '5px 12px', cursor: 'pointer' }}>
              ← New search
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: 16 }}>
            {loading && <LoadingState steps={steps} stepIndex={stepIndex} />}

            {error && !loading && (
              <div style={{ background: 'rgba(142,65,40,0.08)', border: '1px solid rgba(142,65,40,0.25)', borderRadius: 12, padding: 20, color: 'var(--negative)' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Search failed</div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>{error}</div>
              </div>
            )}

            {!loading && !error && results && !hasResults && (
              <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--ink-3)' }}>
                <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 16 }}>◎</div>
                <p style={{ fontWeight: 500, color: 'var(--ink-2)' }}>No properties found matching your criteria.</p>
                {results.warnings?.map((w: string, i: number) => (
                  <p key={i} style={{ fontSize: 12, marginTop: 8, color: 'var(--warn)' }}>{w}</p>
                ))}
              </div>
            )}

            {/* Warnings */}
            {!loading && results?.warnings?.length > 0 && hasResults && (
              <div style={{ marginBottom: 12 }}>
                {results.warnings.map((w: string, i: number) => (
                  <div key={i} style={{ background: 'rgba(182,137,52,0.1)', border: '1px solid rgba(182,137,52,0.3)', borderRadius: 8, padding: '8px 14px', fontSize: 12, color: 'var(--warn)', marginBottom: 6 }}>
                    ⚠ {w}
                  </div>
                ))}
              </div>
            )}

            {/* 2-column card grid */}
            {!loading && hasResults && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {sorted.map((result: any) => (
                  <div key={result.listing.id} data-property-id={result.listing.id}>
                    <PropertyCard
                      result={result}
                      goal={criteria.investment_goal}
                      isHovered={result.listing.id === hoveredPropertyId || result.listing.id === selectedPropertyId}
                      onMouseEnter={() => setHoveredPropertyId(result.listing.id)}
                      onMouseLeave={() => setHoveredPropertyId(null)}
                      onClick={() => navigate(`/property/${result.listing.id}`, {
                        state: { result, market, goal: criteria.investment_goal },
                      })}
                    />
                  </div>
                ))}
              </div>
            )}

            {!loading && hasResults && sorted.length === 0 && (
              <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--ink-3)' }}>
                <p>No properties match your filters.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
