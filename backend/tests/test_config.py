import pytest

from app.config import DEV_ADMIN_PASSWORD, DEV_SECRET_KEY, Settings


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


def test_assistant_config_defaults():
    s = Settings(_env_file=None)
    assert s.nvidia_api_key is None
    assert s.nvidia_base_url == "https://integrate.api.nvidia.com/v1"
    assert s.nvidia_ca_bundle is None
