"""backfill component account flags

Revision ID: c8a1f4d27b53
Revises: f1b36c0cf33c
Create Date: 2026-08-15 07:30:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8a1f4d27b53"
down_revision: str | Sequence[str] | None = "f1b36c0cf33c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COMPONENT_SLUGS = (
    "'employer-match-401-k','reverse-rollover-401-k','traditional-401-k',"
    "'roth-basic-401-k','after-tax-401-k'"
)


def upgrade() -> None:
    """Upgrade schema."""
    # f1b36c0cf33c backfilled these five flags but was a no-op on any database whose
    # accounts had not been imported yet (fresh deploy: migrations run at container
    # boot, the workbook import happens later, and imported accounts default to
    # is_component = FALSE — double-counting the 401(k) source buckets under their
    # Fidelity aggregates). Re-run the backfill, guarded: only when NONE of the five
    # is flagged, i.e. exactly the unclassified-import state. A deliberate user unflip
    # (e.g. after-tax-401-k set FALSE to reproduce the sheet's own totals) leaves its
    # siblings TRUE, so it is never undone here. The importer now also seeds the flag
    # at account creation (apply.py COMPONENT_SLUGS_AT_CREATE), making this a repair
    # for databases imported before that fix.
    op.execute(
        f"UPDATE accounts SET is_component = TRUE WHERE slug IN ({COMPONENT_SLUGS}) "
        "AND NOT EXISTS ("
        f"SELECT 1 FROM accounts WHERE is_component AND slug IN ({COMPONENT_SLUGS}))"
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Data-only repair; nothing to reverse (f1b36c0cf33c's downgrade drops the column).
