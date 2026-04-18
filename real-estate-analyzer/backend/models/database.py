import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Column, DateTime, Integer, String, Text, Float, create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from backend.config import settings


class Base(DeclarativeBase):
    pass


class PropertyRecord(Base):
    __tablename__ = "properties"

    id = Column(String, primary_key=True)
    address = Column(String, nullable=False)
    city = Column(String, nullable=False)
    state = Column(String, nullable=False)
    zip_code = Column(String)
    list_price = Column(Integer)
    data = Column(Text, nullable=False)  # JSON blob of full PropertyListing
    source = Column(String)
    fetched_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class AnalysisRecord(Base):
    __tablename__ = "analyses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    property_id = Column(String, nullable=False, index=True)  # H8: indexed for fast lookups
    goal = Column(String, nullable=False)
    data = Column(Text, nullable=False)  # JSON blob of PropertyAnalysis
    score = Column(Integer)
    analyzed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class SearchRecord(Base):
    __tablename__ = "searches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    criteria = Column(Text, nullable=False)  # JSON blob
    result_count = Column(Integer, default=0)
    searched_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    """Create all tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    async with async_session() as session:
        yield session


# ── Supabase client (optional) ───────────────────────────────────────────────
_supabase_client: Any = None


async def get_supabase() -> Any:
    """Return the Supabase async client, or None if not configured."""
    global _supabase_client
    if not settings.has_supabase:
        return None
    if _supabase_client is None:
        from supabase import acreate_client
        _supabase_client = await acreate_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
        )
    return _supabase_client
