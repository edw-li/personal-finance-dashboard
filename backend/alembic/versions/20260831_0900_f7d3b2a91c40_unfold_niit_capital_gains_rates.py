"""unfold NIIT from stored capital-gains bracket rates

The sheet's CG model folded the 3.8% NIIT surcharge into the two upper bracket rates
(15% -> 18.8%, 20% -> 23.8%) and the importer stored the cached values. The engine now
computes NIIT as its own line (2026-08-31 spec C2), so a folded table would charge the
surcharge twice. Rewrite EXACT matches only — 0.1880 -> 0.1500 and 0.2380 -> 0.2000 —
in every year and every filing status; anything else is a user's own number and is never
touched. The importer applies the same translation on every future import (apply.py) and
`niit_advisory` warns whenever a folded pair is still stored, so this repair cannot be
silently reintroduced.

Downgrade restores the folded pair under the same exact-match guard. Documented
asymmetry, accepted (spec C2): a year that stored GENUINE base rates all along (2023
here) re-folds on downgrade too — under the pre-NIIT engine those are the very rates its
AGI-comparison advisory expected above the threshold, and any leftover mismatch is named
by that advisory rather than silently double-charged.

Revision ID: f7d3b2a91c40
Revises: e4a7c92b6d18
Create Date: 2026-08-31 09:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f7d3b2a91c40"
down_revision: str | Sequence[str] | None = "e4a7c92b6d18"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Numeric(7,4) compares exactly, so a hand-edited 0.1881 — or a genuine 0.1500 —
    # is invisible to both statements. No overlap between the two rewrites.
    op.execute(
        "UPDATE tax_brackets SET rate = 0.1500 "
        "WHERE jurisdiction = 'capital_gains' AND rate = 0.1880"
    )
    op.execute(
        "UPDATE tax_brackets SET rate = 0.2000 "
        "WHERE jurisdiction = 'capital_gains' AND rate = 0.2380"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(
        "UPDATE tax_brackets SET rate = 0.1880 "
        "WHERE jurisdiction = 'capital_gains' AND rate = 0.1500"
    )
    op.execute(
        "UPDATE tax_brackets SET rate = 0.2380 "
        "WHERE jurisdiction = 'capital_gains' AND rate = 0.2000"
    )
