from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET_KEY = "dev-only-change-me-to-a-random-secret"
DEV_ADMIN_PASSWORD = "changeme123"

# HS256 keys under 32 bytes weaken the MAC (RFC 7518 3.2) and make PyJWT warn on every
# encode/decode. bcrypt raises above 72 bytes, which would crash seed.py at container boot.
MIN_SECRET_KEY_BYTES = 32
MIN_PASSWORD_BYTES = 8
MAX_PASSWORD_BYTES = 72


class Settings(BaseSettings):
    environment: str = "dev"
    database_url: str = "postgresql+asyncpg://finance:finance@localhost:5433/finance"
    secret_key: str = DEV_SECRET_KEY
    access_token_expire_hours: int = 24
    cors_origins: str = "http://localhost:5173"
    admin_email: str = "admin@example.com"
    admin_password: str = DEV_ADMIN_PASSWORD
    # Path to a PEM bundle for yfinance's curl_cffi session. Needed ONLY behind
    # TLS-intercepting proxies (this dev box — see plan probe 2); prod leaves it unset.
    yfinance_ca_bundle: str | None = None
    # ── Assistant (2026-09-01 spec §3) ────────────────────────────────────────────
    # The deploy-time baseline key; a Settings-page override (app_settings row) wins.
    nvidia_api_key: str | None = None
    # Tests point this at a mock; never user-facing.
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    # Dev-box only: PEM bundle when a TLS-intercepting proxy sits in the way (the
    # yfinance_ca_bundle precedent above); prod leaves it unset.
    nvidia_ca_bundle: str | None = None
    scheduler_enabled: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def _validate_safety(self) -> "Settings":
        if self.environment != "dev":
            if self.secret_key == DEV_SECRET_KEY:
                raise ValueError("SECRET_KEY must be set outside dev")
            if self.admin_password == DEV_ADMIN_PASSWORD:
                raise ValueError("ADMIN_PASSWORD must be set outside dev")
            if len(self.secret_key.encode()) < MIN_SECRET_KEY_BYTES:
                raise ValueError(f"SECRET_KEY must be at least {MIN_SECRET_KEY_BYTES} bytes")
            # bcrypt's limit is BYTES, not characters: 40 accented chars is 80 bytes.
            if not MIN_PASSWORD_BYTES <= len(self.admin_password.encode()) <= MAX_PASSWORD_BYTES:
                raise ValueError(
                    f"ADMIN_PASSWORD must be {MIN_PASSWORD_BYTES}-{MAX_PASSWORD_BYTES} bytes"
                )
        if "*" in self.cors_origin_list:
            raise ValueError("CORS_ORIGINS must list explicit origins, not '*'")
        return self

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
