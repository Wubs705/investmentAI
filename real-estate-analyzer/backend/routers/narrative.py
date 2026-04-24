"""On-demand narrative router — POST /api/analysis/narrative/{property_id}.

The Sonnet narrative used to fire for every scored listing during search. That
was the largest single cost driver: ~20× Sonnet calls per search even when the
user only read 1–3 results. The narrative now fires on user click, and the
result is cached for 24h keyed on (property_id, goal) so repeat clicks — or
two users hitting the same listing — never pay twice.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from backend.auth import get_current_user
from backend.models.schemas import (
    AIAnalysis,
    InvestmentGoal,
    PropertyAnalysis,
    PropertyListing,
)
from backend.services.ai_service import ai_service
from backend.services.geocoding import geocoding_service
from backend.services.market_data import get_heat_score, market_data_service
from backend.utils.cache import cache_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/analysis", tags=["narrative"])

_PROPERTY_ID_RE = r"^[A-Za-z0-9_\-]+$"

NARRATIVE_CACHE_TTL = 86400  # 24h per spec — narratives don't change intraday
NARRATIVE_SCORE_THRESHOLD = 40


def _context_cache_key(property_id: str, goal: str) -> str:
    return f"analysis_context:{property_id}:{goal}"


def _narrative_cache_key(property_id: str, goal: str) -> str:
    return f"narrative:{property_id}:{goal}"


async def _rehydrate_from_supabase(
    property_id: str,
    goal: str,
    user_id: str | None,
) -> tuple[PropertyListing, PropertyAnalysis, object] | None:
    """Fall back to Supabase when the short-TTL context cache has expired.

    Returns (listing, analysis, market) or None if any piece is missing.
    Comps are not persisted but the narrative prompt does not require them.
    """
    # Imported lazily to avoid a module-level cycle with analysis.py.
    from backend.routers.analysis import (
        _fetch_latest_analysis_data,
        _fetch_property_data,
    )

    try:
        prop_data = await _fetch_property_data(property_id, user_id)
    except HTTPException:
        return None
    analysis_data = await _fetch_latest_analysis_data(property_id, user_id)
    if not analysis_data:
        return None

    try:
        listing = PropertyListing(**prop_data)
        analysis = PropertyAnalysis(**analysis_data)
    except Exception as exc:
        log.warning("Failed to rehydrate analysis from Supabase: %s", exc)
        return None

    if analysis.investment_goal.value != goal:
        return None

    location = await geocoding_service.normalize_location(f"{listing.city}, {listing.state}")
    if not location:
        return None
    market = await market_data_service.get_market_snapshot(location)
    return listing, analysis, market


@router.post("/narrative/{property_id}", response_model=AIAnalysis)
async def generate_property_narrative(
    property_id: str = Path(min_length=1, max_length=64, pattern=_PROPERTY_ID_RE),
    goal: InvestmentGoal = Query(..., description="Investment strategy the narrative should address."),
    user_id: str | None = Depends(get_current_user),
) -> AIAnalysis:
    """Generate (or return cached) the Sonnet narrative for one property.

    Flow:
      1. Narrative cache check (24h) — fast path, no rehydration.
      2. Rehydrate analysis context from short-TTL cache (1h, populated at
         search time). Logged-in users fall back to Supabase.
      3. Guard against below-threshold scores — mirrors the old inline gate.
      4. Fire Sonnet, cache, return.
    """
    goal_value = goal.value

    cached_narrative = cache_service.get(_narrative_cache_key(property_id, goal_value))
    if cached_narrative is not None:
        return cached_narrative

    context = cache_service.get(_context_cache_key(property_id, goal_value))
    if context is not None:
        listing = context["listing"]
        analysis = context["analysis"]
        market = context["market"]
        score_value = context.get("score", 0)
    else:
        fallback = await _rehydrate_from_supabase(property_id, goal_value, user_id)
        if fallback is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No analysis context for '{property_id}'. Run a fresh search, "
                    "or open Deep Analysis within 1 hour of the search."
                ),
            )
        listing, analysis, market = fallback
        score_value = NARRATIVE_SCORE_THRESHOLD  # Supabase persisted → trust prior filter

    if score_value < NARRATIVE_SCORE_THRESHOLD:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Investment score {score_value} is below the narrative review "
                f"threshold ({NARRATIVE_SCORE_THRESHOLD}). Deep analysis is reserved "
                "for higher-quality deals."
            ),
        )

    assumptions = analysis.ai_analysis.assumptions if analysis.ai_analysis else None
    # Heat score is deterministic from (market, goal); the cached helper hits
    # the same key the search router populated so we don't recompute.
    heat = get_heat_score(market, goal)
    narrative = await ai_service.generate_narrative(
        listing=listing,
        analysis=analysis,
        market=market,
        goal=goal,
        assumptions=assumptions,
        heat_score=heat.score,
        heat_components=heat.components,
    )

    cache_service.set(
        _narrative_cache_key(property_id, goal_value),
        narrative,
        ttl=NARRATIVE_CACHE_TTL,
    )
    return narrative
