from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://finance:finance@localhost:5433/finance"
    secret_key: str = "change-me-to-a-random-secret"
    access_token_expire_hours: int = 24
    cors_origins: str = "http://localhost:5173"
    admin_email: str = "admin@example.com"
    admin_password: str = "changeme123"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
