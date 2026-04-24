"""AI-powered real estate underwriting using the Anthropic API.

Implements a two-stage ("Double AI Call") flow with model routing and
prompt caching for token efficiency:

1. `generate_assumptions` — runs on Haiku 4.5 (cheap structured extraction).
   Returns numerical underwriting assumptions that feed the deterministic
   engine.

2. `generate_narrative` — runs on Sonnet (better reasoning + writing).
   Writes the narrative referencing the engine-calculated results.

Both calls place the static role/rubric/format spec in the `system`
parameter with ``cache_control: ephemeral`` so that repeated calls within a
search reuse the cached prefix at ~10% the input cost. Dynamic per-call
content (property, market, comps, results) stays in the user message.
"""

import json
import logging

import anthropic
from pydantic import BaseModel, Field, ValidationError

from backend.config import settings
from backend.testmode import is_test_mode
from backend.models.schemas import (
    AIAnalysis,
    AIAssumptions,
    CompAnalysis,
    InvestmentGoal,
    InvestmentNarrative,
    ListingIntelligence,
    MarketCommentary,
    MarketSnapshot,
    PropertyAnalysis,
    PropertyListing,
)

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------
# Model routing: Haiku for extraction, Sonnet for generative writing.
# ----------------------------------------------------------------------
# Note on caching:
#   - Sonnet 4.6 honors `cache_control: ephemeral` — verified via the
#     usage object (cache_creation → cache_read on subsequent calls).
#     For a 20-property search this cuts system-prompt input cost to
#     ~10% on calls 2–20.
#   - Haiku 4.5 currently ignores `cache_control` on the system param
#     (API returns cache_creation=0/cache_read=0). The marker is kept
#     as a no-op so the code is ready if/when caching activates. Cost
#     impact is small: Haiku input is already ~3× cheaper than Sonnet.
#
# H5: Model names are now in config.py (settings.model_assumptions / settings.model_narrative)
# so they can be overridden via env vars without a code change.

# Max output tokens. Assumptions are short JSON; narrative is prose.
ASSUMPTIONS_MAX_TOKENS = 512
NARRATIVE_MAX_TOKENS = 2000


# ----------------------------------------------------------------------
# H4: Pydantic model for LLM-parsed JSON — gates bad output before it
# reaches AIAssumptions and the analysis engine.
# ----------------------------------------------------------------------

class LLMAssumptions(BaseModel):
    """Validated shape of the JSON returned by the assumptions model.

    Fields are optional so a partially-valid response still populates
    whatever the model did return; out-of-range values are clamped via
    Field bounds so a hallucinated negative value never reaches the engine.
    """

    estimated_rehab_cost: int = Field(default=0, ge=0, le=1_000_000)
    rehab_reasoning: str = ""
    expected_monthly_rent: int | None = Field(default=None, ge=0, le=50_000)
    maintenance_reserve_pct: float | None = Field(default=None, ge=0.0, le=20.0)
    vacancy_rate_pct: float | None = Field(default=None, ge=0.0, le=100.0)
    arv_estimate: int | None = Field(default=None, ge=0, le=10_000_000)
    insurance_premium_monthly: int | None = Field(default=None, ge=0, le=10_000)
    capex_reserve_pct: float | None = Field(default=None, ge=0.0, le=20.0)
    utilities_during_rehab_monthly: int | None = Field(default=None, ge=0, le=5_000)
    property_manager_fee_pct: float | None = Field(default=None, ge=0.0, le=30.0)
    rent_growth_pct: float | None = Field(default=None, ge=0.0, le=20.0)
    expected_appreciation_pct: float | None = Field(default=None, ge=0.0, le=20.0)
    holding_months: int | None = Field(default=None, ge=1, le=60)
    confidence: str = "Low"
    str_nightly_rate: int | None = Field(default=None, ge=0, le=10_000)
    str_occupancy_rate_pct: float | None = Field(default=None, ge=0.0, le=100.0)
    str_cleaning_fee: int | None = Field(default=None, ge=0, le=1_000)
    house_hack_rental_units: int | None = Field(default=None, ge=1, le=10)


# ----------------------------------------------------------------------
# Static system prompts (eligible for prompt caching)
# ----------------------------------------------------------------------

