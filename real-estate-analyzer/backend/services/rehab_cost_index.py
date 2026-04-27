"""
Hyperlocal rehab cost index.

Builds a calibrated $/sqft cost table for three rehab scopes
(Cosmetic, Moderate, Full Gut) using:
  1. BLS OEWS metro-level labor wages for the four key construction trades
  2. City/county open permit data for historical residential project costs

Falls back gracefully to hardcoded national baselines when APIs are
unavailable. All results are cached to disk to minimize API calls.
"""

import asyncio
import io
import logging
import statistics
from dataclasses import dataclass, field

import httpx

from backend.config import settings
from backend.models.schemas import NormalizedLocation
from backend.utils.cache import cache_service

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# National baseline wages (BLS 2024, mean hourly)
# ---------------------------------------------------------------------------
NATIONAL_BASELINE_WAGES = {
    "472031": 26.50,   # Carpenters
    "472111": 30.40,   # Electricians
    "472152": 30.00,   # Plumbers
    "472181": 24.80,   # Roofers
}
NATIONAL_BASELINE_BLENDED = sum(NATIONAL_BASELINE_WAGES.values()) / len(NATIONAL_BASELINE_WAGES)

# ---------------------------------------------------------------------------
# Census CBSA crosswalk
# ---------------------------------------------------------------------------
CBSA_CROSSWALK_URL = (
    "https://www2.census.gov/programs-surveys/metro-micro/"
    "geographies/reference-files/2023/delineation-files/list1_2023.xlsx"
)

# Eagerly-resolved static map for the 10 permit cities — avoids the crosswalk
# download on first hit for the most common searches.
_STATIC_CBSA: dict[str, str] = {
    "san francisco": "41860",
    "san jose":      "41940",
    "los angeles":   "31080",
    "seattle":       "42660",
    "chicago":       "16980",
    "austin":        "12420",
    "new york":      "35620",
    "denver":        "19740",
    "portland":      "38900",
    "phoenix":       "38060",
}

# Module-level in-process cache; populated on first use
_cbsa_crosswalk: dict[tuple[str, str], str] | None = None
_cbsa_lock = asyncio.Lock()


async def _get_cbsa_crosswalk(client: httpx.AsyncClient) -> dict[tuple[str, str], str]:
    """Return {(city_lower, state_code_lower): cbsa_code} for all US CBSAs.

    Downloads the Census delineation Excel file on first call; subsequent calls
    return the in-process or diskcache copy.  TTL = 90 days.
    """
    global _cbsa_crosswalk
    if _cbsa_crosswalk is not None:
        return _cbsa_crosswalk

    async with _cbsa_lock:
        if _cbsa_crosswalk is not None:
            return _cbsa_crosswalk

        cache_key = "cbsa_crosswalk_2023"
        cached = cache_service.get(cache_key)
        if cached is not None:
            _cbsa_crosswalk = cached
            return _cbsa_crosswalk

        try:
            import openpyxl  # optional dep; present after pip install openpyxl

            r = await client.get(CBSA_CROSSWALK_URL, timeout=30.0)
            wb = openpyxl.load_workbook(io.BytesIO(r.content), read_only=True)
            ws = wb.active

            lookup: dict[tuple[str, str], str] = {}
            for idx, row in enumerate(ws.iter_rows(values_only=True)):
                if idx < 3:      # rows 1-2: metadata; row 3: header
                    continue
                cbsa_code = str(row[0]).strip() if row[0] else None
                cbsa_title = str(row[3]).strip() if row[3] else None
                if not cbsa_code or not cbsa_title or cbsa_code == "None":
                    continue

                # CBSA titles look like: "San Jose-Sunnyvale-Santa Clara, CA"
                # or multi-state:        "Kansas City, MO-KS"
                if ", " not in cbsa_title:
                    continue
                city_part, state_part = cbsa_title.rsplit(", ", 1)

                # state_part may be "MO-KS"; extract 2-letter codes only
                state_codes = [
                    s.strip().lower()
                    for s in state_part.replace("-", " ").split()
                    if len(s.strip()) == 2 and s.strip().isalpha()
                ]
                cities = [c.strip().lower() for c in city_part.split("-")]

                for city in cities:
                    for sc in state_codes:
                        key = (city, sc)
                        if key not in lookup:    # keep first/primary CBSA
                            lookup[key] = cbsa_code

            wb.close()
            cache_service.set(cache_key, lookup, ttl=60 * 60 * 24 * 90)  # 90 days
            _cbsa_crosswalk = lookup
            logger.info("Loaded Census CBSA crosswalk: %d city/state pairs", len(lookup))
            return lookup

        except Exception:
            logger.warning("Census CBSA crosswalk download failed; BLS lookup unavailable")
            _cbsa_crosswalk = {}
            return _cbsa_crosswalk


