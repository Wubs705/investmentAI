# AiRE Cost Optimization — Implementation Plan

Spec: `C:\Users\drdre\Downloads\COST_OPTIMIZATION_SPEC.md`
Priority order follows the spec (quickest savings first).

---

## P1 — Token cap reduction (10 min, immediate savings)

- [ ] `backend/services/ai_service.py:60` — change `NARRATIVE_MAX_TOKENS = 4096` → `2000`
- [ ] Verify no other references expect 4096 (grep `NARRATIVE_MAX_TOKENS` + `4096`)
- [ ] Sanity test: one narrative call locally, confirm output not truncated mid-sentence

**Rollback:** single-line revert.

---

## P2 — Split narrative into on-demand endpoint (half day)

### Backend

- [ ] `backend/routers/search.py:71–150` — remove the `if score >= 40: generate_narrative(...)` branch at line ~136. Search returns grid rows only (score, grade, component breakdown, key goal metrics, listing snapshot).
- [ ] New router `backend/routers/narrative.py` exposing `POST /api/analysis/narrative/{analysis_id}`:
  - Accepts `analysis_id` (persisted `PropertyAnalysis`) + `investment_goal`
  - Loads the cached analysis from Supabase/diskcache; returns 404 if missing
  - Cache check (see P3) → short-circuit if hit
  - Calls `generate_narrative(...)` for that one property
  - Returns `{narrative, market_commentary, listing_intelligence}` matching existing `AIAnalysis` shape
- [ ] Register the new router in `backend/main.py`
- [ ] Update `SearchResponse` model: `ai_analysis` is now `Optional` / absent on grid; include `analysis_id` per result for the follow-up call
- [ ] Preserve the `score ≥ 40` guard on the new endpoint as well (don't burn Sonnet on bad deals even on click)

### Frontend

- [ ] `PropertyCard.tsx` — add "Deep Analysis" button/toggle; show score, grade, summary line, and the goal-relevant KPI (cap rate / CoC / profit margin / mortgage offset / gross yield)
- [ ] New hook `useNarrative(analysisId, goal)` — lazy fires the narrative endpoint on click, shows 3–5s loading state, renders `InvestmentNarrative` + `MarketCommentary` + `ListingIntelligence` inline
- [ ] `api/client.ts` — add `fetchNarrative(analysisId, goal)` method
- [ ] Disable the button when cached score < 40 (or show "below review threshold" badge)

### Verification

- [ ] Run search end-to-end in dev — grid renders without Sonnet firing (check logs)
- [ ] Click one property — narrative streams, renders inline
- [ ] Second click on same property — served from cache, no Sonnet call (check logs)

---

## P3 — SQLite narrative cache (1–2 hours)

- [ ] Use existing `utils/cache.py` (diskcache, already SQLite-ish on disk)
- [ ] Inside the new narrative endpoint, wrap the Sonnet call in `cache.get_or_fetch(key, fn, ttl=86400)`
- [ ] Key: `f"narrative:{property_id}:{investment_goal}"` — property_id sourced from the listing, not the analysis row (cross-user sharing)
- [ ] TTL: 24h (spec); narratives don't change intraday
- [ ] **Analysis rehydration (decided):** explicit short-TTL cache so anonymous users work end-to-end. Key `f"analysis:{analysis_id}"`, TTL 1h. Populated by search endpoint for every result, read by narrative endpoint before falling back to Supabase.
- [ ] Invalidate on re-analysis if assumptions change materially — out of scope for v1; rely on TTL

**Verify:** two searches from different users on the same MLS ID → one Sonnet call, one cache hit. Anonymous user can hit narrative endpoint without auth.

---

## P4 — Market heat score (1–2 days)

### Calculation (`backend/services/market_data.py`)

- [ ] New `calculate_heat_score(snapshot: MarketSnapshot, goal: InvestmentGoal) -> HeatScore` function
- [ ] Inputs already on `MarketSnapshot`: `rent_growth_yoy_pct` (HUD), `unemployment_rate_pct` (Census), population growth (need to derive — ACS YoY delta), `median_days_on_market` (Rentcast)
- [ ] Normalize each signal to 0–100 (quantile/threshold table — doc inline) then weight by goal per spec table:
  - Rental: 35/25/20/20
  - Long-term: 30/20/35/15
  - Fix & flip: 10/25/15/50
  - STR: 35/15/20/30
  - House hack: 30/35/20/15
- [ ] Return `{score: int, components: {rent_growth, unemployment, population, dom}}` with sub-scores for the tooltip
- [ ] Cache: `cache.get_or_fetch(f"heat_score:{city}:{state}:{goal}", fn, ttl=86400)` — zero extra AI cost

### Scoring integration (`backend/utils/scoring.py`)

- [ ] Add `heat_score: int` param to each `_score_*` function; rebalance existing weights proportionally to make room for heat at:
  - Rental 15% / Long-term 20% / Fix&flip 15% / STR 20% / House hack 10%
- [ ] Thread the heat score through `calculate_investment_score()` and the search orchestrator
- [ ] Unit-check: old weights summed to 100; new weights + heat weight must also sum to 100

### Schema (`backend/models/schemas.py`)

- [ ] `InvestmentScore` — add `heat_score: int` and `heat_score_components: dict[str, int]`
- [ ] Keep old fields; don't break existing API consumers

### Frontend

- [ ] `PropertyCard.tsx` — "Market Heat" badge beside the investment score
- [ ] Color thresholds: ≥80 red, 60–79 orange, 40–59 yellow, <40 gray
- [ ] Tooltip on hover: component breakdown (e.g., "Rent growth: strong · DOM: fast · Unemployment: low")
- [ ] Labels derived from sub-score buckets (strong/moderate/weak) — keep the mapping in one helper

### AI annotation

- [ ] Narrative prompt (`ai_service.py` narrative user message builder) — pass `heat_score` and components into the prompt context; instruct Sonnet to add one contextual line when the heat score is notable (≥75 or ≤30). Spec gives an example — include it as a few-shot.

### Verification

- [ ] Deterministic: given a fixed `MarketSnapshot`, heat score is identical across runs
- [ ] Two searches same city different goals → different heat scores, both cache on second run
- [ ] Badge renders with correct color at boundary values (79, 80; 59, 60; etc.)

---

## Out of scope (noted for follow-up)

- Invalidating narrative cache when Haiku assumptions change — currently relying on TTL
- Population YoY growth: **decided — second fetch.** Pull ACS 1yr or compare two ACS 5yr vintages for a YoY delta. Cache 7–30d like other Census calls.
- Streaming Sonnet output to the UI (better perceived latency than a 3–5s spinner) — separate task
