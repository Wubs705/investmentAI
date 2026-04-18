import { useState, useCallback, useRef, useEffect, type FormEvent } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { Search } from 'lucide-react'
import {
  usePhotonAutocomplete,
  type PhotonSuggestion,
} from '../hooks/usePhotonAutocomplete'
import { formatCurrency } from '../utils/formatters'
import apiClient from '../api/client'

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function MarketOverviewPage() {
  const [location, setLocation] = useState('')
  const [market, setMarket] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { suggestions, fetchSuggestions, clear } = usePhotonAutocomplete()
  const [showSuggestions, setShowSuggestions] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  // Cancel any pending abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const fetchMarket = useCallback(async (loc: string) => {
    // Cancel any previous in-flight request before starting a new one
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)
    try {
      const { data } = await apiClient.get(`/market/${encodeURIComponent(loc)}`, {
        signal: abortRef.current.signal,
      })
      setMarket(data)
    } catch (err: unknown) {
      const e = err as any
      if (e?.code === 'ERR_CANCELED') return  // stale request — ignore
      setError(e.response?.data?.detail || e.message || 'Failed to fetch market data')
    } finally {
      setLoading(false)
    }
  }, [])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (location.trim()) fetchMarket(location.trim())
  }

  function selectSuggestion(s: PhotonSuggestion) {
    setLocation(s.full_text)
    setShowSuggestions(false)
    clear()
    fetchMarket(s.full_text)
  }

  const ei = market?.economic_indicators
  const pt = market?.price_trends
  const rm = market?.rental_market
  const demo = market?.demographics
  const loc = market?.location

  const kpis = market ? [
    { label: 'Median Home Value', value: ei?.median_home_value ? formatCurrency(ei.median_home_value, { compact: true }) : 'N/A', change: pt?.yoy_appreciation_pct != null ? `${pt.yoy_appreciation_pct > 0 ? '+' : ''}${pt.yoy_appreciation_pct.toFixed(1)}% YoY` : '', positive: pt?.yoy_appreciation_pct > 0 },
    { label: '30yr Mortgage Rate', value: ei?.mortgage_rate_30yr ? `${ei.mortgage_rate_30yr.toFixed(2)}%` : 'N/A', change: '', positive: null },
    { label: 'Median 2BR Rent', value: rm?.median_rent_2br ? formatCurrency(rm.median_rent_2br) : 'N/A', change: rm?.rent_growth_yoy_pct != null ? `${rm.rent_growth_yoy_pct > 0 ? '+' : ''}${rm.rent_growth_yoy_pct.toFixed(1)}% YoY` : '', positive: rm?.rent_growth_yoy_pct > 0 },
    { label: 'Median Income', value: demo?.median_household_income ? formatCurrency(demo.median_household_income, { compact: true }) : 'N/A', change: '', positive: null },
    { label: 'Days on Market', value: ei?.median_days_on_market ?? 'N/A', change: '', positive: null },
  ] : []

  const healthItems = market ? [
    { label: 'Sale-to-List Ratio', value: ei?.sale_to_list_ratio ? `${(ei.sale_to_list_ratio * 100).toFixed(1)}%` : 'N/A', status: 'Balanced', color: 'text-primary' },
    { label: 'Months of Supply', value: ei?.months_of_supply ? `${ei.months_of_supply.toFixed(1)}` : 'N/A', status: ei?.months_of_supply <= 3 ? "Seller's Market" : ei?.months_of_supply >= 6 ? "Buyer's Market" : 'Balanced', color: ei?.months_of_supply <= 3 ? 'text-warning' : 'text-accent' },
    { label: 'Vacancy Rate', value: rm?.vacancy_rate_pct ? `${rm.vacancy_rate_pct.toFixed(1)}%` : 'N/A', status: rm?.vacancy_rate_pct <= 5 ? 'Healthy' : 'Elevated', color: rm?.vacancy_rate_pct <= 5 ? 'text-accent' : 'text-warning' },
    { label: 'Population Growth', value: demo?.population_growth_pct != null ? `${demo.population_growth_pct > 0 ? '+' : ''}${demo.population_growth_pct.toFixed(1)}%` : 'N/A', status: demo?.population_growth_pct > 0 ? 'Growing' : 'Declining', color: demo?.population_growth_pct > 0 ? 'text-accent' : 'text-danger' },
    { label: 'Unemployment', value: demo?.unemployment_rate_pct ? `${demo.unemployment_rate_pct.toFixed(1)}%` : 'N/A', status: demo?.unemployment_rate_pct <= 4 ? 'Low' : 'Elevated', color: demo?.unemployment_rate_pct <= 4 ? 'text-accent' : 'text-warning' },
    { label: 'Rent Growth YoY', value: rm?.rent_growth_yoy_pct != null ? `${rm.rent_growth_yoy_pct > 0 ? '+' : ''}${rm.rent_growth_yoy_pct.toFixed(1)}%` : 'N/A', status: 'Moderate', color: 'text-primary' },
  ] : []

  const rentData = market ? [
    { type: '1 Bedroom', rent: rm?.median_rent_1br },
    { type: '2 Bedroom', rent: rm?.median_rent_2br },
    { type: '3 Bedroom', rent: rm?.median_rent_3br },
    { type: '4 Bedroom', rent: rm?.median_rent_4br },
  ].filter((r) => r.rent) : []

  const maxRent = Math.max(...rentData.map((r) => r.rent || 0), 1)

  const chartData = pt?.price_history?.map((h: any) => ({
    year: h.year,
    price: h.median_price,
  })) || []

  return (
    <div className="min-h-screen bg-bg-light">
      <div className="max-w-[1440px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">
              {loc ? `${loc.city}, ${loc.state_code} — Market Overview` : 'Market Overview'}
            </h1>
            {market?.data_sources_used?.length > 0 && (
              <p className="text-xs text-text-muted mt-1">
                Data sources: {market.data_sources_used.join(', ')}
              </p>
            )}
          </div>

          {/* Location Search */}
          <form onSubmit={handleSubmit} className="relative">
            <div className="flex items-center border border-input bg-white rounded-lg px-4 h-10 w-72 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10 transition-all">
              <Search className="w-4 h-4 text-text-muted mr-2 flex-shrink-0" />
              <input
                type="text"
                value={location}
                onChange={(e) => {
                  const val = e.target.value
                  setLocation(val)
                  setShowSuggestions(true)
                  fetchSuggestions(val)
                }}
                placeholder="Change location..."
                className="flex-1 bg-transparent text-sm outline-none text-text-primary placeholder-text-muted"
              />
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute z-50 w-full bg-white border border-border rounded-lg shadow-lg mt-1 max-h-60 overflow-y-auto">
                {suggestions.map((s) => (
                  <li
                    key={s.id}
                    onMouseDown={() => selectSuggestion(s)}
                    className="px-4 py-2 text-sm hover:bg-bg-light cursor-pointer text-text-primary transition-colors"
                  >
                    <span className="font-medium">{s.name}</span>
                    {s.place_formatted && (
                      <span className="text-text-muted ml-1">· {s.place_formatted}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </form>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 rounded-full border-4 border-gray-200 border-t-primary animate-spin" />
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-red-700">
            <div className="font-semibold mb-1">Error</div>
            <div className="text-sm opacity-80">{error}</div>
          </div>
        )}

        {/* Empty state */}
        {!market && !loading && !error && (
          <div className="text-center py-24 text-text-muted">
            <div className="text-5xl mb-4 opacity-20">📊</div>
            <p className="text-lg font-medium text-text-secondary">Search for a location to view market data</p>
            <p className="text-sm mt-2">Enter a city, state, or zip code above to get started.</p>
          </div>
        )}

        {market && !loading && (
          <>
            {/* KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
              {kpis.map((k) => (
                <div key={k.label} className="bg-white border border-border rounded-xl p-4 shadow-sm">
                  <div className="text-xs font-medium text-text-secondary">{k.label}</div>
                  <div className="text-2xl font-bold text-text-primary mt-1">{k.value}</div>
                  {k.change && (
                    <div className={`text-xs font-semibold mt-1 ${k.positive ? 'text-accent' : 'text-warning'}`}>
                      {k.change}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Chart + Health */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
              {/* Price Trends Chart */}
              <div className="lg:col-span-3 bg-white border border-border rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-text-primary mb-4">Price Trends</h2>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                      <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#8C8C8C' }} stroke="#E0E0E0" />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#8C8C8C' }}
                        tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}K`}
                        width={55}
                        stroke="#E0E0E0"
                      />
                      <Tooltip
                        formatter={(v) => [formatCurrency(Number(v)), 'Median Price']}
                        labelStyle={{ fontSize: 12, color: '#2A2A33' }}
                        contentStyle={{ fontSize: 12, borderRadius: 8, background: '#FFFFFF', border: '1px solid #E0E0E0', color: '#2A2A33', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="#006AFF"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: '#006AFF' }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[260px] text-text-muted text-sm">
                    No price history data available
                  </div>
                )}
              </div>

              {/* Market Health */}
              <div className="lg:col-span-2 bg-white border border-border rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-text-primary mb-4">Market Health</h2>
                <div className="space-y-3">
                  {healthItems.map((h) => (
                    <div key={h.label} className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">{h.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-text-primary">{h.value}</span>
                        <span className={`text-[11px] font-medium px-2 py-0.5 bg-gray-100 rounded-full ${h.color}`}>
                          {h.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {/* Rental Market */}
              <div className="bg-white border border-border rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-text-primary mb-4">Rental Market</h2>
                <div className="space-y-4">
                  {rentData.map((rd) => (
                    <div key={rd.type}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium text-text-primary">{rd.type}</span>
                        <span className="font-semibold text-text-primary">{formatCurrency(rd.rent!)}/mo</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${((rd.rent || 0) / maxRent) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {rm?.rent_growth_yoy_pct != null && (
                  <div className="text-xs font-medium text-accent mt-4">
                    Rent Growth: {rm.rent_growth_yoy_pct > 0 ? '+' : ''}{rm.rent_growth_yoy_pct.toFixed(1)}% YoY
                    {rm.vacancy_rate_pct != null && ` · Vacancy: ${rm.vacancy_rate_pct.toFixed(1)}%`}
                  </div>
                )}
              </div>

              {/* Demographics */}
              <div className="bg-white border border-border rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-text-primary mb-4">Demographics &amp; Economy</h2>
                <div className="space-y-3">
                  {[
                    ['Population', demo?.population?.toLocaleString(), demo?.population_growth_pct != null ? `${demo.population_growth_pct > 0 ? '+' : ''}${demo.population_growth_pct.toFixed(1)}% growth` : ''],
                    ['Median HH Income', demo?.median_household_income ? formatCurrency(demo.median_household_income, { compact: true }) : 'N/A', ''],
                    ['Unemployment Rate', demo?.unemployment_rate_pct ? `${demo.unemployment_rate_pct.toFixed(1)}%` : 'N/A', demo?.unemployment_rate_pct <= 4 ? 'Below national avg' : ''],
                  ].map(([label, val, note]) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">{label}</span>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-text-primary">{val || 'N/A'}</span>
                        {note && <div className="text-[11px] text-text-muted">{note}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Economic Indicators */}
              <div className="bg-white border border-border rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-text-primary mb-4">Economic Indicators</h2>
                <div className="space-y-3">
                  {[
                    ['30yr Fixed Rate', ei?.mortgage_rate_30yr ? `${ei.mortgage_rate_30yr.toFixed(2)}%` : 'N/A'],
                    ['Months of Supply', ei?.months_of_supply ? `${ei.months_of_supply.toFixed(1)}` : 'N/A'],
                    ['Sale-to-List Ratio', ei?.sale_to_list_ratio ? `${(ei.sale_to_list_ratio * 100).toFixed(1)}%` : 'N/A'],
                    ['Median Days on Market', ei?.median_days_on_market ?? 'N/A'],
                  ].map(([label, val]) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-sm text-text-secondary">{label}</span>
                      <span className="text-sm font-semibold text-text-primary">{val}</span>
                    </div>
                  ))}
                </div>
                {market.data_sources_used?.length > 0 && (
                  <div className="text-[11px] text-text-muted mt-4">
                    Source: {market.data_sources_used.join(', ')}
                  </div>
                )}
              </div>
            </div>

            {/* Warnings */}
            {market.warnings?.length > 0 && (
              <div className="space-y-1 mb-6">
                {market.warnings.map((w: string, i: number) => (
                  <div key={i} className="bg-amber-50 border border-amber-200 text-amber-700 text-xs px-4 py-2 rounded-lg">
                    ⚠ {w}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