async def _resolve_cbsa(location: NormalizedLocation, client: httpx.AsyncClient) -> str | None:
    """Return the 5-digit CBSA code for *location*, or None if not resolvable."""
    city = location.city.lower()
    state = location.state_code.lower()

    # 1. Static map — instant, covers the 10 permit cities
    cbsa = _STATIC_CBSA.get(city)
    if cbsa:
        return cbsa

    # 2. Census crosswalk — covers the full US
    crosswalk = await _get_cbsa_crosswalk(client)
    cbsa = crosswalk.get((city, state))
    if cbsa:
        return cbsa

    logger.debug("No CBSA found for %s, %s", location.city, location.state_code)
    return None


# ---------------------------------------------------------------------------
# Permit API endpoints (Socrata + one CSV)
# ---------------------------------------------------------------------------
PERMIT_APIS: dict[str, str] = {
    "san francisco": "https://data.sfgov.org/resource/p4e4-a99a.json",
    "los angeles":   "https://data.lacity.org/resource/nbyu-2ha9.json",
    "seattle":       "https://data.seattle.gov/resource/uyyd-8gak.json",
    "chicago":       "https://data.cityofchicago.org/resource/ydr8-5enu.json",
    "austin":        "https://data.austintexas.gov/resource/3syk-w9eu.json",
    "new york":      "https://data.cityofnewyork.us/resource/ipu4-2q9a.json",
    "denver":        "https://www.denvergov.org/media/gis/DataCatalog/building_permits/csv/building_permits.csv",
    "portland":      "https://opendata.portland.gov/resource/ij28-pzz9.json",
    "phoenix":       "https://phoenixopendata.com/resource/gpn8-4cxi.json",
    "san jose":      "https://data.sanjoseca.gov/resource/3qem-6v3v.json",
}

# Keywords that flag a residential rehab permit
REHAB_KEYWORDS = ["remodel", "renovation", "rehab", "repair", "addition", "kitchen", "bathroom", "roof"]


# ---------------------------------------------------------------------------
# Output dataclass
# ---------------------------------------------------------------------------

@dataclass
class RehabCostIndex:
    cosmetic_per_sqft: float
    moderate_per_sqft: float
    full_gut_per_sqft: float
    labor_index: float
    permit_sample_size: int
    permit_median_cost_per_sqft: float | None
    data_sources: list[str] = field(default_factory=list)
    confidence: str = "low"


# ---------------------------------------------------------------------------
# BLS labor index
# ---------------------------------------------------------------------------