UNDERWRITING_RUBRIC = """\
## Real Estate Underwriting Rubric

### Rehab Cost Benchmarks (US, 2025)
- Cosmetic refresh (paint, flooring, fixtures): $15–25/sqft
- Kitchen remodel: $15,000–45,000 depending on scope
  - Basic (paint cabinets, new counters, appliances): $10,000–18,000
  - Mid-range (new cabinets, quartz counters, tile): $25,000–40,000
  - High-end (custom cabinetry, stone, high-end appliances): $45,000–80,000+
- Bathroom remodel: $5,000–15,000 per bath
  - Basic refresh: $3,500–7,000
  - Full gut mid-range: $10,000–18,000
  - Primary bath high-end: $20,000–40,000+
- Roof replacement: $8,000–20,000 (asphalt); $25,000–50,000+ (metal/tile)
- HVAC replacement: $6,000–12,000 per system
- Electrical panel upgrade: $2,000–5,000; full rewire: $8,000–20,000
- Plumbing re-pipe: $4,000–15,000 depending on sqft
- Windows replacement: $500–1,200 per window
- Exterior paint: $3,000–8,000
- Flooring replacement: $3–15/sqft installed depending on material
- Full gut renovation: $75–120/sqft (more in HCOL metros)
- Foundation repair: $5,000–25,000+ (structural issues can exceed $50k)
- Water damage remediation: $2,000–10,000; mold abatement: $2,000–6,000
- Septic replacement: $5,000–15,000
- Well pump/system: $3,000–10,000

### Regional Cost Multipliers (apply to baseline)
- HCOL metros (SF, NYC, LA, Boston, Seattle): 1.4–1.7× baseline
- Mid-cost coastal/urban (Denver, Austin, Miami, DC): 1.15–1.3× baseline
- Midwest/South suburban: 0.85–1.0× baseline
- Rural: 0.75–0.9× baseline (labor scarcity can invert this)

### Rental Underwriting Targets
- Cap rate: >5% acceptable, >7% strong, >9% exceptional
- Cash-on-cash return: >6% acceptable, >10% strong, >15% exceptional
- DSCR: >1.20 acceptable, >1.40 strong, >1.60 conservative
- Rent-to-price (1% rule): monthly rent ≥ 1% of purchase price (hard in HCOL)
- 50% rule: operating expenses ≈ 50% of gross rent (sanity check)
- Vacancy reserve:
  - 5–6% stable markets with <5% area vacancy
  - 7–8% average markets
  - 8–12% volatile, college towns, seasonal markets
- Maintenance reserve:
  - 0.75–1%/yr for post-2010 construction
  - 1%/yr baseline for 1980–2010
  - 1.5–2%/yr for 1950–1980
  - 2–3%/yr for pre-1950
- Property management: 8–10% of gross rent typical, 12% for SFR turnkey
- CapEx reserve (separate from maintenance): 0.5–1%/yr of value

### Flip Underwriting (70% Rule)
- Max Allowable Offer (MAO) = ARV × 0.70 − Rehab
- Target profit margin: 15–25% of ARV after all costs
- Holding period: 3–6 months typical; longer = more interest + carrying cost
- Carrying costs to include: mortgage, taxes, insurance, utilities, HOA
- Selling costs: ~8% of ARV (6% commission + 2% closing); FSBO saves 3%
- Deal quality: Strong < MAO × 0.90; Good ≤ MAO; Marginal ≤ MAO × 1.10
- 75% rule variant for hot markets: ARV × 0.75 − Rehab (thinner margin, faster exit)

### Condition Scoring Guidelines
- Excellent: Turnkey, recent full renovation, move-in ready, no deferred maintenance
- Good: Well-maintained, minor cosmetic updates needed ($5k–15k)
- Fair: Dated but functional, moderate updates needed ($15k–50k)
- Poor: Major systems at end of life, significant repairs ($50k+)
- Unknown: Insufficient listing detail to assess

### Rent Estimation Adjustments
- >2000 sqft: +10–15% over median for bedroom count
- <800 sqft: -15% from median
- Recent full renovation (within 3 yrs): +5–10% premium
- Dated/poor condition (stuck in 1990s): -10–20% discount
- Premium school district: +5–8%
- New construction (<5 yrs): +5–10%
- Attached garage/covered parking: +$50–150/mo
- In-unit washer/dryer: +$25–75/mo
- Pool/spa: +$50–150/mo but +maintenance burden
- No AC in hot climate: -5–15%
- Pet-friendly policy: +$25–75/mo pet rent

### Signal Extraction Priorities
- Motivated seller: DOM >60, price drops, "as-is", "bring offers", "must sell", estate sale, "motivated", "job relocation", "quick close", "no contingencies"
- Renovation needed: "needs TLC", "handyman special", "fixer", "investor opportunity", "bring your vision", "diamond in the rough", "cash only", "sold as-is"
- Recently renovated: "fully remodeled", "new everything", "turnkey", "updated kitchen/bath", "new roof", "new HVAC"
- Red flags: foundation issues, water damage, mold, unpermitted work, HOA special assessments, title issues, flood zone, polybutylene plumbing, aluminum wiring, knob-and-tube, galvanized pipes, lead paint (pre-1978), asbestos (pre-1980)
- Hidden value: large lot (>0.25 acre), ADU potential, favorable zoning (R2+), unfinished basement/attic, detached garage (convertible), separate entrance (house-hack potential), mother-in-law suite
- Neighborhood trajectory: nearby new construction, transit expansion, employer relocations, school ratings trending up

### Common Underwriting Mistakes to Avoid
- Using Zestimate/Redfin Estimate as ARV (they lag by 3–6 months)
- Ignoring deferred maintenance signals ("needs some TLC" usually = $20k+)
- Assuming list price = market value (especially in slow markets)
- Underestimating holding costs on flips (rates + utilities stack quickly)
- Forgetting CapEx reserve separate from maintenance
- Projecting rent growth straight-line (use 2–3%/yr for conservative base case)
- Skipping inspection contingency budget on fix-and-flip deals
- Treating gross rent as net in cap rate math (subtract all expenses first)

### Confidence Calibration
- High: Clear listing description, strong comps (≥5), recent sales, unambiguous condition cues
- Medium: Partial listing info, 2–4 comps, some condition ambiguity, mixed signals
- Low: Thin listing, <2 comps, no condition cues, outdated photos, stale data
"""

