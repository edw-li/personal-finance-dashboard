"""position_transactions.import_key — the importer's identity for sheet rows

`sort_index` used to be two things at once: the cost-basis replay order AND the key the
Positions importer matched and sync-deleted its rows by (sheet row x 10). Drag-to-reorder
(2026-09-23 spec §3.5) hands the replay order to the user, so identity moves to a column of
its own: `import_key` holds the sheet key on source='import' rows (NULL on UI rows) and is
unique among them.

The backfill copies sort_index into import_key for every import row. Until this revision
nothing but the importer ever wrote an import row's sort_index — the ledger PATCH never
touches it — so it IS each row's sheet key, and the first re-import after the deploy
matches every row it matched before. The unique index is created AFTER the backfill, so a
duplicate key would fail the upgrade loudly instead of passing silently.

Rollout: snapshots taken before this revision are not restorable after it (restore requires
the snapshot's alembic head to equal the server's — the rule for every migration). Take a
snapshot right after deploying.

Revision ID: f12026092301
Revises: f12026091203
Create Date: 2026-09-23 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f12026092301"
down_revision: str | Sequence[str] | None = "f12026091203"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Named explicitly, and identically in models.portfolio.PositionTransaction.__table_args__.
INDEX = "ux_position_txn_import_key"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("position_transactions", sa.Column("import_key", sa.Integer(), nullable=True))
    op.execute("UPDATE position_transactions SET import_key = sort_index WHERE source = 'import'")
    op.create_index(
        INDEX,
        "position_transactions",
        ["import_key"],
        unique=True,
        postgresql_where=sa.text("source = 'import'"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(INDEX, table_name="position_transactions")
    op.drop_column("position_transactions", "import_key")
