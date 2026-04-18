import asyncio
import time

import httpx

from backend.models.schemas import NormalizedLocation, LocationSuggestion
from backend.utils.cache import cache_service


class GeocodingService:
    """Geocoding service using Nominatim (OpenStreetMap) for both geocoding and autocomplete."""

    BASE_URL = "https://nominatim.openstreetmap.org"
    HEADERS = {"User-Agent": "RealEstateInvestmentAnalyzer/1.0"}

    def __init__(self):
        self._last_request_time = 0.0
        self._lock = asyncio.Lock()

    async def _rate_limit(self):
        """Enforce 1 request per second for Nominatim policy."""
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_request_time
            if elapsed < 1.0:
                await asyncio.sleep(1.0 - elapsed)
            self._last_request_time = time.monotonic()

    async def normalize_location(self, query: str) -> NormalizedLocation | None:
        """Normalize any location input into a structured location object."""
        cache_key = f"geocode:{query.lower().strip()}"
        cached = cache_service.get(cache_key)
        if cached is not None:
            return NormalizedLocation(**cached)

        await self._rate_limit()

        async with httpx.AsyncClient(headers=self.HEADERS, timeout=10) as client:
            params = {
                "q": query,
                "format": "jsonv2",
                "countrycodes": "us",
                "limit": 1,
                "addressdetails": 1,
            }
            resp = await client.get(f"{self.BASE_URL}/search", params=params)
            resp.raise_for_status()
            results = resp.json()

        if not results:
            return None

        result = results[0]
        address = result.get("address", {})

        location = NormalizedLocation(
            city=address.get("city") or address.get("town") or address.get("village") or query,
            state=address.get("state", ""),
            state_code=address.get("ISO3166-2-lvl4", "").replace("US-", ""),
            zip_code=address.get("postcode"),
            county=address.get("county"),
            lat=float(result["lat"]),
            lng=float(result["lon"]),
            display_name=result.get("display_name", query),
        )

        cache_service.set(cache_key, location.model_dump(), ttl=86400 * 7)
        return location

    async def autocomplete(self, partial: str) -> list[LocationSuggestion]:
        """Get location suggestions for autocomplete via Nominatim."""
        if len(partial.strip()) < 2:
            return []

        cache_key = f"autocomplete:{partial.lower().strip()}"
        cached = cache_service.get(cache_key)
        if cached is not None:
            return [LocationSuggestion(**s) for s in cached]

        suggestions = await self._autocomplete_nominatim(partial)
        cache_service.set(cache_key, [s.model_dump() for s in suggestions], ttl=300)
        return suggestions

    async def _autocomplete_nominatim(self, partial: str) -> list[LocationSuggestion]:
        """Autocomplete via Nominatim (subject to 1 req/sec limit)."""
        await self._rate_limit()

        async with httpx.AsyncClient(headers=self.HEADERS, timeout=10) as client:
            params = {
                "q": partial,
                "format": "jsonv2",
                "countrycodes": "us",
                "limit": 5,
                "addressdetails": 1,
            }
            resp = await client.get(f"{self.BASE_URL}/search", params=params)
            resp.raise_for_status()
            results = resp.json()

        suggestions = []
        seen: set[str] = set()
        for r in results:
            addr = r.get("address", {})
            city = addr.get("city") or addr.get("town") or addr.get("village") or ""
            state = addr.get("state", "")
            if city:
                display = f"{city}, {state}" if state else city
                if display not in seen:
                    seen.add(display)
                    suggestions.append(LocationSuggestion(
                        display_name=display,
                        city=city,
                        state=state,
                        lat=float(r["lat"]),
                        lng=float(r["lon"]),
                    ))
        return suggestions


geocoding_service = GeocodingService()
