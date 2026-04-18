# Analysis Engine — Financial Modeling Fix Specification

**Target files:**
- `backend/services/analysis_engine.py`
- `backend/models/schemas.py`
- `backend/services/ai_service.py` (assumption prompt updates)

**Goal:** Bring the financial model from "directional screening tool" to "underwriting-grade." Every change below is described with exact formulas, field names, defaults, line references, and an expected test case.

---

## 0. Conventions

- All monetary values in USD, rounded to whole dollars for display, full precision internally.
- All percentages stored as `float` in percent form (e.g. `5.5` = 5.5%), matching current codebase convention.
- Any new field added to a Pydantic schema must be `Optional` with a sensible default so existing serialized payloads remain valid.
- All new constants live at the top of `analysis_engine.py` in a block labelled `# --- UNDERWRITING CONSTANTS ---`.

---

## 1. PMI for sub-20% down payments

**Where:** `_compute_universal_metrics`, `analysis_engine.py` around lines 49–69.

**Problem:** PMI not added when `down_pct < 20`.

**Fix:**

1. Add constant:
   ```
   PMI_ANNUAL_PCT_OF_LOAN = 0.008   # 0.8% of loan balance per year (midpoint of 0.5–1.5%)
   ```
2. After computing `loan_amount` and before `total_monthly`:
   ```
   ltv = loan_amount / listing.list_price
   if ltv > 0.80:
       pmi_monthly = loan_amount * PMI_ANNUAL_PCT_OF_LOAN / 12
   else:
       pmi_monthly = 0.0
   ```
3. Include `pmi_monthly` in `total_monthly_cost`.
4. Expose `pmi_monthly` on `UniversalMetrics` as a new field:
   ```
   pmi_monthly: float = 0.0
   ```

**Schema change:** `UniversalMetrics` — add `pmi_monthly: float = 0.0`.

**Test:** $400K home, 10% down, 7% rate, 30-yr → expect `pmi_monthly ≈ $240` and `total_monthly_cost` ≈ (P&I $2,395) + (tax $367) + (ins $183) + (pmi $240) = **~$3,185**.

---

## 2. Closing costs in all ROI denominators

**Where:** every function that uses `total_cash_invested = down_payment_amount`.

**Problem:** Real closing costs are 2–3% of purchase price; currently zero.

**Fix:**

1. Add constants:
   ```
   CLOSING_COST_PCT_OF_PRICE = 0.025   # 2.5% blended
   ```
2. In `_compute_universal_metrics`, compute:
   ```
   closing_costs = listing.list_price * CLOSING_COST_PCT_OF_PRICE
   ```
   Store on `UniversalMetrics` as new field `closing_costs: float`.
3. In `_compute_rental_metrics` (line 250):
   ```
   total_cash_invested = down + universal.closing_costs
   ```
4. In `_compute_long_term_metrics` (line 159):
   ```
   total_invested = down + universal.closing_costs
   ```
5. In `_compute_flip_metrics` (line 349):
   ```
   total_investment = (
       universal.down_payment_amount
       + universal.closing_costs
       + rehab_cost
       + total_holding
       + financing_costs  # see §4
   )
   ```

**Schema change:** `UniversalMetrics` — add `closing_costs: float = 0.0`.

**Test:** $400K, 20% down (no PMI), closing = $10,000; CoC on $4,800/yr cash flow should fall from ~6.0% to ~5.3%.

---

## 3. Separate CapEx reserve from maintenance

**Where:** `_compute_rental_metrics`, line 227–230.

**Problem:** Single 1%/yr bucket understates long-term expenses.

**Fix:**

1. Add constants:
   ```
   DEFAULT_MAINTENANCE_PCT = 0.01   # 1%/yr of value
   DEFAULT_CAPEX_PCT = 0.01         # 1%/yr of value (roof, HVAC, water heater, appliances)
   ```
2. Split the calculation:
   ```
   maintenance_monthly = price * DEFAULT_MAINTENANCE_PCT / 12
   capex_monthly = price * DEFAULT_CAPEX_PCT / 12
   ```
   (Keep the AI override for `maintenance_reserve_pct` applied to `maintenance_monthly` only.)
