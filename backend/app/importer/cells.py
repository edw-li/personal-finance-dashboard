"""Pure cell-coercion helpers: strict Decimal, sheet quirks, slugs.

No SQLAlchemy or openpyxl imports — parsers hand in raw cell values. Callers pass a
`ctx` like "Net Worth!r5c3" so every issue carries row/col context (spec section 5).
"""

import datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

# data_only=True returns cached formula errors as strings; the sheet also writes
# literal N/A into computed cells. All coerce to None (caller decides what that means).
ERROR_STRINGS = frozenset(
    {"#N/A", "#REF!", "#VALUE!", "#DIV/0!", "#NAME?", "#NUM!", "#NULL!", "#ERROR!", "N/A", "n/a"}
)

Q2 = Decimal("0.01")
Q4 = Decimal("0.0001")
Q5 = Decimal("0.00001")
Q6 = Decimal("0.000001")
Q9 = Decimal("0.000000001")

_PLACEHOLDER = Decimal("0.001")


class CellIssues:
    """Warning/error accumulator shared by the parsers of one sheet."""

    def __init__(self) -> None:
        self.warnings: list[str] = []
        self.errors: list[str] = []

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def error(self, message: str) -> None:
        self.errors.append(message)


def cell_ref(sheet: str, row: int, col: int) -> str:
    return f"{sheet}!r{row}c{col}"


def to_decimal(
    value: object,
    quantum: Decimal,
    max_int_digits: int,
    *,
    ctx: str,
    issues: CellIssues,
) -> Decimal | None:
    """Strict money/number parsing. None, blank, and error-cells return None silently;
    anything else non-numeric records an error and returns None. The result is quantized
    HALF_UP (PG rounds half-away-from-zero; Python's default is banker's) and bounds-checked
    against the target NUMERIC's integer-digit budget (overflow otherwise surfaces as a bare
    DBAPIError, sqlstate 22003 — Plan 1 forward note)."""
    if value is None:
        return None
    if isinstance(value, bool):  # bool is an int subclass — must be rejected first
        issues.error(f"{ctx}: expected a number, got boolean {value}")
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text or text in ERROR_STRINGS:
            return None
        try:
            raw = Decimal(text)
        except InvalidOperation:
            issues.error(f"{ctx}: expected a number, got {value!r}")
            return None
    elif isinstance(value, int | float | Decimal):
        # str() first: Decimal(float) would exhume binary representation noise
        raw = Decimal(str(value))
    else:
        issues.error(f"{ctx}: expected a number, got {type(value).__name__}")
        return None
    # Quiet NaN would pass through quantize silently and blow up the bounds
    # comparison instead; inf/snan/oversized-digit values raise at quantize.
    if not raw.is_finite():
        issues.error(f"{ctx}: expected a finite number, got {value!r}")
        return None
    try:
        quantized = raw.quantize(quantum, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        issues.error(f"{ctx}: expected a finite number, got {value!r}")
        return None
    if quantized.copy_abs() >= 10**max_int_digits:
        issues.error(f"{ctx}: {raw} exceeds NUMERIC({max_int_digits} integer digits) bounds")
        return None
    return quantized


def is_placeholder_balance(value: object) -> bool:
    """The sheet marks unused accounts with 0.001/-0.001. Must be detected on the RAW
    value — Numeric(14,2) storage would silently collapse it into a real zero."""
    if isinstance(value, bool) or not isinstance(value, int | float | Decimal):
        return False
    return Decimal(str(value)).copy_abs() == _PLACEHOLDER


def to_date_strict(value: object, *, ctx: str, issues: CellIssues) -> datetime.date | None:
    """For cells that must be dates (months, purchase dates). Non-date non-None = error."""
    if value is None:
        return None
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    issues.error(f"{ctx}: expected a date, got {value!r}")
    return None


def to_date_lenient(value: object) -> datetime.date | None:
    """For known-junk date cells (ReferenceData ex-div holds time(0,0) and 'N/A')."""
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    return None


def first_of_month(value: datetime.date, *, ctx: str, issues: CellIssues) -> datetime.date:
    """DB CheckConstraints enforce day==1; normalize earlier for clean errors."""
    if value.day == 1:
        return value
    issues.warn(f"{ctx}: {value.isoformat()} normalized to first of month")
    return value.replace(day=1)


def slugify(name: str) -> str:
    out: list[str] = []
    previous_dash = True  # suppress leading dash
    for ch in name.lower():
        if ch.isascii() and ch.isalnum():
            out.append(ch)
            previous_dash = False
        elif not previous_dash:
            out.append("-")
            previous_dash = True
    return "".join(out).strip("-")


def synthetic_ticker(name: str, taken: set[str]) -> str:
    """Short deterministic ticker for a Positions security missing from ReferenceData
    (String(20), Plan 1 forward note: keep them short)."""
    base = "X-" + "".join(ch for ch in name.upper() if ch.isascii() and ch.isalnum())[:8]
    if base == "X-":
        base = "X-ASSET"
    candidate = base
    suffix = 2
    while candidate in taken:
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate
