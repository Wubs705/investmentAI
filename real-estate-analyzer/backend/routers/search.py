"""Search router — POST /api/search and GET /api/autocomplete."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.auth import get_current_user
from backend.models.database import get_supabase
from backend.models.schemas import (
    AIAnalysis,
    LocationSuggestion,
    PropertyResult,
    SearchCriteria,
    SearchResponse,
)
from backend.services.ai_service import ai_service
from backend.services.analysis_engine import analysis_engine
from backend.services.comparables import comparables_service
from backend.services.geocoding import geocoding_service
from backend.services.market_data import market_data_service
from backend.services.property_search import property_search_service
from backend.utils.scoring import calculate_investment_score

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["search"])


async def _persist_results(
    results: list[PropertyResult],
    criteria: SearchCriteria,
    user_id: str,
    supabase,
) -> None:
    """Persist search results to Supabase. Failures are logged, not raised."""
    try:
        for result in results:
            listing = result.listing
            # Upsert the shared property record (property data is not user-specific)
            await supabase.table("properties").upsert({
                "id": listing.id,
                "address": listing.address,
                "city": listing.city,
                "state": listing.state,
                "zip_code": listing.zip_code or "",
                "list_price": listing.list_price,
                "data": listing.model_dump(mode="json"),
                "source": listing.source,
            }).execute()

            # Insert the user-specific analysis record
            if result.analysis:
                await supabase.table("analyses").insert({
                    "user_id": user_id,
                    "property_id": listing.id,
                    "goal": criteria.investment_goal.value,
                    "data": result.analysis.model_dump(mode="json"),
                    "score": result.score.overall_score if result.score else None,
                }).execute()

        # Record the search itself
        await supabase.table("searches").insert({
            "user_id": user_id,
            "criteria": criteria.model_dump(mode="json"),
            "result_count": len(results),
        }).execute()
    except Exception as exc:
        log.warning("Failed to persist search results to Supabase: %s", exc)


@router.post("/search", response_model=SearchResponse)
async def search_properties(
    criteria: SearchCriteria,
    user_id: str | None = Depends(get_current_user),
) -> SearchResponse:
    """
    Full search pipeline:
    1. Normalize location via geocoding
    2. Fetch market snapshot (FRED, Census, HUD)
    3. Search for property listings
    4. Run analysis + scoring on each listing concurrently
    5. Persist results to Supabase (when authenticated)
    6. Return ranked results
    """
    if criteria.location_hint is not None:
        location = criteria.location_hint
    else:
        location = await geocoding_service.normalize_location(criteria.location)
        if not location:
            raise HTTPException(
                status_code=422,
                detail=f"Could not geocode location: '{criteria.location}'. Try a city, state, or zip code.",
            )

    market = await market_data_service.get_market_snapshot(location)

    price_per_sqft = market_data_service.get_price_per_sqft(market)
    median_rent = market_data_service.get_median_rent(market, beds=2)

    listings, search_warnings = await property_search_service.search(
        criteria,
        location,
        median_price_per_sqft=price_per_sqft,
        median_rent_2br=median_rent,
    )

    if not listings:
        return SearchResponse(
            location=location,
            market_snapshot=market,
            total_found=0,
            warnings=search_warnings + ["No listings found matching your criteria."],
        )

    NARRATIVE_SCORE_THRESHOLD = 40

    async def analyze_one(listing):
        comps = await comparables_service.find_comps(
            listing, market, goal=criteria.investment_goal.value
        )
        assumptions = await ai_service.generate_assumptions(
            listing=listing,
            market=market,
            comps=comps,
        )
        analysis = analysis_engine.analyze(
            listing=listing,
            goal=criteria.investment_goal,
            market=market,
            comps=comps,
            down_pct=criteria.down_payment_pct,
            ai_assumptions=assumptions,
        )
        score = calculate_investment_score(listing, analysis)

        if score.overall_score >= NARRATIVE_SCORE_THRESHOLD:
            analysis.ai_analysis = await ai_service.generate_narrative(
                listing=listing,
                analysis=analysis,
                market=market,
                goal=criteria.investment_goal,
                assumptions=assumptions,
            )
        else:
            analysis.ai_analysis = AIAnalysis(assumptions=assumptions, ai_available=False)

        return PropertyResult(listing=listing, analysis=analysis, score=score, comps=comps)

    results = await asyncio.gather(*[analyze_one(l) for l in listings], return_exceptions=True)

    valid_results: list[PropertyResult] = []
    for listing, r in zip(listings, results):
        if isinstance(r, Exception):
            search_warnings.append(
                f"Analysis skipped for {listing.address}: [{type(r).__name__}] {r}"
            )
        else:
            valid_results.append(r)

    valid_results.sort(key=lambda r: r.score.overall_score if r.score else 0, reverse=True)
    valid_results = valid_results[:20]

    # Persist to Supabase when we have an authenticated user
    if user_id:
        supabase = await get_supabase()
        if supabase:
            await _persist_results(valid_results, criteria, user_id, supabase)

    return SearchResponse(
        properties=valid_results,
        market_snapshot=market,
        location=location,
        total_found=len(valid_results),
        sources_used=market.data_sources_used,
        warnings=market.warnings + search_warnings,
    )


@router.get("/autocomplete", response_model=list[LocationSuggestion])
async def autocomplete_location(q: str = Query(min_length=2)) -> list[LocationSuggestion]:
    """Return location autocomplete suggestions."""
    return await geocoding_service.autocomplete(q)
