# Real-Estate Analyzer — Audit Fixes

Consolidated fix document for all issues surfaced in the five-slice audit.
Each entry: **ID · severity · file:line · problem · fix**.

**Totals:** 8 Critical · 22 High · 20 Medium · 11 Low
**Supabase auth (separate plan) will cover:** C10, H1, H3, Navbar sign-in, H9.

---

## Batch 1 — Financial correctness (ship first)

These cause users to see **wrong investment numbers**.

### C4 · Critical · `backend/services/property_search.py:48-60`
**Problem:** `criteria.radius_miles` is collected and cached but never passed to Rentcast API. "5 miles" vs "50 miles" return identical results.
**Fix:** Add `"radius": criteria.radius_miles` to the `params` dict inside `_fetch_rentcast_listings`. Also include `radius_miles` in the cache key.

### C5 · Critical · `backend/services/property_search.py:54-57`
**Problem:** `if criteria.budget_min:` treats `0` as falsy, so an explicit `$0` floor is dropped.
**Fix:** Change to `if criteria.budget_min is not None:`. Audit the file for other `if x:` guards on numeric params (`budget_max`, `beds_min`, `baths_min`, `sqft_min`) and apply the same treatment.

### H7 · High · `backend/services/comparables.py:119`
**Problem:** Cache key `f"comps:{subject.id}:{subject.list_price}"` omits `goal`; a flip analysis reuses rental-scenario comps → wrong ARV/MAO/profit.
**Fix:** `f"comps:{subject.id}:{subject.list_price}:{goal}"`.

### M4 · Medium · `backend/services/analysis_engine.py:298-300`
**Problem:** Comment admits year-1 interest should be ~97% of `loan * rate`, but code uses 100%. Inflates tax shield.
**Fix:** Compute year-1 interest from amortization:
```python
monthly_rate = mortgage_rate / 12
n = loan_term_years * 12
monthly_payment = loan * (monthly_rate * (1+monthly_rate)**n) / ((1+monthly_rate)**n - 1)
balance = loan
year_one_interest = 0
for _ in range(12):
    interest = balance * monthly_rate
    year_one_interest += interest
    balance -= (monthly_payment - interest)
```

### M5 · Medium · `backend/services/analysis_engine.py:381-382`
**Problem:** Age adjustment sign inverted — older properties get *higher* appreciation rate.
**Fix:** Penalize age instead:
```python
age_adj = max(-0.01, min(0, (30 - age) / 100 * 0.02))
```

### M10 · Medium · `backend/services/ai_service.py:562-577`
**Problem:** No bounds check on LLM-parsed `estimated_rehab_cost`, `expected_monthly_rent`, `arv_estimate`. Negative rehab inflates profit.
**Fix:** After parsing:
```python
estimated_rehab_cost = max(0, int(estimated_rehab_cost or 0))
expected_monthly_rent = max(0, min(50_000, int(expected_monthly_rent or 0)))
arv_estimate = max(0, int(arv_estimate or 0))
```

### M8 · Medium · `backend/services/market_data.py:253`
**Problem:** Market cache key lacks zip; different neighborhoods collide.
**Fix:** `f"market:{city.lower()}:{state.lower()}:{location.zip_code or 'any'}"`.

### Verification for Batch 1
- Pytest: `test_radius_passed_to_rentcast`, `test_budget_min_zero_honored`, `test_comp_cache_separates_goals`, `test_age_adjustment_penalizes_old`, `test_llm_bounds_reject_negatives`.

---

## Batch 2 — Crash-class defects

### C1 · Critical · `backend/routers/analysis.py:46,58,77,80`
**Problem:** `json.loads(record.data)` unwrapped; one corrupted row 500s every client for that property.
**Fix:** Wrap each call:
```python
try:
    data = json.loads(record.data)
except json.JSONDecodeError as e:
    raise HTTPException(422, f"Invalid property record: {e}")
```

