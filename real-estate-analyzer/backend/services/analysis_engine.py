"""
Core financial analysis engine. Pure functions — no side effects, no I/O.
Takes data in, returns PropertyAnalysis objects.
All three investment strategies are fully calculated.

Note on tax outputs: the tax figures produced here are simplified projections.
Actual tax outcomes depend on filer status, passive-loss rules (§469), QBI,
state tax, 1031 exchanges, and more. UI should label these as
"Estimated tax impact (consult CPA)."
"""

import math
from datetime import datetime

from backend.models.schemas import (
    AIAssumptions,
    BudgetRange,
    CompAnalysis,
    FlipMetrics,
    HouseHackMetrics,
    InvestmentGoal,
    LongTermMetrics,
    MarketSnapshot,
    PropertyAnalysis,
    PropertyListing,
    RentalMetrics,
    RiskFactor,
    ShortTermRentalMetrics,
    UniversalMetrics,
)


# --- UNDERWRITING CONSTANTS -------------------------------------------------

# §1 PMI
PMI_ANNUAL_PCT_OF_LOAN = 0.008          # 0.8% of loan balance per year

# §2 Closing costs
CLOSING_COST_PCT_OF_PRICE = 0.025       # 2.5% blended

# §3 Maintenance & CapEx
DEFAULT_MAINTENANCE_PCT = 0.01          # 1%/yr of value
DEFAULT_CAPEX_PCT = 0.01                # 1%/yr of value

# §4 Hard-money (flip) financing
HARD_MONEY_RATE_PCT = 11.0              # Annual, interest-only
HARD_MONEY_POINTS_PCT = 2.5             # Origination, paid upfront
HARD_MONEY_LTC_PCT = 0.85               # Loan-to-cost (purchase + rehab)
HARD_MONEY_MIN_DOWN_PCT = 0.15          # Flipper still puts 15% in
UTILITIES_DURING_REHAB_MONTHLY = 150.0  # Default utility cost during rehab

# §5 Rehab $/sqft (2025)
REHAB_COST_COSMETIC_PER_SQFT = 40.0
REHAB_COST_MODERATE_PER_SQFT = 95.0
REHAB_COST_FULL_GUT_PER_SQFT = 180.0

# §8 Tax
FEDERAL_MARGINAL_TAX_RATE = 0.24
DEPRECIATION_YEARS_RESIDENTIAL = 27.5
LAND_VALUE_PCT_OF_PRICE = 0.20          # improvements = 80% of basis
DEPRECIATION_RECAPTURE_RATE = 0.25
LT_CAPITAL_GAINS_RATE = 0.15
SELF_EMPLOYMENT_TAX_RATE = 0.153        # flipper classified as dealer

# §9 Growth assumptions for projections
DEFAULT_RENT_GROWTH_PCT = 0.03          # 3%/yr
DEFAULT_EXPENSE_INFLATION_PCT = 0.035   # 3.5%/yr
DEFAULT_TAX_REASSESSMENT_PCT = 0.02     # 2%/yr

# §10 Selling costs when realizing equity
SELLING_COST_PCT = 0.07

# §11 Property management fee
DEFAULT_PM_FEE_PCT = 0.09               # 9% of collected rent

# §12 Turnover
AVG_TENANCY_MONTHS = 24
TURNOVER_VACANCY_MONTHS = 1
LEASING_COMMISSION_MONTHS = 0.5

# §15 Short-term rental (STR / Airbnb) constants
STR_PLATFORM_FEE_PCT = 0.03          # Airbnb host service fee ~3%
STR_AVG_STAY_NIGHTS = 3.0            # Average booking length in nights
STR_CLEANING_FEE_DEFAULT = 120.0     # Per turnover cleaning cost
STR_DEFAULT_OCCUPANCY_PCT = 0.65     # 65% occupancy default
STR_MAINTENANCE_PCT = 0.02           # Higher than LTR due to wear & tear (2%/yr)
STR_NIGHTLY_MULTIPLIER = 2.5         # STR nightly premium vs (monthly LTR / 30)
STR_INSURANCE_MULTIPLIER = 1.6       # STR insurance ~60% higher than standard

# §16 House hack constants
HOUSE_HACK_ROOM_RENT_FACTOR = 0.65   # Per-room rental = 65% of 1BR market rate

# §14 Scenario bands
SCENARIOS = {
    "bear": {"apprec_delta": -0.02, "rent_growth_delta": -0.015, "vacancy_delta": 0.03},
    "base": {"apprec_delta": 0.0,   "rent_growth_delta": 0.0,   "vacancy_delta": 0.0},
    "bull": {"apprec_delta": 0.02,  "rent_growth_delta": 0.015, "vacancy_delta": -0.02},
}


# ---------------------------------------------------------------------------
# Mortgage math
# ---------------------------------------------------------------------------

def _monthly_mortgage_payment(principal: float, annual_rate_pct: float, years: int = 30) -> float:
    """Standard amortization formula: monthly P&I payment."""
    if annual_rate_pct <= 0:
        return principal / (years * 12)
    r = (annual_rate_pct / 100) / 12
    n = years * 12
    return principal * (r * (1 + r) ** n) / ((1 + r) ** n - 1)


def _annual_depreciation(price: float) -> float:
    """Straight-line residential depreciation on improvements (land excluded)."""
    improvements = price * (1 - LAND_VALUE_PCT_OF_PRICE)
    return improvements / DEPRECIATION_YEARS_RESIDENTIAL


def _compute_year_one_interest(loan: float, annual_rate: float, years: int = 30) -> float:
    """Exact year-1 mortgage interest via month-by-month amortization."""
    if annual_rate <= 0 or loan <= 0:
        return 0.0
    monthly_rate = annual_rate / 12
    n = years * 12
    monthly_payment = loan * (monthly_rate * (1 + monthly_rate) ** n) / ((1 + monthly_rate) ** n - 1)
    balance = loan
    total_interest = 0.0
    for _ in range(12):
        interest = balance * monthly_rate
        total_interest += interest
        balance -= (monthly_payment - interest)
    return total_interest


def _compute_rate_sensitivity(loan_amount: float, base_rate_pct: float) -> dict[int, float]:
    """Compute monthly P&I across ±200 bps for rate risk visibility."""
    sensitivity: dict[int, float] = {}
    for delta_bps in (-200, -100, 0, 100, 200):
        rate = base_rate_pct + delta_bps / 100
        if rate <= 0:
            sensitivity[delta_bps] = round(loan_amount / 360, 2)
        else:
            sensitivity[delta_bps] = round(_monthly_mortgage_payment(loan_amount, rate), 2)
    return sensitivity