3. Include `capex_monthly` in `monthly_expenses`.
4. Expose on `RentalMetrics`:
   ```
   capex_reserve_monthly: float | None = None
   ```

**Schema change:** `RentalMetrics` — add `capex_reserve_monthly`.

**Test:** $400K rental → maintenance $333/mo + capex $333/mo (up from $333/mo combined); NOI drops by ~$333/mo → cap rate falls by ~1.0 percentage point.

---

## 4. Hard-money financing for flips

**Where:** `_compute_flip_metrics`, entire function.

**Problem:** Flip holding costs use conventional 30-yr mortgage; flippers use hard money at 9–14% interest-only with 2–3 points.

**Fix:**

1. Add constants:
   ```
   HARD_MONEY_RATE_PCT = 11.0       # Annual, interest-only
   HARD_MONEY_POINTS_PCT = 2.5      # Origination, paid upfront
   HARD_MONEY_LTC_PCT = 0.85        # Loan-to-cost (85% of purchase+rehab typical)
   HARD_MONEY_MIN_DOWN_PCT = 0.15   # Flipper still puts 15% in
   ```
2. Replace `universal.monthly_mortgage_payment` references inside `_compute_flip_metrics` with a flip-specific block:
   ```
   flip_loan = (listing.list_price + rehab_cost) * HARD_MONEY_LTC_PCT
   flip_down = (listing.list_price + rehab_cost) - flip_loan
   monthly_interest = flip_loan * (HARD_MONEY_RATE_PCT / 100) / 12
   origination_fee = flip_loan * (HARD_MONEY_POINTS_PCT / 100)
   ```
3. Holding cost monthly becomes:
   ```
   holding_monthly = (
       monthly_interest
       + universal.property_tax_monthly
       + universal.insurance_estimate_monthly
       + (listing.hoa_monthly or 0)
       + UTILITIES_DURING_REHAB_MONTHLY    # see constant below, default 150
   )
   ```
4. Add `financing_costs = origination_fee` to the `potential_profit` subtraction:
   ```
   potential_profit = int(
       arv - price - rehab_cost - total_holding - selling_costs - origination_fee
   )
   ```
5. Replace `total_investment` per §2.
6. Add new constant: `UTILITIES_DURING_REHAB_MONTHLY = 150`.

**Schema change:** `FlipMetrics` — add:
```
financing_rate_pct: float | None = None
origination_fee: int | None = None
utilities_during_rehab: int | None = None
down_payment_flip: int | None = None
```

**Test:** $300K purchase, $50K rehab, $400K ARV → flip_loan $297,500, monthly interest $2,727, origination $7,437. Profit should drop by ~$15K–$20K vs. current calc.

---

## 5. Updated rehab $/sqft defaults

**Where:** `_compute_flip_metrics`, lines 316–324.

**Problem:** $22 / $45 / $80 is pre-2020 pricing.

**Fix:** Replace with:
```
REHAB_COST_COSMETIC_PER_SQFT = 40.0     # was 22
REHAB_COST_MODERATE_PER_SQFT = 95.0     # was 45
REHAB_COST_FULL_GUT_PER_SQFT = 180.0    # was 80
```

**Optional improvement:** scale by MSA cost-of-living if `market.demographics.median_household_income` is available:
```
col_factor = max(0.75, min(1.5, (median_income or 70000) / 70000))
rehab_ppsf *= col_factor
```

**Test:** 1,800 sqft moderate rehab → was $81,000; becomes $171,000 (or up to $256K in HCOL).

---

## 6. Rent-to-price ratio labelling & thresholds

**Where:** `_compute_rental_metrics` line 270, `_compute_risk_factors` lines 452–464.

**Problem:** Field is labelled "ratio" but is actually "yield %." Thresholds (0.5/0.7) are well below the classic 1% rule.

**Fix:**

