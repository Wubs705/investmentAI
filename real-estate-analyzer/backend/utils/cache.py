import hashlib
import json
from typing import Any, Callable, Awaitable

import diskcache

from backend.config import settings


class CacheService:
    """Disk-based caching layer using diskcache."""

    def __init__(self):
        self._cache = diskcache.Cache(
            str(settings.cache_path),
            size_limit=500_000_000,  # 500 MB cap (H10)
            cull_limit=10,           # evict 10 items per set when over limit
        )
        self._ttl = settings.cache_ttl_hours * 3600

    def _make_key(self, prefix: str, params: dict) -> str:
        raw = json.dumps(params, sort_keys=True, default=str)
        h = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return f"{prefix}:{h}"

    def get(self, key: str) -> Any | None:
        return self._cache.get(key)

    def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        self._cache.set(key, value, expire=ttl or self._ttl)

    async def get_or_fetch(
        self,
        key: str,
        fetch_fn: Callable[[], Awaitable[Any]],
        ttl: int | None = None,
    ) -> Any:
        """Return cached value or call fetch_fn and cache the result."""
        cached = self.get(key)
        if cached is not None:
            return cached
        result = await fetch_fn()
        self.set(key, result, ttl)
        return result

    def close(self):
        self._cache.close()


cache_service = CacheService()
