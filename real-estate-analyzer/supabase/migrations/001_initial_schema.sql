-- ============================================================
-- Real Estate Analyzer — Supabase Initial Schema
-- Run this entire file in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New Query → Paste → Run)
-- ============================================================

-- Properties: globally shared property records (address, price, raw data).
-- Any authenticated user can read/insert. Analyses are what's user-specific.
create table if not exists public.properties (
  id          text        primary key,
  address     text        not null,
  city        text        not null,
  state       text        not null,
  zip_code    text,
  list_price  integer,
  data        jsonb       not null,
  source      text,
  fetched_at  timestamptz default now()
);

-- Analyses: per-user AI underwriting results tied to a property.
create table if not exists public.analyses (
  id          bigserial   primary key,
  user_id     uuid        references auth.users(id) on delete cascade not null,
  property_id text        references public.properties(id) on delete cascade,
  goal        text        not null,
  data        jsonb       not null,
  score       integer,
  analyzed_at timestamptz default now()
);

-- Searches: per-user search history.
create table if not exists public.searches (
  id           bigserial   primary key,
  user_id      uuid        references auth.users(id) on delete cascade not null,
  criteria     jsonb       not null,
  result_count integer     default 0,
  searched_at  timestamptz default now()
);

-- ── Indexes ──────────────────────────────────────────────────
create index if not exists idx_analyses_property_id  on public.analyses(property_id);
create index if not exists idx_analyses_user_id      on public.analyses(user_id);
create index if not exists idx_analyses_analyzed_at  on public.analyses(analyzed_at desc);
create index if not exists idx_searches_user_id      on public.searches(user_id);

-- ── Row Level Security ────────────────────────────────────────
alter table public.properties enable row level security;
alter table public.analyses   enable row level security;
alter table public.searches   enable row level security;

-- Properties: any authenticated user can read or upsert
-- (property data is public market info, not user-private)
create policy "Authenticated users can view properties"
  on public.properties for select
  to authenticated
  using (true);

create policy "Authenticated users can upsert properties"
  on public.properties for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update properties"
  on public.properties for update
  to authenticated
  using (true);

-- Analyses: users can only see and insert their own
create policy "Users can view own analyses"
  on public.analyses for select
  using (auth.uid() = user_id);

create policy "Users can insert own analyses"
  on public.analyses for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own analyses"
  on public.analyses for delete
  using (auth.uid() = user_id);

-- Searches: users can only see and insert their own
create policy "Users can view own searches"
  on public.searches for select
  using (auth.uid() = user_id);

create policy "Users can insert own searches"
  on public.searches for insert
  with check (auth.uid() = user_id);
