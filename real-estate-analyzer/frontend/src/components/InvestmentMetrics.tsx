import type { ReactNode } from 'react'
import { formatCurrency, signalColor } from '../utils/formatters'

/* eslint-disable @typescript-eslint/no-explicit-any */

function MetricRow({ label, value, hint, colorClass }: { label: string; value: string; hint?: string | null; colorClass?: string }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border last:border-0">
      <div>
        <div className="text-sm text-text-primary">{label}</div>
        {hint && <div className="text-xs text-text-muted mt-0.5">{hint}</div>}
      </div>
      <div className={`text-sm font-semibold ml-4 text-right ${colorClass || 'text-text-primary'}`}>
        {value}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-bg-light border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="px-4 divide-y divide-border bg-white">{children}</div>
    </div>
  )
}

function AiBulletList({ items, colorScheme = 'green' }: { items?: string[]; colorScheme?: 'green' | 'amber' }) {
  if (!items?.length) return null
  const textColor = colorScheme === 'green' ? 'text-accent' : 'text-warning'
  const dotColor = colorScheme === 'green' ? 'bg-accent' : 'bg-warning'
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className={`flex items-start gap-2 text-sm px-3 py-1.5 bg-bg-light rounded-lg border border-border ${textColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${dotColor}`} />
          {item}
        </li>
      ))}
    </ul>
  )
}