def _compute_universal_metrics(
    listing: PropertyListing,
    market: MarketSnapshot,
    comps: CompAnalysis,
    down_pct: float = 20.0,
    ai_assumptions: AIAssumptions | None = None,
) -> UniversalMetrics:
    """Calculate metrics that apply to all investment strategies."""
    mortgage_rate = market.economic_indicators.mortgage_rate_30yr or 7.0
    down_payment = listing.list_price * (down_pct / 100)
    loan_amount = listing.list_price - down_payment

    monthly_mortgage = _monthly_mortgage_payment(loan_amount, mortgage_rate)

    # §1 PMI for sub-20% down (LTV > 80%)
    ltv = loan_amount / listing.list_price if listing.list_price > 0 else 0
    if ltv > 0.80:
        pmi_monthly = loan_amount * PMI_ANNUAL_PCT_OF_LOAN / 12
    else:
        pmi_monthly = 0.0

    # Property tax
    if listing.tax_annual:
        tax_monthly = listing.tax_annual / 12
    else:
        tax_monthly = listing.list_price * 0.011 / 12

    # Insurance: prefer AI-estimated monthly premium, else ~0.55% of value annually
    if ai_assumptions and ai_assumptions.insurance_premium_monthly is not None:
        insurance_monthly = float(ai_assumptions.insurance_premium_monthly)
    else:
        insurance_monthly = listing.list_price * 0.0055 / 12

    hoa_monthly = listing.hoa_monthly or 0

    total_monthly = monthly_mortgage + tax_monthly + insurance_monthly + hoa_monthly + pmi_monthly

    # §2 Closing costs
    closing_costs = listing.list_price * CLOSING_COST_PCT_OF_PRICE

    # Market value from comps
    estimated_value = comps.adjusted_value_mid or listing.list_price
    price_vs_market = ((listing.list_price - estimated_value) / estimated_value) * 100 if estimated_value else None

    # §7 Area median $/sqft — prefer real data; fall back only if missing
    area_median_ppsf = market.economic_indicators.median_price_per_sqft
    if area_median_ppsf is None and market.economic_indicators.median_home_value:
        # Legacy fallback: assumes 1500 sqft typical home size.
        area_median_ppsf = round(market.economic_indicators.median_home_value / 1500, 2)

    # §15 Rate sensitivity table
    rate_sensitivity = _compute_rate_sensitivity(loan_amount, mortgage_rate)

    return UniversalMetrics(
        estimated_market_value=estimated_value,
        price_vs_market_pct=round(price_vs_market, 1) if price_vs_market is not None else None,
        price_per_sqft=listing.price_per_sqft,
        area_median_price_per_sqft=area_median_ppsf,
        property_tax_monthly=round(tax_monthly, 2),
        insurance_estimate_monthly=round(insurance_monthly, 2),
        monthly_mortgage_payment=round(monthly_mortgage, 2),
        total_monthly_cost=round(total_monthly, 2),
        down_payment_amount=round(down_payment, 2),
        loan_amount=round(loan_amount, 2),
        pmi_monthly=round(pmi_monthly, 2),
        closing_costs=round(closing_costs, 2),
        rate_sensitivity=rate_sensitivity,
    )


# ---------------------------------------------------------------------------
# Rental Income analysis
# ---------------------------------------------------------------------------

