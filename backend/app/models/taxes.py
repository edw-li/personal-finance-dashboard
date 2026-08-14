from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TaxYear(Base):
    __tablename__ = "tax_years"

    # autoincrement=False: an integer PK otherwise emits SERIAL, and an omitted year would
    # silently insert year=1 instead of erroring. This is a natural key, not a surrogate.
    year: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    notes: Mapped[str | None] = mapped_column(Text)


class TaxBracket(Base):
    __tablename__ = "tax_brackets"
    __table_args__ = (UniqueConstraint("year", "jurisdiction", "bracket_index"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(ForeignKey("tax_years.year", ondelete="CASCADE"))
    jurisdiction: Mapped[str] = mapped_column(String(20))  # one of tax_keys.JURISDICTIONS
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


class TaxInput(Base):
    __tablename__ = "tax_inputs"
    __table_args__ = (UniqueConstraint("year", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int] = mapped_column(ForeignKey("tax_years.year", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(ForeignKey("tax_input_definitions.key", ondelete="CASCADE"))
    # (14,4), not (14,2): the sheet stores fractional inputs (e.g. state-exempt dividend
    # percentage 0.9645) alongside dollar amounts; 4 dp preserves both.
    value: Mapped[Decimal] = mapped_column(Numeric(14, 4))
