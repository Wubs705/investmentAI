import { useState, useRef, useEffect, type FormEvent, type ChangeEvent } from 'react'
import { TrendingUp, Home, Hammer, Building2, Star } from 'lucide-react'
import {
  usePhotonAutocomplete,
  type PhotonSuggestion,
  type ResolvedLocation,
} from '../hooks/usePhotonAutocomplete'
import { LiquidButton, Button, MetalButton } from './ui/liquid-glass-button'

/* eslint-disable @typescript-eslint/no-explicit-any */

const GOALS = [
  {
    value: 'long_term',
    label: 'Long-Term Hold',
    Icon: TrendingUp,
    description: 'Buy & hold for appreciation + passive income. Prioritizes growth markets and school districts.',
  },
  {
    value: 'rental',
    label: 'Rental Income',
    Icon: Home,
    description: 'Maximize monthly cash flow. Prioritizes cap rate, rent-to-price ratio, and low vacancy.',
  },
  {
    value: 'fix_and_flip',
    label: 'Fix & Flip',
    Icon: Hammer,
    description: 'Buy undervalued, renovate, sell for profit. Prioritizes ARV potential and days on market.',
  },
  {
    value: 'house_hack',
    label: 'House Hack',
    Icon: Building2,
    description: 'Live in one unit, rent the rest. Tenants offset your mortgage — ideal first investment.',
  },
  {
    value: 'short_term_rental',
    label: 'Short-Term Rental',
    Icon: Star,
    description: 'Airbnb/VRBO strategy. Higher nightly rates and revenue potential vs long-term leasing.',
  },
]

const BUDGET_PRESETS = [
  { label: 'Under $200K', min: 0, max: 200_000 },
  { label: '$200K\u2013$400K', min: 200_000, max: 400_000 },
  { label: '$400K\u2013$700K', min: 400_000, max: 700_000 },
  { label: '$700K\u2013$1M', min: 700_000, max: 1_000_000 },
  { label: '$1M+', min: 1_000_000, max: 3_000_000 },
]

function formatK(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  return `$${(val / 1_000).toFixed(0)}K`
}

interface SearchFormProps {
  onSearch: (criteria: any) => void
  loading: boolean
}