def _compute_rental_metrics(
    listing: PropertyListing,
    universal: UniversalMetrics,
    market: MarketSnapshot,
    ai_assumptions: AIAssumptions | None = None,
) -> RentalMetrics:
    """Compute cash flow, cap rate, GRM, DSCR, and other rental metrics."""
    # Prefer AI-estimated rent; fall back to market-derived estimate
    if ai_assumptions and ai_assumptions.expected_monthly_rent:
        estimated_rent = int(ai_assumptions.expected_monthly_rent)
    else:
        rm = market.rental_market
        rent_map = {1: rm.median_rent_1br, 2: rm.median_rent_2br, 3: rm.median_rent_3br, 4: rm.median_rent_4br}
        beds_key = min(listing.bedrooms, 4)
        estimated_rent = rent_map.get(beds_key) or 1500
        estimated_rent = estimated_rent or 1500

        if listing.sqft > 2000:
            estimated_rent = int(estimated_rent * 1.15)
        elif listing.sqft < 800:
            estimated_rent = int(estimated_rent * 0.85)

    price = listing.list_price

    # Vacancy rate: AI override > market > default 6%
    if ai_assumptions and ai_assumptions.vacancy_rate_pct is not None:
        vacancy_rate = ai_assumptions.vacancy_rate_pct / 100
    else:
        vacancy_rate = (market.rental_market.vacancy_rate_pct or 6.0) / 100
    vacancy_loss = estimated_rent * vacancy_rate
    effective_gross_rent = estimated_rent - vacancy_loss

    # §3 Split maintenance and capex
    if ai_assumptions and ai_assumptions.maintenance_reserve_pct is not None:
        maintenance_monthly = price * (ai_assumptions.maintenance_reserve_pct / 100) / 12
    else:
        maintenance_monthly = price * DEFAULT_MAINTENANCE_PCT / 12

    if ai_assumptions and ai_assumptions.capex_reserve_pct is not None:
        capex_monthly = price * (ai_assumptions.capex_reserve_pct / 100) / 12
    else:
        capex_monthly = price * DEFAULT_CAPEX_PCT / 12

    # §11 Property management on effective gross rent, not gross rent
    if ai_assumptions and ai_assumptions.property_manager_fee_pct is not None:
        pm_fee_pct = ai_assumptions.property_manager_fee_pct / 100
    else:
        pm_fee_pct = DEFAULT_PM_FEE_PCT
    mgmt_fee = effective_gross_rent * pm_fee_pct

    # §12 Turnover / leasing commission amortized monthly
    turnover_cost_per_event = estimated_rent * (TURNOVER_VACANCY_MONTHS + LEASING_COMMISSION_MONTHS)
    turnover_monthly = turnover_cost_per_event / AVG_TENANCY_MONTHS

    hoa = listing.hoa_monthly or 0

    monthly_expenses = (
        universal.property_tax_monthly
        + universal.insurance_estimate_monthly
        + hoa
        + maintenance_monthly
        + capex_monthly
        + mgmt_fee
        + turnover_monthly
    )

    noi_monthly = effective_gross_rent - monthly_expenses
    noi_annual = noi_monthly * 12

    cap_rate = (noi_annual / price) * 100 if price > 0 else None

    monthly_cash_flow = noi_monthly - universal.monthly_mortgage_payment - universal.pmi_monthly

    # §2 Closing costs in CoC denominator
    down = universal.down_payment_amount
    total_cash_invested = down + universal.closing_costs
    annual_cash_flow = monthly_cash_flow * 12
    coc_return = (annual_cash_flow / total_cash_invested) * 100 if total_cash_invested > 0 else None

    grm = price / (estimated_rent * 12) if estimated_rent > 0 else None

    annual_debt_service = (universal.monthly_mortgage_payment + universal.pmi_monthly) * 12
    dscr = noi_annual / annual_debt_service if annual_debt_service > 0 else None

    # §13 Break-even occupancy — mgmt fee is variable, exclude from fixed
    fixed_monthly = (
        universal.monthly_mortgage_payment
        + universal.pmi_monthly
        + universal.property_tax_monthly
        + universal.insurance_estimate_monthly
        + hoa
        + maintenance_monthly
        + capex_monthly
        + turnover_monthly
    )
    if estimated_rent > 0:
        denom = estimated_rent * (1 - pm_fee_pct)
        beo = (fixed_monthly / denom) * 100 if denom > 0 else None
    else:
        beo = None

    # §6 Rent-to-price: store true ratio in `rent_to_price_ratio`, pct in sibling
    rent_to_price = estimated_rent / price if price > 0 else None
    rent_to_price_pct = rent_to_price * 100 if rent_to_price is not None else None

    # §8 Tax impact (simplified; see module docstring caveat)
    mortgage_rate = (market.economic_indicators.mortgage_rate_30yr or 7.0) / 100
    # Year-1 interest from proper amortization schedule (not the simplified loan*rate)
    year_one_interest = _compute_year_one_interest(universal.loan_amount, mortgage_rate)
    depreciation = _annual_depreciation(price)
    taxable_income_y1 = noi_annual - year_one_interest - depreciation
    tax_impact_annual = taxable_income_y1 * FEDERAL_MARGINAL_TAX_RATE
    after_tax_cash_flow_annual = annual_cash_flow - tax_impact_annual

    # §14 Scenarios on rent-income outputs
    base_vacancy = vacancy_rate
    scenario_map: dict[str, dict[str, float]] = {}
    for name, deltas in SCENARIOS.items():
        scen_vacancy = max(0.0, base_vacancy + deltas["vacancy_delta"])
        scen_effective_gross = estimated_rent * (1 - scen_vacancy)
        scen_mgmt = scen_effective_gross * pm_fee_pct
        scen_expenses = (
            universal.property_tax_monthly
            + universal.insurance_estimate_monthly
            + hoa
            + maintenance_monthly
            + capex_monthly
            + scen_mgmt
            + turnover_monthly
        )
        scen_noi_m = scen_effective_gross - scen_expenses
        scen_noi_annual = scen_noi_m * 12
        scen_cf_m = scen_noi_m - universal.monthly_mortgage_payment - universal.pmi_monthly
        scen_cap = (scen_noi_annual / price) * 100 if price > 0 else None
        scen_coc = ((scen_cf_m * 12) / total_cash_invested) * 100 if total_cash_invested > 0 else None
        scenario_map[name] = {
            "monthly_cash_flow": round(scen_cf_m, 2),
            "cap_rate_pct": round(scen_cap, 2) if scen_cap is not None else None,
            "cash_on_cash_return_pct": round(scen_coc, 2) if scen_coc is not None else None,
            "vacancy_rate_pct": round(scen_vacancy * 100, 2),
        }

    return RentalMetrics(
        estimated_monthly_rent=estimated_rent,
        gross_rent_multiplier=round(grm, 1) if grm else None,
        cap_rate_pct=round(cap_rate, 2) if cap_rate else None,
        cash_on_cash_return_pct=round(coc_return, 2) if coc_return else None,
        monthly_cash_flow=round(monthly_cash_flow, 2),
        vacancy_rate_pct=vacancy_rate * 100,
        maintenance_monthly=round(maintenance_monthly, 2),
        property_management_monthly=round(mgmt_fee, 2),
        dscr=round(dscr, 2) if dscr else None,
        break_even_occupancy_pct=round(beo, 1) if beo else None,
        rent_to_price_ratio=round(rent_to_price, 5) if rent_to_price is not None else None,
        rent_to_price_ratio_pct=round(rent_to_price_pct, 2) if rent_to_price_pct is not None else None,
        capex_reserve_monthly=round(capex_monthly, 2),
        turnover_reserve_monthly=round(turnover_monthly, 2),
        annual_depreciation=round(depreciation, 2),
        taxable_income_year_one=round(taxable_income_y1, 2),
        after_tax_cash_flow_annual=round(after_tax_cash_flow_annual, 2),
        scenarios=scenario_map,
    )


# ---------------------------------------------------------------------------
# Long-Term Hold analysis
# ---------------------------------------------------------------------------