1. Rename the stored value semantically. Keep the field name `rent_to_price_ratio` for backward compatibility but store the **true ratio**:
   ```
   rent_to_price_ratio = estimated_rent / price   # e.g. 0.008 = 0.8%
   ```
2. Add a sibling field for display:
   ```
   rent_to_price_ratio_pct: float | None = None   # e.g. 0.8
   ```
   Populate from `rent_to_price_ratio * 100`.
3. Update risk thresholds in `_compute_risk_factors` to use the **pct** version:
   ```
   if rtp_pct >= 1.0:
       # meets 1% rule — "Strong"
   elif rtp_pct >= 0.7:
       # acceptable
   elif rtp_pct < 0.5:
       # warning
   ```
4. Update frontend to read `rent_to_price_ratio_pct`.

**Schema change:** `RentalMetrics` — add `rent_to_price_ratio_pct`.

**Test:** $2,000 rent on $300K → ratio = 0.00667, pct = 0.67, risk label = acceptable.

---

## 7. Area median $/sqft from real data

**Where:** `_compute_universal_metrics`, lines 76–78.

**Problem:** `median_home_value / 1500` fabricates a denominator.

**Fix:**

1. Add a field to `EconomicIndicators` in `schemas.py`:
   ```
   median_price_per_sqft: float | None = None
   ```
2. `market_data.py` must populate it from whichever data source provides it (Rentcast market endpoint, Zillow, or fallback to `median_home_value / median_sqft` where median_sqft is pulled from Census ACS housing stock data).
3. Replace lines 76–78 with:
   ```
   area_median_ppsf = market.economic_indicators.median_price_per_sqft
   ```

**Test:** If source data returns `median_price_per_sqft = 215.0`, the universal metric matches directly instead of being computed as `median_home_value / 1500`.

---

## 8. Tax treatment

**Where:** new helper functions, invoked from rental and long-term calcs.

**Problem:** No mortgage interest deduction, property tax deduction, depreciation, or depreciation recapture / capital gains.

**Fix:**

1. Add constants:
   ```
   FEDERAL_MARGINAL_TAX_RATE = 0.24     # assume 24% bracket by default
   DEPRECIATION_YEARS_RESIDENTIAL = 27.5
   LAND_VALUE_PCT_OF_PRICE = 0.20       # improvements = 80% of basis
   DEPRECIATION_RECAPTURE_RATE = 0.25
   LT_CAPITAL_GAINS_RATE = 0.15
   SELF_EMPLOYMENT_TAX_RATE = 0.153     # if flipper classified as dealer
   ```
2. New helper `_annual_depreciation(price)`:
   ```
   improvements = price * (1 - LAND_VALUE_PCT_OF_PRICE)
   return improvements / DEPRECIATION_YEARS_RESIDENTIAL
   ```
3. In `_compute_rental_metrics`, after computing NOI, compute tax shield:
   ```
   year_one_interest = loan * mortgage_rate   # approx, full amortization interest for yr 1 is ~97% of this
   taxable_income = noi_annual - year_one_interest - _annual_depreciation(price)
   tax_impact_annual = taxable_income * FEDERAL_MARGINAL_TAX_RATE
   after_tax_cash_flow = (monthly_cash_flow * 12) - tax_impact_annual
   ```
   (Note: if `taxable_income` is negative, `tax_impact_annual` is negative = a shield against W-2 income, capped by passive activity rules — but approximating as a full shield is acceptable for this pass.)
4. Expose on `RentalMetrics`:
   ```
   annual_depreciation: float | None = None
   after_tax_cash_flow_annual: float | None = None
   taxable_income_year_one: float | None = None
   ```
5. For `_compute_flip_metrics`, subtract taxes from profit:
   ```
   flip_tax = potential_profit * (FEDERAL_MARGINAL_TAX_RATE + SELF_EMPLOYMENT_TAX_RATE)
   after_tax_profit = potential_profit - flip_tax
   ```
   Expose `after_tax_profit: int | None = None` on `FlipMetrics`.
