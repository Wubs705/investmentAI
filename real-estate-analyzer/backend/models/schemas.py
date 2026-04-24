from enum import Enum

from pydantic import BaseModel, Field, model_validator


class InvestmentGoal(str, Enum):
    LONG_TERM = "long_term"
    RENTAL = "rental"
    FIX_AND_FLIP = "fix_and_flip"
    HOUSE_HACK = "house_hack"
    SHORT_TERM_RENTAL = "short_term_rental"


class BudgetRange(BaseModel):
    min_price: int = Field(default=100_000, ge=0)
    max_price: int = Field(default=500_000, ge=0)


class NormalizedLocation(BaseModel):
    city: str
    state: str
    state_code: str
    zip_code: str | None = None
    county: str | None = None
    lat: float = Field(ge=-90.0, le=90.0)
    lng: float = Field(ge=-180.0, le=180.0)
    display_name: str


class SearchCriteria(BaseModel):
    budget_min: int = Field(default=100_000, ge=0)
    budget_max: int = Field(default=500_000, ge=0)
    location: str = Field(min_length=1)
    # Optional pre-resolved location from the frontend's Mapbox autocomplete.
    # When present, the search pipeline skips server-side geocoding entirely.
    location_hint: NormalizedLocation | None = None
    radius_miles: int = Field(default=15, ge=1, le=50)
    investment_goal: InvestmentGoal = InvestmentGoal.RENTAL
    down_payment_pct: float = Field(default=20.0, ge=0, le=100)

    @model_validator(mode="after")
    def _budget_order(self) -> "SearchCriteria":
        if self.budget_min is not None and self.budget_max is not None:
            if self.budget_min > self.budget_max:
                raise ValueError("budget_min must be ≤ budget_max")
        return self


class LocationSuggestion(BaseModel):
    display_name: str
    city: str
    state: str
    lat: float | None = None
    lng: float | None = None
    place_id: str | None = None


class PropertyListing(BaseModel):
    id: str
    address: str
    city: str
    state: str
    zip_code: str
    lat: float | None = Field(default=None, ge=-90.0, le=90.0)
    lng: float | None = Field(default=None, ge=-180.0, le=180.0)
    list_price: int = Field(gt=0)
    bedrooms: int = Field(ge=0, le=50)
    bathrooms: float = Field(ge=0.0, le=50.0)
    sqft: int = Field(gt=0, le=1_000_000)
    lot_size_sqft: int | None = None
    year_built: int | None = None
    property_type: str
    days_on_market: int | None = None
    listing_status: str = "Active"
    hoa_monthly: int | None = None
    tax_annual: int | None = None
    price_per_sqft: float
    description: str = ""
    photos: list[str] = Field(default_factory=list)
    listing_url: str = ""
    source: str = ""
    raw_data: dict = Field(default_factory=dict)


class CompProperty(BaseModel):
    address: str
    sold_price: int
    sold_date: str
    sqft: int
    bedrooms: int
    bathrooms: float
    price_per_sqft: float
    distance_miles: float
    adjusted_value: int | None = None


class CompAnalysis(BaseModel):
    comps_found: int
    comparable_properties: list[CompProperty] = Field(default_factory=list)
    adjusted_value_low: int | None = None
    adjusted_value_mid: int | None = None
    adjusted_value_high: int | None = None
    price_vs_comps: str = "Unknown"
    price_vs_comps_pct: float = 0.0
    confidence: str = "Low"


# Market data schemas
class PriceTrends(BaseModel):
    median_price: int | None = None
    median_price_1yr_ago: int | None = None
    median_price_3yr_ago: int | None = None
    median_price_5yr_ago: int | None = None
    yoy_appreciation_pct: float | None = None
    price_history: list[dict] = Field(default_factory=list)


class RentalMarket(BaseModel):
    median_rent_1br: int | None = None
    median_rent_2br: int | None = None
    median_rent_3br: int | None = None
    median_rent_4br: int | None = None
    rent_growth_yoy_pct: float | None = None
    vacancy_rate_pct: float | None = None


class Demographics(BaseModel):
    median_household_income: int | None = None
    population: int | None = None
    population_growth_pct: float | None = None
    unemployment_rate_pct: float | None = None


