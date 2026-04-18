import { useState, useRef, useEffect, type FormEvent, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Brain, Home, BarChart3, TrendingUp } from 'lucide-react'
import {
  usePhotonAutocomplete,
  type PhotonSuggestion,
  type ResolvedLocation,
} from '../hooks/usePhotonAutocomplete'

/* eslint-disable @typescript-eslint/no-explicit-any */

const GOALS = [
  { value: 'rental', label: 'Rental Income' },
  { value: 'fix_and_flip', label: 'Fix & Flip' },
  { value: 'long_term', label: 'Long-Term Hold' },
  { value: 'house_hack', label: 'House Hack' },
  { value: 'short_term_rental', label: 'Short-Term Rental' },
]

const FEATURES = [
  {
    Icon: Brain,
    title: 'AI-Powered Analysis',
    desc: 'Get instant underwriting with AI-generated assumptions for rehab costs, rent estimates, and ARV',
  },
  {
    Icon: BarChart3,
    title: 'Market Intelligence',
    desc: 'Real-time market data from FRED, Census, and HUD to evaluate neighborhoods and trends',
  },
  {
    Icon: Home,
    title: 'Comparable Sales',
    desc: 'Automated comp analysis with adjusted valuations to find below-market opportunities',
  },
  {
    Icon: TrendingUp,
    title: 'Investment Scoring',
    desc: 'Properties ranked 0–100 with detailed breakdowns for cash flow, appreciation, and risk',
  },
]

function formatK(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  return `$${(val / 1_000).toFixed(0)}K`
}

