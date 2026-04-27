"""Tests for the hyperlocal rehab cost index service.

Runnable via:
  pytest backend/tests/test_rehab_cost_index.py
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.models.schemas import NormalizedLocation
from backend.services.rehab_cost_index import (
    NATIONAL_BASELINE_BLENDED,
    RehabCostIndex,
    RehabCostIndexService,
    _compute_calibrated_costs,
    _fetch_bls_labor_index,
    _get_cbsa_crosswalk,
    _resolve_cbsa,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_location(city: str, state_code: str, zip_code: str | None = None) -> NormalizedLocation:
    return NormalizedLocation(
        city=city,
        state=state_code,
        state_code=state_code,
        zip_code=zip_code,
        lat=0.0,
        lng=0.0,
        display_name=f"{city}, {state_code}",
    )


# ---------------------------------------------------------------------------
# Unit tests for _compute_calibrated_costs
# ---------------------------------------------------------------------------

def test_calibrated_costs_scale_with_labor_index():
    """cosmetic/moderate/full_gut scale proportionally with labor_index (no permit data)."""
    cosmetic, moderate, full_gut = _compute_calibrated_costs(1.4, None, 0)
    assert cosmetic == pytest.approx(40.0 * 1.4, abs=1)
    assert moderate == pytest.approx(95.0 * 1.4, abs=1)
    assert full_gut == pytest.approx(180.0 * 1.4, abs=1)


def test_permit_blend_at_30_samples():
    """40% weight applied to permit data when sample >= 30."""
    cosmetic, moderate, full_gut = _compute_calibrated_costs(1.0, 80.0, 35)
    assert moderate == pytest.approx(0.6 * 95.0 + 0.4 * 80.0, abs=1)


def test_permit_blend_at_10_samples():
    """20% weight applied to permit data when 10 <= sample < 30."""
    _, moderate, _ = _compute_calibrated_costs(1.0, 80.0, 15)
    assert moderate == pytest.approx(0.8 * 95.0 + 0.2 * 80.0, abs=1)


def test_permit_ignored_below_10_samples():
    """Permit data with fewer than 10 records is ignored entirely."""
    _, moderate, _ = _compute_calibrated_costs(1.0, 10.0, 5)
    assert moderate == pytest.approx(95.0, abs=0.1)


def test_hardcoded_floor_not_breached():
    """Result never drops below 50% of national baseline."""
    cosmetic, moderate, full_gut = _compute_calibrated_costs(0.1, 5.0, 100)
    assert cosmetic >= 40.0 * 0.5
    assert moderate >= 95.0 * 0.5
    assert full_gut >= 180.0 * 0.5


def test_hardcoded_ceiling_not_breached():
    """Result never exceeds 250% of national baseline."""
    cosmetic, moderate, full_gut = _compute_calibrated_costs(10.0, 5000.0, 100)
    assert cosmetic <= 40.0 * 2.5
    assert moderate <= 95.0 * 2.5
    assert full_gut <= 180.0 * 2.5


def test_national_baseline_no_data():
    """labor_index=1.0, no permit data → returns exact national baselines."""
    cosmetic, moderate, full_gut = _compute_calibrated_costs(1.0, None, 0)
    assert cosmetic == pytest.approx(40.0)
    assert moderate == pytest.approx(95.0)
    assert full_gut == pytest.approx(180.0)


# ---------------------------------------------------------------------------
# BLS failure → safe fallback
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_labor_index_at_one_on_api_failure():
    """BLS API failure returns 1.0 (safe no-op fallback)."""
    import httpx

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.side_effect = Exception("connection refused")

    with patch("backend.services.rehab_cost_index.cache_service") as mock_cache:
        mock_cache.get.return_value = None
        result = await _fetch_bls_labor_index("41940", mock_client)

    assert result == 1.0


@pytest.mark.asyncio
async def test_labor_index_at_one_on_empty_response():
    """BLS response with no series data returns 1.0."""
    import httpx

    mock_response = MagicMock()
    mock_response.json.return_value = {"Results": {"series": []}}

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.return_value = mock_response

    with patch("backend.services.rehab_cost_index.cache_service") as mock_cache:
        mock_cache.get.return_value = None
        result = await _fetch_bls_labor_index("41940", mock_client)

    assert result == 1.0


# ---------------------------------------------------------------------------
# Full pipeline with mocked APIs
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_full_pipeline_with_mocked_apis():
    """get_rehab_cost_index returns a valid RehabCostIndex for San Jose."""
    import httpx

    # BLS response: wages ~40% above national baseline
    bls_wages = NATIONAL_BASELINE_BLENDED * 1.4
    mock_bls_response = MagicMock()
    mock_bls_response.json.return_value = {
        "Results": {
            "series": [
                {"data": [{"value": str(bls_wages)}]},
                {"data": [{"value": str(bls_wages)}]},
                {"data": [{"value": str(bls_wages)}]},
                {"data": [{"value": str(bls_wages)}]},
            ]
        }
    }

    # Permit response: 40 residential rehab records with clear cost/sqft
    permit_rows = [
        {
            "estimated_cost": str(80 * sqft),
            "square_feet": str(sqft),
            "description": "bathroom remodel",
        }
        for sqft in range(500, 1500, 25)  # 40 rows
    ]
    mock_permit_response = MagicMock()
    mock_permit_response.json.return_value = permit_rows

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.return_value = mock_bls_response
    mock_client.get.return_value = mock_permit_response
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    location = _make_location("San Jose", "CA", "95112")
    service = RehabCostIndexService()

    with patch("backend.services.rehab_cost_index.cache_service") as mock_cache:
        mock_cache.get.return_value = None
        mock_cache.set.return_value = None
        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await service.get_rehab_cost_index(location)

    assert isinstance(result, RehabCostIndex)
    assert result.labor_index > 1.0
    assert result.permit_sample_size >= 10
    assert result.cosmetic_per_sqft > 40.0
    assert result.moderate_per_sqft > 95.0
    assert result.full_gut_per_sqft > 180.0
    assert result.confidence in ("high", "medium")


# ---------------------------------------------------------------------------
# Cache hit
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_rehab_index_cache_hit():
    """Second call for same location returns cached result without hitting APIs."""
    location = _make_location("San Jose", "CA", "95112")
    service = RehabCostIndexService()

    cached_data = {
        "cosmetic_per_sqft": 56.0,
        "moderate_per_sqft": 133.0,
        "full_gut_per_sqft": 252.0,
        "labor_index": 1.4,
        "permit_sample_size": 45,
        "permit_median_cost_per_sqft": 85.0,
        "data_sources": ["BLS OEWS labor data", "45 local permits"],
        "confidence": "high",
    }

    with patch("backend.services.rehab_cost_index.cache_service") as mock_cache:
        mock_cache.get.return_value = cached_data
        with patch("httpx.AsyncClient") as mock_httpx:
            result = await service.get_rehab_cost_index(location)
            mock_httpx.assert_not_called()

    assert result.labor_index == 1.4
    assert result.permit_sample_size == 45
    assert result.confidence == "high"


# ---------------------------------------------------------------------------
# Census CBSA crosswalk
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_crosswalk_resolves_wichita():
    """Census crosswalk maps Wichita, KS to CBSA 48620."""
    import backend.services.rehab_cost_index as module

    # Build a minimal crosswalk that includes Wichita
    fake_crosswalk = {
        ("wichita", "ks"): "48620",
        ("san jose", "ca"): "41940",
    }

    orig = module._cbsa_crosswalk
    module._cbsa_crosswalk = fake_crosswalk
    try:
        location = _make_location("Wichita", "KS", "67202")
        mock_client = AsyncMock()
        cbsa = await _resolve_cbsa(location, mock_client)
        assert cbsa == "48620"
    finally:
        module._cbsa_crosswalk = orig


@pytest.mark.asyncio
async def test_crosswalk_static_map_takes_priority():
    """Static map short-circuits crosswalk for the 10 known permit cities."""
    import backend.services.rehab_cost_index as module

    orig = module._cbsa_crosswalk
    module._cbsa_crosswalk = {}   # empty crosswalk — should not matter
    try:
        location = _make_location("San Jose", "CA", "95112")
        mock_client = AsyncMock()
        cbsa = await _resolve_cbsa(location, mock_client)
        assert cbsa == "41940"   # came from _STATIC_CBSA
    finally:
        module._cbsa_crosswalk = orig


@pytest.mark.asyncio
async def test_crosswalk_download_and_parse():
    """_get_cbsa_crosswalk parses the Excel bytes correctly."""
    import openpyxl, io as stdlib_io
    import backend.services.rehab_cost_index as module

    # Build a minimal Excel workbook with the same structure as the Census file
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["metadata row 1"])
    ws.append(["metadata row 2"])
    ws.append(["CBSA Code", "MetDiv", "CSA", "CBSA Title", "Type", "MetDiv Title", "CSA Title",
               "County", "State Name", "FIPS State", "FIPS County", "C/O"])
    ws.append(["48620", None, None, "Wichita, KS", "Metropolitan Statistical Area",
               None, None, "Sedgwick County", "Kansas", "20", "173", "Central"])
    ws.append(["12420", None, None, "Austin-Round Rock-San Marcos, TX", "Metropolitan Statistical Area",
               None, None, "Travis County", "Texas", "48", "453", "Central"])
    ws.append(["35620", None, None, "Kansas City, MO-KS", "Metropolitan Statistical Area",
               None, None, "Jackson County", "Missouri", "29", "095", "Central"])

    buf = stdlib_io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    excel_bytes = buf.read()

    # Mock the HTTP GET to return our fake workbook
    mock_response = MagicMock()
    mock_response.content = excel_bytes
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get.return_value = mock_response

    orig = module._cbsa_crosswalk
    module._cbsa_crosswalk = None
    try:
        with patch("backend.services.rehab_cost_index.cache_service") as mock_cache:
            mock_cache.get.return_value = None
            mock_cache.set.return_value = None
            crosswalk = await _get_cbsa_crosswalk(mock_client)

        assert crosswalk[("wichita", "ks")] == "48620"
        assert crosswalk[("austin", "tx")] == "12420"
        assert crosswalk[("round rock", "tx")] == "12420"
        assert crosswalk[("san marcos", "tx")] == "12420"
        # Multi-state metro: Kansas City appears in both MO and KS
        assert crosswalk[("kansas city", "mo")] == "35620"
        assert crosswalk[("kansas city", "ks")] == "35620"
    finally:
        module._cbsa_crosswalk = orig


@pytest.mark.asyncio
async def test_crosswalk_download_failure_returns_empty():
    """Crosswalk download failure falls back to empty dict (BLS still skipped gracefully)."""
    import backend.services.rehab_cost_index as module

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.get.side_effect = Exception("network error")

    orig = module._cbsa_crosswalk
    module._cbsa_crosswalk = None
    try:
        with patch("backend.services.rehab_cost_index.cache_service") as mock_cache:
            mock_cache.get.return_value = None
            crosswalk = await _get_cbsa_crosswalk(mock_client)
        assert crosswalk == {}
    finally:
        module._cbsa_crosswalk = orig


@pytest.mark.asyncio
async def test_wichita_acceptance_criterion():
    """get_rehab_cost_index for Wichita returns labor_index < 1.0 when BLS data available.

    Wichita is a below-average construction cost market (CBSA 48620).
    We mock the BLS response to return wages 15% below national baseline.
    """
    import backend.services.rehab_cost_index as module

    # Prime the crosswalk so Wichita resolves to CBSA 48620
    below_avg_wage = NATIONAL_BASELINE_BLENDED * 0.85
    mock_bls_response = MagicMock()
    mock_bls_response.json.return_value = {
        "Results": {
            "series": [{"data": [{"value": str(below_avg_wage)}]} for _ in range(4)]
        }
    }

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.return_value = mock_bls_response
    mock_client.get.return_value = MagicMock(json=MagicMock(return_value=[]))  # no permit data
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    orig_crosswalk = module._cbsa_crosswalk
    module._cbsa_crosswalk = {("wichita", "ks"): "48620"}
    try:
        location = _make_location("Wichita", "KS", "67202")
        service = RehabCostIndexService()

        with patch("backend.services.rehab_cost_index.cache_service") as mock_cache:
            mock_cache.get.return_value = None
            mock_cache.set.return_value = None
            with patch("httpx.AsyncClient", return_value=mock_client):
                result = await service.get_rehab_cost_index(location)

        assert result.labor_index < 1.0, f"Expected labor_index < 1.0, got {result.labor_index}"
        assert result.confidence in ("medium", "low")  # no permit data for Wichita
    finally:
        module._cbsa_crosswalk = orig_crosswalk
