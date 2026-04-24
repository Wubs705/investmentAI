"""
Property investment scoring. Produces a 0–100 score and letter grade
using goal-weighted component scores.
"""

from datetime import datetime

from backend.models.schemas import (
    HouseHackMetrics,
    InvestmentGoal,
    InvestmentScore,
    PropertyAnalysis,
    PropertyListing,
    ShortTermRentalMetrics,
)


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def _score_long_term(
    listing: PropertyListing,
    analysis: PropertyAnalysis,
    heat_score: int = 0,
) -> dict[str, float]:
    """
    Long-term hold scoring weights (post-P4 rebalance, sum to 1.00):
        price_vs_comps:        20%   ← property-specific
        total_roi_10yr:        16%
        rental_demand_buffer:  12%
        property_condition:    12%
        appreciation_forecast: 12%
        neighborhood_growth:    8%
        market_heat:           20%   ← P4: market velocity / demographics
    Pre-P4 weights summed to 1.00; existing weights scaled by 0.80 to keep total
    at 1.00 after introducing the 20% heat component.
    """
    lt = analysis.long_term
    uni = analysis.universal
    scores: dict[str, float] = {}

    # Price vs comps: continuous curve across full range, not a hard -10% cutoff
    # -50% below = 100, -25% = 75, 0% = 50, +20% = 30, +40% = 0
    pvm = uni.price_vs_market_pct or 0
    pvc_score = _clamp(50 - pvm * 1.0, 0, 100)  # each % below market adds 1pt
    scores["price_vs_comps"] = pvc_score * 0.20

    # Annualized CAGR instead of total ROI (avoids leverage inflation)
    # 8% CAGR = 40, 12% = 60, 16% = 80, 20%+ = 100
    cagr = lt.annualized_return_pct or 0.0
    scores["total_roi_10yr"] = _clamp((cagr / 20) * 100, 0, 100) * 0.16

    # Rental demand buffer: price_per_sqft efficiency (lower $/sqft = better value)
    # Use listing.price_per_sqft: $80/sqft=100, $150/sqft=50, $220/sqft=0
    ppsf = listing.price_per_sqft or (listing.list_price / max(listing.sqft or 1000, 1))
    scores["rental_demand_buffer"] = _clamp(100 - (ppsf - 80) / 1.4, 0, 100) * 0.12

    # Property condition proxy: newer = better
    year_built = listing.year_built or 1990
    current_year = datetime.now().year
    age = current_year - year_built
    scores["property_condition"] = _clamp(100 - (age / 60) * 60, 0, 100) * 0.12

    # Appreciation forecast: 0% = 0, 3% = 37, 5% = 63, 8% = 100
    annualized = (lt.appreciation_5yr_pct / 5) if lt.appreciation_5yr_pct else 3.0
    scores["appreciation_forecast"] = _clamp((annualized / 8) * 100, 0, 100) * 0.12

    # Neighborhood growth score: already 0-100
    scores["neighborhood_growth"] = _clamp(lt.neighborhood_growth_score or 50, 0, 100) * 0.08

    scores["market_heat"] = _clamp(heat_score, 0, 100) * 0.20

    return scores


def _score_rental(
    listing: PropertyListing,
    analysis: PropertyAnalysis,
    heat_score: int = 0,
) -> dict[str, float]:
    """
    Rental income scoring weights (post-P4 rebalance, sum to 1.00):
        cash_on_cash_return:        21.25%
        cap_rate:                   17%
        rent_to_price:              17%
        vacancy_rate:                8.5%
        neighborhood_rental_demand: 12.75%
        property_condition:          8.5%
        market_heat:                15%
    """
    r = analysis.rental
    scores: dict[str, float] = {}

    # Cash-on-cash: <0% = 0, 0% = 20, 5% = 60, 10%+ = 100
    coc = r.cash_on_cash_return_pct or 0
    if coc <= 0:
        coc_score = _clamp(20 + coc * 2, 0, 100)
    else:
        coc_score = _clamp(20 + (coc / 10) * 80, 0, 100)
    scores["cash_on_cash_return"] = coc_score * 0.2125

    # Cap rate: <3% = 20, 5% = 60, 8%+ = 100
    cap = r.cap_rate_pct or 0
    scores["cap_rate"] = _clamp((cap / 8) * 100, 0, 100) * 0.17

    # Rent-to-price: <0.5% = 20, 0.7% = 60, 1%+ = 100
    rtp = r.rent_to_price_ratio or 0
    scores["rent_to_price"] = _clamp((rtp / 1.0) * 100, 0, 100) * 0.17

    # Vacancy: lower is better (6% = 70, 0% = 100, 15% = 0)
    vacancy = r.vacancy_rate_pct or 6.0
    scores["vacancy_rate"] = _clamp(100 - (vacancy / 15) * 100, 0, 100) * 0.085

    # Neighborhood rental demand: vacancy rate proxy
    # 0% vacancy → 100, 6% → 50, 12%+ → 0
    scores["neighborhood_rental_demand"] = _clamp(100 - (vacancy / 12) * 100, 0, 100) * 0.1275

    # Property condition
    year_built = listing.year_built or 1990
    current_year = datetime.now().year
    age = current_year - year_built
    scores["property_condition"] = _clamp(100 - (age / 60) * 60, 0, 100) * 0.085

    scores["market_heat"] = _clamp(heat_score, 0, 100) * 0.15

    return scores


