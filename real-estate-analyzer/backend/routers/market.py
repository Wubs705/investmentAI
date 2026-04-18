"""Market router — GET /api/market/{location}."""

from fastapi import APIRouter, HTTPException, Path

from backend.models.schemas import MarketSnapshot
from backend.services.geocoding import geocoding_service
from backend.services.market_data import market_data_service

router = APIRouter(prefix="/api", tags=["market"])


@router.get("/market/{location:path}", response_model=MarketSnapshot)
async def get_market_data(
    location: str = Path(min_length=1, max_length=200),
) -> MarketSnapshot:
    """Return market snapshot for a given location string."""
    normalized = await geocoding_service.normalize_location(location)
    if not normalized:
        raise HTTPException(
            status_code=422,
            detail=f"Could not geocode location: '{location}'.",
        )
    return await market_data_service.get_market_snapshot(normalized)
