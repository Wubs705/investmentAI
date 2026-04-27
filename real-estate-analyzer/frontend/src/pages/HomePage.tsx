import { useState, useRef, useEffect, type FormEvent, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  usePhotonAutocomplete,
  type PhotonSuggestion,
  type ResolvedLocation,
} from '../hooks/usePhotonAutocomplete'

/* eslint-disable @typescript-eslint/no-explicit-any */

const GOALS = [
  { value: 'rental',       label: 'Rental Income',     hint: 'Buy & hold · monthly cash flow' },
  { value: 'fix_and_flip', label: 'Fix & Flip',        hint: '70% rule · ARV · holding cost' },
  { value: 'long_term',    label: 'Long-Term Hold',    hint: '10-yr appreciation + equity' },
  { value: 'house_hack',   label: 'House Hack',        hint: 'Owner + ADU rental offset' },
  { value: 'str',          label: 'Short-Term Rental', hint: 'Nightly rate · occupancy · CF' },
]

const FEATURES = [
  { icon: '◈', title: 'AI-Powered Underwriting',  desc: 'Claude Haiku extracts rehab costs, rent estimates, and ARV from listings. Sonnet writes the investment memo on demand.' },
  { icon: '◎', title: 'Market Intelligence',       desc: 'Real-time data from FRED, Census, and HUD FMR feeds — appreciation trends, vacancy, median rents, 30-yr rate.' },
  { icon: '⊕', title: 'Comparable Sales',          desc: 'Automated comp analysis with adjusted valuations and price-per-sqft benchmarking to surface below-market opportunities.' },
  { icon: '▲', title: 'Investment Scoring',        desc: 'Properties ranked 0–100 with weighted subscores for cash flow, appreciation, DSCR, rehab risk, and neighborhood quality.' },
]

const PIPELINE = [
  { n: '01', role: 'Extraction', model: 'Claude Haiku 4.5', detail: 'Parses listing text for rehab signals, rent comps, condition flags, and motivated-seller language. ~$0.0004/property.' },
  { n: '02', role: 'Calculation', model: 'Deterministic Engine', detail: 'Python engine runs the numbers — cash flow, cap rate, DSCR, IRR, flip MAO, STR yield. No AI guesswork.' },
  { n: '03', role: 'Narrative', model: 'Claude Sonnet 4.6', detail: 'On-demand broker-style investment memo. Strengths, concerns, offer strategy. Cached 24h — charged once.' },
]

const MARKET_LEADERS = [
  { city: 'Asheville, NC',    tier: 'Vacation / STR',   cap: '5.2%', grade: 'A−' },
  { city: 'Pittsburgh, PA',   tier: 'Cash Flow',        cap: '6.8%', grade: 'B+' },
  { city: 'Tulsa, OK',        tier: 'Appreciation',     cap: '5.9%', grade: 'B+' },
  { city: 'Knoxville, TN',    tier: 'House Hack',       cap: '5.5%', grade: 'B'  },
  { city: 'Columbus, OH',     tier: 'Long-Term Hold',   cap: '5.1%', grade: 'B'  },
]

