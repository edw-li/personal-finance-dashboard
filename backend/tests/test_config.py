import pytest

from app.config import DEV_ADMIN_PASSWORD, DEV_SECRET_KEY, Settings
from app.services import clock


def test_dev_secret_key_rejected_outside_dev():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(environment="prod", secret_key=DEV_SECRET_KEY)


def test_dev_admin_password_rejected_outside_dev():
    with pytest.raises(ValueError, match="ADMIN_PASSWORD"):
        Settings(environment="prod", secret_key="x" * 64, admin_password=DEV_ADMIN_PASSWORD)


def test_prod_with_real_secrets_ok():
    s = Settings(environment="prod", secret_key="x" * 64, admin_password="real-password")
    assert s.environment == "prod"


def test_wildcard_cors_rejected():
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        Settings(cors_origins="*")


def test_short_secret_key_rejected_outside_dev():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(environment="prod", secret_key="x" * 31, admin_password="real-password")


def test_out_of_range_admin_password_rejected_outside_dev():
    # Empty passes the "is it still the dev default" check but yields a working empty login.
    with pytest.raises(ValueError, match="ADMIN_PASSWORD"):
        Settings(environment="prod", secret_key="x" * 64, admin_password="")
    # bcrypt's limit is BYTES: 40 accented chars is 80 bytes and would crash seed at boot.
    with pytest.raises(ValueError, match="ADMIN_PASSWORD"):
        Settings(environment="prod", secret_key="x" * 64, admin_password="é" * 40)


def test_assistant_config_defaults(monkeypatch):
    # A developer shell that exports these would flip the asserts — and pytest's assertion
    # rewriting would print the real key through the Settings repr. Clear them first.
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.delenv("NVIDIA_BASE_URL", raising=False)
    monkeypatch.delenv("NVIDIA_CA_BUNDLE", raising=False)
    s = Settings(_env_file=None)
    assert s.nvidia_api_key is None
    assert s.nvidia_base_url == "https://integrate.api.nvidia.com/v1"
    assert s.nvidia_ca_bundle is None


def test_lifecycle_config_defaults(monkeypatch):
    monkeypatch.delenv("DATA_DIR", raising=False)
    monkeypatch.delenv("SNAPSHOT_ENABLED", raising=False)
    s = Settings(_env_file=None)
    # ./data relative to the process cwd (backend/ in start.sh); prod mounts a volume at
    # /data and sets DATA_DIR=/data in docker-compose.prod.yml.
    assert s.data_dir == "./data"
    assert s.snapshot_enabled is True


# --- the dev-only clock override (2026-09-23 spec §K1) ---


def test_a_process_environment_clock_override_is_refused_outside_dev(monkeypatch):
    monkeypatch.setenv("PRODUCT_TODAY", "2026-10-01")
    with pytest.raises(ValueError, match="PRODUCT_TODAY"):
        Settings(
            _env_file=None, environment="prod", secret_key="x" * 64, admin_password="real-password"
        )


def test_the_override_starts_in_dev_and_a_malformed_one_does_not(monkeypatch):
    monkeypatch.setenv("PRODUCT_TODAY", "2026-10-01")
    assert Settings(_env_file=None).environment == "dev"
    monkeypatch.setenv("PRODUCT_TODAY", "Oct 1")
    with pytest.raises(ValueError, match="PRODUCT_TODAY"):
        Settings(_env_file=None)


def test_a_product_today_line_in_the_env_file_changes_nothing(monkeypatch, tmp_path):
    """backend/.env is not the process environment: the validator and the clock both ignore a
    PRODUCT_TODAY there (spec §K1) — Settings declares no field for it."""
    monkeypatch.delenv("PRODUCT_TODAY", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(
        "PRODUCT_TODAY=2026-10-01\nENVIRONMENT=prod\n"
        f"SECRET_KEY={'x' * 64}\nADMIN_PASSWORD=real-password\n"
    )
    settings = Settings(_env_file=env_file)
    assert settings.environment == "prod"  # the file WAS read …
    assert not hasattr(settings, "product_today")  # … but no field exists for the override
    assert clock.product_today_override() is None  # and the clock never sees it