ROLE_ASSUMPTIONS = """\
You are an experienced real estate underwriter. Given a listing, comparable \
sales, and market data, output numerical underwriting assumptions that a \
Python engine will use to calculate ROI, cap rate, cash flow, and flip profit. \
Be conservative but specific. Ground your numbers in the rubric below.\
"""

ROLE_NARRATIVE = """\
You are a professional real estate investment analyst writing the narrative \
portion of an investment memo. The financial numbers in each request were \
ALREADY calculated by a deterministic Python engine using underwriting \
assumptions you generated in a prior step. You MUST reference those numbers \
accurately and NOT invent different ROI, cap rate, cash flow, or profit \
figures.\
"""

FORMAT_ASSUMPTIONS = """\
## Output Format
Respond with ONLY valid JSON (no markdown fences, no commentary outside the JSON). \
Required keys:

- "estimated_rehab_cost": integer USD, your best single-point estimate of \
  total rehab needed to bring the property to rentable/resale condition. \
  0 if turn-key.
- "rehab_reasoning": 1-2 sentence explanation citing specific evidence from \
  the listing description.
- "expected_monthly_rent": integer USD/month the property would rent for in \
  as-is or light-rehab condition. null if rental is clearly not viable.
- "maintenance_reserve_pct": float 0–5, annual maintenance reserve as a \
  percent of property value. null to use default (1.0).
- "capex_reserve_pct": float 0–3, annual CapEx reserve (roof, HVAC, appliances) \
  as a percent of property value, separate from maintenance. null to use default (1.0).
- "vacancy_rate_pct": float 0–20, recommended vacancy reserve percent. null \
  to use market default.
- "arv_estimate": integer USD, realistic After-Repair Value for flip math. \
  null if not applicable.
- "insurance_premium_monthly": integer USD/month. null to use default heuristic.
- "utilities_during_rehab_monthly": integer USD/month of utilities carried \
  during a flip rehab. null to use default ($150/mo).
- "property_manager_fee_pct": float 0–15, override for PM fee as percent of \
  collected rent. null to use default (9%).
- "rent_growth_pct": float 0–8, expected annual rent growth for long-term pro \
  forma. null to use market YoY or default (3%).
- "expected_appreciation_pct": float -5–15, expected annual home-price \
  appreciation for this property. null to use market YoY.
- "holding_months": integer 1–18, holding period for a flip. null to use \
  scope-based default (Cosmetic 3, Moderate 4, Full Gut 5).
- "confidence": "Low", "Medium", or "High" — your confidence given available data.
- "str_nightly_rate": integer USD/night for a short-term rental (Airbnb/VRBO). \
  Estimate based on comparable STR listings in the area, bedrooms, and property quality. \
  null if goal is not short_term_rental.
- "str_occupancy_rate_pct": float 0–100, expected STR occupancy %. \
  Typical markets: 55–75%. Tourist/urban hotspots can reach 80%+. \
  null if goal is not short_term_rental.
- "str_cleaning_fee": integer USD per turnover cleaning cost. \
  Typical range $80–$200 depending on property size. null to use default ($120).
- "house_hack_rental_units": integer number of units/rooms the owner will rent out. \
  For duplexes: 1. Triplexes: 2. Quadplexes: 3. SFH: bedrooms minus 1 owner room. \
  null to use auto-inferred value from bedrooms/property type.
"""

