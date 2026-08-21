from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import AppSetting, CompEvent, EsppLot, EsppPeriod, PaycheckProfile, RsuGrant


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
    ev = (await db.execute(select(CompEvent))).scalar_one()
    # Numeric(14,4): the sheet's 6-dp unvested price rounds to 4 dp — documented and pinned
    assert ev.unvested_price == Decimal("129.5651")


async def test_rsu_grant_roundtrip(db):
    db.add(
        RsuGrant(
            kind="new_hire",
            label="Offer letter",
            focal_year=None,
            shares=700,
            grant_price=Decimal("45.1200"),
            first_vest_date=date(2024, 9, 18),
            cliff_pct=Decimal("0.2500"),
            notes=None,
        )
    )
    await db.commit()
    grant = (await db.execute(select(RsuGrant))).scalar_one()
    assert (grant.kind, grant.label, grant.shares) == ("new_hire", "Offer letter", 700)
    assert grant.cliff_pct == Decimal("0.2500")
    assert grant.first_vest_date == date(2024, 9, 18)


async def test_rsu_grant_label_unique(db):
    # The API answers a taken label with a 409 from a pre-select, so it never reaches this
    # constraint — which is exactly why the constraint itself needs its own test.
    def grant(**overrides) -> RsuGrant:
        fields = {
            "kind": "refresh",
            "label": "FY26 refresh",
            "shares": 320,
            "grant_price": Decimal("129.5651"),
            "first_vest_date": date(2025, 6, 18),
            "cliff_pct": Decimal("0.0625"),
        }
        fields.update(overrides)
        return RsuGrant(**fields)

    db.add(grant())
    await db.commit()
    db.add(grant(shares=400, first_vest_date=date(2026, 6, 17)))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


async def test_focal_year_unique(db):
    db.add(CompEvent(focal_year=2025, current_base=Decimal("1")))
    await db.commit()
    db.add(CompEvent(focal_year=2025, current_base=Decimal("2")))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
