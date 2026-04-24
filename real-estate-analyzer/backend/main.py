from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from backend.auth import get_current_user
from backend.config import settings
from backend.models.database import async_session, get_supabase, init_db
from backend.routers import analysis, market, narrative, search
from backend.testmode import TestModeMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Pre-warm Supabase client so the first request isn't slow
    await get_supabase()
    yield


app = FastAPI(
    title="Real Estate Investment Analyzer",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(TestModeMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Auth dependency applied to all protected routers
_protected = [Depends(get_current_user)]
app.include_router(search.router, dependencies=_protected)
app.include_router(analysis.router, dependencies=_protected)
app.include_router(narrative.router, dependencies=_protected)
app.include_router(market.router)


@app.get("/api/health")
async def health_check():
    supabase = await get_supabase()
    if supabase:
        try:
            await supabase.table("properties").select("id").limit(1).execute()
            return {"status": "ok", "db": "supabase", "version": "1.0.0"}
        except Exception as exc:
            return {"status": "degraded", "db": "supabase", "error": str(exc), "version": "1.0.0"}
    else:
        async with async_session() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ok", "db": "sqlite", "version": "1.0.0"}