FORMAT_NARRATIVE = """\
## Output Format
Respond with ONLY valid JSON (no markdown fences, no commentary outside the JSON). \
The JSON must have exactly these top-level keys:

- "listing_intelligence": An object with:
  - "renovation_signals": list of strings — clues suggesting renovation is needed or has been done
  - "motivated_seller_signals": list of strings — clues the seller may be motivated
  - "red_flags": list of strings — potential problems
  - "hidden_value": list of strings — opportunities not immediately obvious
  - "condition_estimate": one of "Excellent", "Good", "Fair", "Poor", or "Unknown"
  - "ai_confidence": float 0.0 to 1.0

- "investment_narrative": An object with:
  - "narrative": 2-3 paragraph professional broker-style summary. Reference the EXACT engine-calculated numbers (ROI, cap rate, cash flow, profit). Do NOT invent different figures.
  - "key_strengths": list of 3-5 concise bullet strings
  - "key_concerns": list of 2-4 concise bullet strings

- "market_commentary": An object with:
  - "commentary": 1-2 paragraph market context analysis
  - "outlook": one of "Bullish", "Bearish", or "Neutral"
  - "key_trends": list of 3-5 concise strings

- "ai_available": true
"""

ASSUMPTIONS_SYSTEM = f"{ROLE_ASSUMPTIONS}\n\n{UNDERWRITING_RUBRIC}\n\n{FORMAT_ASSUMPTIONS}"
NARRATIVE_SYSTEM = f"{ROLE_NARRATIVE}\n\n{UNDERWRITING_RUBRIC}\n\n{FORMAT_NARRATIVE}"


