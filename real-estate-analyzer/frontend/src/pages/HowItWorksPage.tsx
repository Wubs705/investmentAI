import { Brain, Database, TrendingUp, Search, BarChart3, Shield, Zap, ChevronRight } from 'lucide-react'

const STEPS = [
  {
    number: 1,
    icon: Search,
    title: 'Search & Geocode',
    description: 'You enter a location and investment criteria. The backend geocodes your search area and pulls active listings from the market.',
  },
  {
    number: 2,
    icon: Database,
    title: 'Market Data Pull',
    description: 'Real-time data is fetched from FRED (Federal Reserve), US Census Bureau, and HUD. This gives us median home prices, rent levels, mortgage rates, vacancy rates, unemployment, and days on market.',
  },
  {
    number: 3,
    icon: BarChart3,
    title: 'Comparable Sales',
    description: 'For each property, the engine finds recent sold listings within ~1 mile with similar bedrooms and square footage. It adjusts for size differences to estimate a fair market value range.',
  },
  {
    number: 4,
    icon: Brain,
    title: 'AI Assumptions (Pass 1)',
    description: 'Claude Haiku reads the listing description, comps, and market data. It outputs specific underwriting numbers: estimated rehab cost, expected monthly rent, vacancy rate, maintenance reserve, and ARV — the inputs the financial engine needs.',
  },
  {
    number: 5,
    icon: TrendingUp,
    title: 'Financial Engine',
    description: 'A deterministic Python engine runs the math: mortgage payments, cap rate, cash-on-cash return, DSCR, cash flow, 10-year projections, flip profit, MAO. These numbers are authoritative and never invented by AI.',
  },
  {
    number: 6,
    icon: Zap,
    title: 'AI Narrative (Pass 2)',
    description: 'Claude Sonnet reads the engine results and writes the investment memo: key strengths, concerns, condition estimate, motivated seller signals, red flags, and hidden value opportunities.',
  },
  {
    number: 7,
    icon: Shield,
    title: 'Investment Score',
    description: 'A 0–100 score is calculated from weighted components specific to your investment goal. The score drives the ranking in search results.',
  },
]

const SCORING_GOALS = [
  {
    goal: 'Rental Income',
    color: 'bg-blue-50 border-blue-200',
    headerColor: 'bg-blue-100',
    accent: 'text-primary',
    components: [
      { name: 'Cash-on-Cash Return', weight: '25%', note: '<0% = 0pts, 5% = 60pts, 10%+ = 100pts' },
      { name: 'Cap Rate', weight: '20%', note: '<3% = 20pts, 5% = 60pts, 8%+ = 100pts' },
      { name: 'Rent-to-Price Ratio', weight: '20%', note: '<0.5% = 20pts, 0.7% = 60pts, 1%+ = 100pts' },
      { name: 'Neighborhood Rental Demand', weight: '15%', note: 'Based on area vacancy rate' },
      { name: 'Vacancy Rate', weight: '10%', note: '0% = 100pts, 6% = 50pts, 15% = 0pts' },
      { name: 'Property Condition', weight: '10%', note: 'Proxied by age of construction' },
    ],
  },
  {
    goal: 'Fix & Flip',
    color: 'bg-amber-50 border-amber-200',
    headerColor: 'bg-amber-100',
    accent: 'text-warning',
    components: [
      { name: 'Price vs MAO (70% Rule)', weight: '30%', note: '20% below MAO = 100pts, 20% above MAO = 0pts' },
      { name: 'Profit Margin', weight: '25%', note: '<$0 = 0pts, $50k = 70pts, $100k+ = 100pts' },
      { name: 'Flip ROI', weight: '20%', note: '<0% = 0pts, 20% = 50pts, 40%+ = 100pts' },
      { name: 'Rehab Complexity', weight: '15%', note: 'Cosmetic = 90pts, Moderate = 60pts, Full Gut = 25pts' },
      { name: 'Days on Market', weight: '10%', note: '<14d = 85pts, <45d = 65pts, >90d = 20pts' },
    ],
  },
  {
    goal: 'Long-Term Hold',
    color: 'bg-green-50 border-green-200',
    headerColor: 'bg-green-100',
    accent: 'text-accent',
    components: [
      { name: 'Price vs Market Comps', weight: '25%', note: 'Each % below market value adds 1pt (up to 100)' },
      { name: 'Annualized CAGR', weight: '20%', note: '8% CAGR = 40pts, 16% = 80pts, 20%+ = 100pts' },
      { name: 'Appreciation Forecast', weight: '15%', note: 'Based on 5-year historical trend' },
      { name: 'Rental Demand Buffer', weight: '15%', note: 'Price-per-sqft efficiency ($80 = 100pts, $220 = 0pts)' },
      { name: 'Property Condition', weight: '15%', note: 'Proxied by age of construction' },
      { name: 'Neighborhood Growth Score', weight: '10%', note: 'Composite of market indicators' },
    ],
  },
]