6. For `_compute_long_term_metrics`, apply capital gains on realized equity:
   ```
   gain_at_sale = projected_value - price
   lt_tax = gain_at_sale * LT_CAPITAL_GAINS_RATE
   recapture_tax = cumulative_depreciation * DEPRECIATION_RECAPTURE_RATE  # rentals only
   ```
   Expose `net_equity_after_tax_5yr` / `..._10yr` on `LongTermMetrics`.

**Schema changes:** Fields above added to `RentalMetrics`, `FlipMetrics`, `LongTermMetrics`.

**Caveat to document in a docstring:** These are simplified projections; actual tax outcomes depend on filer status, passive loss rules (§469), QBI, state tax, 1031 exchanges, etc. Label output as "Estimated tax impact (consult CPA)."

**Test:** $400K rental, $80K down, NOI $18K/yr, interest $21K/yr, depreciation $11.6K/yr → taxable = -$14.6K → tax shield = $3.5K/yr (boosts after-tax CoC by ~4.4 pp).

---

## 9. Rent growth & expense inflation for long-term projections

**Where:** `_compute_long_term_metrics`, and a new forward-cash-flow calc inside `_compute_rental_metrics` (or a new function `_compute_projected_cashflows`).

**Problem:** 5/10-yr projections hold rent, tax, insurance flat.

**Fix:**

1. Add constants:
   ```
   DEFAULT_RENT_GROWTH_PCT = 0.03        # 3%/yr
   DEFAULT_EXPENSE_INFLATION_PCT = 0.035  # 3.5%/yr (insurance trends higher)
   DEFAULT_TAX_REASSESSMENT_PCT = 0.02    # 2%/yr
   ```
2. Prefer `market.rental_market.rent_growth_yoy_pct` when available; else fall back to default.
3. Generate year-by-year pro forma for years 1–10:
   ```
   for year in range(1, 11):
       rent_y = rent_year1 * (1 + rent_growth) ** (year - 1)
       tax_y = tax_year1 * (1 + tax_inflation) ** (year - 1)
       ins_y = ins_year1 * (1 + expense_inflation) ** (year - 1)
       # etc.
       cash_flow_y = ...
   ```
4. Add to `LongTermMetrics`:
   ```
   projected_annual_cashflows: list[float] = Field(default_factory=list)
   cumulative_cashflow_5yr: float | None = None
   cumulative_cashflow_10yr: float | None = None
   ```

**Test:** $2,000 starting rent → year 10 rent = $2,612. Cumulative 10-yr delta vs. flat = ~$26K.

---

## 10. Selling costs in long-term equity projections

**Where:** `_compute_long_term_metrics`, line 156–157.

**Problem:** Projected equity is gross; realizing it costs 6–8%.

**Fix:**

1. Add constant: `SELLING_COST_PCT = 0.07`.
2. Compute net equity:
   ```
   selling_cost_5yr = projected_5yr * SELLING_COST_PCT
   net_equity_5yr = (projected_5yr - selling_cost_5yr) - remaining_balance(60)
   selling_cost_10yr = projected_10yr * SELLING_COST_PCT
   net_equity_10yr = (projected_10yr - selling_cost_10yr) - remaining_balance(120)
   ```
3. Expose:
   ```
   net_equity_5yr: int | None = None
   net_equity_10yr: int | None = None
   ```
4. Rename existing `projected_equity_5yr/10yr` output to represent gross equity; both stay for comparison.

**Test:** $500K projected value, $280K remaining loan → gross $220K, net $185K.

---

## 11. Property management fee on collected rent, not gross

**Where:** `_compute_rental_metrics`, line 231.

**Problem:** `mgmt_fee = estimated_rent * 0.09` uses gross.

**Fix:**
```
mgmt_fee = effective_gross_rent * 0.09
```
(Apply after `effective_gross_rent` is computed.)

**Test:** 6% vacancy, $2,000 rent → mgmt fee $169.20 (not $180.00). Small but strict.

---

## 12. Turnover / leasing commission

**Where:** `_compute_rental_metrics`, new line in expense block.

**Problem:** Not modeled.

**Fix:**

