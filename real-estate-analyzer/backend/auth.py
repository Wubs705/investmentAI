"""
Authentication dependency for FastAPI.

Priority order:
  1. Supabase Bearer JWT  — when SUPABASE_JWT_SECRET is configured
  2. Legacy X-API-Key     — when AUTH_REQUIRED=true (no Supabase)
  3. Open / dev mode      — returns None (no auth enforced)

Endpoints that need the calling user's ID should declare:
    user_id: str | None = Depends(get_current_user)
"""

from fastapi import Header, HTTPException, status
from jose import JWTError, jwt

from backend.config import settings


async def get_current_user(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> str | None:
    """Return the authenticated user's UUID, or None in open/dev mode."""

    # ── 1. Supabase JWT (primary) ────────────────────────────────
    if settings.has_supabase_auth:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authorization header with Bearer token required.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        token = authorization.removeprefix("Bearer ").strip()
        try:
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
            user_id: str | None = payload.get("sub")
            if not user_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token is missing user ID.",
                )
            return user_id
        except JWTError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Token validation failed: {exc}",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # ── 2. Legacy API key fallback ───────────────────────────────
    if settings.auth_required:
        if not settings.api_auth_key:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="API authentication is enabled but no API_AUTH_KEY is configured.",
            )
        if x_api_key != settings.api_auth_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing X-API-Key header.",
                headers={"WWW-Authenticate": "ApiKey"},
            )

    # ── 3. Open mode ─────────────────────────────────────────────
    return None
