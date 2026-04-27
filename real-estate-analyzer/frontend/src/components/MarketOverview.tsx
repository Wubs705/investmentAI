import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { formatCurrency } from '../utils/formatters'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface StatCardProps {
  label: string
  value: string
  sub?: string
  color?: string
}

function StatCard({ label, value, sub, color = 'blue' }: StatCardProps) {
  const colors: Record<string, string> = {
    blue: 'metal-stat metal-accent-blue',
    green: 'metal-stat metal-accent-green',
    amber: 'metal-stat metal-accent-amber',
    red: 'metal-stat',
    gray: 'metal-stat',
  }
  return (
    <div className={colors[color] || 'metal-stat'}>
      <div className="text-xs font-medium text-text-secondary mb-1">{label}</div>
      <div className="text-xl font-bold text-text-primary">{value ?? 'N/A'}</div>
      {sub && <div className="text-xs text-text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

interface PriceChartProps {
  history: any[] | undefined
}

function PriceChart({ history }: PriceChartProps) {
  if (!history || history.length === 0) return null
  const data = history.map((h: any) => ({
    year: h.year,
    price: h.median_price,
  }))

  return (
    <div className="glass-surface p-4">
      <div className="text-sm font-semibold text-text-primary mb-3">Median Home Price (10yr)</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#94A3B8' }} stroke="rgba(148, 163, 184, 0.2)" />
          <YAxis
            tick={{ fontSize: 11, fill: '#94A3B8' }}
            tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}K`}
            width={55}
            stroke="rgba(148, 163, 184, 0.2)"
          />
          <Tooltip
            formatter={(v) => [formatCurrency(Number(v)), 'Median Price']}
            labelStyle={{ fontSize: 12, color: '#E2E8F0' }}
            contentStyle={{ fontSize: 12, borderRadius: 8, background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(148, 163, 184, 0.15)', color: '#E2E8F0' }}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke="#3B82F6"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

interface MarketOverviewProps {
  market: any
}

export default function MarketOverview({ market }: MarketOverviewProps) {
  if (!market) return null
  const { price_trends, rental_market, demographics, economic_indicators } = market

  const appRate = price_trends.yoy_appreciation_pct
  const appColor = appRate >= 6 ? 'green' : appRate >= 3 ? 'blue' : 'amber'

  return (
    <div className="space-y-4">
      {/* Stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard
          label="Median Home Value"
          value={economic_indicators.median_home_value ? formatCurrency(economic_indicators.median_home_value, { compact: true }) : 'N/A'}
          sub="Estimated area median"
          color="blue"
        />
        <StatCard
          label="YoY Appreciation"
          value={appRate != null ? `${appRate.toFixed(1)}%` : 'N/A'}
          sub="Annual avg (10yr)"
          color={appColor}
        />
        <StatCard
          label="30yr Mortgage Rate"
          value={economic_indicators.mortgage_rate_30yr ? `${economic_indicators.mortgage_rate_30yr.toFixed(2)}%` : 'N/A'}
          color="gray"
        />
        <StatCard
          label="Median 2BR Rent"
          value={rental_market.median_rent_2br ? formatCurrency(rental_market.median_rent_2br) : 'N/A'}
          sub="HUD FMR estimate"
          color="blue"
        />
        <StatCard
          label="Vacancy Rate"
          value={rental_market.vacancy_rate_pct ? `${rental_market.vacancy_rate_pct.toFixed(1)}%` : 'N/A'}
          color={rental_market.vacancy_rate_pct <= 5 ? 'green' : rental_market.vacancy_rate_pct >= 10 ? 'red' : 'amber'}
        />
        <StatCard
          label="Median HH Income"
          value={demographics.median_household_income ? formatCurrency(demographics.median_household_income, { compact: true }) : 'N/A'}
          sub="Census ACS estimate"
          color="gray"
        />
        <StatCard
          label="Population"
          value={demographics.population ? demographics.population.toLocaleString() : 'N/A'}
          color="gray"
        />
        <StatCard
          label="Unemployment Rate"
          value={demographics.unemployment_rate_pct ? `${demographics.unemployment_rate_pct.toFixed(1)}%` : 'N/A'}
          color={demographics.unemployment_rate_pct <= 4 ? 'green' : demographics.unemployment_rate_pct >= 7 ? 'red' : 'amber'}
        />
        <StatCard
          label="Months of Supply"
          value={economic_indicators.months_of_supply ? `${economic_indicators.months_of_supply.toFixed(1)} mo` : 'N/A'}
          sub="<3 = seller's market"
          color={economic_indicators.months_of_supply <= 3 ? 'amber' : 'green'}
        />
      </div>

      {/* Rent breakdown */}
      {(rental_market.median_rent_1br || rental_market.median_rent_2br) && (
        <div className="glass-surface overflow-hidden">
          <div className="px-4 py-3 bg-slate-800/40 border-b border-slate-700/30">
            <h3 className="text-sm font-semibold text-text-primary">Fair Market Rents by Unit Size</h3>
          </div>
          <div className="divide-y divide-slate-700/30">
            {[
              { label: '1 Bedroom', val: rental_market.median_rent_1br },
              { label: '2 Bedrooms', val: rental_market.median_rent_2br },
              { label: '3 Bedrooms', val: rental_market.median_rent_3br },
              { label: '4 Bedrooms', val: rental_market.median_rent_4br },
            ].filter((r) => r.val).map((r) => (
              <div key={r.label} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-text-secondary">{r.label}</span>
                <span className="font-semibold text-text-primary">{formatCurrency(r.val)}/mo</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Price history chart */}
      <PriceChart history={price_trends.price_history} />

      {/* Local Construction Costs */}
      {market.rehab_cost_calibration && (
        <div className="glass-surface overflow-hidden">
          <div className="px-4 py-3 bg-slate-800/40 border-b border-slate-700/30 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">Local Construction Costs</h3>
            {market.rehab_cost_calibration.confidence === 'high' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-700/40">High confidence</span>
            )}
            {market.rehab_cost_calibration.confidence === 'medium' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-400 border border-amber-700/40">Medium confidence</span>
            )}
            {market.rehab_cost_calibration.confidence === 'low' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/60 text-text-muted border border-slate-600/40">Estimated</span>
            )}
          </div>
          <div className="divide-y divide-slate-700/30">
            {[
              { label: 'Cosmetic rehab', val: market.rehab_cost_calibration.cosmetic_per_sqft },
              { label: 'Moderate rehab', val: market.rehab_cost_calibration.moderate_per_sqft },
              { label: 'Full gut rehab', val: market.rehab_cost_calibration.full_gut_per_sqft },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-text-secondary">{r.label}</span>
                <span className="font-semibold text-text-primary">~${Math.round(r.val)}/sqft</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-text-secondary">Labor vs national avg</span>
              <span className="font-semibold text-text-primary">
                {market.rehab_cost_calibration.labor_index.toFixed(2)}×
                {market.rehab_cost_calibration.labor_index > 1.05 && (
                  <span className="ml-1 text-xs text-amber-400">({Math.round((market.rehab_cost_calibration.labor_index - 1) * 100)}% above avg)</span>
                )}
                {market.rehab_cost_calibration.labor_index < 0.95 && (
                  <span className="ml-1 text-xs text-green-400">({Math.round((1 - market.rehab_cost_calibration.labor_index) * 100)}% below avg)</span>
                )}
              </span>
            </div>
          </div>
          <div className="px-4 py-2.5 text-xs text-text-muted border-t border-slate-700/30">
            Based on: {market.rehab_cost_calibration.data_sources.join(' · ')}
          </div>
        </div>
      )}

      {/* Data sources */}
      {market.data_sources_used?.length > 0 && (
        <div className="text-xs text-text-muted">
          Data sources: {market.data_sources_used.join(' · ')}
        </div>
      )}
    </div>
  )
}