1. Add constants:
   ```
   AVG_TENANCY_MONTHS = 24
   TURNOVER_VACANCY_MONTHS = 1       # 1 month vacant during turnover
   LEASING_COMMISSION_MONTHS = 0.5   # half month's rent to leasing agent
   ```
2. Compute monthly amortized turnover cost:
   ```
   turnover_cost_per_event = estimated_rent * (TURNOVER_VACANCY_MONTHS + LEASING_COMMISSION_MONTHS)
   turnover_monthly = turnover_cost_per_event / AVG_TENANCY_MONTHS
   ```
3. Include in `monthly_expenses`.
4. Expose `turnover_reserve_monthly: float | None = None` on `RentalMetrics`.

**Test:** $2,000 rent → turnover $125/mo → reduces NOI by $1,500/yr.

---

## 13. Break-even occupancy — fix the variable/fixed split

**Where:** `_compute_rental_metrics`, lines 260–268.

**Problem:** `mgmt_fee` included in "fixed" numerator even though it's variable with occupancy.

**Fix:**
```
fixed_monthly = (
    universal.monthly_mortgage_payment
    + universal.property_tax_monthly
    + universal.insurance_estimate_monthly
    + (listing.hoa_monthly or 0)
    + maintenance_monthly
    + capex_monthly
    + turnover_monthly
    # Note: mgmt_fee and vacancy are variable; exclude from fixed
)
variable_cost_pct_of_rent = 0.09  # mgmt fee
# BEO: occupancy × rent × (1 - var_pct) >= fixed_monthly
beo = (fixed_monthly / (estimated_rent * (1 - variable_cost_pct_of_rent))) * 100
```

**Test:** Same inputs should produce a BEO ~1–2 pp lower than current calc (because mgmt scales down with vacancy).

---

## 14. Scenario bands (bear / base / bull)

**Where:** `_compute_long_term_metrics` and `_compute_rental_metrics`.

**Problem:** Point estimates imply false precision.

**Fix:**

1. Wrap appreciation, rent growth, and vacancy assumptions in a 3-scenario helper:
   ```
   SCENARIOS = {
       "bear":  {"apprec_delta": -0.02, "rent_growth_delta": -0.015, "vacancy_delta": +0.03},
       "base":  {"apprec_delta":  0.0,  "rent_growth_delta":  0.0,   "vacancy_delta":  0.0},
       "bull":  {"apprec_delta": +0.02, "rent_growth_delta": +0.015, "vacancy_delta": -0.02},
   }
   ```
2. Compute each key output (projected value, cash flow, ROI) under each scenario.
3. Expose on `LongTermMetrics` and `RentalMetrics`:
   ```
   scenarios: dict[str, dict[str, float]] | None = None
   # e.g. {"bear": {"roi_10yr_pct": 41.2, ...}, "base": {...}, "bull": {...}}
   ```

**Test:** Base ROI 80%; bear should be ~50%; bull should be ~115%.

---

## 15. Interest rate sensitivity table

**Where:** `_compute_universal_metrics` returns primary output; add sibling function `_compute_rate_sensitivity`.

**Problem:** Single rate = no visibility on rate risk.

**Fix:**

1. After computing base `monthly_mortgage_payment`, compute at ±100 bps and ±200 bps:
   ```
   sensitivity = {}
   for delta_bps in (-200, -100, 0, 100, 200):
       rate = mortgage_rate + delta_bps / 100
       pmt = _monthly_mortgage_payment(loan_amount, rate)
       sensitivity[delta_bps] = round(pmt, 2)
   ```
2. Expose on `UniversalMetrics`:
   ```
   rate_sensitivity: dict[int, float] = Field(default_factory=dict)
   ```

**Test:** $320K loan at 7% = $2,129/mo. At 9% = $2,575/mo (+$446).

---

## 16. Neighborhood growth score — calibrate or drop

**Where:** `_compute_long_term_metrics`, line 172.

**Problem:** Arbitrary weights produce false precision.

