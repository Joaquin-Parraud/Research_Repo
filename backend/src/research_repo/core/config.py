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

    session_ttl_days: int = Field(default=30, ge=1)
    cookie_secure: bool = False

    login_rate_limit_attempts: int = Field(default=5, ge=1)
    login_rate_limit_window_seconds: int = Field(default=300, ge=1)

    owner_email: str | None = None
    owner_password: SecretStr | None = None
    owner_display_name: str = ""

    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
