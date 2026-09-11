"""computed tax totals leave storage

The nine derived totals became COMPUTED on 2026-09-11 (taxes spec §1.5): the engine
rebuilds each of them from its components on every read, the inputs PUT refuses them, the
what-if refuses to override them and the importer skips them. Rows that are never read and
can never be written again are not data, they are a trap — production's own census found
2025/2026's itemized totals still carrying the §199A line their formula dropped two days
earlier, which is exactly the drift a stored copy of a formula's answer invites.

So they are deleted, once, here. `tax_input_definitions` keeps its rows for all nine
(label, section, sort order, flag): the form still renders those lines, it just renders
them read-only with their figure computed.

Revision ID: b8e1c5f7a204
Revises: c4a7e2b9d13f
Create Date: 2026-09-11 09:00:00.000000

"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# Alembic's own logger, so the count lands in whatever handler the operator is already
# watching (`alembic upgrade` prints it, the deploy script's log file keeps it) instead of
# on a stdout a migration has no business writing to.
logger = logging.getLogger("alembic.runtime.migration")

# revision identifiers, used by Alembic.
revision: str = "b8e1c5f7a204"
down_revision: str | Sequence[str] | None = "c4a7e2b9d13f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Spelled out rather than imported from app.tax_keys: a migration is a record of what ran
# against a database on a day, and it must keep meaning the same thing after the code it
# was written beside moves on (the f7d3b2a91c40 precedent).
_DERIVED_KEYS = (
    "gross_paycheck",
    "latest_w2_income",
    "other_w2_income",
    "stcg_total",
    "unqualified_dividends",
    "interest_total",
    "other_pretax_deductions",
    "itemized_deduction",
    "ltcg_total",
)


def upgrade() -> None:
    """Upgrade schema."""
    result = op.get_bind().execute(
        sa.text("DELETE FROM tax_inputs WHERE key IN :keys").bindparams(
            sa.bindparam("keys", value=_DERIVED_KEYS, expanding=True)
        )
    )
    logger.info("computed tax totals: deleted %s stored rows", result.rowcount)


def downgrade() -> None:
    """Downgrade schema.

    A documented no-op. Every deleted figure is a pure function of rows this migration did
    not touch, so the old code recomputes all nine on its next read; and the nightly backup
    holds the prior image for anyone who wants the literal bytes back. Re-inserting them
    would mean re-running the formulas here, in a file that must not own them.
    """