class AIService:
    """Two-pass AI underwriter with model routing and prompt caching."""

    def __init__(self) -> None:
        self._client: anthropic.AsyncAnthropic | None = None

    def _get_client(self) -> anthropic.AsyncAnthropic:
        """Lazily create the Anthropic async client on first use."""
        if self._client is None:
            self._client = anthropic.AsyncAnthropic(
                api_key=settings.anthropic_api_key,
            )
        return self._client

    # ------------------------------------------------------------------
    # Pass 1: Generate underwriting assumptions (Haiku)
    # ------------------------------------------------------------------

    async def generate_assumptions(
        self,
        listing: PropertyListing,
        market: MarketSnapshot,
        comps: CompAnalysis,
    ) -> AIAssumptions | None:
        """Ask Haiku to produce numerical underwriting assumptions.

        Returns None if no API key is configured or on any failure so the
        caller can fall back to the engine's default heuristics.
        """
        if is_test_mode():
            logger.info("Test mode active; skipping AI assumptions")
            return None

        if not settings.has_anthropic_key:
            logger.info("No Anthropic API key configured; skipping AI assumptions")
            return None

        try:
            user_content = self._build_assumptions_user(listing, market, comps)
            client = self._get_client()

            response = await client.messages.create(
                model=settings.model_assumptions,  # H5
                max_tokens=ASSUMPTIONS_MAX_TOKENS,
                system=[
                    {
                        "type": "text",
                        "text": ASSUMPTIONS_SYSTEM,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user_content}],
            )

            raw_text = response.content[0].text
            return self._parse_assumptions(raw_text)

        except Exception:
            logger.exception("AI assumptions generation failed")
            return None

    # ------------------------------------------------------------------
    # Pass 2: Generate narrative referencing deterministic results (Sonnet)
    # ------------------------------------------------------------------

    async def generate_narrative(
        self,
        listing: PropertyListing,
        analysis: PropertyAnalysis,
        market: MarketSnapshot,
        goal: InvestmentGoal,
        assumptions: AIAssumptions | None,
        heat_score: int | None = None,
        heat_components: dict[str, int] | None = None,
    ) -> AIAnalysis:
        """Generate the qualitative narrative based on Python-calculated metrics.

        Returns an AIAnalysis with ai_available=True on success, or a default
        AIAnalysis (carrying the assumptions) with ai_available=False if the
        API key is missing or any error occurs.
        """
        if is_test_mode():
            logger.info("Test mode active; skipping AI narrative")
            return AIAnalysis(assumptions=assumptions, ai_available=False)

        if not settings.has_anthropic_key:
            logger.info("No Anthropic API key configured; skipping AI narrative")
            return AIAnalysis(assumptions=assumptions, ai_available=False)

        try:
            user_content = self._build_narrative_user(
                listing, analysis, market, goal, assumptions,
                heat_score=heat_score, heat_components=heat_components,
            )
            client = self._get_client()

            response = await client.messages.create(
                model=settings.model_narrative,  # H5
                max_tokens=NARRATIVE_MAX_TOKENS,
                system=[
                    {
                        "type": "text",
                        "text": NARRATIVE_SYSTEM,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user_content}],
            )

            raw_text = response.content[0].text
            return self._parse_narrative(raw_text, assumptions)

        except Exception:
            logger.exception("AI narrative generation failed")
            return AIAnalysis(assumptions=assumptions, ai_available=False)

    # ------------------------------------------------------------------
    # Dynamic per-call content builders
    # ------------------------------------------------------------------

    def _property_block(self, listing: PropertyListing) -> str:
        return (
            f"Address: {listing.address}, {listing.city}, {listing.state} {listing.zip_code}\n"
            f"List Price: ${listing.list_price:,}\n"
            f"Bedrooms: {listing.bedrooms} | Bathrooms: {listing.bathrooms}\n"
            f"Square Feet: {listing.sqft:,} | Price/SqFt: ${listing.price_per_sqft:,.0f}\n"
            f"Year Built: {listing.year_built or 'Unknown'}\n"
            f"Property Type: {listing.property_type}\n"
            f"Days on Market: {listing.days_on_market or 'Unknown'}\n"
            f"HOA Monthly: {'$' + str(listing.hoa_monthly) if listing.hoa_monthly else 'None'}\n"
            f"Annual Taxes: {'$' + f'{listing.tax_annual:,}' if listing.tax_annual else 'Unknown'}\n"
            f"\nListing Description:\n{listing.description or 'No description available.'}\n"
        )

    def _market_block(self, market: MarketSnapshot) -> str:
        pt = market.price_trends
        rm = market.rental_market
        dm = market.demographics
        ei = market.economic_indicators
        return (
            f"Median Home Price: {'$' + f'{pt.median_price:,}' if pt.median_price else 'Unknown'}\n"
            f"YoY Appreciation: {f'{pt.yoy_appreciation_pct:.1f}%' if pt.yoy_appreciation_pct is not None else 'Unknown'}\n"
            f"Median Rent (2BR): {'$' + f'{rm.median_rent_2br:,}' if rm.median_rent_2br else 'Unknown'}\n"
            f"Median Rent (3BR): {'$' + f'{rm.median_rent_3br:,}' if rm.median_rent_3br else 'Unknown'}\n"
            f"Vacancy Rate: {f'{rm.vacancy_rate_pct:.1f}%' if rm.vacancy_rate_pct is not None else 'Unknown'}\n"
            f"Median Household Income: {'$' + f'{dm.median_household_income:,}' if dm.median_household_income else 'Unknown'}\n"
            f"Unemployment Rate: {f'{dm.unemployment_rate_pct:.1f}%' if dm.unemployment_rate_pct is not None else 'Unknown'}\n"
            f"30yr Mortgage Rate: {f'{ei.mortgage_rate_30yr:.2f}%' if ei.mortgage_rate_30yr is not None else 'Unknown'}\n"
            f"Median Days on Market: {ei.median_days_on_market or 'Unknown'}\n"
            f"Sale-to-List Ratio: {f'{ei.sale_to_list_ratio:.2f}' if ei.sale_to_list_ratio is not None else 'Unknown'}\n"
        )

    def _comps_block(self, comps: CompAnalysis) -> str:
        lines = [
            f"Comps Found: {comps.comps_found}",
            f"Adjusted Value (Low/Mid/High): "
            f"{'$' + f'{comps.adjusted_value_low:,}' if comps.adjusted_value_low else 'N/A'} / "
            f"{'$' + f'{comps.adjusted_value_mid:,}' if comps.adjusted_value_mid else 'N/A'} / "
            f"{'$' + f'{comps.adjusted_value_high:,}' if comps.adjusted_value_high else 'N/A'}",
            f"Confidence: {comps.confidence}",
        ]
        if comps.comparable_properties:
            lines.append("Recent Comparables:")
            # Trim to 3 comps — sufficient signal, saves tokens
            for c in comps.comparable_properties[:3]:
                lines.append(
                    f"  - {c.address}: ${c.sold_price:,} | "
                    f"{c.sqft:,} sqft | ${c.price_per_sqft:.0f}/sqft | "
                    f"{c.distance_miles:.1f}mi"
                )
        return "\n".join(lines) + "\n"

    def _build_assumptions_user(
        self,
        listing: PropertyListing,
        market: MarketSnapshot,
        comps: CompAnalysis,
    ) -> str:
        return f"""\
=== PROPERTY DETAILS ===
{self._property_block(listing)}

=== COMPARABLE SALES ===
{self._comps_block(comps)}

=== MARKET DATA ({listing.city}, {listing.state}) ===
{self._market_block(market)}
"""

    def _build_narrative_user(
        self,
        listing: PropertyListing,
        analysis: PropertyAnalysis,
        market: MarketSnapshot,
        goal: InvestmentGoal,
        assumptions: AIAssumptions | None,
        heat_score: int | None = None,
        heat_components: dict[str, int] | None = None,
    ) -> str:
        goal_label = {
            InvestmentGoal.LONG_TERM: "Long-Term Buy & Hold",
            InvestmentGoal.RENTAL: "Rental Income",
            InvestmentGoal.FIX_AND_FLIP: "Fix & Flip",
        }.get(goal, goal.value)

        u = analysis.universal
        finance_section = (
            f"Monthly Mortgage (P&I): ${u.monthly_mortgage_payment:,.0f}\n"
            f"Total Monthly Cost (PITI + HOA): ${u.total_monthly_cost:,.0f}\n"
            f"Down Payment: ${u.down_payment_amount:,.0f}\n"
            f"Loan Amount: ${u.loan_amount:,.0f}\n"
        )

        if analysis.rental and goal in (InvestmentGoal.RENTAL, InvestmentGoal.LONG_TERM):
            r = analysis.rental
            finance_section += (
                f"Estimated Monthly Rent: ${r.estimated_monthly_rent or 0:,}\n"
                f"Cap Rate: {r.cap_rate_pct or 0:.2f}%\n"
                f"Cash-on-Cash Return: {r.cash_on_cash_return_pct or 0:.2f}%\n"
                f"Monthly Cash Flow: ${r.monthly_cash_flow or 0:,.0f}\n"
                f"GRM: {r.gross_rent_multiplier or 0:.1f}\n"
                f"DSCR: {r.dscr or 0:.2f}\n"
            )

        if analysis.flip and goal == InvestmentGoal.FIX_AND_FLIP:
            f = analysis.flip
            finance_section += (
                f"ARV (After Repair Value): ${f.arv or 0:,}\n"
                f"Estimated Rehab Cost: ${f.estimated_rehab_cost or 0:,}\n"
                f"Rehab Scope: {f.rehab_scope or 'Unknown'}\n"
                f"MAO (Max Allowable Offer): ${f.mao or 0:,}\n"
                f"Potential Profit: ${f.potential_profit or 0:,}\n"
                f"Flip ROI: {f.roi_pct or 0:.1f}%\n"
                f"Deal Score: {f.deal_score or 'Unknown'}\n"
            )

        if analysis.long_term and goal == InvestmentGoal.LONG_TERM:
            lt = analysis.long_term
            finance_section += (
                f"Projected Value (5yr): ${lt.projected_value_5yr or 0:,}\n"
                f"Projected Value (10yr): ${lt.projected_value_10yr or 0:,}\n"
                f"Annualized Return: {lt.annualized_return_pct or 0:.2f}%\n"
            )

        assumptions_section = ""
        if assumptions:
            assumptions_section = (
                f"Rehab Estimate Used: ${assumptions.estimated_rehab_cost:,}\n"
                f"Rehab Reasoning: {assumptions.rehab_reasoning}\n"
                f"Expected Rent (AI): {'$' + f'{assumptions.expected_monthly_rent:,}' if assumptions.expected_monthly_rent else 'n/a'}\n"
                f"Vacancy Rate (AI): {f'{assumptions.vacancy_rate_pct:.1f}%' if assumptions.vacancy_rate_pct is not None else 'n/a'}\n"
                f"Maintenance Reserve (AI): {f'{assumptions.maintenance_reserve_pct:.1f}%' if assumptions.maintenance_reserve_pct is not None else 'n/a'}\n"
                f"ARV Estimate (AI): {'$' + f'{assumptions.arv_estimate:,}' if assumptions.arv_estimate else 'n/a'}\n"
                f"Assumptions Confidence: {assumptions.confidence}\n"
            )

        risks_section = ""
        if analysis.risks:
            risks_section = "Pre-identified risks:\n"
            for risk in analysis.risks:
                risks_section += f"  - [{risk.type}] {risk.message}\n"

        # Heat-score block: only inject when we have one. The few-shot is shown
        # only at extreme scores so Sonnet doesn't waste tokens narrating an
        # average market — the goal is to surface signal, not to comment on
        # everything.
        heat_section = ""
        if heat_score is not None:
            comps = heat_components or {}
            comp_lines = "\n".join(
                f"  - {k}: {v}/100" for k, v in comps.items()
            ) if comps else "  - components unavailable"
            heat_section = (
                f"=== MARKET HEAT (P4) ===\n"
                f"Heat Score: {heat_score}/100 (goal-weighted blend of rent growth, "
                f"unemployment, population growth, and median days-on-market)\n"
                f"Sub-scores:\n{comp_lines}\n"
            )
            if heat_score >= 75:
                heat_section += (
                    "\nNOTE: Heat is high — add ONE concise contextual sentence in "
                    "`investment_narrative.narrative` that ties this hot market to the "
                    "deal's risk/return profile. Example tone:\n"
                    '  "This market is running hot — rent growth and listing velocity '
                    'mean any pricing missteps trigger bidding wars rather than longer carry."\n'
                )
            elif heat_score <= 30:
                heat_section += (
                    "\nNOTE: Heat is low — add ONE concise contextual sentence in "
                    "`investment_narrative.narrative` flagging the cool market and what "
                    "it implies for negotiation leverage and exit timing. Example tone:\n"
                    '  "The market is soft — slow listing turnover and weak rent growth '
                    'give you negotiating room on price but extend the realistic exit horizon."\n'
                )

        return f"""\
=== INVESTMENT STRATEGY ===
{goal_label}

=== PROPERTY DETAILS ===
{self._property_block(listing)}

=== YOUR UNDERWRITING ASSUMPTIONS (used by the engine) ===
{assumptions_section or 'No AI assumptions — engine used default heuristics.'}

=== ENGINE-CALCULATED RESULTS (authoritative) ===
{finance_section}

=== MARKET DATA ({listing.city}, {listing.state}) ===
{self._market_block(market)}

{heat_section}
{risks_section}
"""

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    def _strip_fences(self, raw_text: str) -> str:
        text = raw_text.strip()
        if text.startswith("```"):
            first_newline = text.index("\n")
            text = text[first_newline + 1 :]
        if text.endswith("```"):
            text = text[: text.rfind("```")]
        return text.strip()

    def _extract_json_object(self, raw_text: str) -> dict:
        """Parse the first complete JSON object from the model's response.

        Claude occasionally emits valid JSON followed by trailing prose
        (especially Haiku). `json.raw_decode` stops at the first complete
        value and ignores anything after, which is exactly what we want.
        """
        text = self._strip_fences(raw_text)
        # Jump to the first '{' in case the model prefixed with any text
        start = text.find("{")
        if start > 0:
            text = text[start:]
        decoder = json.JSONDecoder()
        obj, _ = decoder.raw_decode(text)
        return obj

    def _parse_assumptions(self, raw_text: str) -> AIAssumptions:
        data = self._extract_json_object(raw_text)

        # H4: Validate and clamp via LLMAssumptions Pydantic model before touching
        # the analysis engine. Out-of-range values are clamped by Field bounds;
        # extra keys are ignored; missing keys use safe defaults.
        try:
            validated = LLMAssumptions.model_validate(data)
        except ValidationError as exc:
            logger.warning("LLM assumptions failed validation, using safe defaults: %s", exc)
            validated = LLMAssumptions()

        return AIAssumptions(
            estimated_rehab_cost=validated.estimated_rehab_cost,
            rehab_reasoning=validated.rehab_reasoning,
            expected_monthly_rent=validated.expected_monthly_rent,
            maintenance_reserve_pct=validated.maintenance_reserve_pct,
            vacancy_rate_pct=validated.vacancy_rate_pct,
            arv_estimate=validated.arv_estimate,
            insurance_premium_monthly=validated.insurance_premium_monthly,
            capex_reserve_pct=validated.capex_reserve_pct,
            utilities_during_rehab_monthly=validated.utilities_during_rehab_monthly,
            property_manager_fee_pct=validated.property_manager_fee_pct,
            rent_growth_pct=validated.rent_growth_pct,
            expected_appreciation_pct=validated.expected_appreciation_pct,
            holding_months=validated.holding_months,
            confidence=validated.confidence,
            str_nightly_rate=validated.str_nightly_rate,
            str_occupancy_rate_pct=validated.str_occupancy_rate_pct,
            str_cleaning_fee=validated.str_cleaning_fee,
            house_hack_rental_units=validated.house_hack_rental_units,
        )

    def _parse_narrative(
        self,
        raw_text: str,
        assumptions: AIAssumptions | None,
    ) -> AIAnalysis:
        data = self._extract_json_object(raw_text)

        listing_intel = ListingIntelligence(
            renovation_signals=data.get("listing_intelligence", {}).get("renovation_signals", []),
            motivated_seller_signals=data.get("listing_intelligence", {}).get("motivated_seller_signals", []),
            red_flags=data.get("listing_intelligence", {}).get("red_flags", []),
            hidden_value=data.get("listing_intelligence", {}).get("hidden_value", []),
            condition_estimate=data.get("listing_intelligence", {}).get("condition_estimate", "Unknown"),
            ai_confidence=float(data.get("listing_intelligence", {}).get("ai_confidence", 0.0)),
        )

        narrative_data = data.get("investment_narrative", {})
        narrative = InvestmentNarrative(
            narrative=narrative_data.get("narrative", ""),
            key_strengths=narrative_data.get("key_strengths", []),
            key_concerns=narrative_data.get("key_concerns", []),
        )

        market_data = data.get("market_commentary", {})
        market_commentary = MarketCommentary(
            commentary=market_data.get("commentary", ""),
            outlook=market_data.get("outlook", "Neutral"),
            key_trends=market_data.get("key_trends", []),
        )

        return AIAnalysis(
            listing_intelligence=listing_intel,
            investment_narrative=narrative,
            market_commentary=market_commentary,
            assumptions=assumptions,
            ai_available=True,
        )


ai_service = AIService()