### C6 · Critical · `backend/utils/scoring.py:131`
**Problem:** `pvm = (mao - price) / mao * 100` divides by zero when `mao == 0`.
**Fix:** `pvm = ((mao - price) / mao * 100) if mao > 0 else 0.0`.

### C7 · Critical · `backend/models/schemas.py:54-57`
**Problem:** `list_price`, `bedrooms`, `bathrooms`, `sqft` have no bounds.
**Fix:**
```python
list_price: int = Field(gt=0)
bedrooms: int = Field(ge=0, le=50)
bathrooms: float = Field(ge=0, le=50)
sqft: int = Field(gt=0, le=1_000_000)
```

### C8 · Critical · `backend/models/schemas.py:32-33,41-42,52-53`
**Problem:** `lat`/`lng` unbounded.
**Fix:** `lat: float = Field(ge=-90, le=90)`, `lng: float = Field(ge=-180, le=180)`.

### C2 · Critical · `backend/routers/analysis.py:91`
**Problem:** `property_id` injected into `Content-Disposition` header without escaping — filename / path-traversal vector.
**Fix:** Sanitize before use:
```python
safe_id = re.sub(r"[^A-Za-z0-9_\-]", "_", property_id)[:64]
headers = {"Content-Disposition": f'attachment; filename="report_{safe_id}.pdf"'}
```

### C3 · Critical · `backend/routers/analysis.py:37,49,69`, `backend/routers/market.py:12`
**Problem:** Path params are bare `str`.
**Fix:** `property_id: str = Path(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")`.

### M11 · Medium · `backend/models/schemas.py:18-19`
**Problem:** No check that `budget_min ≤ budget_max`.
**Fix:**
```python
@model_validator(mode="after")
def _budget_order(self):
    if self.budget_min is not None and self.budget_max is not None:
        if self.budget_min > self.budget_max:
            raise ValueError("budget_min must be ≤ budget_max")
    return self
```

### Verification for Batch 2
- Pytest: corrupted row → 422 (not 500), `mao=0` flip scoring, negative `list_price` → 422, `lat=91` → 422, `property_id="../etc"` rejected, `budget_min > budget_max` → 422.

---

## Batch 3 — Frontend correctness & UX

### C9-a · Critical · `frontend/src/pages/SearchResultsPage.tsx:84-86`
**Problem:** `search(criteria)` called from `useEffect([])` — stale closure.
**Fix:** Stabilize `search` via `useCallback` in `usePropertySearch`, add `[search, criteria]` to deps. Use a ref for tracking "already ran for this criteria" if re-entry is a concern.

### C9-b · Critical · `frontend/src/pages/PropertyDetailPage.tsx:379-442`
**Problem:** Contact form has no submit handler.
**Fix (recommended):** Remove the form until a `/api/contacts` endpoint exists — silent failure is worse than missing UI. If you want it live now, add the endpoint + a POST with success/error toast.

### C9-c · Critical · `frontend/src/pages/MarketOverviewPage.tsx:20-44`
**Problem:** Unthrottled `onChange` → request races; old response can overwrite new.
**Fix:** Debounce 300ms + `AbortController` tied to each keystroke; cancel previous in-flight request on new input.

### C11 · Critical · `frontend/src/hooks/usePropertySearch.ts:14,45-49,56`
**Problem:** Module-level `_cache` mutable object shared across all instances; `setInterval` leaks step counter on unmount; stale closure.
**Fix:** Move cache into a `useRef` or a small React context with TTL. Track step in `useRef` to avoid stale closure. Clear interval in effect cleanup:
```typescript
useEffect(() => {
  const id = setInterval(() => { stepRef.current += 1; ... }, 800);
  return () => clearInterval(id);
}, []);
```

### High · `frontend/src/components/ComparablesTable.tsx:81`
**Fix:** `key={comp.address ?? comp.id}` — not array index.

### High · `frontend/src/components/ComparablesTable.tsx:10`
**Fix:** Remove unused `subjectPrice` prop.

### High · `frontend/src/components/InvestmentMetrics.tsx:265-267`
**Fix:** Guard every `.toFixed()` call with `typeof x === "number" && Number.isFinite(x)`.