async def _fetch_bls_labor_index(cbsa_code: str, client: httpx.AsyncClient) -> float:
    """Return a labor-cost multiplier vs the national baseline (1.0 = avg).

    Returns 1.0 on any failure so callers always get a usable multiplier.
    """
    cache_key = f"bls_labor:{cbsa_code}"
    cached = cache_service.get(cache_key)
    if cached is not None:
        return cached

    series_ids = [
        f"OEUM{cbsa_code.zfill(7)}000000{occ}03"
        for occ in ["472031", "472111", "472152", "472181"]
    ]
    payload: dict = {
        "seriesid": series_ids,
        "startyear": "2023",
        "endyear": "2024",
    }
    if settings.bls_api_key:
        payload["registrationkey"] = settings.bls_api_key

    try:
        r = await client.post(
            "https://api.bls.gov/publicAPI/v2/timeseries/data/",
            json=payload,
            timeout=15.0,
        )
        data = r.json()
        wages: list[float] = []
        for series in data.get("Results", {}).get("series", []):
            latest = series.get("data", [{}])[0]
            val_str = latest.get("value", "")
            try:
                val = float(val_str)
                if val > 0:
                    wages.append(val)
            except (ValueError, TypeError):
                pass

        if not wages:
            return 1.0

        local_blended = sum(wages) / len(wages)
        index = round(local_blended / NATIONAL_BASELINE_BLENDED, 3)
        cache_service.set(cache_key, index, ttl=60 * 60 * 24 * 30)  # 30 days
        return index
    except Exception:
        logger.debug("BLS labor index fetch failed for CBSA %s", cbsa_code)
        return 1.0


# ---------------------------------------------------------------------------
# Permit data aggregation
# ---------------------------------------------------------------------------

def _parse_permit_row(row: dict) -> dict | None:
    """Extract cost and sqft from a permit row using common field name variants."""
    cost: float | None = None
    for key in ("estimated_cost", "declared_valuation", "job_value", "valuation", "permit_value", "cost_estimate"):
        raw = row.get(key)
        if raw is not None:
            try:
                cost = float(str(raw).replace(",", "").replace("$", ""))
                break
            except (ValueError, TypeError):
                pass

    sqft: float | None = None
    for key in ("square_feet", "sqft", "floor_area", "sq_ft", "total_sqft", "square_footage"):
        raw = row.get(key)
        if raw is not None:
            try:
                sqft = float(str(raw).replace(",", ""))
                break
            except (ValueError, TypeError):
                pass

    if cost is None or sqft is None:
        return None

    # Description filter — must mention a rehab-type scope
    desc = " ".join(
        str(row.get(k, ""))
        for k in ("description", "permit_type", "work_type", "work_description", "type")
    ).lower()
    if not any(kw in desc for kw in REHAB_KEYWORDS):
        return None

    return {"cost": cost, "sqft": sqft}


async def _fetch_permit_data(
    location: NormalizedLocation,
    client: httpx.AsyncClient,
) -> tuple[float | None, int]:
    """Return (median_cost_per_sqft, sample_size) for the city, or (None, 0)."""
    city_key = location.city.lower()
    endpoint = PERMIT_APIS.get(city_key)
    if not endpoint:
        for key, url in PERMIT_APIS.items():
            if key in city_key or city_key in key:
                endpoint = url
                break
    if not endpoint:
        return None, 0

    cache_key = f"permits:{city_key}"
    cached = cache_service.get(cache_key)
    if cached is not None:
        return cached

    try:
        result = (
            await _fetch_denver_csv(endpoint, client)
            if endpoint.endswith(".csv")
            else await _fetch_socrata(endpoint, client)
        )
        cache_service.set(cache_key, result, ttl=60 * 60 * 24 * 7)  # 7 days
        return result
    except Exception:
        logger.debug("Permit fetch failed for %s", city_key)
        return None, 0


async def _fetch_socrata(endpoint: str, client: httpx.AsyncClient) -> tuple[float | None, int]:
    params = {"$limit": "500", "$order": "issued_date DESC"}
    r = await client.get(endpoint, params=params, timeout=15.0)
    rows_raw: list[dict] = r.json()

    valid: list[float] = []
    for row in rows_raw:
        parsed = _parse_permit_row(row)
        if parsed and parsed["sqft"] > 200 and parsed["cost"] > 1000:
            valid.append(parsed["cost"] / parsed["sqft"])

    if len(valid) < 10:
        return None, len(valid)
    return statistics.median(valid), len(valid)