**Fix (pragmatic):** Keep the score but rename it and ground the components:
```
growth_score = (
    min(pop_growth / 2.0, 1.0) * 35           # 0–35 pts, maxes at 2%/yr pop growth
    + min(appreciation_rate / 0.06, 1.0) * 35  # 0–35 pts, maxes at 6%/yr appreciation
    + min(income / 100_000, 1.0) * 20          # 0–20 pts, maxes at $100K median income
    + min(max(0, 5 - unemployment_pct) / 5, 1.0) * 10  # 0–10 pts, maxes at 0% unemployment
)
```
This at least has a clear maximum of 100 and intuitive component meanings.

**Alternative (rigorous):** Remove the score entirely; present the three inputs separately and let the user/UI decide how to synthesize.

**Schema change:** None (field already exists).

---

## 17. Document flip interest explicitly

**Where:** `_compute_flip_metrics` output.

**Problem:** Holding cost lumps interest in with taxes and insurance.

**Fix:** Break out on `FlipMetrics`:
```
total_interest_paid: int | None = None   # monthly_interest * holding_months
property_tax_during_hold: int | None = None
insurance_during_hold: int | None = None
utilities_during_hold: int | None = None
total_holding_costs: int | None = None
```

No math change — this is a transparency / explainability fix so the UI can show where the holding cost number comes from.

---

## 18. Risk factor updates

**Where:** `_compute_risk_factors`.

**Additions:**

- **Negative after-tax cash flow:** if `rental.after_tax_cash_flow_annual < 0`, `severity=0.85`.
- **DSCR below 1.2:** if `rental.dscr and rental.dscr < 1.2`, `severity=0.7` ("lender-unfriendly, expect rate add-on or larger down payment").
- **LTV > 80% with no PMI buffer:** if `ltv > 0.80`, `severity=0.3` ("PMI required; factored into payment").
- **Rehab > 30% of purchase price:** if `flip and rehab_cost / price > 0.30`, `severity=0.75` ("significant execution risk").
- **Insurance > 1% of price/yr:** if markets where this is true (FL, CA), `severity=0.65` ("insurance cost abnormally high — verify quotes").

---

## 19. AI assumption prompt updates

**Where:** `backend/services/ai_service.py`, `generate_assumptions` prompt.

**Problem:** AI isn't asked for several of the new fields.

**Fix:** Extend the prompt (and `AIAssumptions` schema) to request:
- `capex_reserve_pct` (separate from maintenance)
- `utilities_during_rehab_monthly`
- `property_manager_fee_pct` (override default 9%)
- `rent_growth_pct` (override market)
- `expected_appreciation_pct` (override market)
- `holding_months` (override scope-based default)

Make all optional; existing fallback defaults remain in force when AI returns null.

**Schema change:** `AIAssumptions` — add the fields above as `Optional`.

---

## 20. Testing plan