function ConditionBadge({ condition }: { condition?: string }) {
  if (!condition || condition === 'Unknown') return null
  const styles: Record<string, string> = {
    Good: 'bg-green-50 text-accent border-green-200',
    Fair: 'bg-amber-50 text-warning border-amber-200',
    Poor: 'bg-red-50 text-danger border-red-200',
  }
  return (
    <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full border ${styles[condition] || 'bg-bg-light text-text-secondary border-border'}`}>
      Condition: {condition}
    </span>
  )
}

function AiSection({ title, children, subtitle }: { title: ReactNode; children: ReactNode; subtitle?: string }) {
  return (
    <div className="border border-blue-200 rounded-xl overflow-hidden bg-blue-50/30">
      <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
      </div>
      <div className="px-4 py-3 bg-white">{children}</div>
    </div>
  )
}

function AssumptionRow({ label, aiValue, defaultValue, hint }: { label: string; aiValue: string; defaultValue?: string | null; hint?: string | null }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-border last:border-0">
      <div>
        <div className="text-sm text-text-primary">{label}</div>
        {hint && <div className="text-xs text-text-muted mt-0.5">{hint}</div>}
      </div>
      <div className="text-right ml-4">
        <div className="text-sm font-semibold text-primary">{aiValue}</div>
        {defaultValue && (
          <div className="text-xs text-text-muted mt-0.5">Default: {defaultValue}</div>
        )}
      </div>
    </div>
  )
}

function AIUnderwritingAssumptions({ assumptions, market, rental }: { assumptions: any; market: any; rental: any }) {
  if (!assumptions) return null

  const marketRent = market?.rental_market?.median_rent_2br
  const marketVacancy = market?.rental_market?.vacancy_rate_pct

  return (
    <AiSection
      title={
        <span className="flex items-center gap-2">
          <span>AI Underwriting Assumptions</span>
          <span className="text-primary text-base">⚙</span>
          <span className="text-xs font-normal text-text-muted">Drives the ROI / Cap Rate below</span>
        </span>
      }
      subtitle={assumptions.confidence ? `Confidence: ${assumptions.confidence}` : undefined}
    >
      <div className="mb-3 text-xs text-primary bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
        The metrics below are calculated using these AI-generated assumptions instead of generic market averages.
      </div>

      <AssumptionRow
        label="Estimated Rehab Cost"
        aiValue={formatCurrency(assumptions.estimated_rehab_cost ?? 0)}
        hint={assumptions.rehab_reasoning}
      />
      {assumptions.expected_monthly_rent != null && (
        <AssumptionRow
          label="Expected Monthly Rent"
          aiValue={formatCurrency(assumptions.expected_monthly_rent)}
          defaultValue={marketRent ? formatCurrency(marketRent) + ' (area median 2BR)' : null}
          hint={rental?.estimated_monthly_rent ? `Used by engine: ${formatCurrency(rental.estimated_monthly_rent)}` : null}
        />
      )}
      {assumptions.vacancy_rate_pct != null && (
        <AssumptionRow
          label="Vacancy Rate"
          aiValue={`${assumptions.vacancy_rate_pct.toFixed(1)}%`}
          defaultValue={marketVacancy != null ? `${marketVacancy.toFixed(1)}% (market)` : '6.0% (default)'}
        />
      )}
      {assumptions.maintenance_reserve_pct != null && (
        <AssumptionRow
          label="Maintenance Reserve"
          aiValue={`${assumptions.maintenance_reserve_pct.toFixed(1)}%/yr`}
          defaultValue="1.0%/yr (default)"
        />
      )}
      {assumptions.arv_estimate != null && (
        <AssumptionRow
          label="ARV Estimate"
          aiValue={formatCurrency(assumptions.arv_estimate)}
          hint="After-Repair Value used in flip math"
        />
      )}
      {assumptions.insurance_premium_monthly != null && (
        <AssumptionRow
          label="Insurance Premium"
          aiValue={`${formatCurrency(assumptions.insurance_premium_monthly)}/mo`}
          defaultValue="~0.55% of value/yr (default)"
        />
      )}
    </AiSection>
  )
}

interface InvestmentMetricsProps {
  analysis: any
  goal: string
  market: any
  listing: any
}

export default function InvestmentMetrics({ analysis, goal, market, listing }: InvestmentMetricsProps) {
  if (!analysis) return null
  const { universal, rental, long_term, flip, house_hack, str_metrics } = analysis
  const ai = analysis.ai_analysis
  const assumptions = ai?.assumptions

  const listPrice = listing?.list_price || 0
  const downPct = listPrice > 0 ? Math.round((universal.down_payment_amount / listPrice) * 100) : 20
  const isCash = downPct >= 100

  return (
    <div className="space-y-4">
      {ai?.ai_available && ai.investment_narrative && (
        <AiSection
          title={
            <span className="flex items-center gap-2">
              <span>AI Investment Analysis</span>
              <span className="text-amber-500 text-base">✦</span>
              <span className="text-xs font-normal text-text-muted">Powered by Claude</span>
            </span>
          }
        >
          <div className="space-y-3">
            {ai.investment_narrative.narrative && (
              <div className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
                {ai.investment_narrative.narrative}
              </div>
            )}
            {ai.investment_narrative.key_strengths?.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">Key Strengths</div>
                <AiBulletList items={ai.investment_narrative.key_strengths} colorScheme="green" />
              </div>
            )}
            {ai.investment_narrative.key_concerns?.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">Key Concerns</div>
                <AiBulletList items={ai.investment_narrative.key_concerns} colorScheme="amber" />
              </div>
            )}
          </div>
        </AiSection>
      )}

      {ai?.ai_available && ai.listing_intelligence && (
        <AiSection
          title={
            <span className="flex items-center gap-2">
              <span>Listing Intelligence</span>
              {ai.listing_intelligence.ai_confidence != null && (
                <span className="text-xs font-normal text-text-muted">
                  Confidence: {(ai.listing_intelligence.ai_confidence * 100).toFixed(0)}%
                </span>
              )}
            </span>
          }
        >
          <div className="space-y-3">
            <ConditionBadge condition={ai.listing_intelligence.condition_estimate} />
            {ai.listing_intelligence.red_flags?.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-danger uppercase tracking-wide mb-1.5">Red Flags</div>
                <AiBulletList items={ai.listing_intelligence.red_flags} colorScheme="amber" />
              </div>
            )}
            {ai.listing_intelligence.hidden_value?.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-accent uppercase tracking-wide mb-1.5">Hidden Value</div>
                <AiBulletList items={ai.listing_intelligence.hidden_value} colorScheme="green" />
              </div>
            )}
            {ai.listing_intelligence.renovation_signals?.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">Renovation Signals</div>
                <AiBulletList items={ai.listing_intelligence.renovation_signals} colorScheme="amber" />
              </div>
            )}
            {ai.listing_intelligence.motivated_seller_signals?.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">Motivated Seller Signals</div>
                <AiBulletList items={ai.listing_intelligence.motivated_seller_signals} colorScheme="green" />
              </div>
            )}
          </div>
        </AiSection>
      )}

      {assumptions && (
        <AIUnderwritingAssumptions assumptions={assumptions} market={market} rental={rental} />
      )}

      <Section title={
        <span className="flex items-center gap-2">
          <span>Property Financials</span>
          <span className={`text-xs font-normal px-2 py-0.5 rounded-full border ${
            isCash ? 'bg-green-50 text-accent border-green-200' : 'bg-blue-50 text-primary border-blue-200'
          }`}>
            {isCash ? 'All Cash' : `${downPct}% Down`}
          </span>
        </span>
      }>
        <MetricRow label="Estimated Market Value" value={formatCurrency(universal.estimated_market_value)} hint="Based on comparable sales"
          colorClass={universal.price_vs_market_pct != null ? universal.price_vs_market_pct < -5 ? 'text-accent' : universal.price_vs_market_pct > 5 ? 'text-danger' : 'text-text-primary' : 'text-text-primary'} />
        <MetricRow label="Price vs Market" value={universal.price_vs_market_pct != null ? `${universal.price_vs_market_pct > 0 ? '+' : ''}${universal.price_vs_market_pct.toFixed(1)}%` : 'N/A'} hint="Relative to comparable sold properties" colorClass={signalColor(universal.price_vs_market_pct, -5, 10, false)} />
        <MetricRow label="Price per sqft" value={formatCurrency(universal.price_per_sqft, { decimals: 2 })} hint={universal.area_median_price_per_sqft ? `Area median: ${formatCurrency(universal.area_median_price_per_sqft, { decimals: 2 })}/sqft` : null} />
        {isCash ? (
          <MetricRow label="Cash Investment" value={formatCurrency(universal.down_payment_amount)} hint="100% cash — no mortgage or interest" colorClass="text-accent font-bold" />
        ) : (
          <>
            <MetricRow label={`Down Payment (${downPct}%)`} value={formatCurrency(universal.down_payment_amount)} />
            <MetricRow label="Loan Amount" value={formatCurrency(universal.loan_amount)} />
            <MetricRow label="Monthly Mortgage" value={formatCurrency(universal.monthly_mortgage_payment, { decimals: 2 })} hint="P&I at current 30yr rate" />
          </>
        )}
        <MetricRow label="Monthly Tax" value={formatCurrency(universal.property_tax_monthly, { decimals: 2 })} />
        <MetricRow label="Monthly Insurance" value={formatCurrency(universal.insurance_estimate_monthly, { decimals: 2 })} />
        <MetricRow label="Total Monthly Cost" value={formatCurrency(universal.total_monthly_cost, { decimals: 2 })} hint={isCash ? 'Tax + Insurance + HOA (no mortgage)' : 'PITI + HOA'} colorClass="text-primary font-bold" />
      </Section>

      {goal === 'rental' && rental && (
        <Section title="Rental Analysis">
          <MetricRow label="Est. Monthly Rent" value={formatCurrency(rental.estimated_monthly_rent)} hint="Based on HUD FMR + local market" />
          <MetricRow label="Monthly Cash Flow" value={formatCurrency(rental.monthly_cash_flow, { decimals: 2 })} hint="After all expenses" colorClass={signalColor(rental.monthly_cash_flow, 200, 0)} />
          <MetricRow label="Cap Rate" value={typeof rental.cap_rate_pct === 'number' && isFinite(rental.cap_rate_pct) ? `${rental.cap_rate_pct.toFixed(2)}%` : 'N/A'} hint="NOI / Purchase Price" colorClass={signalColor(rental.cap_rate_pct, 6, 3)} />
          <MetricRow label="Cash-on-Cash Return" value={typeof rental.cash_on_cash_return_pct === 'number' && isFinite(rental.cash_on_cash_return_pct) ? `${rental.cash_on_cash_return_pct.toFixed(2)}%` : 'N/A'} hint="Annual cash flow / cash invested" colorClass={signalColor(rental.cash_on_cash_return_pct, 8, 0)} />
          <MetricRow label="Gross Rent Multiplier" value={typeof rental.gross_rent_multiplier === 'number' && isFinite(rental.gross_rent_multiplier) ? `${rental.gross_rent_multiplier.toFixed(1)}x` : 'N/A'} hint="Price / Annual Rent (lower = better)" colorClass={signalColor(rental.gross_rent_multiplier, 8, 20, false)} />
          <MetricRow label="DSCR" value={typeof rental.dscr === 'number' && isFinite(rental.dscr) ? rental.dscr.toFixed(2) : 'N/A'} hint="Debt Service Coverage Ratio (>1.25 is strong)" colorClass={signalColor(rental.dscr, 1.25, 1.0)} />
          <MetricRow label="Rent-to-Price Ratio" value={typeof rental.rent_to_price_ratio_pct === 'number' && isFinite(rental.rent_to_price_ratio_pct) ? `${rental.rent_to_price_ratio_pct.toFixed(2)}%` : 'N/A'} hint="Target: >0.6%/mo (1% rule ideal)" colorClass={signalColor(rental.rent_to_price_ratio_pct, 0.7, 0.5)} />
          <MetricRow label="Break-Even Occupancy" value={typeof rental.break_even_occupancy_pct === 'number' && isFinite(rental.break_even_occupancy_pct) ? `${rental.break_even_occupancy_pct.toFixed(1)}%` : 'N/A'} hint="Occupancy needed to cover expenses" colorClass={signalColor(rental.break_even_occupancy_pct, 70, 90, false)} />
          <MetricRow label="Vacancy Reserve" value={`${rental.vacancy_rate_pct?.toFixed(1) ?? 6}%`} />
          <MetricRow label="Maintenance Reserve" value={formatCurrency(rental.maintenance_monthly, { decimals: 2 })} hint="1% of value/year" />
          <MetricRow label="Property Management" value={formatCurrency(rental.property_management_monthly, { decimals: 2 })} hint="9% of rent" />
        </Section>
      )}

      {goal === 'long_term' && long_term && (
        <Section title="Long-Term Hold Projections">
          <MetricRow label="5-Year Projected Value" value={formatCurrency(long_term.projected_value_5yr)} />
          <MetricRow label="10-Year Projected Value" value={formatCurrency(long_term.projected_value_10yr)} />
          <MetricRow label="5-Year Appreciation" value={typeof long_term.appreciation_5yr_pct === 'number' && isFinite(long_term.appreciation_5yr_pct) ? `${long_term.appreciation_5yr_pct.toFixed(1)}%` : 'N/A'} colorClass={signalColor(long_term.appreciation_5yr_pct, 20, 5)} />
          <MetricRow label="10-Year Appreciation" value={typeof long_term.appreciation_10yr_pct === 'number' && isFinite(long_term.appreciation_10yr_pct) ? `${long_term.appreciation_10yr_pct.toFixed(1)}%` : 'N/A'} colorClass={signalColor(long_term.appreciation_10yr_pct, 40, 10)} />
          <MetricRow label="Projected Equity (5yr)" value={formatCurrency(long_term.projected_equity_5yr)} hint="Appreciation + principal paydown + down payment" />
          <MetricRow label="Projected Equity (10yr)" value={formatCurrency(long_term.projected_equity_10yr)} />
          <MetricRow label="Total ROI (10yr)" value={typeof long_term.total_roi_10yr_pct === 'number' && isFinite(long_term.total_roi_10yr_pct) ? `${long_term.total_roi_10yr_pct.toFixed(1)}%` : 'N/A'} colorClass={signalColor(long_term.total_roi_10yr_pct, 80, 20)} />
          <MetricRow label="Annualized Return" value={typeof long_term.annualized_return_pct === 'number' && isFinite(long_term.annualized_return_pct) ? `${long_term.annualized_return_pct.toFixed(1)}%` : 'N/A'} colorClass={signalColor(long_term.annualized_return_pct, 8, 3)} />
          <MetricRow label="Neighborhood Growth Score" value={typeof long_term.neighborhood_growth_score === 'number' && isFinite(long_term.neighborhood_growth_score) ? `${long_term.neighborhood_growth_score.toFixed(0)}/100` : 'N/A'} colorClass={signalColor(long_term.neighborhood_growth_score, 60, 30)} />
        </Section>
      )}

      {goal === 'fix_and_flip' && flip && (
        <Section title="Fix & Flip Analysis">
          <MetricRow label="ARV (After-Repair Value)" value={formatCurrency(flip.arv)} hint="Estimated post-renovation market value" />
          <MetricRow label="Rehab Scope" value={flip.rehab_scope ?? 'N/A'} hint={flip.rehab_cost_per_sqft ? `~$${flip.rehab_cost_per_sqft}/sqft` : null} />
          <MetricRow label="Estimated Rehab Cost" value={formatCurrency(flip.estimated_rehab_cost)} />
          <MetricRow label="Maximum Allowable Offer" value={formatCurrency(flip.mao)} hint="ARV x 70% - Rehab (the 70% rule)" colorClass="text-primary" />
          <MetricRow label="Deal Score" value={flip.deal_score ?? 'N/A'}
            colorClass={flip.deal_score === 'Strong Deal' ? 'text-accent' : flip.deal_score === 'Good Deal' ? 'text-accent' : flip.deal_score === 'Marginal' ? 'text-warning' : 'text-danger'} />
          <MetricRow label="Potential Profit" value={formatCurrency(flip.potential_profit)} colorClass={signalColor(flip.potential_profit, 30_000, 0)} />
          <MetricRow label="ROI on Flip" value={flip.roi_pct != null ? `${flip.roi_pct.toFixed(1)}%` : 'N/A'} colorClass={signalColor(flip.roi_pct, 20, 5)} />
          <MetricRow label="Holding Period" value={`${flip.holding_months} months`} />
          <MetricRow label="Monthly Holding Cost" value={formatCurrency(flip.holding_cost_monthly, { decimals: 2 })} />
          <MetricRow label="Selling Costs (8%)" value={formatCurrency(flip.selling_costs)} hint="Commission + closing" />
        </Section>
      )}

      {goal === 'house_hack' && house_hack && (
        <Section title="House Hack Analysis">
          <MetricRow
            label="Rentable Units / Rooms"
            value={`${house_hack.rental_units ?? 1}`}
            hint="Units or rooms rented to tenants while owner occupies the rest"
          />
          <MetricRow
            label="Monthly Rental Income"
            value={formatCurrency(house_hack.total_rental_income_monthly)}
            hint="Total rent collected from tenant units/rooms"
            colorClass="text-accent"
          />
          <MetricRow
            label="Mortgage Offset"
            value={house_hack.mortgage_offset_pct != null ? `${house_hack.mortgage_offset_pct.toFixed(1)}%` : 'N/A'}
            hint="% of mortgage payment covered by tenants"
            colorClass={signalColor(house_hack.mortgage_offset_pct, 75, 40)}
          />
          <MetricRow
            label="Owner's Net Monthly Cost"
            value={house_hack.owner_net_monthly_cost != null ? formatCurrency(house_hack.owner_net_monthly_cost, { decimals: 2 }) : 'N/A'}
            hint="Your effective housing cost after tenant income (negative = tenants pay you)"
            colorClass={house_hack.owner_net_monthly_cost != null && house_hack.owner_net_monthly_cost <= 0 ? 'text-accent' : house_hack.owner_net_monthly_cost != null && house_hack.owner_net_monthly_cost < 800 ? 'text-warning' : 'text-danger'}
          />
          <MetricRow
            label="Market Rent (Owner's Unit)"
            value={formatCurrency(house_hack.market_rent_owner_unit)}
            hint="What renting equivalent space would cost in the local market"
          />
          <MetricRow
            label="Monthly Savings vs. Renting"
            value={house_hack.monthly_savings_vs_renting != null ? formatCurrency(house_hack.monthly_savings_vs_renting, { decimals: 2 }) : 'N/A'}
            hint="Compared to renting equivalent space at market rate"
            colorClass={signalColor(house_hack.monthly_savings_vs_renting, 500, 0)}
          />
          <MetricRow
            label="Cash-on-Cash Return"
            value={house_hack.cash_on_cash_return_pct != null ? `${house_hack.cash_on_cash_return_pct.toFixed(2)}%` : 'N/A'}
            hint="Rental portion NOI / total cash invested"
            colorClass={signalColor(house_hack.cash_on_cash_return_pct, 6, 0)}
          />
          <MetricRow label="Total Monthly Expenses" value={formatCurrency(house_hack.total_monthly_expenses, { decimals: 2 })} hint="PITI + maintenance + CapEx + HOA" />
          <MetricRow label="Maintenance Reserve" value={formatCurrency(house_hack.maintenance_monthly, { decimals: 2 })} hint="1% of value/year" />
        </Section>
      )}

      {goal === 'short_term_rental' && str_metrics && (
        <Section title="Short-Term Rental Analysis (Airbnb/VRBO)">
          <MetricRow
            label="Est. Nightly Rate"
            value={`${formatCurrency(str_metrics.estimated_nightly_rate)}/night`}
            hint="Based on market comparables and bedroom count"
          />
          <MetricRow
            label="Occupancy Rate"
            value={str_metrics.occupancy_rate_pct != null ? `${str_metrics.occupancy_rate_pct.toFixed(1)}%` : 'N/A'}
            hint="Expected % of nights booked (65% is typical)"
            colorClass={signalColor(str_metrics.occupancy_rate_pct, 70, 50)}
          />
          <MetricRow
            label="Gross Monthly Revenue"
            value={formatCurrency(str_metrics.gross_monthly_revenue, { decimals: 2 })}
            hint="Nightly rate × occupied nights"
            colorClass="text-accent"
          />
          <MetricRow
            label="Platform Fees (3%)"
            value={formatCurrency(str_metrics.platform_fee_monthly, { decimals: 2 })}
            hint="Airbnb/VRBO host service fee"
          />
          <MetricRow
            label="Cleaning Costs"
            value={formatCurrency(str_metrics.cleaning_costs_monthly, { decimals: 2 })}
            hint="Per-turnover cleaning × estimated bookings/month"
          />
          <MetricRow
            label="STR Maintenance Reserve"
            value={formatCurrency(str_metrics.str_maintenance_monthly, { decimals: 2 })}
            hint="2%/yr of value (higher than standard rental due to wear)"
          />
          <MetricRow
            label="Net Operating Income"
            value={formatCurrency(str_metrics.net_operating_income_monthly, { decimals: 2 })}
            hint="Gross revenue − platform fees − cleaning − maintenance − insurance − tax − HOA"
            colorClass={signalColor(str_metrics.net_operating_income_monthly, 500, 0)}
          />
          <MetricRow
            label="Monthly Cash Flow"
            value={formatCurrency(str_metrics.monthly_cash_flow, { decimals: 2 })}
            hint="After mortgage and all expenses"
            colorClass={signalColor(str_metrics.monthly_cash_flow, 300, 0)}
          />
          <MetricRow
            label="Cap Rate"
            value={str_metrics.cap_rate_pct != null ? `${str_metrics.cap_rate_pct.toFixed(2)}%` : 'N/A'}
            hint="STR NOI / Purchase Price"
            colorClass={signalColor(str_metrics.cap_rate_pct, 8, 4)}
          />
          <MetricRow
            label="Cash-on-Cash Return"
            value={str_metrics.cash_on_cash_return_pct != null ? `${str_metrics.cash_on_cash_return_pct.toFixed(2)}%` : 'N/A'}
            hint="Annual cash flow / cash invested"
            colorClass={signalColor(str_metrics.cash_on_cash_return_pct, 10, 0)}
          />
          <MetricRow
            label="Break-Even Occupancy"
            value={str_metrics.break_even_occupancy_pct != null ? `${str_metrics.break_even_occupancy_pct.toFixed(1)}%` : 'N/A'}
            hint="Minimum occupancy needed to cover all costs"
            colorClass={signalColor(str_metrics.break_even_occupancy_pct, 40, 65, false)}
          />
          <MetricRow
            label="LTR Monthly (for comparison)"
            value={formatCurrency(str_metrics.ltr_monthly_comparison)}
            hint="Estimated long-term rental income for same property"
          />
          {str_metrics.str_vs_ltr_premium_pct != null && (
            <MetricRow
              label="STR vs. LTR Premium"
              value={`${str_metrics.str_vs_ltr_premium_pct > 0 ? '+' : ''}${str_metrics.str_vs_ltr_premium_pct.toFixed(1)}%`}
              hint="How much more (or less) STR earns vs. traditional rental"
              colorClass={signalColor(str_metrics.str_vs_ltr_premium_pct, 30, 0)}
            />
          )}
        </Section>
      )}
    </div>
  )
}