def _compute_long_term_metrics(
    listing: PropertyListing,
    universal: UniversalMetrics,
    market: MarketSnapshot,
    ai_assumptions: AIAssumptions | None = None,
    rental: RentalMetrics | None = None,
) -> LongTermMetrics:
    """Compute 5/10-year appreciation, equity, and ROI projections."""
    # Allow AI override of appreciation rate
    if ai_assumptions and ai_assumptions.expected_appreciation_pct is not None:
        base_rate = ai_assumptions.expected_appreciation_pct / 100
    else:
        base_rate = (market.price_trends.yoy_appreciation_pct or 4.5) / 100
    price = listing.list_price
    down = universal.down_payment_amount

    # Property-level appreciation modifier
    pvm = universal.price_vs_market_pct or 0.0
    price_adj = max(-0.008, min(0.008, -pvm / 100 * 0.08))

    year_built = listing.year_built or 1990
    age = datetime.now().year - year_built
    # Penalise age — no upside for new builds, escalating drag for old ones.
    # age=10 → 0, age=30 → 0, age=50 → -0.004, age=80 → -0.01 (capped)
    age_adj = max(-0.01, min(0.0, (30 - age) / 100 * 0.02))

    dom = listing.days_on_market or 30
    if dom < 14:
        dom_adj = 0.002
    elif dom > 90:
        dom_adj = -0.003
    else:
        dom_adj = 0.0

    annual_rate = max(0.005, base_rate + price_adj + age_adj + dom_adj)

    projected_5yr = int(price * (1 + annual_rate) ** 5)
    projected_10yr = int(price * (1 + annual_rate) ** 10)

    appreciation_5yr_pct = round(((projected_5yr - price) / price) * 100, 1)
    appreciation_10yr_pct = round(((projected_10yr - price) / price) * 100, 1)

    # Principal paydown (30yr mortgage)
    mortgage_rate = (market.economic_indicators.mortgage_rate_30yr or 7.0) / 100
    monthly_r = mortgage_rate / 12
    loan = universal.loan_amount
    monthly_pmt = universal.monthly_mortgage_payment

    def remaining_balance(months_paid: int) -> float:
        if monthly_r == 0:
            return loan - monthly_pmt * months_paid
        return loan * (1 + monthly_r) ** months_paid - monthly_pmt * ((1 + monthly_r) ** months_paid - 1) / monthly_r

    principal_5yr = loan - remaining_balance(60)
    principal_10yr = loan - remaining_balance(120)

    # Gross projected equity (legacy): appreciation + paydown + down payment back
    equity_5yr = int((projected_5yr - price) + principal_5yr + down)
    equity_10yr = int((projected_10yr - price) + principal_10yr + down)

    # §2 Total invested includes closing costs
    total_invested = down + universal.closing_costs
    roi_5yr = round(((equity_5yr - total_invested) / total_invested) * 100, 1) if total_invested > 0 else None
    roi_10yr = round(((equity_10yr - total_invested) / total_invested) * 100, 1) if total_invested > 0 else None

    if total_invested > 0 and equity_10yr > 0:
        annualized = round((((equity_10yr / total_invested) ** (1 / 10)) - 1) * 100, 1)
    else:
        annualized = None

    # §10 Net equity after selling costs
    remaining_5yr = remaining_balance(60)
    remaining_10yr = remaining_balance(120)
    net_equity_5yr = int(projected_5yr * (1 - SELLING_COST_PCT) - remaining_5yr)
    net_equity_10yr = int(projected_10yr * (1 - SELLING_COST_PCT) - remaining_10yr)

    # §8 After-tax net equity (capital gains + depreciation recapture if rental)
    gain_5yr = max(0, projected_5yr - price)
    gain_10yr = max(0, projected_10yr - price)
    cap_gains_tax_5yr = gain_5yr * LT_CAPITAL_GAINS_RATE
    cap_gains_tax_10yr = gain_10yr * LT_CAPITAL_GAINS_RATE

    if rental is not None:
        cum_depreciation_5yr = _annual_depreciation(price) * 5
        cum_depreciation_10yr = _annual_depreciation(price) * 10
        recapture_5yr = cum_depreciation_5yr * DEPRECIATION_RECAPTURE_RATE
        recapture_10yr = cum_depreciation_10yr * DEPRECIATION_RECAPTURE_RATE
    else:
        recapture_5yr = 0.0
        recapture_10yr = 0.0

    net_after_tax_5yr = int(net_equity_5yr - cap_gains_tax_5yr - recapture_5yr)
    net_after_tax_10yr = int(net_equity_10yr - cap_gains_tax_10yr - recapture_10yr)

    # §9 Projected annual cashflows (rental-only; flat zeros otherwise)
    projected_cashflows: list[float] = []
    cumulative_5yr = None
    cumulative_10yr = None
    if rental is not None and rental.estimated_monthly_rent:
        if ai_assumptions and ai_assumptions.rent_growth_pct is not None:
            rent_growth = ai_assumptions.rent_growth_pct / 100
        else:
            rent_growth = (
                market.rental_market.rent_growth_yoy_pct / 100
                if market.rental_market.rent_growth_yoy_pct is not None
                else DEFAULT_RENT_GROWTH_PCT
            )
        tax_y1 = universal.property_tax_monthly * 12
        ins_y1 = universal.insurance_estimate_monthly * 12
        rent_y1 = rental.estimated_monthly_rent * 12
        vacancy_rate = (rental.vacancy_rate_pct or 6.0) / 100

        hoa_annual = (listing.hoa_monthly or 0) * 12
        maintenance_y1 = (rental.maintenance_monthly or 0) * 12
        capex_y1 = (rental.capex_reserve_monthly or 0) * 12
        turnover_y1 = (rental.turnover_reserve_monthly or 0) * 12
        pm_fee_pct = (
            (ai_assumptions.property_manager_fee_pct / 100)
            if (ai_assumptions and ai_assumptions.property_manager_fee_pct is not None)
            else DEFAULT_PM_FEE_PCT
        )
        debt_service_y = (universal.monthly_mortgage_payment + universal.pmi_monthly) * 12

        cumulative = 0.0
        for year in range(1, 11):
            rent_y = rent_y1 * (1 + rent_growth) ** (year - 1)
            egr_y = rent_y * (1 - vacancy_rate)
            mgmt_y = egr_y * pm_fee_pct
            tax_y = tax_y1 * (1 + DEFAULT_TAX_REASSESSMENT_PCT) ** (year - 1)
            ins_y = ins_y1 * (1 + DEFAULT_EXPENSE_INFLATION_PCT) ** (year - 1)
            maint_y = maintenance_y1 * (1 + DEFAULT_EXPENSE_INFLATION_PCT) ** (year - 1)
            capex_yr = capex_y1 * (1 + DEFAULT_EXPENSE_INFLATION_PCT) ** (year - 1)
            turn_y = turnover_y1 * (1 + rent_growth) ** (year - 1)
            hoa_y = hoa_annual * (1 + DEFAULT_EXPENSE_INFLATION_PCT) ** (year - 1)
            expenses_y = tax_y + ins_y + maint_y + capex_yr + mgmt_y + turn_y + hoa_y
            cash_flow_y = egr_y - expenses_y - debt_service_y
            projected_cashflows.append(round(cash_flow_y, 2))
            cumulative += cash_flow_y
            if year == 5:
                cumulative_5yr = round(cumulative, 2)
            if year == 10:
                cumulative_10yr = round(cumulative, 2)

    # §16 Neighborhood growth score — bounded [0, 100] with intuitive components
    pop_growth = market.demographics.population_growth_pct or 1.0
    income = market.demographics.median_household_income or 60000
    unemployment = market.demographics.unemployment_rate_pct or 5.0
    pop_component = min(max(pop_growth / 2.0, 0.0), 1.0) * 35
    apprec_component = min(max(annual_rate / 0.06, 0.0), 1.0) * 35
    income_component = min(max(income / 100_000, 0.0), 1.0) * 20
    unemp_component = min(max((5 - unemployment) / 5, 0.0), 1.0) * 10
    growth_score = pop_component + apprec_component + income_component + unemp_component

    # §14 Scenarios
    scenario_map: dict[str, dict[str, float]] = {}
    for name, deltas in SCENARIOS.items():
        scen_rate = max(0.005, annual_rate + deltas["apprec_delta"])
        scen_val_5yr = int(price * (1 + scen_rate) ** 5)
        scen_val_10yr = int(price * (1 + scen_rate) ** 10)
        scen_equity_10yr = int((scen_val_10yr - price) + principal_10yr + down)
        scen_net_10yr = int(scen_val_10yr * (1 - SELLING_COST_PCT) - remaining_10yr)
        scen_roi_10yr = (
            round(((scen_equity_10yr - total_invested) / total_invested) * 100, 1)
            if total_invested > 0
            else None
        )
        scenario_map[name] = {
            "projected_value_5yr": scen_val_5yr,
            "projected_value_10yr": scen_val_10yr,
            "roi_10yr_pct": scen_roi_10yr,
            "net_equity_10yr": scen_net_10yr,
        }

    return LongTermMetrics(
        appreciation_5yr_pct=appreciation_5yr_pct,
        appreciation_10yr_pct=appreciation_10yr_pct,
        projected_value_5yr=projected_5yr,
        projected_value_10yr=projected_10yr,
        projected_equity_5yr=equity_5yr,
        projected_equity_10yr=equity_10yr,
        total_roi_5yr_pct=roi_5yr,
        total_roi_10yr_pct=roi_10yr,
        annualized_return_pct=annualized,
        neighborhood_growth_score=round(growth_score, 1),
        school_district_rating=None,
        net_equity_5yr=net_equity_5yr,
        net_equity_10yr=net_equity_10yr,
        net_equity_after_tax_5yr=net_after_tax_5yr,
        net_equity_after_tax_10yr=net_after_tax_10yr,
        projected_annual_cashflows=projected_cashflows,
        cumulative_cashflow_5yr=cumulative_5yr,
        cumulative_cashflow_10yr=cumulative_10yr,
        scenarios=scenario_map,
    )


