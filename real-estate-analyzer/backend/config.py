import logging
import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_config_log = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # AI Analysis
    anthropic_api_key: str = ""

    # Listing / property data APIs
    rentcast_api_key: str = ""   # MLS-sourced active listings
    estated_api_key: str = ""    # Property enrichment (valuation, tax, structure)

    # Optional market-data providers
    census_api_key: str = ""
    bls_api_key: str = ""   # Register free at https://data.bls.gov/registrationEngine/

    # API authentication — clients must send this key in the X-API-Key header
    api_auth_key: str = ""
    auth_required: bool = False  # Enable to enforce API key auth on all /api endpoints

    # AI model routing (H5 — configurable via env vars)
    model_assumptions: str = "claude-haiku-4-5-20251001"
    model_narrative: str = "claude-sonnet-4-6"

    # CORS — comma-separated list of allowed origins (e.g. "https://app.example.com")
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # App config
    cache_dir: str = "./cache"
    cache_ttl_hours: int = 24
    max_results: int = 20
    default_radius_miles: int = 15
    default_down_payment_pct: int = 20

    # Service timeouts in seconds (L3)
    rentcast_timeout_s: float = 20.0
    estated_timeout_s: float = 15.0
    hud_timeout_s: float = 10.0
    geocoding_timeout_s: float = 10.0
    anthropic_timeout_s: float = 30.0

    # Database
    database_url: str = "sqlite+aiosqlite:///./real_estate.db"

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""  # JWT Settings → JWT Secret in Supabase dashboard

    @property
    def has_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def has_supabase_auth(self) -> bool:
        return bool(self.supabase_jwt_secret)

    @property
    def cache_path(self) -> Path:
        return Path(self.cache_dir)

    @property
    def has_anthropic_key(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def has_rentcast_key(self) -> bool:
        return bool(self.rentcast_api_key)

    @property
    def has_estated_key(self) -> bool:
        return bool(self.estated_api_key)

    @property
    def has_census_key(self) -> bool:
        return bool(self.census_api_key)

    @property
    def has_bls_key(self) -> bool:
        return bool(self.bls_api_key)


settings = Settings()

# H9 — Warn loudly when SQLite is used outside a development environment.
# Check both a conventional ENVIRONMENT variable and DEBUG flag so any
# deployment pattern is covered.
_env = os.environ.get("ENVIRONMENT", "").lower()
_debug = os.environ.get("DEBUG", "").lower() in ("1", "true", "yes")
if "sqlite" in settings.database_url and _env not in ("development", "dev", "local") and not _debug:
    _config_log.warning(
        "DATABASE_URL is set to a local SQLite file (%s) but the application does not "
        "appear to be running in development mode (ENVIRONMENT=%r, DEBUG=%r). "
        "Set DATABASE_URL to a production-grade database or set ENVIRONMENT=development "
        "to suppress this warning.",
        settings.database_url,
        _env or "<unset>",
        _debug,
    )