const RECENT_SEARCHES = [
  { label: 'Asheville, NC · Rental · $300–600k',       criteria: { location: 'Asheville, NC',  investment_goal: 'rental',       budget_min: 300000, budget_max: 600000, radius_miles: 15, down_payment_pct: 0.20, bedrooms_min: 1, max_results: 20 } },
  { label: 'Pittsburgh, PA · Fix & Flip · $100–300k', criteria: { location: 'Pittsburgh, PA', investment_goal: 'fix_and_flip',  budget_min: 100000, budget_max: 300000, radius_miles: 15, down_payment_pct: 0.25, bedrooms_min: 1, max_results: 20 } },
  { label: 'Tulsa, OK · Long-Term · $150–400k',        criteria: { location: 'Tulsa, OK',      investment_goal: 'long_term',    budget_min: 150000, budget_max: 400000, radius_miles: 15, down_payment_pct: 0.20, bedrooms_min: 1, max_results: 20 } },
]

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  return `$${(n / 1_000).toFixed(0)}K`
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
    setLocationHint(null)
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
      location: location.trim(),
      investment_goal: goal,
      budget_min: budgetMin,
      budget_max: budgetMax,
      radius_miles: radius,
      down_payment_pct: downPct / 100,
      bedrooms_min: 1,
      bathrooms_min: 1,
      max_results: 20,
    }
    if (locationHint) criteria.location_hint = locationHint
    navigate('/results', { state: { criteria } })
  }

  function fireRecentSearch(criteria: Record<string, unknown>) {
    navigate('/results', { state: { criteria } })
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section
        className="relative hero-stripe overflow-hidden"
        style={{ background: 'var(--ink)', minHeight: 580 }}
      >
        {/* Nav */}
        <header className="absolute top-0 left-0 right-0 z-30">
          <div className="max-w-[1320px] mx-auto px-8 py-5 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M4 11 L12 4 L20 11 L20 20 L14 20 L14 14 L10 14 L10 20 L4 20 Z" stroke="var(--paper)" strokeWidth="1.5" strokeLinejoin="round"/>
                <circle cx="12" cy="4" r="1.2" fill="var(--accent)"/>
              </svg>
              <span className="font-serif tracking-display" style={{ fontSize: 20, color: 'var(--paper)', letterSpacing: '0.02em' }}>Cornice</span>
            </div>
            <nav className="hidden md:flex items-center gap-6 text-[13px]" style={{ color: 'rgba(255,255,255,0.65)' }}>
              <a href="#" className="hover:text-white transition-colors">Deals</a>
              <a href="/market" className="hover:text-white transition-colors">Markets</a>
              <a href="/how-it-works" className="hover:text-white transition-colors">How it works</a>
            </nav>
            <div className="flex items-center gap-3">
              <span style={{ fontSize: 13, fontWeight: 500, padding: '6px 16px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.3)', color: 'var(--paper)', cursor: 'pointer' }}>Sign in</span>
              <a href="#search" style={{ fontSize: 13, fontWeight: 600, padding: '6px 16px', borderRadius: 20, background: 'var(--accent)', color: '#fff', textDecoration: 'none' }}>Get started</a>
            </div>
          </div>
        </header>

        {/* Hero content */}
        <div id="search" className="max-w-[960px] mx-auto px-8" style={{ paddingTop: 144, paddingBottom: 64 }}>
          {/* Eyebrow */}
          <div className="smallcaps mb-5" style={{ color: 'rgba(255,255,255,0.45)' }}>AI-powered real estate underwriting</div>

          {/* Headline */}
          <h1 className="font-serif tracking-display mb-8" style={{ fontSize: 'clamp(44px,6vw,80px)', lineHeight: 0.95, color: 'var(--paper)', letterSpacing: '-0.02em' }}>
            Find your next<br />deal faster.
          </h1>

          {/* Search card */}
          <div style={{ background: 'var(--paper)', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', border: '1px solid var(--rule-soft)' }}>
            {/* Goal tabs */}
            <div className="flex border-b overflow-x-auto" style={{ borderColor: 'var(--rule-soft)' }}>
              {GOALS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGoal(g.value)}
                  title={g.hint}
                  style={{
                    padding: '10px 18px',
                    fontSize: 13,
                    fontWeight: 500,
                    borderBottom: goal === g.value ? '2px solid var(--accent)' : '2px solid transparent',
                    marginBottom: -1,
                    color: goal === g.value ? 'var(--ink)' : 'var(--ink-3)',
                    background: 'transparent',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all .15s',
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {/* Search row */}
            <form onSubmit={handleSearch} className="p-4 flex flex-col gap-3">
              <div className="flex gap-3 items-center flex-wrap">
                {/* Location */}
                <div className="relative flex-1" style={{ minWidth: 260 }} ref={autocompleteRef}>
                  <div className="flex items-center gap-2" style={{ border: '1px solid var(--rule)', borderRadius: 8, padding: '10px 14px', background: 'var(--paper)', transition: 'border-color .15s' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--ink-3)', flexShrink: 0 }}>
                      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/>
                      <path d="M16.5 16.5 L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                    <input
                      type="text"
                      value={location}
                      onChange={handleLocationChange}
                      onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                      placeholder="City, neighborhood, or ZIP code"
                      required
                      style={{ background: 'transparent', outline: 'none', fontSize: 14, color: 'var(--ink)', flex: 1, border: 'none' }}
                    />
                  </div>
                  {showSuggestions && suggestions.length > 0 && (
                    <ul style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 10, boxShadow: '0 8px 24px rgba(30,26,21,0.12)', zIndex: 100, overflow: 'hidden', listStyle: 'none', margin: 0, padding: 0 }}>
                      {suggestions.map((s: PhotonSuggestion) => (
                        <li
                          key={s.id}
                          onMouseDown={() => selectSuggestion(s)}
                          style={{ padding: '10px 14px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--rule-soft)' }}
                          className="hover:bg-[var(--paper-2)]"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--ink-3)', flexShrink: 0 }}>
                            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor" opacity=".5"/>
                          </svg>
                          <span>
                            <span style={{ fontWeight: 500 }}>{s.name}</span>
                            {s.place_formatted && <span style={{ color: 'var(--ink-3)', marginLeft: 6 }}>· {s.place_formatted}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Budget min */}
                <div style={{ width: 128, border: '1px solid var(--rule)', borderRadius: 8, padding: '10px 14px', background: 'var(--paper)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>$</span>
                  <input type="number" value={budgetMin} onChange={(e) => setBudgetMin(Number(e.target.value))} min={0} step={10000} style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: 'var(--ink)', width: '100%' }} placeholder="Min" />
                </div>

                {/* Budget max */}
                <div style={{ width: 128, border: '1px solid var(--rule)', borderRadius: 8, padding: '10px 14px', background: 'var(--paper)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>$</span>
                  <input type="number" value={budgetMax} onChange={(e) => setBudgetMax(Number(e.target.value))} min={0} step={10000} style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: 'var(--ink)', width: '100%' }} placeholder="Max" />
                </div>

                {/* Search button */}
                <button
                  type="submit"
                  disabled={!location.trim()}
                  style={{ height: 44, padding: '0 28px', background: 'var(--accent)', color: '#fff', fontWeight: 600, borderRadius: 8, fontSize: 14, cursor: location.trim() ? 'pointer' : 'not-allowed', opacity: location.trim() ? 1 : 0.5, border: 'none', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="M16.5 16.5 L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  Search
                </button>
              </div>

              {/* Advanced row */}
              <div className="flex gap-6 text-xs" style={{ borderTop: '1px solid var(--rule-soft)', paddingTop: 10, color: 'var(--ink-3)' }}>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <span>Radius:</span>
                  <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} style={{ background: 'transparent', border: 'none', outline: 'none', fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}>
                    {[5, 10, 15, 20, 25, 30, 50].map((r) => <option key={r} value={r}>{r} mi</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <span>Down payment:</span>
                  <select value={downPct} onChange={(e) => setDownPct(Number(e.target.value))} style={{ background: 'transparent', border: 'none', outline: 'none', fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}>
                    {[100, 25, 20, 10, 5, 3.5].map((p) => <option key={p} value={p}>{p === 100 ? 'Cash' : `${p}%`}</option>)}
                  </select>
                </label>
                <span>Budget: {fmt(budgetMin)} – {fmt(budgetMax)}</span>
              </div>
            </form>

            {/* Recent searches */}
            {RECENT_SEARCHES.length > 0 && (
              <div className="flex items-center gap-2 px-4 pb-4 flex-wrap">
                <span className="smallcaps" style={{ color: 'var(--ink-4)' }}>Recent:</span>
                {RECENT_SEARCHES.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => fireRecentSearch(s.criteria)}
                    style={{ background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 20, padding: '5px 14px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-2)', transition: 'background .15s' }}
                    onMouseOver={(e) => (e.currentTarget.style.background = 'var(--paper-3)')}
                    onMouseOut={(e) => (e.currentTarget.style.background = 'var(--paper-2)')}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Feature grid ────────────────────────────────────────────── */}
      <section style={{ background: 'var(--paper)', padding: '80px 0' }}>
        <div className="max-w-[1200px] mx-auto px-8">
          <div className="mb-10">
            <div className="smallcaps mb-3" style={{ color: 'var(--ink-3)' }}>Why Cornice</div>
            <h2 className="font-serif tracking-display" style={{ fontSize: 38, lineHeight: 1.05, color: 'var(--ink)' }}>
              Smarter real estate investing.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                style={{ background: 'var(--card)', border: '1px solid var(--rule-soft)', borderLeft: '3px solid var(--accent)', borderRadius: 12, padding: 28 }}
                onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(30,26,21,0.08)')}
                onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = 'none')}
              >
                <div className="font-mono mb-4" style={{ fontSize: 22, color: 'var(--accent)' }}>{f.icon}</div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>{f.title}</h3>
                <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.65 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI Pipeline ─────────────────────────────────────────────── */}
      <section style={{ background: 'var(--accent)', padding: '80px 0' }}>
        <div className="max-w-[1200px] mx-auto px-8">
          <div className="mb-10">
            <div className="smallcaps mb-3" style={{ color: 'rgba(255,255,255,0.55)' }}>How it works</div>
            <h2 className="font-serif tracking-display" style={{ fontSize: 38, lineHeight: 1.05, color: '#fff' }}>
              Three-stage analysis pipeline.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border rounded-xl overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.22)' }}>
            {PIPELINE.map((p, i) => (
              <div key={p.n} style={{ padding: 32, borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.22)' : 'none' }}>
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.45)' }}>{p.n}</span>
                  <span className="smallcaps" style={{ color: 'rgba(255,255,255,0.65)' }}>{p.role}</span>
                </div>
                <div className="font-serif tracking-display mb-4" style={{ fontSize: 22, lineHeight: 1.1, color: '#fff' }}>{p.model}</div>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.65 }}>{p.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Market leaders ──────────────────────────────────────────── */}
      <section style={{ background: 'var(--paper-2)', padding: '80px 0' }}>
        <div className="max-w-[1200px] mx-auto px-8">
          <div className="mb-8">
            <div className="smallcaps mb-3" style={{ color: 'var(--ink-3)' }}>Top markets</div>
            <h2 className="font-serif tracking-display" style={{ fontSize: 38, lineHeight: 1.05, color: 'var(--ink)' }}>
              Investor-grade markets.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {MARKET_LEADERS.map((m) => (
              <button
                key={m.city}
                onClick={() => navigate('/results', { state: { criteria: { location: m.city, investment_goal: 'rental', budget_min: 200000, budget_max: 600000, radius_miles: 15, down_payment_pct: 0.20, bedrooms_min: 1, max_results: 20 } } })}
                style={{ background: 'var(--card)', border: '1px solid var(--rule-soft)', borderLeft: '3px solid var(--accent)', borderRadius: 12, padding: 20, textAlign: 'left', cursor: 'pointer', transition: 'box-shadow .2s' }}
                onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(30,26,21,0.1)')}
                onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = 'none')}
              >
                <div className="smallcaps mb-2" style={{ color: 'var(--ink-4)' }}>{m.tier}</div>
                <div className="font-serif" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 8, lineHeight: 1.2 }}>{m.city}</div>
                <div className="flex items-center justify-between">
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{m.cap} cap</span>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 4, padding: '2px 8px', color: 'var(--ink-2)' }}>{m.grade}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer style={{ borderTop: '1px solid var(--rule-soft)', padding: '24px 32px' }}>
        <p style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'center', maxWidth: 640, margin: '0 auto' }}>
          This tool provides estimates for informational purposes only. Always conduct your own due diligence
          before making investment decisions. Projections are based on historical trends and may not reflect future performance.
        </p>
      </footer>
    </div>
  )
}