class EconomicIndicators(BaseModel):
    mortgage_rate_30yr: float | None = None
    median_home_value: int | None = None
    months_of_supply: float | None = None
    median_days_on_market: int | None = None
    sale_to_list_ratio: float | None = None
    median_price_per_sqft: float | None = None


class MarketSnapshot(BaseModel):
    location: NormalizedLocation | None = None
    price_trends: PriceTrends = Field(default_factory=PriceTrends)
    rental_market: RentalMarket = Field(default_factory=RentalMarket)
    demographics: Demographics = Field(default_factory=Demographics)
    economic_indicators: EconomicIndicators = Field(default_factory=EconomicIndicators)
    data_sources_used: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


# Analysis result schemas
class RiskFactor(BaseModel):
    type: str  # "warning" or "positive"
    message: str
    severity: float = 0.5


class UniversalMetrics(BaseModel):
    estimated_market_value: int | None = None
    price_vs_market_pct: float | None = None
    price_per_sqft: float
    area_median_price_per_sqft: float | None = None
    property_tax_monthly: float
    insurance_estimate_monthly: float
    monthly_mortgage_payment: float
    total_monthly_cost: float
    down_payment_amount: float
    loan_amount: float
    pmi_monthly: float = 0.0
    closing_costs: float = 0.0
    rate_sensitivity: dict[int, float] = Field(default_factory=dict)


class LongTermMetrics(BaseModel):
    appreciation_5yr_pct: float | None = None
    appreciation_10yr_pct: float | None = None
    projected_value_5yr: int | None = None
    projected_value_10yr: int | None = None
    projected_equity_5yr: int | None = None
    projected_equity_10yr: int | None = None
    total_roi_5yr_pct: float | None = None
    total_roi_10yr_pct: float | None = None
    annualized_return_pct: float | None = None
    neighborhood_growth_score: float | None = None
    school_district_rating: float | None = None
    net_equity_5yr: int | None = None
    net_equity_10yr: int | None = None
    net_equity_after_tax_5yr: int | None = None
    net_equity_after_tax_10yr: int | None = None
    projected_annual_cashflows: list[float] = Field(default_factory=list)
    cumulative_cashflow_5yr: float | None = None
    cumulative_cashflow_10yr: float | None = None
    scenarios: dict | None = None


class RentalMetrics(BaseModel):
    estimated_monthly_rent: int | None = None
    gross_rent_multiplier: float | None = None
    cap_rate_pct: float | None = None
    cash_on_cash_return_pct: float | None = None
    monthly_cash_flow: float | None = None
    vacancy_rate_pct: float = 5.0
    maintenance_monthly: float | None = None
    property_management_monthly: float | None = None
    dscr: float | None = None
    break_even_occupancy_pct: float | None = None
    rent_to_price_ratio: float | None = None
    rent_to_price_ratio_pct: float | None = None
    capex_reserve_monthly: float | None = None
    turnover_reserve_monthly: float | None = None
    annual_depreciation: float | None = None
    taxable_income_year_one: float | None = None
    after_tax_cash_flow_annual: float | None = None
    scenarios: dict | None = None


class FlipMetrics(BaseModel):
    arv: int | None = None
    estimated_rehab_cost: int | None = None
    rehab_scope: str | None = None
    rehab_cost_per_sqft: float | None = None
    mao: int | None = None
    potential_profit: int | None = None
    roi_pct: float | None = None
    holding_cost_monthly: float | None = None
    holding_months: int = 4
    selling_costs: int | None = None
    deal_score: str | None = None
    financing_rate_pct: float | None = None
    origination_fee: int | None = None
    down_payment_flip: int | None = None
    utilities_during_rehab: int | None = None
    total_interest_paid: int | None = None
    property_tax_during_hold: int | None = None
    insurance_during_hold: int | None = None
    total_holding_costs: int | None = None
    after_tax_profit: int | None = None


class HouseHackMetrics(BaseModel):
    rental_units: int | None = None
    total_rental_income_monthly: int | None = None
    owner_net_monthly_cost: float | None = None
    mortgage_offset_pct: float | None = None
    cash_on_cash_return_pct: float | None = None
    market_rent_owner_unit: int | None = None
    monthly_savings_vs_renting: float | None = None
    total_monthly_expenses: float | None = None
    maintenance_monthly: float | None = None
    capex_monthly: float | None = None


