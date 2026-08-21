from datetime import date
from decimal import Decimal

from sqlalchemy import Date, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EsppLot(Base):
    __tablename__ = "espp_lots"

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_date: Mapped[date] = mapped_column(Date, unique=True)
    qualifying_date: Mapped[date] = mapped_column(Date)
    shares: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    # Numeric(14,5), not (14,4): the sheet's purchase price genuinely carries 5 dp
    # (0.85 x 48.509 = 41.23265) — 4 dp would break cent-exact cost-basis reconciliation.
    subscription_price: Mapped[Decimal] = mapped_column(Numeric(14, 5))
    purchase_fmv: Mapped[Decimal] = mapped_column(Numeric(14, 5))
    purchase_price: Mapped[Decimal] = mapped_column(Numeric(14, 5))
    sold_date: Mapped[date | None] = mapped_column(Date)
    sold_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 5))
    notes: Mapped[str | None] = mapped_column(Text)


class EsppPeriod(Base):
    __tablename__ = "espp_periods"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(60), unique=True)
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    semi_annual_base: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    additional_payments: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    contribution_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9))


class PaycheckProfile(Base):
    __tablename__ = "paycheck_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    effective_date: Mapped[date] = mapped_column(Date, unique=True)
    annual_salary: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    pay_periods_per_year: Mapped[int] = mapped_column(default=24)
    trad_401k_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    roth_401k_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    after_tax_401k_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    espp_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    withholding_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    dental_vision_per_check: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    hsa_per_check: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    notes: Mapped[str | None] = mapped_column(Text)


class CompEvent(Base):
    __tablename__ = "comp_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    focal_year: Mapped[int] = mapped_column(unique=True)
    current_base: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    new_base: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    unvested_rsus: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    unvested_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    refresh_rsus: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    grant_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    notes: Mapped[str | None] = mapped_column(Text)


class RsuGrant(Base):
    """Dashboard-only equity grants (2026-08-21 spec). NOT in the spreadsheet: the importer
    never reads or writes this table (pinned in test_importer_apply.py). Vest rows are never
    stored — rsu_vesting computes the schedule from these parameters at read time."""

    __tablename__ = "rsu_grants"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(10))  # 'new_hire' | 'refresh' (API-validated)
    label: Mapped[str] = mapped_column(String(60), unique=True)
    focal_year: Mapped[int | None] = mapped_column()
    shares: Mapped[int] = mapped_column()  # whole shares by definition
    grant_price: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    first_vest_date: Mapped[date] = mapped_column(Date)
    cliff_pct: Mapped[Decimal] = mapped_column(Numeric(7, 4))
    # Shares-per-vest rounding: cumulative entitlement floors to a multiple of this (the
    # final vest trues up to `shares`). 1 = single shares (refresh grants); the user's real
    # offer grant vests in tens (broker-verified 2026-08-21, spec §8.2).
    vest_quantum: Mapped[int] = mapped_column(default=1, server_default="1")
    notes: Mapped[str | None] = mapped_column(Text)
