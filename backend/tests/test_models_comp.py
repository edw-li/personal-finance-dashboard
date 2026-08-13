from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.models import AppSetting, CompEvent, EsppLot, EsppPeriod, PaycheckProfile


async def test_espp_lot_roundtrip(db):
    db.add(
        EsppLot(
            purchase_date=date(2024, 2, 29),
            qualifying_date=date(2025, 9, 1),
            shares=Decimal("260"),
            subscription_price=Decimal("48.509"),
            purchase_fmv=Decimal("79.112"),
            purchase_price=Decimal("41.23265"),
        )
    )
    await db.commit()
    lot = (await db.execute(select(EsppLot))).scalar_one()
    assert lot.sold_date is None
    assert lot.shares == Decimal("260")
    assert lot.purchase_price == Decimal("41.23265")  # 5 dp must survive exactly


async def test_paycheck_profile_roundtrip(db):
    db.add(
        PaycheckProfile(
            effective_date=date(2026, 3, 1),
            annual_salary=Decimal("188930"),
            trad_401k_pct=Decimal("0.13"),
            roth_401k_pct=Decimal("0"),
            after_tax_401k_pct=Decimal("0.03"),
            espp_pct=Decimal("0.11"),
            withholding_pct=Decimal("0.334009166"),
            dental_vision_per_check=Decimal("12.50"),
            hsa_per_check=Decimal("100.00"),
        )
    )
    await db.commit()
    p = (await db.execute(select(PaycheckProfile))).scalar_one()
    assert p.pay_periods_per_year == 24
    assert p.withholding_pct == Decimal("0.334009166")


async def test_comp_event_and_period_and_setting(db):
    db.add(
        CompEvent(
            focal_year=2025,
            current_base=Decimal("151000"),
            new_base=Decimal("162000"),
            unvested_rsus=Decimal("2152"),
            unvested_price=Decimal("129.565056"),
            refresh_rsus=Decimal("502"),
            grant_price=Decimal("129.59"),
        )
    )
    db.add(
        EsppPeriod(
            label="2026 Feb purchase",
            period_start=date(2025, 9, 1),
            period_end=date(2026, 2, 27),
            semi_annual_base=Decimal("81000"),
            additional_payments=Decimal("0"),
            contribution_pct=Decimal("0.14"),
        )
    )
    db.add(AppSetting(key="swr_pct", value={"value": 0.04}))
    await db.commit()
    setting = await db.get(AppSetting, "swr_pct")
    assert setting.value == {"value": 0.04}