Create `backend/tests/test_analysis_engine.py` (if it doesn't exist) and add:

| Test | Property | Expected invariant |
|---|---|---|
| `test_pmi_applied_below_80_ltv` | $400K, 10% down | `pmi_monthly > 0` |
| `test_no_pmi_at_20_down` | $400K, 20% down | `pmi_monthly == 0` |
| `test_closing_costs_included_in_coc` | $400K rental | CoC < (without closing) |
| `test_capex_separate_from_maintenance` | $400K rental | `capex_reserve_monthly ≈ maintenance_monthly` |
| `test_flip_uses_hard_money` | Flip scenario | `total_interest_paid` reflects ~11% rate |
| `test_selling_costs_reduce_equity` | 10-yr projection | `net_equity_10yr < gross_equity_10yr` |
| `test_rent_growth_compounds` | 10-yr projection | `year_10_rent ≈ year_1_rent × 1.03**9` |
| `test_scenarios_ordered` | Any | `bear_roi < base_roi < bull_roi` |
| `test_rate_sensitivity_monotonic` | Any | `pmt[-200] < pmt[0] < pmt[+200]` |
| `test_depreciation_shield_applied` | Rental with mortgage | `after_tax_cf > pre_tax_cf` when `taxable_income < 0` |
| `test_tax_on_flip_profit` | Flip | `after_tax_profit < potential_profit` |
| `test_rent_to_price_pct_vs_ratio` | Any | `ratio * 100 == ratio_pct` |

Use fixtures for a "canonical test property" so all tests share the same baseline.

---

## 21. Deployment order / commit plan

Recommended order to keep diffs reviewable:

1. **Commit 1** — Schema additions (all new fields, all default to `None`/`0`). No behavior change.
2. **Commit 2** — §1 (PMI), §2 (closing costs), §3 (capex split). Accuracy fixes in universal + rental core.
3. **Commit 3** — §5 (rehab $/sqft) + §4 (hard money). Flip accuracy.
4. **Commit 4** — §11 (mgmt fee on effective), §12 (turnover), §13 (BEO split). Rental refinements.
5. **Commit 5** — §6 (rent-to-price), §7 (median ppsf). Display fixes.
6. **Commit 6** — §10 (selling costs), §15 (rate sensitivity), §17 (flip transparency). Cosmetic and sensitivity.
7. **Commit 7** — §9 (rent growth), §14 (scenarios). Projections.
8. **Commit 8** — §8 (tax). Most conceptually heavy; isolate.
9. **Commit 9** — §16 (growth score), §18 (risk factors), §19 (AI prompts). Polish.
10. **Commit 10** — §20 (tests). Ideally incremental alongside each prior commit, but catch-all if not.

---

## 22. Open questions for the product owner

Flag these before implementation — answers change defaults:

1. What's the target user's marginal tax bracket? (Drives `FEDERAL_MARGINAL_TAX_RATE`.)
2. Should flipper tax assume "dealer" (SE tax) or "investor" (capital gains)? Very different outcomes.
3. Are users expected to be owner-occupants for long-term hold, or pure investors? (Changes whether rental income / tax shield applies to long-term scenario.)
4. Should the default down payment for long-term hold stay at 20%, or move to 25% (investor conventional)?
5. Cash-purchase path — is there an UI toggle? If yes, PMI/PMI/mortgage all need to short-circuit cleanly.
6. HCOL rehab scaling (§5 optional) — ship as default or behind a flag?

---

## Summary of new schema fields (quick reference)

**`UniversalMetrics`:**
- `pmi_monthly: float = 0.0`
- `closing_costs: float = 0.0`
- `rate_sensitivity: dict[int, float] = {}`

**`RentalMetrics`:**
- `capex_reserve_monthly: float | None = None`
- `turnover_reserve_monthly: float | None = None`
- `rent_to_price_ratio_pct: float | None = None`
- `annual_depreciation: float | None = None`
- `taxable_income_year_one: float | None = None`
- `after_tax_cash_flow_annual: float | None = None`
- `scenarios: dict | None = None`

**`LongTermMetrics`:**
- `net_equity_5yr: int | None = None`
- `net_equity_10yr: int | None = None`
- `projected_annual_cashflows: list[float] = []`
- `cumulative_cashflow_5yr: float | None = None`
- `cumulative_cashflow_10yr: float | None = None`
- `scenarios: dict | None = None`

**`FlipMetrics`:**
- `financing_rate_pct: float | None = None`
- `origination_fee: int | None = None`
- `down_payment_flip: int | None = None`
- `utilities_during_rehab: int | None = None`
- `total_interest_paid: int | None = None`
- `property_tax_during_hold: int | None = None`
- `insurance_during_hold: int | None = None`
- `total_holding_costs: int | None = None`
- `after_tax_profit: int | None = None`

**`EconomicIndicators`:**
- `median_price_per_sqft: float | None = None`

**`AIAssumptions`:**
- `capex_reserve_pct: float | None = None`
- `utilities_during_rehab_monthly: int | None = None`
- `property_manager_fee_pct: float | None = None`
- `rent_growth_pct: float | None = None`
- `expected_appreciation_pct: float | None = None`
- `holding_months: int | None = None`

---

End of spec. An engineer (or another agent) applying this file section-by-section will land underwriting-grade financial logic without needing further context from the original review.
