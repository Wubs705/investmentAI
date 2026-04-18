# Audit Fix Plan — Real-Estate Analyzer

Scope: 8 Critical, 22 High, 20 Medium, 11 Low findings from the parallel audit.
Supabase auth (separate plan in `claude_supabase_implementation_plan.md`) will
cover: C10 (API key in bundle), Navbar sign-in, H3 (test-mode bypass), H1 (CORS
credentials), and the overarching "no auth" gap. Everything below is independent
of that work.

Ordered into 5 PR-sized batches. Check in after each batch.

---

## Batch 1 — Financial correctness (highest business impact)

These cause users to see **wrong investment numbers**. Ship first.

- [ ] **C4** `backend/services/property_search.py:48-60` — pass
      `criteria.radius_miles` to Rentcast `params` dict.
- [ ] **C5** `backend/services/property_search.py:54-57` — change
      `if criteria.budget_min:` → `if criteria.budget_min is not None:`
      (also audit `budget_max`, `beds_min`, similar `if x:` patterns).
- [ ] **H7** `backend/services/comparables.py:119` — add `goal` to comp cache
      key: `f"comps:{subject.id}:{subject.list_price}:{goal}"`.
- [ ] **M4** `backend/services/analysis_engine.py:298-300` — compute year-1
      interest from amortization schedule (not `loan * rate`).
- [ ] **M5** `backend/services/analysis_engine.py:381-382` — fix inverted age
      adjustment so older properties are penalized, not rewarded.
- [ ] **M10** `backend/services/ai_service.py:562-577` — bounds-check LLM
      outputs (`estimated_rehab_cost >= 0`, `expected_monthly_rent` within
      sane range, `arv_estimate > 0`).
- [ ] **M8** `backend/services/market_data.py:253` — include zip in market
      cache key.
- [ ] **Verification**: add pytest covering radius filter, `budget_min=0`,
      cache-key separation for rental vs flip, age adjustment direction.

## Batch 2 — Crash-class defects

- [ ] **C1** `backend/routers/analysis.py:46,58,77,80` — wrap `json.loads(...)`
      in try/except → `HTTPException(422, "Invalid property record")`.
- [ ] **C6** `backend/utils/scoring.py:131` — guard `mao > 0` before dividing.
- [ ] **C7** `backend/models/schemas.py:54-57` — add `Field` constraints on
      `list_price`, `bedrooms`, `bathrooms`, `sqft`.
- [ ] **C8** `backend/models/schemas.py:32-33,41-42,52-53` — bound `lat`,
      `lng`.
- [ ] **C2** `backend/routers/analysis.py:91` — sanitize `property_id` before
      embedding in `Content-Disposition` (alphanumeric + `-_` only).
- [ ] **C3** `backend/routers/analysis.py:37,49,69` and
      `backend/routers/market.py:12` — constrain path params with
      `Path(min_length=1, max_length=128, pattern=...)`.
- [ ] **M11** `backend/models/schemas.py:18-19` — root validator
      `budget_min <= budget_max`.
- [ ] **Verification**: pytest for each 400/422 path; confirm no route raises
      500 on malformed input.

## Batch 3 — Frontend correctness & UX

- [ ] **C9-a** `frontend/src/pages/SearchResultsPage.tsx:84-86` — fix
      `useEffect` deps; stabilize `search` with `useCallback` in hook.
- [ ] **C9-b** `frontend/src/pages/PropertyDetailPage.tsx:379-442` — either
      wire contact-form submit or remove until backend endpoint exists.
      Confirm with user which one.
- [ ] **C9-c** `frontend/src/pages/MarketOverviewPage.tsx:20-44` — debounce
      (300ms) + AbortController on location input.
- [ ] **C11** `frontend/src/hooks/usePropertySearch.ts:14,45-49,56` — move
      `_cache` into React ref or context; add TTL; clear `setInterval` on
      unmount; fix stale closure on `step`.
- [ ] `ComparablesTable.tsx:81` — use `comp.address` (or stable id) as key.
- [ ] `ComparablesTable.tsx:10` — remove unused `subjectPrice` prop.
- [ ] `InvestmentMetrics.tsx:265-267` — guard every `.toFixed()` call.
- [ ] `MarketOverviewPage.tsx:76` — guard empty `rentData`.
- [ ] `LoadingState.tsx:12` — guard empty `steps`.
- [ ] Add timeout + AbortController to `usePropertySearch` axios calls.
- [ ] Deduplicate `formatK()` into `src/utils/formatters.ts`.

## Batch 4 — Repo hygiene & build config

- [ ] Add `.gitignore` entries: `*.db`, `*.db-shm`, `*.db-wal`, `cache/`,
      `__pycache__/`, `*.pyc`, `frontend/dist/`.
- [ ] `git rm --cached` the already-committed artifacts above. **Confirm
      with user before running this** (touches git state).
- [ ] `frontend/tsconfig.json:7` — flip `skipLibCheck: false`, fix fallout.
- [ ] `frontend/eslint.config.js:10` — extend rules to `*.{ts,tsx}` with
      `typescript-eslint`.
- [ ] `frontend/vite.config.ts:14-19` — read proxy target from env.
- [ ] `frontend/index.html:7` — real `<title>`.
- [ ] Add `.env.example` for frontend and backend.

## Batch 5 — Defensive layers (backend)

- [ ] **H6** `property_search.py:62-67` — `httpx.TimeoutException` handler;
      surface partial results + warning.
- [ ] **H5** `ai_service.py:53-54` — move model names to `settings`; log
      explicitly on fallback to defaults.
- [ ] **H4** `ai_service.py:535-549` — validate extracted JSON against a
      Pydantic schema before use.
- [ ] **H8** `backend/models/database.py:15-46` — add index on
      `AnalysisRecord.property_id`; declare FK to `PropertyRecord.id`.
- [ ] **H10** `backend/utils/cache.py:14-15` — `size_limit=500_000_000`,
      `cull_limit=10`.
- [ ] **H11** `backend/models/schemas.py:70` — replace `raw_data: dict` with
      typed model or documented subset.
- [ ] **M1** `routers/search.py:112-120` — per-property error surfaced with
      type + message in response.
- [ ] **M3** `main.py:41-43` — `/api/health` probes DB.
- [ ] **L1** add `slowapi` on `/api/search` and `/api/autocomplete`.
- [ ] **L2** request-ID middleware + structlog.
- [ ] **L3** move timeouts to `config.py`.
- [ ] **L4** pagination on `/api/search` (`limit`, `offset`).
- [ ] **M9** `market_data.py:141-162` — explicit HUD shape check + warn.
- [ ] **M6** `comparables.py:32-99` — use `radius_miles` in demo generation.

## Out of scope (covered by Supabase plan)
- C10 API key in bundle
- H1 CORS `allow_credentials`
- H3 test-mode bypass
- Navbar sign-in wiring

## Out of scope (separate decision)
- **H9** SQLite → Postgres — Supabase plan already migrates DB; this item
  becomes moot once that lands.
- **C12** `frontend/dist/` cached — folded into Batch 4 hygiene.

---

## Review section (to be filled in after implementation)

_Fill in per-batch: what changed, how it was verified, any follow-ups._