const DATA_SOURCES = [
  {
    name: 'FRED (Federal Reserve)',
    detail: 'Mortgage rates, economic indicators',
    color: 'bg-blue-50 text-primary border-blue-200',
  },
  {
    name: 'US Census Bureau',
    detail: 'Median income, population growth, demographics',
    color: 'bg-green-50 text-accent border-green-200',
  },
  {
    name: 'HUD Fair Market Rents',
    detail: 'Bedroom-level rent benchmarks by metro',
    color: 'bg-purple-50 text-purple-700 border-purple-200',
  },
  {
    name: 'Property Listings API',
    detail: 'Active MLS-sourced listings with price, beds, sqft',
    color: 'bg-orange-50 text-orange-700 border-orange-200',
  },
  {
    name: 'Comparable Sales',
    detail: 'Recent sold listings within 1 mile, last 6 months',
    color: 'bg-gray-50 text-text-secondary border-border',
  },
]

const AI_ASSUMPTIONS = [
  { field: 'Estimated Rehab Cost', desc: 'Single-point estimate (USD) based on listing description, age, and condition signals.' },
  { field: 'Expected Monthly Rent', desc: 'What the property would rent for, adjusted for size, condition, and local market.' },
  { field: 'Vacancy Rate', desc: 'Recommended vacancy reserve % based on market and property type.' },
  { field: 'Maintenance Reserve', desc: 'Annual maintenance reserve as % of value, calibrated by property age.' },
  { field: 'ARV Estimate', desc: 'After-Repair Value for flip math, based on comps and renovation scope.' },
  { field: 'Insurance Premium', desc: 'Monthly insurance estimate when listing data is unavailable.' },
  { field: 'Confidence', desc: 'Low / Medium / High — AI\'s confidence given listing detail and comp quality.' },
]

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-bg-light">
      <div className="max-w-[900px] mx-auto px-6 py-12">

        {/* Header */}
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-primary bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-full mb-4">
            <Brain className="w-3.5 h-3.5" /> AI-Powered Analysis
          </div>
          <h1 className="text-4xl font-bold text-text-primary mb-4">How the Analysis Works</h1>
          <p className="text-lg text-text-secondary leading-relaxed max-w-2xl">
            InvestmentAI uses a two-pass AI pipeline built on Claude, combined with a deterministic financial engine and real government data sources. Here's exactly what happens when you search.
          </p>
        </div>

        {/* Pipeline steps */}
        <section className="mb-14">
          <h2 className="text-xl font-bold text-text-primary mb-6">The 7-Step Pipeline</h2>
          <div className="space-y-3">
            {STEPS.map((step, i) => (
              <div key={step.number} className="flex gap-4 items-start">
                {/* Connector */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-white border-2 border-primary flex items-center justify-center shadow-sm">
                    <step.icon className="w-4 h-4 text-primary" />
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="w-0.5 h-6 bg-border mt-1" />
                  )}
                </div>
                {/* Content */}
                <div className="bg-white border border-border rounded-xl p-5 flex-1 mb-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-bold text-text-muted">STEP {step.number}</span>
                    <ChevronRight className="w-3 h-3 text-border" />
                    <h3 className="text-sm font-bold text-text-primary">{step.title}</h3>
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Two-pass AI detail */}
        <section className="mb-14">
          <h2 className="text-xl font-bold text-text-primary mb-2">The Two-Pass AI Design</h2>
          <p className="text-sm text-text-secondary mb-6">
            The AI makes two separate calls per property, each using a different Claude model optimized for the task.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-border rounded-xl p-5">
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Pass 1 — Extraction</div>
              <div className="text-base font-bold text-text-primary mb-1">Claude Haiku</div>
              <p className="text-sm text-text-secondary mb-4 leading-relaxed">
                Fast, cheap, structured. Reads the listing, comps, and market data and outputs a JSON object of underwriting numbers. These feed directly into the financial engine.
              </p>
              <div className="bg-bg-light rounded-lg p-3 text-xs text-text-muted font-mono">
                → rehab_cost, expected_rent,<br />
                &nbsp;&nbsp; vacancy_pct, maintenance_pct,<br />
                &nbsp;&nbsp; arv_estimate, confidence
              </div>
            </div>
            <div className="bg-white border border-blue-200 rounded-xl p-5">
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Pass 2 — Narrative</div>
              <div className="text-base font-bold text-text-primary mb-1">Claude Sonnet</div>
              <p className="text-sm text-text-secondary mb-4 leading-relaxed">
                More capable reasoning and writing. Receives the <em>engine-calculated</em> results and writes the investment memo, referencing the exact numbers — it never invents financial figures.
              </p>
              <div className="bg-blue-50 rounded-lg p-3 text-xs text-text-muted font-mono">
                → investment_narrative, key_strengths,<br />
                &nbsp;&nbsp; key_concerns, red_flags,<br />
                &nbsp;&nbsp; hidden_value, condition_estimate
              </div>
            </div>
          </div>
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <strong>Why two passes?</strong> Keeping extraction and narrative separate means the financial math is always deterministic. The AI interprets and explains — it never controls the numbers.
          </div>
        </section>

        {/* AI Assumptions */}
        <section className="mb-14">
          <h2 className="text-xl font-bold text-text-primary mb-2">What AI Assumptions Are Generated</h2>
          <p className="text-sm text-text-secondary mb-6">
            These are the exact fields Claude Haiku outputs in Pass 1. Each is grounded in a detailed underwriting rubric covering 2025 US rehab benchmarks, regional cost multipliers, and rental market targets.
          </p>
          <div className="bg-white border border-border rounded-xl overflow-hidden">
            <div className="bg-bg-light border-b border-border px-5 py-3">
              <span className="text-sm font-semibold text-text-primary">Pass 1 Output Fields</span>
            </div>
            <div className="divide-y divide-border">
              {AI_ASSUMPTIONS.map((a) => (
                <div key={a.field} className="px-5 py-3.5 flex items-start gap-4">
                  <span className="text-sm font-semibold text-primary w-44 flex-shrink-0">{a.field}</span>
                  <span className="text-sm text-text-secondary">{a.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Scoring breakdown */}
        <section className="mb-14">
          <h2 className="text-xl font-bold text-text-primary mb-2">Investment Score (0–100)</h2>
          <p className="text-sm text-text-secondary mb-2">
            Every property gets a score based on weighted components specific to your chosen investment goal. The weights below are the exact values used in the scoring engine.
          </p>
          <div className="text-xs text-text-muted mb-6">
            Grades: A ≥ 85 · B ≥ 75 · C ≥ 65 · D ≥ 50 · F &lt; 50
          </div>
          <div className="space-y-5">
            {SCORING_GOALS.map((g) => (
              <div key={g.goal} className={`border rounded-xl overflow-hidden ${g.color}`}>
                <div className={`px-5 py-3 border-b ${g.headerColor} ${g.color.split(' ')[1]}`}>
                  <span className={`text-sm font-bold ${g.accent}`}>{g.goal}</span>
                </div>
                <div className="divide-y divide-white/60 bg-white/60">
                  {g.components.map((c) => (
                    <div key={c.name} className="px-5 py-3 flex items-start gap-4">
                      <span className={`text-sm font-bold w-12 flex-shrink-0 ${g.accent}`}>{c.weight}</span>
                      <div>
                        <div className="text-sm font-semibold text-text-primary">{c.name}</div>
                        <div className="text-xs text-text-muted mt-0.5">{c.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Data sources */}
        <section className="mb-14">
          <h2 className="text-xl font-bold text-text-primary mb-2">Data Sources</h2>
          <p className="text-sm text-text-secondary mb-6">
            All market data comes from official government and public sources — no scraped or estimated third-party feeds.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DATA_SOURCES.map((ds) => (
              <div key={ds.name} className={`border rounded-xl p-4 ${ds.color}`}>
                <div className="text-sm font-semibold mb-0.5">{ds.name}</div>
                <div className="text-xs opacity-75">{ds.detail}</div>
              </div>
            ))}
          </div>
        </section>

        {/* What the AI does NOT do */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-text-primary mb-4">What AI Does Not Do</h2>
          <div className="bg-white border border-border rounded-xl divide-y divide-border">
            {[
              'Invent financial figures — all ROI, cap rate, cash flow, and profit numbers come from the deterministic engine',
              'Access real-time MLS or Zillow data directly — listing data is fetched via a property search API',
              'Make investment decisions — scores and narratives are informational estimates, not advice',
              'Guarantee accuracy on sparse listings — confidence ratings reflect data quality',
            ].map((item, i) => (
              <div key={i} className="px-5 py-3.5 flex items-start gap-3">
                <span className="text-danger font-bold text-sm flex-shrink-0 mt-0.5">✕</span>
                <span className="text-sm text-text-secondary">{item}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Disclaimer */}
        <div className="bg-bg-light border border-border rounded-xl p-5 text-xs text-text-muted leading-relaxed">
          <strong className="text-text-secondary">Disclaimer:</strong> All analysis is for informational purposes only and does not constitute financial, investment, or legal advice. Projections are estimates based on historical data and current market conditions. Always conduct your own due diligence before making investment decisions.
        </div>

      </div>
    </div>
  )
}
