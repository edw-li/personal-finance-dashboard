from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.tax_keys import SINGLE


class TaxYear(Base):
    __tablename__ = "tax_years"

    # autoincrement=False: an integer PK otherwise emits SERIAL, and an omitted year would
    # silently insert year=1 instead of erroring. This is a natural key, not a surrogate.
    year: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    notes: Mapped[str | None] = mapped_column(Text)
    # One of tax_keys.FILING_STATUSES. server_default AS WELL AS default (the
    # dividend_payments.source precedent): the migration lands every existing row on
    # 'single' without a data pass, and any raw-SQL insert lands there too.
    filing_status: Mapped[str] = mapped_column(String(20), default=SINGLE, server_default=SINGLE)


class TaxBracket(Base):
    __tablename__ = "tax_brackets"
    # The status dimension sits INSIDE the natural key: one year carries a single-filer
    # table and an MFJ table for the same jurisdiction, and `_engine_tables` selects
    # exactly one of them for the engine.
    __table_args__ = (UniqueConstraint("year", "jurisdiction", "filing_status", "bracket_index"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(ForeignKey("tax_years.year", ondelete="CASCADE"))
    jurisdiction: Mapped[str] = mapped_column(String(20))  # one of tax_keys.JURISDICTIONS
    filing_status: Mapped[str] = mapped_column(String(20), default=SINGLE, server_default=SINGLE)
    bracket_index: Mapped[int] = mapped_column()
    rate: Mapped[Decimal] = mapped_column(Numeric(7, 4))
    threshold: Mapped[Decimal] = mapped_column(Numeric(12, 2))


class TaxInputDefinition(Base):
    __tablename__ = "tax_input_definitions"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    label: Mapped[str] = mapped_column(String(120))
    section: Mapped[str] = mapped_column(String(30))
    sort_order: Mapped[int] = mapped_column(default=0)
    is_derived: Mapped[bool] = mapped_column(default=False)
    # True for the 19 tax_keys.PER_PERSON_KEYS: this line belongs to one person, so a
    # married-joint year stores one row per person and the engine sums them.
    is_per_person: Mapped[bool] = mapped_column(default=False)


class TaxInput(Base):
    __tablename__ = "tax_inputs"
    # NULLS NOT DISTINCT (PG15+; this app runs PG16.14). Without it two household rows for
    # the same (year, key) would BOTH satisfy a plain unique key and the engine's per-key
    # SUM would double-count them. SQLAlchemy 2.0.52 renders the clause for create_all and
    # alembic emits the same DDL, so the test database and prod share one contract.
    __table_args__ = (
        UniqueConstraint("year", "key", "person_id", postgresql_nulls_not_distinct=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(ForeignKey("tax_years.year", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(ForeignKey("tax_input_definitions.key", ondelete="CASCADE"))
    # NULL means HOUSEHOLD, strictly: the migration backfills every per-person key's rows
    # to the primary person. RESTRICT, not CASCADE — a person is never deleted while
    # referenced (spec §5.1 has no delete route), and financial history must not vanish
    # behind a roster edit.
    person_id: Mapped[int | None] = mapped_column(
        ForeignKey("people.id", ondelete="RESTRICT"), default=None
    )
    # (14,4), not (14,2): the sheet stores fractional inputs (e.g. state-exempt dividend
    # percentage 0.9645) alongside dollar amounts; 4 dp preserves both.
    value: Mapped[Decimal] = mapped_column(Numeric(14, 4))