export default function SearchForm({ onSearch, loading }: SearchFormProps) {
  const [budgetMin, setBudgetMin] = useState(100_000)
  const [budgetMax, setBudgetMax] = useState(500_000)
  const [location, setLocation] = useState('')
  const [radius, setRadius] = useState(15)
  const [goal, setGoal] = useState('rental')
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

  function applyPreset(preset: { min: number; max: number }) {
    setBudgetMin(preset.min)
    setBudgetMax(preset.max)
  }

  function handleSubmit(e: FormEvent) {
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
    onSearch(criteria)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-panel p-8 space-y-8"
    >
      {/* Budget */}
      <div>
        <label className="block text-sm font-semibold text-text-primary mb-3">Budget Range</label>

        <div className="flex flex-wrap gap-2 mb-4">
          {BUDGET_PRESETS.map((p) => {
            const active = budgetMin === p.min && budgetMax === p.max
            return active ? (
              <MetalButton
                key={p.label}
                type="button"
                variant="primary"
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </MetalButton>
            ) : (
              <Button
                key={p.label}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => applyPreset(p)}
                className="text-text-secondary hover:text-text-primary"
              >
                {p.label}
              </Button>
            )
          })}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs text-text-muted mb-1 block">Min</label>
            <input
              type="number"
              value={budgetMin}
              onChange={(e) => setBudgetMin(Number(e.target.value))}
              min={0}
              step={10000}
              className="w-full glass-input px-3 py-2 text-sm"
            />
          </div>
          <span className="text-text-muted mt-5">&ndash;</span>
          <div className="flex-1">
            <label className="text-xs text-text-muted mb-1 block">Max</label>
            <input
              type="number"
              value={budgetMax}
              onChange={(e) => setBudgetMax(Number(e.target.value))}
              min={0}
              step={10000}
              className="w-full glass-input px-3 py-2 text-sm"
            />
          </div>
        </div>
        <p className="text-xs text-text-muted mt-1">
          {formatK(budgetMin)} &ndash; {formatK(budgetMax)}
        </p>
      </div>

      {/* Location */}
      <div>
        <label className="block text-sm font-semibold text-text-primary mb-3">Location</label>
        <div className="relative" ref={autocompleteRef}>
          <input
            type="text"
            value={location}
            onChange={handleLocationChange}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder="City, state or zip code (e.g. Austin, TX)"
            required
            className="w-full glass-input px-4 py-2.5 text-sm"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-20 w-full glass-panel mt-1 max-h-60 overflow-y-auto">
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  onMouseDown={() => selectSuggestion(s)}
                  className="px-4 py-2.5 text-sm hover:bg-primary/10 cursor-pointer text-text-primary transition-colors"
                >
                  <span className="font-medium">{s.name}</span>
                  {s.place_formatted && (
                    <span className="text-text-muted ml-1">· {s.place_formatted}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3">
          <label className="text-xs text-text-muted mb-1 block">Search radius: {radius} miles</label>
          <input
            type="range"
            min={5}
            max={50}
            step={5}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-text-muted mt-0.5">
            <span>5 mi</span>
            <span>50 mi</span>
          </div>
        </div>
      </div>

      {/* Investment Goal */}
      <div>
        <label className="block text-sm font-semibold text-text-primary mb-3">Investment Goal</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          {GOALS.map((g) => (
            <Button
              key={g.value}
              variant="ghost"
              type="button"
              onClick={() => setGoal(g.value)}
              className={`p-4 rounded-xl border-2 text-left transition-all h-auto whitespace-normal items-start flex-col ${
                goal === g.value
                  ? 'border-primary bg-primary/10'
                  : 'border-slate-700/30 hover:border-primary/50 hover:bg-slate-800/50'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                <g.Icon className="w-4 h-4 text-primary" />
              </div>
              <div className={`text-sm font-semibold ${goal === g.value ? 'text-primary' : 'text-text-primary'}`}>
                {g.label}
              </div>
              <div className="text-xs text-text-secondary mt-1 leading-snug">{g.description}</div>
            </Button>
          ))}
        </div>
      </div>

      {/* Financing */}
      <div>
        <label className="block text-sm font-semibold text-text-primary mb-3">Financing</label>
        <div className="flex flex-wrap gap-2 mb-3">
          {[
            { label: '100% Cash', value: 100 },
            { label: '25% Down', value: 25 },
            { label: '20% Down', value: 20 },
            { label: '10% Down', value: 10 },
            { label: '5% Down', value: 5 },
            { label: '3.5% (FHA)', value: 3.5 },
          ].map((opt) => (
            downPct === opt.value ? (
              <MetalButton
                key={opt.value}
                type="button"
                variant="primary"
                onClick={() => setDownPct(opt.value)}
              >
                {opt.label}
              </MetalButton>
            ) : (
              <Button
                key={opt.value}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDownPct(opt.value)}
                className="text-text-secondary hover:text-text-primary"
              >
                {opt.label}
              </Button>
            )
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={downPct}
            onChange={(e) => setDownPct(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
          <span className="text-sm font-medium text-text-primary w-14 text-right">{downPct}%</span>
        </div>
        <p className="text-xs text-text-muted mt-1">
          {downPct === 100
            ? 'All cash \u2014 no mortgage, no interest payments.'
            : `${downPct}% down, ${(100 - downPct)}% financed at current 30yr rate.`}
        </p>
      </div>

      {/* Submit */}
      <LiquidButton
        type="submit"
        disabled={loading || !location.trim()}
        className="w-full"
        size="lg"
      >
        {loading ? 'Analyzing...' : 'Analyze Properties'}
      </LiquidButton>
    </form>
  )
}