# ---------------------------------------------------------------------------
# Fix & Flip analysis
# ---------------------------------------------------------------------------

def _compute_flip_metrics(
    listing: PropertyListing,
    universal: UniversalMetrics,
    market: MarketSnapshot,
    comps: CompAnalysis,
    ai_assumptions: AIAssumptions | None = None,
) -> FlipMetrics:
    """Compute ARV, MAO, rehab cost, and profit for a fix-and-flip strategy.

    Uses hard-money financing (interest-only, with points), not a conventional
    30-yr mortgage, reflecting how flippers actually finance deals.
    """
    price = listing.list_price
    sqft = listing.sqft

    # ARV: AI override > top comp + 12% premium
    if ai_assumptions and ai_assumptions.arv_estimate:
        arv = int(ai_assumptions.arv_estimate)
    else:
        arv_base = comps.adjusted_value_high or price
        arv = int(arv_base * 1.12)

    # Scope still inferred from age / gap
    year_built = listing.year_built or 1990
    age = datetime.now().year - year_built
    price_vs_arv_gap_pct = ((arv - price) / arv * 100) if arv > 0 else 0

    # §5 Updated rehab $/sqft, with optional HCOL scaling
    if age > 50 or price_vs_arv_gap_pct > 30:
        scope = "Full Gut"
        rehab_ppsf = REHAB_COST_FULL_GUT_PER_SQFT
    elif age > 30 or price_vs_arv_gap_pct > 15:
        scope = "Moderate"
        rehab_ppsf = REHAB_COST_MODERATE_PER_SQFT
    else:
        scope = "Cosmetic"
        rehab_ppsf = REHAB_COST_COSMETIC_PER_SQFT

    # HCOL scaling (§5 optional improvement) — guarded within [0.75, 1.5]
    median_income = market.demographics.median_household_income
    if median_income:
        col_factor = max(0.75, min(1.5, median_income / 70000))
        rehab_ppsf *= col_factor

    # Rehab cost: AI override > sqft × per-sqft heuristic
    if ai_assumptions and ai_assumptions.estimated_rehab_cost:
        rehab_cost = int(ai_assumptions.estimated_rehab_cost)
        if sqft > 0:
            rehab_ppsf = round(rehab_cost / sqft, 1)
    else:
        rehab_cost = int(sqft * rehab_ppsf)

    # §4 Hard-money financing
    basis = price + rehab_cost
    flip_loan = basis * HARD_MONEY_LTC_PCT
    flip_down = basis - flip_loan  # flipper's cash in purchase+rehab
    monthly_interest = flip_loan * (HARD_MONEY_RATE_PCT / 100) / 12
    origination_fee = flip_loan * (HARD_MONEY_POINTS_PCT / 100)

    # §17 Holding cost breakdown
    if ai_assumptions and ai_assumptions.utilities_during_rehab_monthly is not None:
        utilities_monthly = float(ai_assumptions.utilities_during_rehab_monthly)
    else:
        utilities_monthly = UTILITIES_DURING_REHAB_MONTHLY
    hoa_monthly = listing.hoa_monthly or 0

    holding_monthly = (
        monthly_interest
        + universal.property_tax_monthly
        + universal.insurance_estimate_monthly
        + hoa_monthly
        + utilities_monthly
    )

    # Holding months: AI override > scope-based
    if ai_assumptions and ai_assumptions.holding_months is not None:
        holding_months = int(ai_assumptions.holding_months)
    else:
        holding_months = 5 if scope == "Full Gut" else (4 if scope == "Moderate" else 3)

    total_holding = holding_monthly * holding_months
    total_interest_paid = int(monthly_interest * holding_months)
    property_tax_during_hold = int(universal.property_tax_monthly * holding_months)
    insurance_during_hold = int(universal.insurance_estimate_monthly * holding_months)
    utilities_during_hold = int(utilities_monthly * holding_months)
    total_holding_costs = int(total_holding)

    # MAO (70% rule)
    mao = int(arv * 0.70 - rehab_cost)

    # Selling costs: 8% of ARV
    selling_costs = int(arv * 0.08)

    # §4 Profit now also subtracts origination
    potential_profit = int(
        arv - price - rehab_cost - total_holding - selling_costs - origination_fee
    )

    # §8 After-tax profit (dealer treatment: ordinary + SE tax)
    flip_tax_rate = FEDERAL_MARGINAL_TAX_RATE + SELF_EMPLOYMENT_TAX_RATE
    if potential_profit > 0:
        after_tax_profit = int(potential_profit * (1 - flip_tax_rate))
    else:
        after_tax_profit = int(potential_profit)

    # §2 Total investment = down + closing + rehab + holding + origination
    total_investment = (
        universal.down_payment_amount
        + universal.closing_costs
        + rehab_cost
        + total_holding
        + origination_fee
    )
    roi_pct = (potential_profit / total_investment) * 100 if total_investment > 0 else None

    if price <= mao:
        deal_score = "Strong Deal" if price < mao * 0.90 else "Good Deal"
    elif price <= mao * 1.10:
        deal_score = "Marginal"
    else:
        deal_score = "Overpriced for Flip"

    return FlipMetrics(
        arv=arv,
        estimated_rehab_cost=rehab_cost,
        rehab_scope=scope,
        rehab_cost_per_sqft=round(rehab_ppsf, 1),
        mao=mao,
        potential_profit=potential_profit,
        roi_pct=round(roi_pct, 1) if roi_pct else None,
        holding_cost_monthly=round(holding_monthly, 2),
        holding_months=holding_months,
        selling_costs=selling_costs,
        deal_score=deal_score,
        financing_rate_pct=HARD_MONEY_RATE_PCT,
        origination_fee=int(origination_fee),
        down_payment_flip=int(flip_down),
        utilities_during_rehab=int(utilities_monthly),
        total_interest_paid=total_interest_paid,
        property_tax_during_hold=property_tax_during_hold,
        insurance_during_hold=insurance_during_hold,
        total_holding_costs=total_holding_costs,
        after_tax_profit=after_tax_profit,
    )


# ---------------------------------------------------------------------------
# House Hack analysis
# ---------------------------------------------------------------------------

