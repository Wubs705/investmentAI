import { useState } from 'react'
import PropertyCard from './PropertyCard'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SORT_OPTIONS = [
  { value: 'score', label: 'Best Score' },
  { value: 'price_asc', label: 'Price: Low \u2192 High' },
  { value: 'price_desc', label: 'Price: High \u2192 Low' },
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

interface ResultsGridProps {
  results: any[]
  goal: string
  onSelectProperty: (result: any) => void
  warnings?: string[]
}

export default function ResultsGrid({ results, goal, onSelectProperty, warnings }: ResultsGridProps) {
  const [sortBy, setSortBy] = useState('score')
  const [minScore, setMinScore] = useState(0)
  const [propTypeFilter, setPropTypeFilter] = useState('all')
  const [minBeds, setMinBeds] = useState(0)

  const propTypes = ['all', ...new Set(results.map((r) => r.listing.property_type).filter(Boolean))]

  const filtered = results.filter((r) => {
    if ((r.score?.overall_score ?? 0) < minScore) return false
    if (propTypeFilter !== 'all' && r.listing.property_type !== propTypeFilter) return false
    if (r.listing.bedrooms < minBeds) return false
    return true
  })

  const sorted = sortResults(filtered, sortBy)

  return (
    <div>
      {/* Warnings */}
      {warnings && warnings.length > 0 && (
        <div className="mb-4 space-y-1">
          {warnings.map((w, i) => (
            <div key={i} className="glass-banner text-warning text-xs px-4 py-2 rounded-lg">
              {'\u26A0'} {w}
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <span className="text-sm font-semibold text-text-primary">
          {sorted.length} of {results.length} properties
        </span>

        <div className="ml-auto flex flex-wrap gap-2 items-center">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="text-xs glass-input px-2 py-1.5"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {propTypes.length > 2 && (
            <select
              value={propTypeFilter}
              onChange={(e) => setPropTypeFilter(e.target.value)}
              className="text-xs glass-input px-2 py-1.5"
            >
              {propTypes.map((t) => (
                <option key={t} value={t}>{t === 'all' ? 'All Types' : t}</option>
              ))}
            </select>
          )}

          <select
            value={minBeds}
            onChange={(e) => setMinBeds(Number(e.target.value))}
            className="text-xs glass-input px-2 py-1.5"
          >
            <option value={0}>Any Beds</option>
            <option value={1}>1+ Beds</option>
            <option value={2}>2+ Beds</option>
            <option value={3}>3+ Beds</option>
            <option value={4}>4+ Beds</option>
          </select>

          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="text-xs glass-input px-2 py-1.5"
          >
            <option value={0}>All Scores</option>
            <option value={50}>Score 50+</option>
            <option value={65}>Score 65+</option>
            <option value={75}>Score 75+</option>
          </select>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <div className="text-4xl mb-3 opacity-30">{'\u{1F50D}'}</div>
          <p>No properties match your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {sorted.map((result: any) => (
            <PropertyCard
              key={result.listing.id}
              result={result}
              goal={goal}
              onClick={() => onSelectProperty(result)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