def _score_flip(
    listing: PropertyListing,
    analysis: PropertyAnalysis,
    heat_score: int = 0,
) -> dict[str, float]:
    """
    Fix & flip scoring weights (post-P4 rebalance, sum to 1.00):
        deal_score_mao:  25.5%
        profit_margin:   21.25%
        arv_confidence:  17%
        days_on_market:   8.5%
        rehab_complexity: 12.75%
        market_heat:     15%
    """
    f = analysis.flip
    scores: dict[str, float] = {}

    # Deal score vs MAO: continuous scoring based on price vs MAO percentage
    # positive pvm = below MAO (good), negative = above MAO (bad)
    # 0% below MAO = 50, 20% below MAO = 100, 20% above MAO = 0
    mao = f.mao or 0
    price = listing.list_price
    pvm = ((mao - price) / mao * 100) if mao > 0 else 0.0
    deal_score = _clamp(50 + pvm * 2.5, 0, 100)
    scores["deal_score_mao"] = deal_score * 0.255

    # Profit margin: <0 = 0, $25k = 40, $50k = 70, $100k+ = 100
    profit = f.potential_profit or 0
    if profit <= 0:
        profit_score = 0.0
    else:
        profit_score = _clamp((profit / 100_000) * 100, 0, 100)
    scores["profit_margin"] = profit_score * 0.2125

    # ARV confidence proxy via ROI: <0% = 0, 20% = 50, 40%+ = 100
    roi = f.roi_pct or 0
    scores["arv_confidence"] = _clamp((roi / 40) * 100, 0, 100) * 0.17

    # Days on market: fresh listings = competitive price / motivated seller
    # days_on_market lives on the listing, not on FlipMetrics
    dom = listing.days_on_market
    if dom is None:
        dom_score = 50
    elif dom < 14:
        dom_score = 85  # Fresh — priced competitively or motivated seller
    elif dom < 45:
        dom_score = 65  # Normal market time
    elif dom < 90:
        dom_score = 40  # Sitting — possible issues
    else:
        dom_score = 20  # Stale listing — likely overpriced or problems
    scores["days_on_market"] = dom_score * 0.085

    # Rehab complexity: simpler = higher score
    scope_map = {"Cosmetic": 90, "Moderate": 60, "Full Gut": 25}
    rehab_score = float(scope_map.get(f.rehab_scope or "Moderate", 50))
    scores["rehab_complexity"] = _clamp(rehab_score, 0, 100) * 0.1275

    scores["market_heat"] = _clamp(heat_score, 0, 100) * 0.15

    return scores


def _score_house_hack(
    listing: PropertyListing,
    analysis: PropertyAnalysis,
    heat_score: int = 0,
) -> dict[str, float]:
    """
    House hack scoring weights (post-P4 rebalance, sum to 1.00):
        mortgage_offset:    31.5%
        owner_net_cost:     22.5%
        cash_on_cash:       18%
        property_condition:  9%
        unit_count:          9%
        market_heat:        10%
    """
    hh = analysis.house_hack
    uni = analysis.universal
    scores: dict[str, float] = {}

    # Mortgage offset: 0% = 0, 50% = 50, 100% = 90, 150%+ = 100
    offset = hh.mortgage_offset_pct or 0
    scores["mortgage_offset"] = _clamp(min(offset * 0.9, 100), 0, 100) * 0.315

    # Owner net cost: negative (owner is paid) = 100, $0 = 75, $1500/mo = 25, $3000+/mo = 0
    net_cost = hh.owner_net_monthly_cost or 0
    if net_cost <= 0:
        net_score = 100.0
    else:
        net_score = _clamp(75 - (net_cost / 3000) * 75, 0, 100)
    scores["owner_net_cost"] = net_score * 0.225

    # CoC return
    coc = hh.cash_on_cash_return_pct or 0
    scores["cash_on_cash"] = _clamp(20 + (coc / 10) * 80 if coc > 0 else 20 + coc * 2, 0, 100) * 0.18

    # Property condition
    year_built = listing.year_built or 1990
    age = datetime.now().year - year_built
    scores["property_condition"] = _clamp(100 - (age / 60) * 60, 0, 100) * 0.09

    # Unit/room count: 1 rentable = 50, 2 = 75, 3+ = 100
    units = hh.rental_units or 1
    unit_score = _clamp(units * 35, 0, 100)
    scores["unit_count"] = unit_score * 0.09

    scores["market_heat"] = _clamp(heat_score, 0, 100) * 0.10

    return scores


