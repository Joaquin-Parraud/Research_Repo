"""Application settings, read from environment variables."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    database_url: str = Field(
        description="SQLAlchemy URL, e.g. postgresql+asyncpg://user:pass@host:5432/db",
    )
    storage_dir: Path = Path("/data/storage")
    # Largest PDF accepted by an upload, in megabytes (MiB).
    max_upload_mb: int = Field(default=200, ge=1)

    session_ttl_days: int = Field(default=30, ge=1)
    cookie_secure: bool = False

    login_rate_limit_attempts: int = Field(default=5, ge=1)
    login_rate_limit_window_seconds: int = Field(default=300, ge=1)

    owner_email: str | None = None
    owner_password: SecretStr | None = None
    owner_display_name: str = ""

    # Metadata suggestions on upload (FR-S2): Crossref lookups by DOI. When disabled, no
    # outbound request is ever made and only the PDF's embedded metadata is used.
    metadata_lookup_enabled: bool = True
    # Total time budget of one suggestion run (PDF inspection + Crossref), in seconds.
    metadata_lookup_timeout_seconds: float = Field(default=6.0, gt=0, le=120)
    # Contact address sent to Crossref in the User-Agent ("polite pool"); optional.
    crossref_mailto: str | None = None

    # Citation service (citeproc-js with the official APA style), on the internal network.
    citeproc_url: str = "http://citeproc:8080"
    # Longest wait for one rendering request; a large exported bibliography takes seconds.
    # Connecting has its own short limit (2 s).
    citeproc_timeout_seconds: float = Field(default=30.0, gt=0, le=600)

    log_level: str = "INFO"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
