"""Full-data export (2026-08-31 tier-1 spec §B1): one auth-gated GET streaming a ZIP of
every user-data table — a CSV per table plus one nested finance-export.json, described by
manifest.json. The table list is HAND-MAINTAINED, not reflected: a future table must be a
conscious export decision, and test_export_api pins the list against Base.metadata so
forgetting one fails the suite until it is listed here or named in EXCLUDED_TABLES."""

import csv
import io
import json
import zipfile
from datetime import UTC, date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models import (
    Account,
    AccountBalance,
    AppSetting,
    CardCredit,
    CategoryBudget,
    CompEvent,
    ContributionLimit,
    CreditCard,
    CreditLimitEvent,
    CustomEvent,
    DividendPayment,
    EsppLot,
    EsppOffering,
    EsppPeriod,
    LatestPrice,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    PortfolioAccount,
    PortfolioValueHistory,
    PositionTransaction,
    PriceHistory,
    RewardCategory,
    RewardRate,
    RsuGrant,
    Security,
    SecurityDividendEvent,
    SpendingCategory,
    TaxBracket,
    TaxInput,
    TaxInputDefinition,
    TaxYear,
)

router = APIRouter(prefix="/export", tags=["export"], dependencies=[Depends(get_current_user)])

# Every user-data table, in the spec's order (§B1). `users` is excluded — password hash,
# and on a single-user app nothing else in it is worth exporting; `alembic_version` is not
# a Base.metadata table at all (the manifest carries the head instead).
EXPORTED_TABLES: tuple[tuple[type, str], ...] = (
    (Account, "accounts"),
    (NetWorthSnapshot, "net_worth_snapshots"),
    (AccountBalance, "account_balances"),
    (SpendingCategory, "spending_categories"),
    (MonthlySpending, "monthly_spending"),
    (MonthlyCashflow, "monthly_cashflow"),
    (CategoryBudget, "category_budgets"),
    (Security, "securities"),
    (PortfolioAccount, "portfolio_accounts"),
    (PositionTransaction, "position_transactions"),
    (DividendPayment, "dividend_payments"),
    (LatestPrice, "latest_prices"),
    (PriceHistory, "price_history"),
    (SecurityDividendEvent, "security_dividend_events"),
    (PortfolioValueHistory, "portfolio_value_history"),
    (TaxYear, "tax_years"),
    (TaxBracket, "tax_brackets"),
    (TaxInputDefinition, "tax_input_definitions"),
    (TaxInput, "tax_inputs"),
    (EsppLot, "espp_lots"),
    (EsppPeriod, "espp_periods"),
    (EsppOffering, "espp_offerings"),
    (PaycheckProfile, "paycheck_profiles"),
    (CompEvent, "comp_events"),
    (RsuGrant, "rsu_grants"),
    (CreditCard, "credit_cards"),
    (CardCredit, "card_credits"),
    (RewardCategory, "reward_categories"),
    (RewardRate, "reward_rates"),
    (CreditLimitEvent, "credit_limit_events"),
    (ContributionLimit, "contribution_limits"),
    (CustomEvent, "custom_events"),
    (Person, "people"),
    (AppSetting, "app_settings"),
)

EXCLUDED_TABLES = frozenset({"users"})


def _csv_cell(value: object) -> str:
    """One CSV spelling per type (spec §B1): NULL is the EMPTY cell, Decimals are plain
    strings (format 'f' — str() can spell exponents), dates ISO, booleans lowercase
    true/false, JSONB compact JSON. csv.writer supplies the RFC-4180 quoting."""
    if value is None:
        return ""
    if isinstance(value, bool):  # before anything numeric-adjacent: bool subclasses int
        return "true" if value else "false"
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, date):  # datetime subclasses date; isoformat serves both
        return value.isoformat()
    if isinstance(value, dict | list):
        return json.dumps(value, separators=(",", ":"), sort_keys=True)
    return str(value)


def _json_cell(value: object) -> object:
    """The JSON twin: identical spellings for Decimal and dates, but None/bool/int/str and
    JSONB structures stay native — this file exists for programmatic re-import."""
    if isinstance(value, bool):
        return value
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, date):
        return value.isoformat()
    return value


async def _alembic_head(db: AsyncSession) -> str | None:
    """The system router's exact probe (app/api/system.py): to_regclass, not try/except —
    a missing alembic_version is an EXPECTED state (create_all-built databases, every test
    run), and a failed SELECT would abort the session's transaction mid-request."""
    has_alembic = (
        await db.execute(text("SELECT to_regclass('alembic_version') IS NOT NULL"))
    ).scalar_one()
    if not has_alembic:
        return None
    head_row = await db.execute(text("SELECT version_num FROM alembic_version"))
    return head_row.scalars().first()


@router.get("/snapshot")
async def export_snapshot(db: AsyncSession = Depends(get_db)) -> StreamingResponse:
    exported_at = datetime.now(UTC)
    alembic_head = await _alembic_head(db)
    counts: dict[str, int] = {}
    json_tables: dict[str, list[dict[str, object]]] = {}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for model, table_name in EXPORTED_TABLES:
            columns = list(model.__table__.columns)  # model-definition order
            rows = (
                (
                    await db.execute(
                        # Ordered by primary key so two exports of the same data are
                        # byte-identical (diffable backups).
                        select(model).order_by(*model.__table__.primary_key.columns)
                    )
                )
                .scalars()
                .all()
            )
            counts[table_name] = len(rows)
            sink = io.StringIO()
            writer = csv.writer(sink)  # csv's default \r\n line ending IS RFC 4180's
            writer.writerow([column.key for column in columns])
            for row in rows:
                writer.writerow([_csv_cell(getattr(row, column.key)) for column in columns])
            archive.writestr(f"csv/{table_name}.csv", sink.getvalue())
            json_tables[table_name] = [
                {column.key: _json_cell(getattr(row, column.key)) for column in columns}
                for row in rows
            ]
        manifest = {
            "exported_at": exported_at.isoformat(),
            "environment": settings.environment,
            "alembic_head": alembic_head,
            "app": "personal-finance-dashboard",
            "note": "full user-data export; users and alembic_version are excluded by design",
            "tables": counts,
        }
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))
        archive.writestr(
            "finance-export.json",
            json.dumps(
                {
                    "exported_at": exported_at.isoformat(),
                    "alembic_head": alembic_head,
                    "tables": json_tables,
                },
                indent=2,
            ),
        )
    payload = buffer.getvalue()
    filename = f"finance-export-{exported_at.strftime('%Y%m%d-%H%M')}.zip"
    return StreamingResponse(
        iter([payload]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(payload)),
        },
    )