def _score_str(
    listing: PropertyListing,
    analysis: PropertyAnalysis,
    heat_score: int = 0,
) -> dict[str, float]:
    """
    Short-term rental scoring weights (post-P4 rebalance, sum to 1.00):
        cash_on_cash:         20%
        cap_rate:             16%
        gross_revenue_yield:  16%
        break_even_occupancy: 16%
        property_condition:   12%
        market_heat:          20%
    """
    s = analysis.str_metrics
    scores: dict[str, float] = {}

    # Cash-on-cash
    coc = s.cash_on_cash_return_pct or 0
    coc_score = _clamp(20 + (coc / 10) * 80 if coc > 0 else 20 + coc * 2, 0, 100)
    scores["cash_on_cash"] = coc_score * 0.20

    # Cap rate: <4% = 20, 8% = 60, 12%+ = 100
    cap = s.cap_rate_pct or 0
    scores["cap_rate"] = _clamp((cap / 12) * 100, 0, 100) * 0.16

    # Gross revenue yield: gross monthly / price → target 1.5%+ of price/mo
    price = listing.list_price or 1
    gross_yield = ((s.gross_monthly_revenue or 0) / price) * 100
    scores["gross_revenue_yield"] = _clamp((gross_yield / 1.5) * 100, 0, 100) * 0.16

    # Break-even occupancy: lower = safer (30% = 100, 50% = 70, 80%+ = 0)
    beo = s.break_even_occupancy_pct or 60
    scores["break_even_occupancy"] = _clamp(100 - (beo / 80) * 100, 0, 100) * 0.16

    # Property condition
    year_built = listing.year_built or 1990
    age = datetime.now().year - year_built
    scores["property_condition"] = _clamp(100 - (age / 60) * 60, 0, 100) * 0.12

    scores["market_heat"] = _clamp(heat_score, 0, 100) * 0.20

    return scores


def _grade(score: int) -> str:
    if score >= 85:
        return "A"
    elif score >= 75:
        return "B"
    elif score >= 65:
        return "C"
    elif score >= 50:
        return "D"
    else:
        return "F"


def _summary(score: int, goal: InvestmentGoal) -> str:
    goal_label = {
        InvestmentGoal.LONG_TERM: "long-term hold",
        InvestmentGoal.RENTAL: "rental income",
        InvestmentGoal.FIX_AND_FLIP: "fix & flip",
        InvestmentGoal.HOUSE_HACK: "house hack",
        InvestmentGoal.SHORT_TERM_RENTAL: "short-term rental",
    }[goal]

    if score >= 80:
        return f"Strong {goal_label} candidate with excellent fundamentals."
    elif score >= 65:
        return f"Solid {goal_label} opportunity with a few caveats."
    elif score >= 50:
        return f"Moderate {goal_label} potential — review risks carefully."
    else:
        return f"Weak {goal_label} candidate — significant concerns present."


def calculate_investment_score(
    listing: PropertyListing,
    analysis: PropertyAnalysis,
    heat_score: int = 0,
    heat_components: dict[str, int] | None = None,
) -> InvestmentScore:
    """
    Score a property 0–100 based on its investment goal.
    Returns overall score, component breakdown, grade, summary, and the
    market heat score that contributed to the breakdown.
    """
    goal = analysis.investment_goal

    if goal == InvestmentGoal.LONG_TERM and analysis.long_term:
        component_scores = _score_long_term(listing, analysis, heat_score)
    elif goal == InvestmentGoal.RENTAL and analysis.rental:
        component_scores = _score_rental(listing, analysis, heat_score)
    elif goal == InvestmentGoal.FIX_AND_FLIP and analysis.flip:
        component_scores = _score_flip(listing, analysis, heat_score)
    elif goal == InvestmentGoal.HOUSE_HACK and analysis.house_hack:
        component_scores = _score_house_hack(listing, analysis, heat_score)
    elif goal == InvestmentGoal.SHORT_TERM_RENTAL and analysis.str_metrics:
        component_scores = _score_str(listing, analysis, heat_score)
    else:
        component_scores = {"overall": 50.0}

    overall = int(_clamp(sum(component_scores.values())))

    return InvestmentScore(
        overall_score=overall,
        component_scores={k: round(v, 1) for k, v in component_scores.items()},
        grade=_grade(overall),
        summary=_summary(overall, goal),
        heat_score=heat_score,
        heat_score_components=heat_components or {},
    )