### Medium · `frontend/src/pages/MarketOverviewPage.tsx:76`
**Fix:** `const maxRent = rentData.length ? Math.max(...rentData.map(r => r.value)) : 1;`

### Medium · `frontend/src/components/LoadingState.tsx:12`
**Fix:** Early return `if (!steps?.length) return null;` before `.slice(0, -1)`.

### Medium · `frontend/src/components/Map/PropertyMap.tsx:55`
**Fix:** Remove the "mount only" exception; fit bounds whenever `bounds` changes.

### High · `frontend/src/hooks/usePropertySearch.ts` (new)
**Fix:** Add `AbortController` + `axios` timeout (30s) to the `/search` POST. Return a `retry()` callback.

### Medium · `frontend/src/pages/{HomePage,SearchForm}.tsx`
**Fix:** Move `formatK()` into `src/utils/formatters.ts`, import in both.

### Medium · `frontend/src/pages/PropertyDetailPage.tsx:377`
**Fix:** Drop `hidden lg:block` — render contact panel on all breakpoints, or move to a bottom sheet on mobile.

### Low · `frontend/src/pages/HomePage.tsx:153`
**Fix:** `key={`${s.display_name}-${s.state_code}`}` or use the API's stable id.

### Low · `frontend/src/utils/formatters.ts:51-63`
**Fix:** Swap hardcoded `text-green-600` etc. for design tokens (`text-accent`, `text-destructive`) or accept them as props.

---

## Batch 4 — Repo hygiene & build config

### `.gitignore` (root of repo)
Add:
```
*.db
*.db-shm
*.db-wal
cache/
__pycache__/
*.pyc
frontend/dist/
frontend/node_modules/
.env
.env.local
```

### Committed artifacts to remove
- `real_estate.db` · `cache/cache.db` · `backend/__pycache__/` · `frontend/dist/`
If repo is under git: `git rm --cached -r <path>` then commit. Otherwise, just delete locally.

### `frontend/tsconfig.json:7`
**Fix:** `"skipLibCheck": false` — run `tsc --noEmit` and fix fallout.

### `frontend/eslint.config.js:10`
**Fix:** Extend rules to `*.{ts,tsx}` with `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin`.

### `frontend/vite.config.ts:14-19`
**Fix:**
```typescript
proxy: {
  "/api": {
    target: process.env.VITE_API_URL || "http://localhost:8000",
    changeOrigin: true,
  },
},
```

### `frontend/index.html:7`
**Fix:** `<title>Real Estate Investment Analyzer</title>`.

### New files
- `frontend/.env.example` with annotated `VITE_API_URL=http://localhost:8000`.
- `backend/.env.example` with `RENTCAST_API_KEY=`, `HUD_API_KEY=`, `ANTHROPIC_API_KEY=`, `DATABASE_URL=`, `SUPABASE_URL=`, `SUPABASE_ANON_KEY=`, `SUPABASE_SERVICE_ROLE_KEY=`.

---

## Batch 5 — Defensive layers (backend)

### H6 · High · `backend/services/property_search.py:62-67`
**Fix:** Wrap Rentcast call:
```python
try:
    resp = await client.get(url, params=params, timeout=settings.rentcast_timeout_s)
except httpx.TimeoutException:
    logger.warning("rentcast_timeout", extra={"params": params})
    return []
```

### H5 · High · `backend/services/ai_service.py:53-54`
**Fix:** Move model names into `config.py`:
```python
model_assumptions: str = "claude-haiku-4-5-20251001"
model_narrative: str = "claude-sonnet-4-6"
```
Log explicitly when an API call fails and defaults are used instead.

### H4 · High · `backend/services/ai_service.py:535-549`
**Fix:** Validate parsed JSON against a Pydantic schema before use:
```python
class LLMAssumptions(BaseModel):
    estimated_rehab_cost: int = Field(ge=0, le=1_000_000)
    expected_monthly_rent: int = Field(ge=0, le=50_000)
    arv_estimate: int = Field(ge=0, le=10_000_000)
    # ...
assumptions = LLMAssumptions.model_validate(parsed)
```

