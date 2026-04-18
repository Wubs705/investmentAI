import { formatCurrency, formatDate } from '../utils/formatters'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ComparablesTableProps {
  comps: any
}

export default function ComparablesTable({ comps }: ComparablesTableProps) {
  if (!comps || comps.comps_found === 0) {
    return (
      <div className="bg-bg-light border border-border rounded-xl p-6 text-center text-text-muted text-sm">
        No comparable data available.
      </div>
    )
  }

  const confidenceColor: string = ({
    High: 'text-accent',
    Medium: 'text-warning',
    Low: 'text-text-secondary',
  } as Record<string, string>)[comps.confidence] || 'text-text-secondary'

  const pvcColor =
    comps.price_vs_comps === 'Below Market'
      ? 'text-accent'
      : comps.price_vs_comps === 'Above Market'
      ? 'text-danger'
      : 'text-warning'

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="bg-bg-light border border-border rounded-xl p-4 flex flex-wrap gap-6">
        <div className="flex-1 min-w-32">
          <div className="text-xs text-text-secondary mb-0.5">Comp Adjusted Value</div>
          <div className="text-lg font-bold text-text-primary">
            {formatCurrency(comps.adjusted_value_low)} – {formatCurrency(comps.adjusted_value_high)}
          </div>
          <div className="text-xs text-text-muted">Mid: {formatCurrency(comps.adjusted_value_mid)}</div>
        </div>

        <div className="flex-1 min-w-28">
          <div className="text-xs text-text-secondary mb-0.5">Subject vs Comps</div>
          <div className={`text-base font-semibold ${pvcColor}`}>
            {comps.price_vs_comps}
          </div>
          <div className={`text-xs ${pvcColor}`}>
            {comps.price_vs_comps_pct > 0 ? '+' : ''}{comps.price_vs_comps_pct?.toFixed(1)}%
          </div>
        </div>

        <div>
          <div className="text-xs text-text-secondary mb-0.5">Confidence</div>
          <span className={`text-xs font-semibold bg-gray-100 px-2.5 py-1 rounded-full ${confidenceColor}`}>
            {comps.confidence} ({comps.comps_found} comps)
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-bg-light border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">Comparable Sales</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-text-secondary bg-bg-light">
                <th className="text-left px-4 py-2.5">Address</th>
                <th className="text-right px-3 py-2.5">Sold Price</th>
                <th className="text-right px-3 py-2.5">$/sqft</th>
                <th className="text-right px-3 py-2.5">Sqft</th>
                <th className="text-center px-3 py-2.5">Bed/Bath</th>
                <th className="text-right px-3 py-2.5">Distance</th>
                <th className="text-right px-3 py-2.5">Sold Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {comps.comparable_properties?.map((comp: any) => (
                <tr key={comp.address ?? comp.id} className="hover:bg-bg-light transition-colors">
                  <td className="px-4 py-2.5 text-text-primary font-medium">{comp.address}</td>
                  <td className="px-3 py-2.5 text-right text-text-primary font-semibold">
                    {formatCurrency(comp.sold_price)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-text-secondary">
                    {formatCurrency(comp.price_per_sqft, { decimals: 0 })}
                  </td>
                  <td className="px-3 py-2.5 text-right text-text-secondary">
                    {comp.sqft?.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-center text-text-secondary">
                    {comp.bedrooms}bd / {comp.bathrooms}ba
                  </td>
                  <td className="px-3 py-2.5 text-right text-text-muted">
                    {comp.distance_miles?.toFixed(2)} mi
                  </td>
                  <td className="px-3 py-2.5 text-right text-text-muted">
                    {formatDate(comp.sold_date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 bg-bg-light border-t border-border">
          <p className="text-xs text-text-muted">
            Comparables estimated from market data. Sold within ~1 mile, last 6 months, similar size/beds.
          </p>
        </div>
      </div>
    </div>
  )
}
