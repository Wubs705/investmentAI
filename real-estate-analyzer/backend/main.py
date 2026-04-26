import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware

from backend.auth import get_current_user
from backend.config import settings
from backend.models.database import async_session, get_supabase, init_db
from backend.request_context import request_id_var
from backend.routers import analysis, market, narrative, search
from backend.testmode import TestModeMiddleware


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        token = request_id_var.set(rid)
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = rid
        return response


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

app.add_middleware(RequestIDMiddleware)
app.add_middleware(TestModeMiddleware)
_cors_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
# When allow_origins contains "*", credentials must be False —
# browsers reject credentialed requests to wildcard origins (RFC 6454 / Fetch spec).
_allow_credentials = "*" not in _cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_allow_credentials,
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
        try:
            async with async_session() as session:
                await session.execute(text("SELECT 1"))
            return {"status": "ok", "db": "sqlite", "version": app.version}
        except Exception as exc:
            return JSONResponse(
                content={"status": "degraded", "db": "sqlite_error", "detail": str(exc), "version": app.version},
                status_code=200,
            )
