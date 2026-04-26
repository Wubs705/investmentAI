# Real Estate Investment Analyzer

An AI-powered tool that helps you evaluate properties before you put money on the line. You tell it where you're looking, what your budget is, and what you're trying to do with the property — it comes back with ranked deals, financial projections, and a plain-English breakdown of whether the numbers actually work.

---

## What it does

Real estate investing has a massive information problem. You're trying to compare dozens of properties across wildly different neighborhoods, run cash flow math on each one, estimate rehab costs you can't always see, and figure out what similar homes have sold for recently — all before making an offer. Most people either skip that analysis or do it badly.

This app tries to close that gap. Here's what happens when you run a search:

1. **It finds real listings** using Rentcast's MLS data, filtered by your budget and search radius
2. **It enriches each property** with tax records, structural details, and valuation data
3. **AI runs the underwriting** — estimated rehab costs, expected rents, ARV, vacancy rates, maintenance reserves, and more
4. **A financial engine models your actual returns** across multiple scenarios (bear/base/bull)
5. **You get a ranked list** of properties scored 0–100 based on how well they fit your goal

The whole thing is built around five investment strategies:
- Long-term rental
- Fix & flip
- House hack
- Short-term rental (Airbnb-style)
- General long-term hold

Each one gets its own financial model — a flip analysis is very different from a rental analysis, and the app treats them that way.

---

## The AI piece

There are two AI calls per property, using different models for different jobs:

- **Claude Haiku** handles structured extraction — pulling out numbers like estimated rent, rehab cost, ARV, vacancy rate. Fast and cheap, runs on every property in a batch.
- **Claude Sonnet** writes the narrative — strengths, weaknesses, deal commentary, condition assessment. Better reasoning, used for the stuff that benefits from it.

Prompt caching is enabled to keep costs sane when you're analyzing a lot of properties at once.

---

## Tech stack

**Frontend**
- React 19 + TypeScript
- Vite
- Tailwind CSS
- MapLibre GL for the property map
- Recharts for financial charts
- Framer Motion for page transitions
- Supabase JS for auth

**Backend**
- FastAPI (async Python)
- SQLAlchemy + aiosqlite (SQLite locally, Postgres in prod)
- Anthropic SDK for Claude integration
- ReportLab for PDF report generation
- Diskcache for filesystem-level caching
- httpx for async external API calls

**External data sources**
- Rentcast — active MLS listings
- Estated — property records, valuations
- FRED — macro economic indicators (mortgage rates, housing supply)
- Census API — demographics
- HUD — housing metrics

---

## Getting started

### Prerequisites
- Python 3.9+
- Node.js 18+
- An Anthropic API key

### Setup

```bash
# Clone and enter the project
git clone <repo-url>
cd investmentAI

# Install Python dependencies
pip install -r requirements.txt

# Install frontend dependencies
cd frontend
npm install
cd ..

# Copy the environment template
cp .env.example .env
```

### Configure your `.env`

The only thing you actually need to get started:

```
ANTHROPIC_API_KEY=sk-ant-...
```

If you don't add the property data API keys, the app will fall back to demo data — useful for testing the UI and financial engine without burning API credits.

Optional (but unlocks real data):
```
RENTCAST_API_KEY=...
ESTATED_API_KEY=...
CENSUS_API_KEY=...
FRED_API_KEY=...
VITE_MAPBOX_TOKEN=pk_...
```

For Supabase (cloud auth + Postgres — skip this to use local SQLite):
```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_JWT_SECRET=...
```

### Run it

Open two terminals:

```bash
# Terminal 1 — backend on port 8000
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2 — frontend on port 5173
cd frontend
npm run dev
```

Then open `http://localhost:5173`.

---

## Running tests

```bash
pytest
```

The backend has a **test mode** you can toggle from the UI (or via `X-Test-Mode: true` header). It disables all Anthropic API calls and returns mock assumptions — great for iterating on the UI or financial engine without touching the API.

---

## Project structure

```
investmentAI/
├── backend/
│   ├── main.py               # FastAPI app, CORS, middleware
│   ├── config.py             # Settings and env variable management
│   ├── auth.py               # JWT verification
│   ├── models/
│   │   ├── schemas.py        # Pydantic models for all API contracts
│   │   └── database.py       # ORM models, Supabase client init
│   ├── routers/
│   │   ├── search.py         # POST /api/search, GET /api/autocomplete
│   │   ├── analysis.py       # Property detail and PDF report endpoints
│   │   ├── narrative.py      # On-demand deep analysis
│   │   └── market.py         # Market snapshot by location
│   ├── services/
│   │   ├── ai_service.py     # Claude integration (assumptions + narrative)
│   │   ├── analysis_engine.py # Core financial calculations
│   │   ├── property_search.py # Rentcast/Estated/demo data aggregation
│   │   ├── market_data.py    # FRED, Census, HUD data
│   │   ├── comparables.py    # Comp search and valuation
│   │   └── geocoding.py      # Address normalization
│   ├── utils/
│   │   ├── cache.py          # Diskcache wrapper
│   │   └── scoring.py        # 0-100 investment scoring
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── pages/            # HomePage, SearchResults, PropertyDetail, Market
│   │   ├── components/       # UI components, charts, map
│   │   ├── hooks/            # usePropertySearch, usePhotonAutocomplete
│   │   ├── contexts/         # AuthContext (Supabase session)
│   │   ├── api/client.ts     # Axios instance with auth headers
│   │   └── utils/            # Formatters, frontend calculations
│   └── package.json
├── requirements.txt
└── .env.example
```

---

## A few things worth knowing

**The financial engine is pure functions.** No side effects, no I/O — just math. This makes it easy to test and means AI output goes through validation before it ever touches the calculations.

**Supabase is optional.** The app detects whether you've configured Supabase and either uses it (Postgres + auth + Row Level Security) or falls back to SQLite with no auth. You can develop the whole thing locally with zero cloud dependencies.

**Caching is aggressive.** Property search results, market data, and comps are all cached to disk with configurable TTLs. If you search the same area twice, the second search is fast.

**The scoring formula is goal-aware.** A property that scores 80 for a rental might score 45 for a flip. The weights are different because the goals are different.

---

## Contributing

This is a personal project, but if you find a bug or have a useful idea, feel free to open an issue.

---

## License

MIT
