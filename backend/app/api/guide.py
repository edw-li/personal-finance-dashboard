"""Read-only setup evidence. Presence is reported, never inferred from visiting the guide."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import (
    Account,
    AccountBalance,
    AppSetting,
    CalendarFeedToken,
    CategoryBudget,
    ContributionLimit,
    CreditCard,
    EsppLot,
    EsppOffering,
    LatestPrice,
    LifecycleRun,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    PaycheckProfile,
    Person,
    PositionTransaction,
    RsuGrant,
    Security,
    SpendingCategory,
    TaxBracket,
    TaxInput,
    TaxYear,
    User,
    UserPreference,
)
from app.services import clock
from app.services.assistant_models import resolve_api_key
from app.tax_keys import JURISDICTIONS

router = APIRouter(prefix="/guide", tags=["guide"])


class SetupEvidence(BaseModel):
    complete: bool
    evidence: str


class SetupStatus(BaseModel):
    checked_at: datetime
    year: int
    steps: dict[str, SetupEvidence]


@router.get("/setup", response_model=SetupStatus)
async def setup_status(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> SetupStatus:
    year = clock.product_today().year

    def count(model, *conditions):
        return select(func.count()).select_from(model).where(*conditions).scalar_subquery()

    # One round trip for the record counts; no financial amounts, credential values or writes.
    statements = {
        "appearance": count(
            UserPreference,
            UserPreference.user_id == user.id,
            UserPreference.key.in_(["theme", "density", "landing_page"]),
        ),
        "people": count(Person),
        "accounts": count(Account, Account.is_active.is_(True)),
        "categories": count(SpendingCategory, SpendingCategory.is_active.is_(True)),
        "imports": count(
            LifecycleRun,
            LifecycleRun.kind == "import_xlsx",
            LifecycleRun.ok.is_(True),
            LifecycleRun.dry_run.is_(False),
        ),
        "prices": count(LatestPrice),
        "securities": count(Security),
        "transactions": count(PositionTransaction),
        "imported_transactions": count(PositionTransaction, PositionTransaction.source == "import"),
        "limits": count(ContributionLimit, ContributionLimit.year == year),
        "tax_year": count(TaxYear, TaxYear.year == year),
        "tax_inputs": count(TaxInput, TaxInput.year == year),
        "tax_tables": select(func.count(func.distinct(TaxBracket.jurisdiction)))
        .where(
            TaxBracket.year == year,
            TaxBracket.person_id.is_(None),
            TaxBracket.jurisdiction.in_(JURISDICTIONS),
            TaxBracket.filing_status
            == select(TaxYear.filing_status).where(TaxYear.year == year).scalar_subquery(),
        )
        .scalar_subquery(),
        "profiles": count(PaycheckProfile),
        "grants": count(RsuGrant),
        "offerings": count(EsppOffering),
        "lots": count(EsppLot),
        "cards": count(CreditCard),
        "feeds": count(CalendarFeedToken, CalendarFeedToken.user_id == user.id),
        "snapshots": count(
            LifecycleRun,
            LifecycleRun.kind == "snapshot",
            LifecycleRun.ok.is_(True),
            LifecycleRun.dry_run.is_(False),
        ),
        "budgets": count(CategoryBudget, CategoryBudget.amount.is_not(None)),
    }
    counts = (
        (await db.execute(select(*(query.label(key) for key, query in statements.items()))))
        .one()
        ._mapping
    )
    # Require all three feeds for the SAME month; unrelated incomplete months do not qualify.
    first_month = await db.scalar(
        select(NetWorthSnapshot.month)
        .where(
            select(AccountBalance.id)
            .where(AccountBalance.snapshot_id == NetWorthSnapshot.id)
            .exists(),
            select(MonthlySpending.id)
            .where(MonthlySpending.month == NetWorthSnapshot.month)
            .exists(),
            select(MonthlyCashflow.month)
            .where(MonthlyCashflow.month == NetWorthSnapshot.month)
            .exists(),
        )
        .order_by(NetWorthSnapshot.month)
        .limit(1)
    )
    saved_settings = set(
        (
            await db.scalars(
                select(AppSetting.key).where(
                    AppSetting.key.in_(["swr_pct", "price_refresh_cron", "calendar_update_due_day"])
                )
            )
        ).all()
    )
    _key, key_source = await resolve_api_key(db)
    steps: dict[str, SetupEvidence] = {}

    def evidence(task: str, complete: bool, detail: str):
        steps[f"setup-{task}"] = SetupEvidence(complete=bool(complete), evidence=detail)

    evidence(
        "appearance",
        counts["appearance"] == 3,
        "Theme, density and landing-page preferences are saved for this account."
        if counts["appearance"] == 3
        else "Choose your preferred appearance, then mark this done.",
    )
    evidence(
        "password",
        user.token_version > 0,
        "A password change is recorded for this account."
        if user.token_version > 0
        else "Confirm you have replaced the initial password, then mark this done.",
    )
    evidence(
        "household",
        counts["people"] > 0,
        f"{counts['people']} household members saved; check that the roster is complete.",
    )
    evidence("accounts", counts["accounts"] > 0, f"{counts['accounts']} active accounts saved.")
    evidence(
        "categories",
        counts["categories"] > 0,
        f"{counts['categories']} active categories saved; "
        "review their Living, Tax or Transfer kinds.",
    )
    evidence(
        "import",
        counts["imports"] > 0 or counts["imported_transactions"] > 0,
        "A successful workbook import is recorded."
        if counts["imports"]
        else f"{counts['imported_transactions']} imported ledger rows are present. "
        "Older imports may predate Activity."
        if counts["imported_transactions"]
        else "No import evidence found. Mark done for an older import, "
        "or Not needed for manual entry.",
    )
    evidence(
        "first-month",
        first_month is not None,
        f"Balances, spending and take-home are saved for {first_month:%B %Y}. "
        "Closing is a separate review."
        if first_month
        else "No single month has balances, spending and take-home saved yet.",
    )
    evidence(
        "prices",
        counts["prices"] > 0 and "price_refresh_cron" in saved_settings,
        f"{counts['prices']} quotes saved; "
        + (
            "a refresh schedule is saved."
            if "price_refresh_cron" in saved_settings
            else "save your refresh schedule."
        ),
    )
    evidence(
        "portfolio",
        counts["securities"] > 0 and counts["transactions"] > 0,
        f"{counts['securities']} securities and {counts['transactions']} transactions saved; "
        "allocation targets are optional.",
    )
    evidence(
        "limits",
        counts["limits"] > 0 and "swr_pct" in saved_settings,
        f"{counts['limits']} contribution limits saved for {year}; "
        + (
            "plan assumptions saved."
            if "swr_pct" in saved_settings
            else "review and save plan assumptions."
        ),
    )
    evidence(
        "taxes",
        counts["tax_year"] > 0
        and counts["tax_inputs"] > 0
        and counts["tax_tables"] == len(JURISDICTIONS),
        f"{year}: "
        + (
            "tax year, inputs and tables for its filing status are present; "
            "check the published figures."
            if counts["tax_year"]
            and counts["tax_inputs"]
            and counts["tax_tables"] == len(JURISDICTIONS)
            else f"{counts['tax_tables']} of {len(JURISDICTIONS)} default table groups saved "
            "for the year's filing status. Check the year, its inputs and remaining tables."
        ),
    )
    evidence(
        "paycheck",
        counts["profiles"] > 0,
        f"{counts['profiles']} paycheck profiles saved; confirm each earner is covered.",
    )
    evidence(
        "comp-espp",
        counts["grants"] > 0 and counts["offerings"] > 0 and counts["lots"] > 0,
        f"{counts['grants']} grants, {counts['offerings']} ESPP offerings "
        f"and {counts['lots']} lots saved. "
        "Mark done if all applicable records are entered.",
    )
    evidence(
        "cards",
        counts["cards"] > 0,
        f"{counts['cards']} cards saved; check opened dates and rewards.",
    )
    evidence(
        "calendar",
        counts["feeds"] > 0 and "calendar_update_due_day" in saved_settings,
        f"{counts['feeds']} subscription links created; "
        + (
            "reminder day saved. Confirm your calendar is subscribed."
            if "calendar_update_due_day" in saved_settings
            else "save your reminder day."
        ),
    )
    evidence(
        "snapshot",
        counts["snapshots"] > 0,
        "A successful snapshot is recorded. Check Backups for the available files."
        if counts["snapshots"]
        else "No successful snapshot is recorded yet.",
    )
    evidence("budgets", counts["budgets"] > 0, f"{counts['budgets']} dated budget amounts saved.")
    evidence(
        "assistant",
        key_source is not None,
        "An assistant key is configured; use Test key to check it."
        if key_source
        else "No assistant key configured. This feature is optional.",
    )
    return SetupStatus(checked_at=datetime.now(UTC), year=year, steps=steps)
