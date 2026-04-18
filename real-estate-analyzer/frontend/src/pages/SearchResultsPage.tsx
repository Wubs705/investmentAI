import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, Bookmark } from 'lucide-react'
import Navbar from '../components/Navbar'
import PropertyCard from '../components/PropertyCard'
import PropertyMap from '../components/Map/PropertyMap'
import LoadingState from '../components/LoadingState'
import { usePropertySearch } from '../hooks/usePropertySearch'
import { formatCurrency } from '../utils/formatters'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SORT_OPTIONS = [
  { value: 'score', label: 'Recommended' },
  { value: 'price_asc', label: 'Price: Low → High' },
  { value: 'price_desc', label: 'Price: High → Low' },
  { value: 'dom', label: 'Newest Listings' },
]

function sortResults(results: any[], sortBy: string): any[] {
  const arr = [...results]
  switch (sortBy) {
    case 'price_asc':
      return arr.sort((a, b) => a.listing.list_price - b.listing.list_price)
    case 'price_desc':
      return arr.sort((a, b) => b.listing.list_price - a.listing.list_price)
    case 'dom':
      return arr.sort((a, b) => (a.listing.days_on_market ?? 999) - (b.listing.days_on_market ?? 999))
    default:
      return arr.sort((a, b) => (b.score?.overall_score ?? 0) - (a.score?.overall_score ?? 0))
  }
}

const GOAL_LABELS: Record<string, string> = {
  rental: 'For Rent',
  fix_and_flip: 'Fix & Flip',
  long_term: 'Long-Term',
}

interface FilterDropdownProps {
  label: string
  value: string | number
  options: { value: string | number; label: string }[]
  onChange: (v: string) => void
  disabled?: boolean
}

function FilterDropdown({ label, value, options, onChange, disabled }: FilterDropdownProps) {
  const selected = options.find(o => String(o.value) === String(value))
  return (
    <div className="relative">
      <div className={`flex items-center gap-1.5 border rounded-full px-4 py-2 text-sm font-medium cursor-pointer transition-colors ${
        disabled ? 'border-border text-text-muted bg-gray-50' : 'border-border text-text-primary hover:border-text-secondary bg-white'
      }`}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="appearance-none bg-transparent outline-none cursor-pointer pr-1 text-sm font-medium text-text-primary disabled:text-text-muted"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0 pointer-events-none" />
      </div>
    </div>
  )
}

