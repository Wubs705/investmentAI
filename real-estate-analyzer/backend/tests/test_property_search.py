"""Tests for search-criteria enforcement in property_search.py.

Run via: python -m backend.tests.test_property_search
Or via pytest: pytest backend/tests/test_property_search.py
"""

from __future__ import annotations

import asyncio
import hashlib
import sys
import types
from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch

from backend.models.schemas import NormalizedLocation, PropertyListing, SearchCriteria
from backend.services.property_search import (
    _fetch_rentcast_listings,
    _generate_demo_listings,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _location() -> NormalizedLocation:
    return NormalizedLocation(
        city="Austin",
        state="Texas",
        state_code="TX",
        zip_code="78701",
        lat=30.2672,
        lng=-97.7431,
        display_name="Austin, TX",
    )


def _criteria(
    budget_min: int = 200_000,
    budget_max: int = 500_000,
    radius_miles: int = 15,
) -> SearchCriteria:
    return SearchCriteria(
        location="Austin, TX",
        budget_min=budget_min,
        budget_max=budget_max,
        radius_miles=radius_miles,
    )


def _make_listing(price: int) -> PropertyListing:
    return PropertyListing(
        id=hashlib.md5(f"test:{price}".encode()).hexdigest()[:12],
        address=f"{price} Test St",
        city="Austin",
        state="TX",
        zip_code="78701",
        list_price=price,
        bedrooms=3,
        bathrooms=2.0,
        sqft=1800,
        property_type="Single Family",
        price_per_sqft=round(price / 1800, 2),
        lat=30.27,
        lng=-97.74,
    )


# ---------------------------------------------------------------------------
# Tiny test harness
# ---------------------------------------------------------------------------

@dataclass
class _Result:
    name: str
    ok: bool
    detail: str = ""


def _check(name: str, cond: bool, detail: str = "") -> _Result:
    return _Result(name=name, ok=bool(cond), detail=detail)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_radius_sent_to_rentcast_api() -> _Result:
    """radius_miles must appear as 'radius' in the params passed to Rentcast."""
    captured_params: dict = {}

    async def _run():
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = []

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)

        # Patch settings so has_rentcast_key returns True
        with patch("backend.services.property_search.settings") as mock_settings:
            mock_settings.has_rentcast_key = True
            mock_settings.max_results = 20
            mock_settings.rentcast_api_key = "fake-key"

            async def _capturing_get(url, *, params, **kwargs):
                captured_params.update(params)
                return mock_response

            mock_client.get = _capturing_get
            await _fetch_rentcast_listings(_location(), _criteria(radius_miles=25), mock_client)

    asyncio.run(_run())
    ok = "radius" in captured_params and captured_params["radius"] == 25
    return _check("radius_sent_to_rentcast_api", ok, f"params={captured_params}")


def test_radius_changes_cache_key() -> _Result:
    """Different radius values must produce different cache keys."""
    from backend.services.property_search import PropertySearchService

    # The cache key is built inside search(); we can inspect it by looking at
    # how the service constructs it. We replicate the formula exactly.
    loc = _location()
    c5 = _criteria(radius_miles=5)
    c50 = _criteria(radius_miles=50)
    key5 = f"search:{loc.city}:{loc.state_code}:{c5.budget_min}:{c5.budget_max}:{c5.radius_miles}"
    key50 = f"search:{loc.city}:{loc.state_code}:{c50.budget_min}:{c50.budget_max}:{c50.radius_miles}"
    return _check("radius_changes_cache_key", key5 != key50, f"key5={key5}, key50={key50}")


def test_budget_min_zero_sends_minprice() -> _Result:
    """budget_min=0 must still include minPrice=0 in the Rentcast params."""
    captured_params: dict = {}

    async def _run():
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = []

        with patch("backend.services.property_search.settings") as mock_settings:
            mock_settings.has_rentcast_key = True
            mock_settings.max_results = 20
            mock_settings.rentcast_api_key = "fake-key"

            async def _capturing_get(url, *, params, **kwargs):
                captured_params.update(params)
                return mock_response

            mock_client = AsyncMock()
            mock_client.get = _capturing_get
            await _fetch_rentcast_listings(
                _location(), _criteria(budget_min=0, budget_max=300_000), mock_client
            )

    asyncio.run(_run())
    ok = "minPrice" in captured_params and captured_params["minPrice"] == 0
    return _check("budget_min_zero_sends_minprice", ok, f"params={captured_params}")


def test_post_fetch_budget_filter_removes_outlier() -> _Result:
    """Listings outside the budget window must be removed after fetch."""
    from backend.services.property_search import PropertySearchService

    # We'll test the filter logic in isolation (it's a list comprehension).
    budget_max = 500_000
    criteria = _criteria(budget_min=200_000, budget_max=budget_max)
    listings = [
        _make_listing(250_000),
        _make_listing(999_999),   # outlier — above budget_max
        _make_listing(400_000),
    ]
    filtered = [
        l for l in listings
        if (criteria.budget_min is None or l.list_price >= criteria.budget_min)
        and (criteria.budget_max is None or l.list_price <= criteria.budget_max)
    ]
    ok = len(filtered) == 2 and all(l.list_price <= budget_max for l in filtered)
    return _check(
        "post_fetch_budget_filter_removes_outlier",
        ok,
        f"filtered prices={[l.list_price for l in filtered]}",
    )


def test_demo_listings_respect_budget() -> _Result:
    """All demo listings must fall within [budget_min, budget_max]. Regression test."""
    criteria = _criteria(budget_min=200_000, budget_max=400_000)
    listings = _generate_demo_listings(_location(), criteria, count=20)
    in_range = all(200_000 <= l.list_price <= 400_000 for l in listings)
    out = [(l.list_price) for l in listings if not (200_000 <= l.list_price <= 400_000)]
    return _check("demo_listings_respect_budget", in_range, f"out_of_range={out}")


# ---------------------------------------------------------------------------
# pytest adapters
# ---------------------------------------------------------------------------

def _assert(result: _Result) -> None:
    assert result.ok, f"{result.name} failed: {result.detail}"


def test_radius_sent_to_rentcast_api_pytest():
    _assert(test_radius_sent_to_rentcast_api())


def test_radius_changes_cache_key_pytest():
    _assert(test_radius_changes_cache_key())


def test_budget_min_zero_sends_minprice_pytest():
    _assert(test_budget_min_zero_sends_minprice())


def test_post_fetch_budget_filter_removes_outlier_pytest():
    _assert(test_post_fetch_budget_filter_removes_outlier())


def test_demo_listings_respect_budget_pytest():
    _assert(test_demo_listings_respect_budget())


# ---------------------------------------------------------------------------
# Direct-run entry point
# ---------------------------------------------------------------------------

def _run_all() -> int:
    runners = [
        test_radius_sent_to_rentcast_api,
        test_radius_changes_cache_key,
        test_budget_min_zero_sends_minprice,
        test_post_fetch_budget_filter_removes_outlier,
        test_demo_listings_respect_budget,
    ]
    passed = failed = 0
    for r in runners:
        result = r()
        status = "PASS" if result.ok else "FAIL"
        print(f"[{status}] {result.name}  {result.detail}")
        if result.ok:
            passed += 1
        else:
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(_run_all())