def _infer_house_hack_units(listing: PropertyListing, ai_override: int | None) -> int:
    """Return the number of rentable units/rooms for a house hack scenario."""
    if ai_override:
        return max(1, ai_override)
    prop = (listing.property_type or "").lower()
    if "quadplex" in prop or "4-unit" in prop or "fourplex" in prop:
        return 3
    if "triplex" in prop or "3-unit" in prop:
        return 2
    if "duplex" in prop or "2-unit" in prop:
        return 1
    # Single-family: rent spare bedrooms
    beds = listing.bedrooms or 2
    if beds >= 5:
        return 3
    if beds >= 3:
        return 2
    return 1


def _compute_house_hack_metrics(
    listing: PropertyListing,
    universal: UniversalMetrics,
    market: MarketSnapshot,
    ai_assumptions: AIAssumptions | None = None,
) -> HouseHackMetrics:
    """House hack: owner-occupies one unit/room, rents the rest to offset mortgage."""
    price = listing.list_price
    rm = market.rental_market

    ai_override_units = ai_assumptions.house_hack_rental_units if ai_assumptions else None
    rental_units = _infer_house_hack_units(listing, ai_override_units)

    prop = (listing.property_type or "").lower()
    is_multi_unit = any(x in prop for x in ("duplex", "triplex", "quadplex", "multi", "2-unit", "3-unit", "4-unit", "fourplex"))

    if is_multi_unit:
        # Rent each unit at market 2BR rate
        unit_rent = ai_assumptions.expected_monthly_rent if (ai_assumptions and ai_assumptions.expected_monthly_rent) else (rm.median_rent_2br or 1500)
        total_rental_income = int(unit_rent * rental_units)
    else:
        # Room-by-room rental at 65% of market 1BR rate
        room_rent = int((rm.median_rent_1br or rm.median_rent_2br or 1200) * HOUSE_HACK_ROOM_RENT_FACTOR)
        if ai_assumptions and ai_assumptions.expected_monthly_rent:
            room_rent = ai_assumptions.expected_monthly_rent // max(rental_units, 1)
        total_rental_income = room_rent * rental_units

    # Maintenance & CapEx
    maint_pct = (ai_assumptions.maintenance_reserve_pct / 100) if (ai_assumptions and ai_assumptions.maintenance_reserve_pct) else DEFAULT_MAINTENANCE_PCT
    capex_pct = (ai_assumptions.capex_reserve_pct / 100) if (ai_assumptions and ai_assumptions.capex_reserve_pct) else DEFAULT_CAPEX_PCT
    maintenance_monthly = price * maint_pct / 12
    capex_monthly = price * capex_pct / 12
    hoa = listing.hoa_monthly or 0

    total_monthly_expenses = (
        universal.monthly_mortgage_payment
        + universal.pmi_monthly
        + universal.property_tax_monthly
        + universal.insurance_estimate_monthly
        + hoa
        + maintenance_monthly
        + capex_monthly
    )

    # Owner's net housing cost after tenant income
    owner_net_cost = total_monthly_expenses - total_rental_income

    # Mortgage offset %
    mortgage_offset = (total_rental_income / universal.monthly_mortgage_payment * 100) if universal.monthly_mortgage_payment > 0 else 0.0

    # What the owner's equivalent space would rent for in the market
    # (owner lives in remaining unit/rooms)
    beds_in_owner_unit = max(1, listing.bedrooms - rental_units)
    rent_map = {1: rm.median_rent_1br, 2: rm.median_rent_2br, 3: rm.median_rent_3br, 4: rm.median_rent_4br}
    market_rent_owner = rent_map.get(min(beds_in_owner_unit, 4)) or rm.median_rent_2br or 1500

    # Monthly savings vs renting equivalent space at market rate
    savings_vs_renting = float(market_rent_owner) - max(owner_net_cost, 0)

    # Cash-on-cash: annual rental NOI relative to total cash invested
    rental_noi_annual = (total_rental_income - (maintenance_monthly + capex_monthly + universal.property_tax_monthly + universal.insurance_estimate_monthly + hoa) * (rental_units / max(rental_units + 1, 1))) * 12
    total_cash_invested = universal.down_payment_amount + universal.closing_costs
    coc = (rental_noi_annual / total_cash_invested * 100) if total_cash_invested > 0 else None

    return HouseHackMetrics(
        rental_units=rental_units,
        total_rental_income_monthly=total_rental_income,
        owner_net_monthly_cost=round(owner_net_cost, 2),
        mortgage_offset_pct=round(mortgage_offset, 1),
        cash_on_cash_return_pct=round(coc, 2) if coc is not None else None,
        market_rent_owner_unit=int(market_rent_owner),
        monthly_savings_vs_renting=round(savings_vs_renting, 2),
        total_monthly_expenses=round(total_monthly_expenses, 2),
        maintenance_monthly=round(maintenance_monthly, 2),
        capex_monthly=round(capex_monthly, 2),
    )


# ---------------------------------------------------------------------------
# Short-Term Rental (STR / Airbnb) analysis
# ---------------------------------------------------------------------------

