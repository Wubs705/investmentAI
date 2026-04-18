"""
Property search service.

Data source priority:
  1. Rentcast API — real active for-sale listings (MLS-sourced)
  2. Estated API — property enrichment (valuation, tax, structure)
  3. Demo data fallback — procedurally generated listings when live APIs are unreachable
"""

import asyncio
import hashlib
import logging
import random

import httpx

from backend.config import settings
from backend.models.schemas import NormalizedLocation, PropertyListing, SearchCriteria
from backend.services.geocoding import geocoding_service
from backend.utils.cache import cache_service

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Rentcast API — active listings
# ---------------------------------------------------------------------------

RENTCAST_BASE = "https://api.rentcast.io/v1"
RENTCAST_LISTINGS_SALE = f"{RENTCAST_BASE}/listings/sale"


def _rentcast_headers(key: str) -> dict[str, str]:
    return {
        "X-Api-Key": key,
        "Accept": "application/json",
    }


async def _fetch_rentcast_listings(
    location: NormalizedLocation,
    criteria: SearchCriteria,
    client: httpx.AsyncClient,
) -> list[dict]:
    """Fetch active for-sale listings from Rentcast."""
    if not settings.has_rentcast_key:
        return []

    params = {
        "city": location.city,
        "state": location.state_code,
        "status": "Active",
        "limit": settings.max_results,
        "radius": criteria.radius_miles,
    }
    if criteria.budget_min is not None:
        params["minPrice"] = criteria.budget_min
    if criteria.budget_max is not None:
        params["maxPrice"] = criteria.budget_max
    if location.zip_code:
        params["zipCode"] = location.zip_code

    try:
        r = await client.get(
            RENTCAST_LISTINGS_SALE,
            params=params,
            headers=_rentcast_headers(settings.rentcast_api_key),
            timeout=settings.rentcast_timeout_s,
        )
        if r.status_code != 200:
            logger.warning(
                "Rentcast listings request returned %s: %s",
                r.status_code,
                r.text[:200],
            )
            return []
        data = r.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and isinstance(data.get("listings"), list):
            return data["listings"]
        return []
    except httpx.TimeoutException:  # H6: explicit timeout path with structured log
        logger.warning("rentcast_timeout", extra={"params": {k: v for k, v in params.items() if k != "X-Api-Key"}})
        return []
    except Exception as exc:
        logger.warning("Rentcast listings request failed: %s", exc)
        return []