async def _fetch_denver_csv(endpoint: str, client: httpx.AsyncClient) -> tuple[float | None, int]:
    r = await client.get(endpoint, timeout=20.0)
    lines = r.text.splitlines()
    if not lines:
        return None, 0

    header = [h.strip().lower() for h in lines[0].split(",")]
    valid: list[float] = []
    for line in lines[1:501]:
        parts = line.split(",")
        row = {header[i]: parts[i].strip() if i < len(parts) else "" for i in range(len(header))}
        parsed = _parse_permit_row(row)
        if parsed and parsed["sqft"] > 200 and parsed["cost"] > 1000:
            valid.append(parsed["cost"] / parsed["sqft"])

    if len(valid) < 10:
        return None, len(valid)
    return statistics.median(valid), len(valid)


# ---------------------------------------------------------------------------
# Cost blending
# ---------------------------------------------------------------------------

def _compute_calibrated_costs(
    labor_index: float,
    permit_median_cost_per_sqft: float | None,
    permit_sample_size: int,
) -> tuple[float, float, float]:
    """Return (cosmetic, moderate, full_gut) $/sqft blended from BLS + permit data."""
    base_cosmetic = 40.0
    base_moderate = 95.0
    base_full_gut = 180.0

    labor_cosmetic = base_cosmetic * labor_index
    labor_moderate = base_moderate * labor_index
    labor_full_gut = base_full_gut * labor_index

    if permit_median_cost_per_sqft is None or permit_sample_size < 10:
        return labor_cosmetic, labor_moderate, labor_full_gut

    permit_cosmetic = permit_median_cost_per_sqft * 0.42
    permit_moderate = permit_median_cost_per_sqft
    permit_full_gut = permit_median_cost_per_sqft * 1.89

    weight = 0.40 if permit_sample_size >= 30 else 0.20
    inv = 1.0 - weight

    cosmetic = inv * labor_cosmetic + weight * permit_cosmetic
    moderate = inv * labor_moderate + weight * permit_moderate
    full_gut = inv * labor_full_gut + weight * permit_full_gut

    # Hard floor/ceiling: 50%–250% of national baseline
    cosmetic = max(base_cosmetic * 0.5, min(base_cosmetic * 2.5, cosmetic))
    moderate = max(base_moderate * 0.5, min(base_moderate * 2.5, moderate))
    full_gut = max(base_full_gut * 0.5, min(base_full_gut * 2.5, full_gut))

    return round(cosmetic, 1), round(moderate, 1), round(full_gut, 1)


# ---------------------------------------------------------------------------
# Service class
# ---------------------------------------------------------------------------

class RehabCostIndexService:

    async def get_rehab_cost_index(self, location: NormalizedLocation) -> RehabCostIndex:
        city = location.city.lower()
        state = location.state_code.lower()
        zip_part = location.zip_code or "any"
        cache_key = f"rehab_index:{city}:{state}:{zip_part}"

        cached = cache_service.get(cache_key)
        if cached is not None:
            return RehabCostIndex(**cached)

        async with httpx.AsyncClient() as client:
            cbsa_code = await _resolve_cbsa(location, client)
            labor_index = await _fetch_bls_labor_index(cbsa_code, client) if cbsa_code else 1.0
            permit_median, permit_n = await _fetch_permit_data(location, client)

        cosmetic, moderate, full_gut = _compute_calibrated_costs(labor_index, permit_median, permit_n)

        sources: list[str] = []
        if labor_index != 1.0:
            sources.append("BLS OEWS labor data")
        if permit_n > 0:
            sources.append(f"{permit_n} local permits")
        if not sources:
            sources.append("national baseline (no local data)")

        confidence = (
            "high"   if labor_index != 1.0 and permit_n >= 30 else
            "medium" if labor_index != 1.0 or permit_n >= 10 else
            "low"
        )

        index = RehabCostIndex(
            cosmetic_per_sqft=cosmetic,
            moderate_per_sqft=moderate,
            full_gut_per_sqft=full_gut,
            labor_index=labor_index,
            permit_sample_size=permit_n,
            permit_median_cost_per_sqft=permit_median,
            data_sources=sources,
            confidence=confidence,
        )

        cache_service.set(cache_key, index.__dict__, ttl=60 * 60 * 24 * 7)  # 7 days
        return index


rehab_cost_index_service = RehabCostIndexService()