def _compute_str_metrics(
    listing: PropertyListing,
    universal: UniversalMetrics,
    market: MarketSnapshot,
    ai_assumptions: AIAssumptions | None = None,
) -> ShortTermRentalMetrics:
    """Estimate Airbnb-style short-term rental cash flow for a property."""
    price = listing.list_price
    rm = market.rental_market

    # Estimate long-term-rental equivalent for premium comparison
    rent_map = {1: rm.median_rent_1br, 2: rm.median_rent_2br, 3: rm.median_rent_3br, 4: rm.median_rent_4br}
    beds_key = min(listing.bedrooms or 2, 4)
    ltr_monthly = rent_map.get(beds_key) or 1500
    ltr_monthly_int = int(ltr_monthly)

    # Nightly rate: AI > multiplier of LTR daily equivalent
    if ai_assumptions and ai_assumptions.str_nightly_rate:
        nightly_rate = ai_assumptions.str_nightly_rate
    else:
        nightly_rate = int((ltr_monthly / 30) * STR_NIGHTLY_MULTIPLIER)

    # Occupancy rate
    if ai_assumptions and ai_assumptions.str_occupancy_rate_pct is not None:
        occupancy = ai_assumptions.str_occupancy_rate_pct / 100
    else:
        occupancy = STR_DEFAULT_OCCUPANCY_PCT

    nights_occupied = 30 * occupancy
    gross_monthly = round(nightly_rate * nights_occupied, 2)

    # Platform fee (e.g., Airbnb host fee)
    platform_fee = round(gross_monthly * STR_PLATFORM_FEE_PCT, 2)

    # Cleaning costs: number of turnovers × cleaning fee
    cleaning_fee = ai_assumptions.str_cleaning_fee if (ai_assumptions and ai_assumptions.str_cleaning_fee) else int(STR_CLEANING_FEE_DEFAULT)
    turnovers_per_month = nights_occupied / STR_AVG_STAY_NIGHTS
    cleaning_monthly = round(turnovers_per_month * cleaning_fee, 2)

    # Higher maintenance for STR (2% vs 1% for LTR)
    str_maintenance = round(price * STR_MAINTENANCE_PCT / 12, 2)

    # STR insurance (higher than standard homeowner's)
    str_insurance = round(universal.insurance_estimate_monthly * STR_INSURANCE_MULTIPLIER, 2)

    hoa = listing.hoa_monthly or 0
    tax_monthly = universal.property_tax_monthly

    # Net operating income
    str_expenses = platform_fee + cleaning_monthly + str_maintenance + str_insurance + tax_monthly + hoa
    noi_monthly = round(gross_monthly - str_expenses, 2)

    # Cash flow after debt service
    monthly_cf = round(noi_monthly - universal.monthly_mortgage_payment - universal.pmi_monthly, 2)
    annual_cf = round(monthly_cf * 12, 2)

    # Cap rate
    noi_annual = noi_monthly * 12
    cap_rate = round((noi_annual / price) * 100, 2) if price > 0 else None

    # Cash-on-cash
    total_cash_invested = universal.down_payment_amount + universal.closing_costs
    coc = round((annual_cf / total_cash_invested) * 100, 2) if total_cash_invested > 0 else None

    # STR premium vs LTR
    ltr_cf_approx = (ltr_monthly - tax_monthly - universal.insurance_estimate_monthly - hoa - price * DEFAULT_MAINTENANCE_PCT / 12 - universal.monthly_mortgage_payment - universal.pmi_monthly) * 12
    str_premium = round(((annual_cf - ltr_cf_approx) / abs(ltr_cf_approx)) * 100, 1) if ltr_cf_approx != 0 else None

    # Break-even occupancy: fixed costs / nightly_rate / 30
    fixed_monthly = str_maintenance + str_insurance + tax_monthly + hoa + universal.monthly_mortgage_payment + universal.pmi_monthly
    if nightly_rate > 0:
        beo_pct = round((fixed_monthly / (nightly_rate * 30)) * 100, 1)
    else:
        beo_pct = None

    return ShortTermRentalMetrics(
        estimated_nightly_rate=nightly_rate,
        occupancy_rate_pct=round(occupancy * 100, 1),
        gross_monthly_revenue=gross_monthly,
        platform_fee_monthly=platform_fee,
        cleaning_costs_monthly=cleaning_monthly,
        str_maintenance_monthly=str_maintenance,
        net_operating_income_monthly=noi_monthly,
        monthly_cash_flow=monthly_cf,
        annual_cash_flow=annual_cf,
        cap_rate_pct=cap_rate,
        cash_on_cash_return_pct=coc,
        str_vs_ltr_premium_pct=str_premium,
        break_even_occupancy_pct=beo_pct,
        ltr_monthly_comparison=ltr_monthly_int,
    )


# ---------------------------------------------------------------------------
# Risk factor generation
# ---------------------------------------------------------------------------