def _parse_rentcast_row(row: dict, location: NormalizedLocation) -> PropertyListing | None:
    """Parse one Rentcast listing dict into a PropertyListing."""
    try:
        price = _safe_int(row.get("price"))
        if not price or price <= 0:
            return None

        sqft = _safe_int(row.get("squareFootage")) or 1000

        address = (row.get("formattedAddress") or row.get("addressLine1") or "").strip()
        city = (row.get("city") or location.city).strip()
        state = (row.get("state") or location.state_code).strip()
        zip_code = str(row.get("zipCode") or location.zip_code or "").strip()

        prop_id_src = row.get("id") or f"{address}:{zip_code}"
        prop_id = hashlib.md5(f"rentcast:{prop_id_src}".encode()).hexdigest()[:12]

        beds = _safe_int(row.get("bedrooms")) or 3
        baths = _safe_float(row.get("bathrooms")) or 2.0

        lat = _safe_float(row.get("latitude"))
        lng = _safe_float(row.get("longitude"))

        prop_type_raw = (row.get("propertyType") or "").strip()
        prop_type = _normalize_prop_type(prop_type_raw)

        hoa = _safe_int(row.get("hoaFee") or (row.get("hoa") or {}).get("fee"))
        ppsf = round(price / sqft, 2)

        return PropertyListing(
            id=prop_id,
            address=address,
            city=city,
            state=state,
            zip_code=zip_code,
            lat=lat,
            lng=lng,
            list_price=price,
            bedrooms=beds,
            bathrooms=baths,
            sqft=sqft,
            lot_size_sqft=_safe_int(row.get("lotSize")),
            year_built=_safe_int(row.get("yearBuilt")),
            property_type=prop_type,
            days_on_market=_safe_int(row.get("daysOnMarket")),
            hoa_monthly=hoa,
            tax_annual=None,
            price_per_sqft=ppsf,
            description="",
            photos=row.get("photos") or [],
            listing_url=row.get("listingUrl") or "",
            source="rentcast",
            raw_data=dict(row),
        )
    except Exception as exc:
        logger.warning("Failed to parse Rentcast row: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Estated API — property enrichment
# ---------------------------------------------------------------------------

ESTATED_ENDPOINT = "https://apis.estated.com/v4/property"


async def _enrich_with_estated(
    listing: PropertyListing, client: httpx.AsyncClient
) -> PropertyListing:
    """
    Enrich a listing with Estated property details: valuation, tax assessment,
    and structural data. Silently returns the original listing on any failure.
    """
    if not settings.has_estated_key:
        return listing

    combined_address = f"{listing.address}, {listing.city}, {listing.state} {listing.zip_code}".strip()

    try:
        r = await client.get(
            ESTATED_ENDPOINT,
            params={
                "token": settings.estated_api_key,
                "combined_address": combined_address,
            },
            timeout=settings.estated_timeout_s,
        )
        if r.status_code != 200:
            return listing

        payload = r.json()
        data = payload.get("data") if isinstance(payload, dict) else None
        if not data:
            return listing

        valuation = data.get("valuation") or {}
        taxes = data.get("taxes") or []
        structure = data.get("structure") or {}

        latest_tax = None
        if isinstance(taxes, list) and taxes:
            latest_tax = _safe_int((taxes[0] or {}).get("amount"))

        enrichment = {
            "estated": {
                "valuation": valuation,
                "latest_tax": latest_tax,
                "structure": structure,
            }
        }

        updated_tax = latest_tax if latest_tax else listing.tax_annual
        year_built = _safe_int(structure.get("year_built")) or listing.year_built

        enriched = listing.model_copy(update={
            "raw_data": {**listing.raw_data, **enrichment},
            "tax_annual": updated_tax,
            "year_built": year_built,
        })
        # Record the Estated valuation as a secondary price signal
        if valuation.get("value"):
            enriched.raw_data["estated_value"] = _safe_int(valuation.get("value"))
        return enriched
    except Exception as exc:
        logger.debug("Estated enrichment failed for %s: %s", listing.address, exc)
        return listing


# ---------------------------------------------------------------------------
# Demo listing generator (fallback)
# ---------------------------------------------------------------------------

PROPERTY_TYPES_POOL = ["Single Family", "Single Family", "Single Family", "Condo", "Townhouse", "Multi-Family"]
STREET_NAMES = [
    "Oak", "Maple", "Cedar", "Pine", "Elm", "Birch", "Willow", "Ash", "Magnolia",
    "Pecan", "Walnut", "Hickory", "Laurel", "Vine", "Riverside", "Hillside", "Lakeview",
    "Sunrise", "Sunset", "Heritage", "Colonial", "Creekside", "Meadow", "Prairie",
]
STREET_TYPES = ["St", "Ave", "Dr", "Blvd", "Ln", "Way", "Ct", "Pl", "Rd", "Cir"]


def _generate_demo_listings(
    location: NormalizedLocation,
    criteria: SearchCriteria,
    count: int = 20,
    median_price_per_sqft: float = 175.0,
    median_rent_2br: int = 1500,  # noqa: ARG001
) -> list[PropertyListing]:
    """Realistic demo listings. Used when live listing APIs are unreachable."""
    rng = random.Random(f"{location.city}{location.state}{criteria.budget_min}{criteria.budget_max}")
    listings = []
    budget_range = criteria.budget_max - criteria.budget_min

    for i in range(count):
        price = int(criteria.budget_min + rng.random() * budget_range)
        prop_type = rng.choice(PROPERTY_TYPES_POOL)
        ppsf = median_price_per_sqft * rng.uniform(0.80, 1.25)
        sqft = max(600, round(int(price / ppsf) / 50) * 50)
        beds = max(1, min(6, round(sqft / 500)))
        if prop_type == "Condo":
            beds = min(beds, 3)
        baths = max(1.0, min(5.0, round(beds * rng.uniform(0.75, 1.25) * 2) / 2))
        year_built = rng.randint(1960, 2022)
        dom = rng.randint(0, 120) if rng.random() > 0.3 else None
        hoa = rng.randint(150, 500) if prop_type in ("Condo", "Townhouse") else (
            rng.randint(50, 200) if rng.random() > 0.7 else None
        )
        tax_annual = int(price * rng.uniform(0.008, 0.025))
        street_num = rng.randint(100, 9999)
        address = f"{street_num} {rng.choice(STREET_NAMES)} {rng.choice(STREET_TYPES)}"
        condition = rng.choice(["move-in ready", "well-maintained", "recently updated", "needs TLC", "great bones"])
        desc = (
            f"Beautiful {beds} bed/{baths} bath {prop_type.lower()} in {location.city}. "
            f"Built in {year_built}, {sqft:,} sq ft, {condition}. "
            f"{'HOA community. ' if hoa else ''}"
            f"Great {rng.choice(['location', 'investment opportunity', 'neighborhood', 'school district'])}."
        )
        prop_id = hashlib.md5(f"demo:{location.city}:{i}:{price}".encode()).hexdigest()[:12]
        listings.append(PropertyListing(
            id=prop_id,
            address=address,
            city=location.city,
            state=location.state_code,
            zip_code=location.zip_code or "",
            lat=round(location.lat + rng.uniform(-0.15, 0.15), 6),
            lng=round(location.lng + rng.uniform(-0.15, 0.15), 6),
            list_price=price,
            bedrooms=beds,
            bathrooms=baths,
            sqft=sqft,
            lot_size_sqft=int(sqft * rng.uniform(1.5, 4.0)) if prop_type != "Condo" else None,
            year_built=year_built,
            property_type=prop_type,
            days_on_market=dom,
            hoa_monthly=hoa,
            tax_annual=tax_annual,
            price_per_sqft=round(price / sqft, 2),
            description=desc,
            photos=[],
            listing_url="",
            source="demo",
            raw_data={},
        ))
    return listings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_prop_type(raw: str) -> str:
    mapping = {
        "SINGLE FAMILY": "Single Family",
        "SINGLE FAMILY RESIDENTIAL": "Single Family",
        "SINGLE_FAMILY": "Single Family",
        "CONDO": "Condo",
        "CONDO/CO-OP": "Condo",
        "CONDOMINIUM": "Condo",
        "TOWNHOUSE": "Townhouse",
        "MULTI-FAMILY": "Multi-Family",
        "MULTI-FAMILY (2-4 UNIT)": "Multi-Family",
        "MULTI_FAMILY": "Multi-Family",
        "APARTMENT": "Condo",
        "MANUFACTURED": "Single Family",
        "LOT": "Land",
        "LAND": "Land",
    }
    return mapping.get(raw.upper(), raw or "Single Family")


def _safe_int(val) -> int | None:
    try:
        v = int(float(str(val).replace(",", "").strip()))
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def _safe_float(val) -> float | None:
    try:
        v = float(str(val).replace(",", "").strip())
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Address geocoding for listings missing coordinates
# ---------------------------------------------------------------------------

async def _geocode_missing(listings: list[PropertyListing]) -> list[PropertyListing]:
    """
    For any listing whose lat/lng is None, attempt to resolve it via
    Nominatim using the full address string.  Listings that still have
    no coordinates after the attempt are dropped entirely.
    """
    resolved: list[PropertyListing] = []
    for listing in listings:
        if listing.lat is not None and listing.lng is not None:
            resolved.append(listing)
            continue

        query = f"{listing.address}, {listing.city}, {listing.state} {listing.zip_code}".strip()
        try:
            loc = await geocoding_service.normalize_location(query)
            if loc:
                resolved.append(listing.model_copy(update={"lat": loc.lat, "lng": loc.lng}))
            else:
                logger.debug("Could not geocode listing, dropping: %s", query)
        except Exception as exc:
            logger.debug("Geocoding failed for %s: %s", query, exc)

    return resolved


# ---------------------------------------------------------------------------
# Main service
# ---------------------------------------------------------------------------

class PropertySearchService:
    """
    Search for active property listings.

    Pipeline:
      1. Rentcast API → real active listings (requires RENTCAST_API_KEY)
      2. Estated API → property enrichment (requires ESTATED_API_KEY)
      3. Demo data fallback
    """

    async def search(
        self,
        criteria: SearchCriteria,
        location: NormalizedLocation,
        median_price_per_sqft: float = 175.0,
        median_rent_2br: int = 1500,  # noqa: ARG002 — used by demo generator
    ) -> tuple[list[PropertyListing], list[str]]:
        """Returns (listings, warnings)."""
        cache_key = (
            f"search:{location.city}:{location.state_code}:"
            f"{criteria.budget_min}:{criteria.budget_max}:{criteria.radius_miles}"
        )
        cached = cache_service.get(cache_key)
        if cached is not None:
            return [PropertyListing(**p) for p in cached["listings"]], cached["warnings"]

        listings: list[PropertyListing] = []
        warnings: list[str] = []

        listings, warnings = await self._fetch_from_rentcast(criteria, location, warnings)

        if not listings:
            warnings.append(
                "Could not retrieve live listings — showing demo data based on market stats."
            )
            listings = _generate_demo_listings(
                location, criteria,
                count=settings.max_results,
                median_price_per_sqft=median_price_per_sqft,
                median_rent_2br=median_rent_2br,
            )
        else:
            listings = await _geocode_missing(listings)
            if settings.has_estated_key:
                # Enrich the top 10 listings with Estated property details
                listings = await self._enrich_listings(listings[:10]) + listings[10:]

        # Enforce budget window on assembled listings (defense-in-depth)
        listings = [
            l for l in listings
            if (criteria.budget_min is None or l.list_price >= criteria.budget_min)
            and (criteria.budget_max is None or l.list_price <= criteria.budget_max)
        ]

        listings.sort(key=lambda p: p.list_price)

        cache_service.set(
            cache_key,
            {"listings": [p.model_dump() for p in listings], "warnings": warnings},
            ttl=settings.cache_ttl_hours * 3600,
        )
        return listings, warnings

    async def _fetch_from_rentcast(
        self,
        criteria: SearchCriteria,
        location: NormalizedLocation,
        warnings: list[str],
    ) -> tuple[list[PropertyListing], list[str]]:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            rows = await _fetch_rentcast_listings(location, criteria, client)

        if not rows:
            return [], warnings

        listings = []
        for row in rows[: settings.max_results]:
            listing = _parse_rentcast_row(row, location)
            if listing:
                listings.append(listing)

        if not listings:
            warnings.append("Rentcast returned data but no valid listings could be parsed.")

        return listings, warnings

    async def _enrich_listings(
        self, listings: list[PropertyListing]
    ) -> list[PropertyListing]:
        """Concurrently enrich listings with Estated property details."""
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            enriched = await asyncio.gather(
                *[_enrich_with_estated(l, client) for l in listings],
                return_exceptions=True,
            )
        return [
            e if isinstance(e, PropertyListing) else listings[i]
            for i, e in enumerate(enriched)
        ]


property_search_service = PropertySearchService()
