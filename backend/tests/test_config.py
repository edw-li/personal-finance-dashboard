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