def _compute_risk_factors(
    listing: PropertyListing,
    universal: UniversalMetrics,
    market: MarketSnapshot,
    comps: CompAnalysis,
    rental: RentalMetrics | None,
    flip: FlipMetrics | None,
    goal: InvestmentGoal,
    house_hack: HouseHackMetrics | None = None,
    str_metrics: ShortTermRentalMetrics | None = None,
) -> list[RiskFactor]:
    risks: list[RiskFactor] = []

    # Price vs comps
    pvc = comps.price_vs_comps_pct
    if pvc and pvc > 10:
        risks.append(RiskFactor(
            type="warning",
            message=f"Property is priced {pvc:.1f}% above comparable average — may be overpriced.",
            severity=0.7,
        ))
    elif pvc and pvc < -8:
        risks.append(RiskFactor(
            type="positive",
            message=f"Property is priced {abs(pvc):.1f}% below comparable average — potential value opportunity.",
            severity=0.2,
        ))

    # HOA impact
    if listing.hoa_monthly and listing.hoa_monthly > 400:
        risks.append(RiskFactor(
            type="warning",
            message=f"High HOA (${listing.hoa_monthly:,}/mo) significantly impacts cash flow.",
            severity=0.6,
        ))

    # Old property
    if listing.year_built and listing.year_built < 1970:
        risks.append(RiskFactor(
            type="warning",
            message=f"Property built in {listing.year_built} — may require major systems updates (roof, HVAC, plumbing).",
            severity=0.5,
        ))

    # Days on market
    if listing.days_on_market and listing.days_on_market > 90:
        risks.append(RiskFactor(
            type="warning",
            message=f"Long time on market ({listing.days_on_market} days) — investigate why it hasn't sold.",
            severity=0.5,
        ))
    elif listing.days_on_market and listing.days_on_market < 7:
        risks.append(RiskFactor(
            type="positive",
            message="Fresh listing — less competition, seller may be flexible.",
            severity=0.2,
        ))

    # Appreciation
    app_rate = market.price_trends.yoy_appreciation_pct or 0
    if app_rate > 6:
        risks.append(RiskFactor(
            type="positive",
            message=f"Area appreciation rate ({app_rate:.1f}%/yr) exceeds national average (4.5%) — strong growth market.",
            severity=0.2,
        ))
    elif app_rate < 2:
        risks.append(RiskFactor(
            type="warning",
            message=f"Low area appreciation rate ({app_rate:.1f}%/yr) — limited long-term upside.",
            severity=0.6,
        ))

    # §18 LTV > 80% (PMI required)
    ltv = universal.loan_amount / listing.list_price if listing.list_price > 0 else 0
    if ltv > 0.80 and universal.pmi_monthly > 0:
        risks.append(RiskFactor(
            type="warning",
            message=f"LTV {ltv*100:.0f}% — PMI required (${universal.pmi_monthly:,.0f}/mo), factored into payment.",
            severity=0.3,
        ))

    # §18 Insurance > 1% of price/yr
    ins_annual = universal.insurance_estimate_monthly * 12
    if listing.list_price > 0 and ins_annual / listing.list_price > 0.01:
        risks.append(RiskFactor(
            type="warning",
            message=f"Insurance cost ${ins_annual:,.0f}/yr is abnormally high (>1% of price) — verify quotes.",
            severity=0.65,
        ))

    # Rental-specific risks
    if goal == InvestmentGoal.RENTAL and rental:
        # §6 Use pct version for readable thresholds
        rtp_pct = rental.rent_to_price_ratio_pct or 0
        if rtp_pct >= 1.0:
            risks.append(RiskFactor(
                type="positive",
                message=f"Rent-to-price ratio ({rtp_pct:.2f}%) meets the 1% rule — strong rental potential.",
                severity=0.1,
            ))
        elif rtp_pct >= 0.7:
            risks.append(RiskFactor(
                type="positive",
                message=f"Rent-to-price ratio ({rtp_pct:.2f}%) indicates acceptable rental potential.",
                severity=0.2,
            ))
        elif rtp_pct < 0.5:
            risks.append(RiskFactor(
                type="warning",
                message=f"Low rent-to-price ratio ({rtp_pct:.2f}%) — cash flow will be tight.",
                severity=0.7,
            ))

        if rental.monthly_cash_flow is not None and rental.monthly_cash_flow < 0:
            risks.append(RiskFactor(
                type="warning",
                message=f"Negative monthly cash flow (${rental.monthly_cash_flow:,.0f}) — property requires subsidy.",
                severity=0.9,
            ))

        # §18 Negative after-tax cash flow
        if rental.after_tax_cash_flow_annual is not None and rental.after_tax_cash_flow_annual < 0:
            risks.append(RiskFactor(
                type="warning",
                message=f"Negative after-tax cash flow (${rental.after_tax_cash_flow_annual:,.0f}/yr) — tax shield not enough to offset losses.",
                severity=0.85,
            ))

        # §18 DSCR < 1.2
        if rental.dscr is not None and rental.dscr < 1.2:
            risks.append(RiskFactor(
                type="warning",
                message=f"DSCR {rental.dscr:.2f} below 1.2 — lender-unfriendly, expect rate add-on or larger down payment.",
                severity=0.7,
            ))

    # Flip-specific
    if goal == InvestmentGoal.FIX_AND_FLIP and flip:
        if flip.deal_score in ("Strong Deal", "Good Deal"):
            risks.append(RiskFactor(
                type="positive",
                message=f"Purchase price is below MAO ({flip.deal_score}) — strong flip candidate.",
                severity=0.1,
            ))
        elif flip.deal_score == "Overpriced for Flip":
            risks.append(RiskFactor(
                type="warning",
                message="Purchase price exceeds Maximum Allowable Offer — flip profit margin is at risk.",
                severity=0.85,
            ))

        # §18 Rehab > 30% of price
        if flip.estimated_rehab_cost and listing.list_price > 0:
            rehab_ratio = flip.estimated_rehab_cost / listing.list_price
            if rehab_ratio > 0.30:
                risks.append(RiskFactor(
                    type="warning",
                    message=f"Rehab cost is {rehab_ratio*100:.0f}% of purchase price — significant execution risk.",
                    severity=0.75,
                ))

    # House hack risks
    if goal == InvestmentGoal.HOUSE_HACK and house_hack:
        if house_hack.mortgage_offset_pct and house_hack.mortgage_offset_pct >= 75:
            risks.append(RiskFactor(
                type="positive",
                message=f"Tenant income covers {house_hack.mortgage_offset_pct:.0f}% of mortgage — strong house hack.",
                severity=0.1,
            ))
        elif house_hack.mortgage_offset_pct and house_hack.mortgage_offset_pct < 40:
            risks.append(RiskFactor(
                type="warning",
                message=f"Tenant income only offsets {house_hack.mortgage_offset_pct:.0f}% of mortgage — limited benefit.",
                severity=0.6,
            ))
        if house_hack.owner_net_monthly_cost is not None and house_hack.owner_net_monthly_cost < 0:
            risks.append(RiskFactor(
                type="positive",
                message="Tenant income exceeds total monthly costs — owner gets paid to live here.",
                severity=0.05,
            ))
        if listing.bedrooms and listing.bedrooms < 3:
            risks.append(RiskFactor(
                type="warning",
                message="Few bedrooms limits room-rental income potential for house hacking.",
                severity=0.5,
            ))

    # STR risks
    if goal == InvestmentGoal.SHORT_TERM_RENTAL and str_metrics:
        risks.append(RiskFactor(
            type="warning",
            message="Verify local STR regulations — many cities restrict or ban short-term rentals.",
            severity=0.8,
        ))
        if str_metrics.monthly_cash_flow is not None and str_metrics.monthly_cash_flow < 0:
            risks.append(RiskFactor(
                type="warning",
                message=f"Negative STR cash flow (${str_metrics.monthly_cash_flow:,.0f}/mo) — high vacancy or low nightly rate.",
                severity=0.85,
            ))
        if str_metrics.cap_rate_pct and str_metrics.cap_rate_pct >= 8:
            risks.append(RiskFactor(
                type="positive",
                message=f"Strong STR cap rate ({str_metrics.cap_rate_pct:.1f}%) — well above typical long-term rental yields.",
                severity=0.1,
            ))
        if str_metrics.str_vs_ltr_premium_pct and str_metrics.str_vs_ltr_premium_pct > 50:
            risks.append(RiskFactor(
                type="positive",
                message=f"STR generates ~{str_metrics.str_vs_ltr_premium_pct:.0f}% more income than long-term rental.",
                severity=0.1,
            ))

    return risks


# ---------------------------------------------------------------------------
# Main engine
# ---------------------------------------------------------------------------

class AnalysisEngine:
    """
    Run comprehensive investment analysis on a property
    based on the user's selected investment strategy.
    """

    def analyze(
        self,
        listing: PropertyListing,
        goal: InvestmentGoal,
        market: MarketSnapshot,
        comps: CompAnalysis,
        down_pct: float = 20.0,
        ai_assumptions: AIAssumptions | None = None,
    ) -> PropertyAnalysis:
        """
        Run full analysis for all three investment strategies.
        Returns a PropertyAnalysis with goal-appropriate metrics.

        When `ai_assumptions` is provided, the engine substitutes the AI's
        property-specific rehab, rent, vacancy, maintenance, ARV, and
        insurance figures in place of the default heuristics.
        """
        universal = _compute_universal_metrics(
            listing, market, comps, down_pct, ai_assumptions=ai_assumptions
        )

        long_term: LongTermMetrics | None = None
        rental: RentalMetrics | None = None
        flip: FlipMetrics | None = None
        house_hack: HouseHackMetrics | None = None
        str_metrics: ShortTermRentalMetrics | None = None

        if goal == InvestmentGoal.LONG_TERM:
            long_term = _compute_long_term_metrics(
                listing, universal, market, ai_assumptions=ai_assumptions
            )
        elif goal == InvestmentGoal.RENTAL:
            rental = _compute_rental_metrics(listing, universal, market, ai_assumptions=ai_assumptions)
        elif goal == InvestmentGoal.FIX_AND_FLIP:
            flip = _compute_flip_metrics(listing, universal, market, comps, ai_assumptions=ai_assumptions)
        elif goal == InvestmentGoal.HOUSE_HACK:
            house_hack = _compute_house_hack_metrics(listing, universal, market, ai_assumptions=ai_assumptions)
        elif goal == InvestmentGoal.SHORT_TERM_RENTAL:
            str_metrics = _compute_str_metrics(listing, universal, market, ai_assumptions=ai_assumptions)

        risks = _compute_risk_factors(listing, universal, market, comps, rental, flip, goal, house_hack, str_metrics)

        return PropertyAnalysis(
            property_id=listing.id,
            investment_goal=goal,
            universal=universal,
            long_term=long_term,
            rental=rental,
            flip=flip,
            house_hack=house_hack,
            str_metrics=str_metrics,
            risks=risks,
        )


analysis_engine = AnalysisEngine()