export default function HomePage() {
  const navigate = useNavigate()
  const [goal, setGoal] = useState('rental')
  const [location, setLocation] = useState('')
  const [budgetMin, setBudgetMin] = useState(100_000)
  const [budgetMax, setBudgetMax] = useState(500_000)
  const [radius, setRadius] = useState(15)
  const [downPct, setDownPct] = useState(20)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [locationHint, setLocationHint] = useState<ResolvedLocation | null>(null)

  const { suggestions, fetchSuggestions, clear } = usePhotonAutocomplete()
  const autocompleteRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleLocationChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setLocation(val)
    setLocationHint(null) // user is typing — previous resolution is stale
    fetchSuggestions(val)
    setShowSuggestions(true)
  }

  function selectSuggestion(s: PhotonSuggestion) {
    setLocation(s.full_text)
    setShowSuggestions(false)
    clear()
    setLocationHint(s.location)
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault()
    if (!location.trim()) return
    const criteria: Record<string, unknown> = {
      budget_min: budgetMin,
      budget_max: budgetMax,
      location: location.trim(),
      radius_miles: radius,
      investment_goal: goal,
      down_payment_pct: downPct,
    }
    if (locationHint) criteria.location_hint = locationHint
    navigate('/results', { state: { criteria } })
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <div
        className="relative min-h-[520px] flex flex-col justify-center"
        style={{
          backgroundImage: 'linear-gradient(to right, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0.1) 100%), url(https://www.zillowstatic.com/bedrock/app/uploads/sites/5/2024/01/hero-desktop.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="max-w-[900px] mx-auto w-full px-6 py-16">
          {/* Headline */}
          <h1 className="text-5xl font-bold text-white leading-tight mb-8 drop-shadow-sm">
            Find Your Next<br />Investment Property
          </h1>

          {/* Search card */}
          <form onSubmit={handleSearch} className="bg-white rounded-xl shadow-lg overflow-visible">
            {/* Goal tabs */}
            <div className="flex border-b border-border">
              {GOALS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGoal(g.value)}
                  className={`px-5 py-3.5 text-sm font-semibold transition-colors border-b-2 -mb-px cursor-pointer ${
                    goal === g.value
                      ? 'border-primary text-primary'
                      : 'border-transparent text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {/* Search row */}
            <div className="flex items-center p-3 gap-2">
              {/* Location */}
              <div className="flex-1 relative" ref={autocompleteRef}>
                <div className="flex items-center border border-input rounded-lg px-4 h-12 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10 transition-all">
                  <Search className="w-4 h-4 text-text-muted mr-2 flex-shrink-0" />
                  <input
                    type="text"
                    value={location}
                    onChange={handleLocationChange}
                    onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                    placeholder="Enter an address, neighborhood, city, or ZIP"
                    required
                    className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
                  />
                </div>
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="absolute z-50 w-full bg-white border border-border rounded-lg shadow-lg mt-1 max-h-60 overflow-y-auto">
                    {suggestions.map((s) => (
                      <li
                        key={s.id}
                        onMouseDown={() => selectSuggestion(s)}
                        className="px-4 py-2.5 text-sm hover:bg-bg-light cursor-pointer text-text-primary transition-colors flex items-center gap-2"
                      >
                        <Search className="w-3 h-3 text-text-muted flex-shrink-0" />
                        <span className="truncate">
                          <span className="font-medium">{s.name}</span>
                          {s.place_formatted && (
                            <span className="text-text-muted ml-1">· {s.place_formatted}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Budget Min */}
              <div className="w-32">
                <div className="border border-input rounded-lg px-3 h-12 flex items-center focus-within:border-primary transition-colors">
                  <input
                    type="number"
                    value={budgetMin}
                    onChange={(e) => setBudgetMin(Number(e.target.value))}
                    min={0}
                    step={10000}
                    className="w-full bg-transparent text-sm text-text-secondary outline-none"
                    placeholder="Min Price"
                  />
                </div>
              </div>

              {/* Budget Max */}
              <div className="w-32">
                <div className="border border-input rounded-lg px-3 h-12 flex items-center focus-within:border-primary transition-colors">
                  <input
                    type="number"
                    value={budgetMax}
                    onChange={(e) => setBudgetMax(Number(e.target.value))}
                    min={0}
                    step={10000}
                    className="w-full bg-transparent text-sm text-text-secondary outline-none"
                    placeholder="Max Price"
                  />
                </div>
              </div>

              {/* Search Button */}
              <button
                type="submit"
                disabled={!location.trim()}
                className="h-12 px-7 bg-primary text-white font-semibold rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm whitespace-nowrap cursor-pointer"
              >
                <Search className="w-4 h-4" /> Search
              </button>
            </div>

            {/* Advanced options */}
            <div className="flex gap-6 px-4 pb-3 text-xs text-text-muted border-t border-border pt-2.5">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <span>Search radius:</span>
                <select
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  className="text-primary font-semibold outline-none cursor-pointer bg-transparent"
                >
                  {[5, 10, 15, 20, 25, 30, 50].map((r) => (
                    <option key={r} value={r}>{r} mi</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <span>Down payment:</span>
                <select
                  value={downPct}
                  onChange={(e) => setDownPct(Number(e.target.value))}
                  className="text-primary font-semibold outline-none cursor-pointer bg-transparent"
                >
                  {[100, 25, 20, 10, 5, 3.5].map((p) => (
                    <option key={p} value={p}>{p === 100 ? 'Cash' : `${p}%`}</option>
                  ))}
                </select>
              </label>
              <span className="text-text-muted">
                Budget: {formatK(budgetMin)} &ndash; {formatK(budgetMax)}
              </span>
            </div>
          </form>
        </div>
      </div>

      {/* Features Section */}
      <div className="bg-white py-16">
        <div className="max-w-[1200px] mx-auto px-6">
          <h2 className="text-2xl font-bold text-text-primary mb-2">Smarter Real Estate Investing</h2>
          <p className="text-text-secondary mb-10">AI-powered analysis for rental income, fix &amp; flip, and long-term appreciation</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="zillow-card p-6 hover:shadow-md transition-shadow"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <f.Icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-base font-semibold text-text-primary mb-2">{f.title}</h3>
                <p className="text-sm text-text-secondary leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="bg-bg-light border-t border-border py-6">
        <p className="text-xs text-text-muted text-center max-w-2xl mx-auto px-6">
          This tool provides estimates for informational purposes only. Always conduct your own due diligence
          before making investment decisions. Projections are based on historical trends and may not reflect
          future performance.
        </p>
      </div>
    </div>
  )
}
