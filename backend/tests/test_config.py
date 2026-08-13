import pytest

from app.config import Settings


def test_dev_secrets_rejected_outside_dev():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(environment="prod")


def test_prod_with_real_secrets_ok():
    s = Settings(environment="prod", secret_key="x" * 64, admin_password="real-password")
    assert s.environment == "prod"


def test_wildcard_cors_rejected():
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        Settings(cors_origins="*")