### H8 · High · `backend/models/database.py:15-46`
**Fix:** Add index and FK (N/A once Supabase migration lands):
```python
property_id: Mapped[str] = mapped_column(
    ForeignKey("properties.id"), index=True
)
```

### H10 · High · `backend/utils/cache.py:14-15`
**Fix:** `Cache(directory=..., size_limit=500_000_000, cull_limit=10)`.

### H11 · High · `backend/models/schemas.py:70`
**Fix:** Replace `raw_data: dict` with a typed model (e.g., `RawListingData`) that documents the fields actually consumed downstream.

### M1 · Medium · `backend/routers/search.py:112-120`
**Fix:** In the `gather` post-processing, attach `{address, error_type, message}` per failure to the response so the frontend can display actionable errors.

### M3 · Medium · `backend/main.py:41-43`
**Fix:**
```python
@app.get("/api/health")
async def health():
    async with async_session() as s:
        await s.execute(text("SELECT 1"))
    return {"status": "ok"}
```

### L1 · Low · rate limiting
**Fix:** Add `slowapi`:
```python
limiter = Limiter(key_func=get_remote_address)
@router.post("/search")
@limiter.limit("10/minute")
async def search(...): ...
```

### L2 · Low · structured logging + request IDs
**Fix:** Add middleware that injects `X-Request-ID` (UUID4 if absent), bind it into `structlog.contextvars`; switch logs to JSON.

### L3 · Low · timeouts in `config.py`
```python
rentcast_timeout_s: float = 20.0
estated_timeout_s: float = 15.0
hud_timeout_s: float = 10.0
geocoding_timeout_s: float = 10.0
anthropic_timeout_s: float = 30.0
```

### L4 · Low · pagination on `/api/search`
**Fix:** `limit: int = Query(20, ge=1, le=100)`, `offset: int = Query(0, ge=0)`. Return `{results, total, limit, offset}`.

### M9 · Medium · `backend/services/market_data.py:141-162`
**Fix:**
```python
if not rents:
    logger.warning("hud_unexpected_shape", extra={"keys": list(payload.keys())})
    return None
```

### M6 · Medium · `backend/services/comparables.py:32-99`
**Fix:** Thread `radius_miles` into `_generate_comp_properties` and use it:
```python
distance = rng.uniform(0.1, max(0.1, min(radius_miles, 10.0)))
```

---

## Covered by the Supabase plan (do not duplicate)

- **C10** `frontend/src/api/client.ts:7-10` — `VITE_API_KEY` in bundle. Gone once Supabase JWT is used instead.
- **H1** `backend/main.py:25-32` — CORS `allow_credentials=True` with wildcard headers. Tighten origins + drop wildcards once authed principal exists.
- **H3** `backend/testmode.py:14-28` — `X-Test-Mode` bypass. Gate behind an admin claim on the Supabase JWT (or remove in prod).
- **Navbar.tsx:50-55** — Sign-in button. Wire to Supabase `/login` route.
- **H9** `backend/config.py:35` — SQLite in prod. Supabase Postgres migration replaces this.

---

## Spec drift (file against its own spec)

### S1 · `backend/services/analysis_engine.py` vs `ANALYSIS_ENGINE_FIX_SPEC.md`
**Missing from code:** `capex_reserve_monthly` (spec §3), `rent_growth_pct` AI override in prompt. Add fields to `AIAssumptions` and prompt.

---

## Execution order

1. Batch 1 (financial correctness) — independent, small diffs, highest impact.
2. Batch 2 (crash-class) — independent, can run parallel to 1.
3. Batch 4 (hygiene) — cheap, unblocks CI type-checking.
4. Batch 3 (frontend) — needs Batch 1's schema tightening to flow through.
5. Batch 5 (defensive layers) — last; most are additive middleware.

Write a brief review entry per batch in `tasks/todo.md` when each batch ships.
