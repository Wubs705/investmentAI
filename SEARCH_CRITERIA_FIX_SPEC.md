# Search Criteria Enforcement — Fix Specification

**Target file:** `backend/services/property_search.py`

**Background:** A full audit of the search pipeline was run. Budget fields (`budget_min` / `budget_max`) are mostly wired correctly. Two bugs were found:
1. `radius_miles` is collected from the user but silently never sent to Rentcast — every search returns city-wide results regardless of the radius the user chose.
2. `budget_min = 0` is falsy in Python, so the `minPrice` guard would silently skip for a zero lower bound.

A third defensive fix is also recommended: post-fetch budget enforcement so listings that slip through the API filter are caught in Python.

All other criteria (`investment_goal`, `down_payment_pct`) are correctly honored in the analysis layer — no changes needed there.

---

## Bug 1 — `radius_miles` never sent to Rentcast

**File:** `property_search.py`
**Function:** `_fetch_rentcast_listings` (line 48 — the `params` dict)
**Current behaviour:** `radius_miles` appears only in the cache key (line 385) and the `SearchCriteria` schema. It is never forwarded to the Rentcast API. Setting "5 miles" vs "50 miles" produces identical results.

**Rentcast parameter name:** `radius` (miles, integer or float — confirmed in Rentcast v1 docs).

### Fix

Add `radius` to the `params` dict in `_fetch_rentcast_listings`, directly after the `status` / `limit` lines:

```
params = {
    "city": location.city,
    "state": location.state_code,
    "status": "Active",
    "limit": settings.max_results,
    "radius": criteria.radius_miles,      # ← ADD THIS LINE
}
```

No conditional guard needed — `radius_miles` has a schema default of `15` and is validated `ge=1`, so it is always a positive integer.

**Test:** Search "Austin, TX" with `radius_miles=5` should return fewer listings than `radius_miles=50`. Both requests share the same city/state but differ in radius → different cache keys (already correct, line 385) → different Rentcast responses.

---

## Bug 2 — `budget_min = 0` falsy guard

**File:** `property_search.py`
**Lines:** 54 and 56
**Current code:**
```python
if criteria.budget_min:
    params["minPrice"] = criteria.budget_min
if criteria.budget_max:
    params["maxPrice"] = criteria.budget_max
```

**Problem:** In Python, `0` is falsy. A user explicitly setting `budget_min = 0` would silently drop the `minPrice` param. `budget_max = 0` would also drop `maxPrice` (allowing all prices — likely unintentional).

### Fix

Replace the truthiness guards with explicit `None` checks:

```python
if criteria.budget_min is not None:
    params["minPrice"] = criteria.budget_min
if criteria.budget_max is not None:
    params["maxPrice"] = criteria.budget_max
```

`SearchCriteria` already validates both fields as `ge=0`, so `None` is the only value that should skip the param.

**Test:** `budget_min=0`, `budget_max=300000` → `params` must include `minPrice=0`. Confirmed by asserting `"minPrice" in params` when `budget_min=0`.

---

## Fix 3 — Post-fetch budget enforcement (defensive filter)

**File:** `property_search.py`
**Function:** `PropertySearchService.search` (line 375)
**Problem:** Rentcast applies `minPrice`/`maxPrice` server-side, but if an API quirk, a cached stale result, or a fallback code path returns out-of-range listings, they will reach the frontend unchecked.

### Fix

Add a one-liner filter immediately after Rentcast results are collected, before enrichment and geocoding (around line 406, after the `if not listings:` fallback block):

```python
# Enforce budget bounds regardless of source (defense-in-depth)
if criteria.budget_min is not None:
    listings = [l for l in listings if l.list_price >= criteria.budget_min]
if criteria.budget_max is not None:
    listings = [l for l in listings if l.list_price <= criteria.budget_max]
```

Apply this to **both** the Rentcast path and after demo generation to keep behaviour consistent.

**Placement in `search()` method — exact insertion point:**

The current method flow is:
```
1. Check cache → return if hit
2. _fetch_from_rentcast()
3. If no listings → _generate_demo_listings()
4. Else → _geocode_missing() + _enrich_listings()
5. listings.sort(key=lambda p: p.list_price)
6. cache_service.set(...)
```

Insert the budget filter at step **4.5** — after all listings are assembled (Rentcast or demo), before the sort:

```python
# Step 4.5 — enforce budget window on assembled listings
listings = [
    l for l in listings
    if (criteria.budget_min is None or l.list_price >= criteria.budget_min)
    and (criteria.budget_max is None or l.list_price <= criteria.budget_max)
]
```

**Test:** Inject a listing with `list_price = 999_999` when `budget_max = 500_000`. Assert it is absent from the returned list.

---

## Summary of all changes

| # | Bug | Location | Severity | Fix |
|---|---|---|---|---|
| 1 | `radius_miles` not sent to Rentcast | `_fetch_rentcast_listings`, line 52 | **High** — user-visible broken feature | Add `"radius": criteria.radius_miles` to params dict |
| 2 | `budget_min=0` falsy guard | lines 54, 56 | **Low** — edge case (rare, but silent) | Replace `if criteria.budget_min:` with `if criteria.budget_min is not None:` |
| 3 | No post-fetch budget filter | `PropertySearchService.search` | **Medium** — defense-in-depth missing | Add list comprehension filter after listings are assembled |

---

## Unit tests

```
test_radius_sent_to_rentcast_api
    Mock httpx.AsyncClient.get; assert params["radius"] == criteria.radius_miles

test_radius_changes_cache_key
    Call search() with radius=5, then radius=50; assert cache keys differ

test_budget_min_zero_sends_minprice
    SearchCriteria(budget_min=0, budget_max=300000)
    Assert "minPrice" in the Rentcast request params and params["minPrice"] == 0

test_post_fetch_budget_filter_removes_outlier
    Return a mocked Rentcast response containing one listing above budget_max
    Assert final listings list does not contain the outlier

test_demo_listings_respect_budget
    Call search() with no Rentcast key; budget_min=200000, budget_max=400000
    Assert all demo listings: 200000 <= list_price <= 400000
    (This currently passes — regression test to keep it passing after changes)
```

---

## What was already correct (no changes needed)

- `budget_min` / `budget_max` are sent to Rentcast as `minPrice` / `maxPrice` for all non-zero values ✅
- Demo listing generator already seeds prices within the budget range ✅
- `investment_goal` correctly drives analysis strategy and scoring weights ✅
- `down_payment_pct` correctly reaches the mortgage math in `analysis_engine.py` ✅
- `radius_miles` is already part of the cache key, so once Bug 1 is fixed, cache invalidation will work correctly without further changes ✅
- Frontend `SearchForm.tsx` sends all five criteria fields correctly on submit ✅
