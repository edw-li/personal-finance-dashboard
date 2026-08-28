from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Numeric, String, Text, UniqueConstraint
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
    # ONE timeline PER PERSON: the effective date is unique within an owner, not across
    # the household, so a couple can both have a profile effective the same January 1.
    # The old bare-`effective_date` unique lived in three places — this model,
    # api/paycheck.py's 409 pre-check and migration e301f88ed241 — and all three moved
    # together (2026-08-27 spec §3.1). It must live HERE too, because the pytest database
    # is built by Base.metadata.create_all, which never runs a migration (Person's rule).
    __table_args__ = (UniqueConstraint("person_id", "effective_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # NOT NULL: a paycheck belongs to somebody. RESTRICT, not CASCADE — there is no
    # person delete route, and pay history must not vanish behind a roster edit
    # (tax_inputs.person_id's rule).
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id", ondelete="RESTRICT"))
    effective_date: Mapped[date] = mapped_column(Date)
    annual_salary: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    pay_periods_per_year: Mapped[int] = mapped_column(default=24)
    trad_401k_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    roth_401k_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    after_tax_401k_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    espp_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    withholding_pct: Mapped[Decimal] = mapped_column(Numeric(10, 9), default=0)
    dental_vision_per_check: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    hsa_per_check: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0)
    # 'none' | 'self' | 'family' — which HSA cap applies to this person (Plan 4's limit
    # registry reads it). Python-validated by api/paycheck.py rather than a DB enum or
    # CHECK (rsu_grants.kind's posture): the vocabulary is the app's, and a constraint
    # would need a migration every time it grew. The server_default is repeated from the
    # migration so `alembic check` stays clean (rsu_grants.vest_quantum's precedent).
    hsa_coverage: Mapped[str] = mapped_column(String(10), default="self", server_default="self")
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


class EsppOffering(Base):
    """A ~24-month ESPP enrollment window: the subscription price fixed at its start.

    Dashboard-only — the workbook has no offerings concept, so the importer never reads
    or writes this table (rsu_grants' posture, pinned by test). Purchase periods link to
    offerings BY DATE, never FK: a period's offering is the row with the greatest
    offering_start <= period_start (espp_calc.plan_year_rows), so adding an offering
    retroactively re-prices later periods with zero re-linking and a mid-cycle reset is
    just another row.
    """

    __tablename__ = "espp_offerings"
    # run_modeler DIVIDES by the subscription price; the API rejects <= 0, but nothing else
    # stops a hand-edited row from reaching that division.
    __table_args__ = (
        CheckConstraint("subscription_price > 0", name="subscription_price_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    offering_start: Mapped[date] = mapped_column(Date, unique=True)
    # Numeric(14,5): the espp lot price family (espp_lots.subscription_price), NOT the
    # app-wide 4dp — the two columns hold the same real-world number.
    subscription_price: Mapped[Decimal] = mapped_column(Numeric(14, 5))
    notes: Mapped[str | None] = mapped_column(Text)
