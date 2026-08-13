from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET_KEY = "change-me-to-a-random-secret"
DEV_ADMIN_PASSWORD = "changeme123"


class Settings(BaseSettings):
    environment: str = "dev"
    database_url: str = "postgresql+asyncpg://finance:finance@localhost:5433/finance"
    secret_key: str = DEV_SECRET_KEY
    access_token_expire_hours: int = 24
    cors_origins: str = "http://localhost:5173"
    admin_email: str = "admin@example.com"
    admin_password: str = DEV_ADMIN_PASSWORD

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
        if "*" in self.cors_origin_list:
            raise ValueError("CORS_ORIGINS must list explicit origins, not '*'")
        return self

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