export default function SearchResultsPage() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const criteria = (state as any)?.criteria

  const { results, loading, error, search, steps, stepIndex } = usePropertySearch()
  const [sortBy, setSortBy] = useState('score')
  const [propTypeFilter, setPropTypeFilter] = useState('all')
  const [minBeds, setMinBeds] = useState(0)
  const [hoveredPropertyId, setHoveredPropertyId] = useState<string | null>(null)
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)
  const listPanelRef = useRef<HTMLDivElement>(null)

  // Fire the search when criteria is available.
  // The hook's own AbortController + cacheRef dedupe any StrictMode-simulated
  // re-mount; a stale `didSearchRef` here would leave the aborted first request
  // with no retry, so we rely on the hook instead of a local guard.
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
  const searchSummary = loc
    ? `${locationLabel} · ${formatCurrency(criteria.budget_min, { compact: true })} - ${formatCurrency(criteria.budget_max, { compact: true })} · ${GOAL_LABELS[criteria.investment_goal] || 'Rental'}`
    : criteria.location

  const rawPropTypes: string[] = hasResults
    ? (results.properties as any[]).map((r) => r.listing.property_type as string).filter((t: string) => !!t)
    : []
  const propTypes: string[] = ['all', ...Array.from(new Set(rawPropTypes))]

  const filtered = (results?.properties || []).filter((r: any) => {
    if (propTypeFilter !== 'all' && r.listing.property_type !== propTypeFilter) return false
    if (r.listing.bedrooms < minBeds) return false
    return true
  })
  const sorted = sortResults(filtered, sortBy)

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Navbar compact searchSummary={searchSummary} />

      {/* Filter Bar */}
      <div className="bg-white border-b border-border">
        <div className="max-w-[1440px] mx-auto px-6 py-3 flex items-center gap-2 flex-wrap">
          {/* Location chip */}
          <div className="flex items-center gap-1.5 border border-border rounded-full px-4 py-2 text-sm font-medium text-text-primary bg-white">
            <span>{locationLabel}</span>
          </div>

          <FilterDropdown
            label="Goal"
            value={criteria.investment_goal}
            options={Object.entries(GOAL_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            onChange={() => {}}
            disabled
          />

          <FilterDropdown
            label="Beds"
            value={minBeds}
            options={[
              { value: 0, label: 'Beds & Baths' },
              { value: 1, label: '1+ bd' },
              { value: 2, label: '2+ bd' },
              { value: 3, label: '3+ bd' },
              { value: 4, label: '4+ bd' },
            ]}
            onChange={(v) => setMinBeds(Number(v))}
          />

          {propTypes.length > 2 && (
            <FilterDropdown
              label="Type"
              value={propTypeFilter}
              options={propTypes.map((t) => ({ value: t, label: t === 'all' ? 'Property type' : t }))}
              onChange={setPropTypeFilter}
            />
          )}

          <div className="flex-1" />

          <button className="flex items-center gap-1.5 bg-primary text-white px-5 py-2 rounded-full text-sm font-semibold hover:bg-primary-dark transition-colors cursor-pointer">
            <Bookmark className="w-3.5 h-3.5" />
            Save search
          </button>
        </div>
      </div>

      {/* Main split layout: map left, listings right */}
      <div className="flex flex-1" style={{ height: 'calc(100vh - 112px)' }}>
        {/* Left: Map */}
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

        {/* Right: Listings */}
        <div ref={listPanelRef} className="w-full lg:w-[48%] overflow-y-auto bg-white">
          {/* Results header */}
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-text-primary">
                {loading ? 'Searching…' : `${locationLabel} Listings`}
              </h1>
              {!loading && (
                <p className="text-sm text-text-secondary">
                  {sorted.length} {sorted.length === 1 ? 'property' : 'properties'} available
                </p>
              )}
            </div>
            <FilterDropdown
              label="Sort"
              value={sortBy}
              options={SORT_OPTIONS}
              onChange={setSortBy}
            />
          </div>

          {/* Market banner */}
          {market && (() => {
            const ei = market.economic_indicators
            const pt = market.price_trends
            const rm = market.rental_market
            const items: string[] = []
            if (ei?.median_home_value) items.push(`Median: ${formatCurrency(ei.median_home_value, { compact: true })}`)
            if (pt?.yoy_appreciation_pct != null) items.push(`YoY: ${pt.yoy_appreciation_pct > 0 ? '+' : ''}${pt.yoy_appreciation_pct.toFixed(1)}%`)
            if (rm?.median_rent_2br) items.push(`2BR Rent: ${formatCurrency(rm.median_rent_2br)}`)
            if (ei?.mortgage_rate_30yr) items.push(`Rate: ${ei.mortgage_rate_30yr.toFixed(2)}%`)
            if (ei?.median_days_on_market) items.push(`Avg DOM: ${ei.median_days_on_market}d`)
            if (items.length === 0) return null
            return (
              <div className="px-6 py-2.5 bg-blue-50 border-b border-blue-100 flex gap-6 overflow-x-auto">
                {items.map((item) => (
                  <span key={item} className="text-xs font-medium text-primary whitespace-nowrap">{item}</span>
                ))}
              </div>
            )
          })()}

          {/* Content */}
          <div className="p-4">
            {loading && <LoadingState steps={steps} stepIndex={stepIndex} />}

            {error && !loading && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-red-700">
                <div className="font-semibold mb-1">Search failed</div>
                <div className="text-sm opacity-80">{error}</div>
              </div>
            )}

            {!loading && !error && results && !hasResults && (
              <div className="text-center py-16 text-text-muted">
                <div className="text-5xl mb-4 opacity-30">🔍</div>
                <p className="font-medium text-text-secondary">No properties found matching your criteria.</p>
                {results.warnings?.map((w: string, i: number) => (
                  <p key={i} className="text-xs mt-2 text-warning">{w}</p>
                ))}
              </div>
            )}

            {/* Warnings */}
            {!loading && results?.warnings?.length > 0 && hasResults && (
              <div className="space-y-1 mb-4">
                {results.warnings.map((w: string, i: number) => (
                  <div key={i} className="bg-amber-50 border border-amber-200 text-amber-700 text-xs px-4 py-2 rounded-lg">
                    ⚠ {w}
                  </div>
                ))}
              </div>
            )}

            {/* 2-column grid */}
            {!loading && hasResults && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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
              <div className="text-center py-16 text-text-muted">
                <div className="text-4xl mb-3 opacity-30">🔍</div>
                <p>No properties match your filters.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