class ShortTermRentalMetrics(BaseModel):
    estimated_nightly_rate: int | None = None
    occupancy_rate_pct: float | None = None
    gross_monthly_revenue: float | None = None
    platform_fee_monthly: float | None = None
    cleaning_costs_monthly: float | None = None
    str_maintenance_monthly: float | None = None
    net_operating_income_monthly: float | None = None
    monthly_cash_flow: float | None = None
    annual_cash_flow: float | None = None
    cap_rate_pct: float | None = None
    cash_on_cash_return_pct: float | None = None
    str_vs_ltr_premium_pct: float | None = None
    break_even_occupancy_pct: float | None = None
    ltr_monthly_comparison: int | None = None


# AI Analysis schemas
class ListingIntelligence(BaseModel):
    renovation_signals: list[str] = Field(default_factory=list)
    motivated_seller_signals: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    hidden_value: list[str] = Field(default_factory=list)
    condition_estimate: str = "Unknown"
    ai_confidence: float = 0.0


class AIAssumptions(BaseModel):
    """AI-generated underwriting assumptions used to drive deterministic math.

    These are produced by the first AI pass (`generate_assumptions`) and then
    fed into `analysis_engine.analyze` so the subsequent Python calculations
    reflect the AI's property-specific judgment rather than generic market
    averages.
    """
    estimated_rehab_cost: int = 0
    rehab_reasoning: str = ""
    expected_monthly_rent: int | None = None
    maintenance_reserve_pct: float | None = None
    vacancy_rate_pct: float | None = None
    arv_estimate: int | None = None
    insurance_premium_monthly: int | None = None
    capex_reserve_pct: float | None = None
    utilities_during_rehab_monthly: int | None = None
    property_manager_fee_pct: float | None = None
    rent_growth_pct: float | None = None
    expected_appreciation_pct: float | None = None
    holding_months: int | None = None
    confidence: str = "Low"
    str_nightly_rate: int | None = None
    str_occupancy_rate_pct: float | None = None
    str_cleaning_fee: int | None = None
    house_hack_rental_units: int | None = None


class InvestmentNarrative(BaseModel):
    narrative: str = ""
    key_strengths: list[str] = Field(default_factory=list)
    key_concerns: list[str] = Field(default_factory=list)


class MarketCommentary(BaseModel):
    commentary: str = ""
    outlook: str = "Neutral"
    key_trends: list[str] = Field(default_factory=list)


class AIAnalysis(BaseModel):
    listing_intelligence: ListingIntelligence = Field(default_factory=ListingIntelligence)
    investment_narrative: InvestmentNarrative = Field(default_factory=InvestmentNarrative)
    market_commentary: MarketCommentary = Field(default_factory=MarketCommentary)
    assumptions: AIAssumptions | None = None
    ai_available: bool = False


class PropertyAnalysis(BaseModel):
    property_id: str
    investment_goal: InvestmentGoal
    universal: UniversalMetrics
    long_term: LongTermMetrics | None = None
    rental: RentalMetrics | None = None
    flip: FlipMetrics | None = None
    house_hack: HouseHackMetrics | None = None
    str_metrics: ShortTermRentalMetrics | None = None
    ai_analysis: AIAnalysis = Field(default_factory=AIAnalysis)
    risks: list[RiskFactor] = Field(default_factory=list)


class HeatScore(BaseModel):
    score: int = Field(ge=0, le=100)
    components: dict[str, int] = Field(default_factory=dict)


class InvestmentScore(BaseModel):
    overall_score: int = Field(ge=0, le=100)
    component_scores: dict[str, float] = Field(default_factory=dict)
    grade: str
    summary: str = ""
    heat_score: int | None = Field(default=None, ge=0, le=100)
    heat_score_components: dict[str, int] = Field(default_factory=dict)


class PropertyResult(BaseModel):
    listing: PropertyListing
    analysis: PropertyAnalysis | None = None
    score: InvestmentScore | None = None
    comps: CompAnalysis | None = None


class SearchResponse(BaseModel):
    properties: list[PropertyResult] = Field(default_factory=list)
    market_snapshot: MarketSnapshot = Field(default_factory=MarketSnapshot)
    location: NormalizedLocation | None = None
    total_found: int = 0
    sources_used: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
