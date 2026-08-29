"""security dividend events

Display-only historical ex-dividend markers for the portfolio performance chart's older
era (2026-08-28 spec), plus the per-security marker that makes the deep fetch
self-extinguishing. Dashboard-only and importer-immune (the custom_events posture); the
rows carry a PER-SHARE amount and never a dollar total, because the imported book is
dateless and the shares held on an old ex-date are unknowable. Additive; downgrade drops
the table and the column.

Revision ID: e4a7c92b6d18
Revises: d3b8e05fa726
Create Date: 2026-08-28 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4a7c92b6d18"
down_revision: str | Sequence[str] | None = "d3b8e05fa726"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Every constraint named EXPLICITLY, exactly as NAMING_CONVENTION derives it, so
    # create_all (the test database) and this migration (dev/prod) agree name-for-name.
    # The longest of the four is 50 characters — comfortably inside Postgres' 63-byte
    # identifier limit, so nothing here hits the silent-truncation landmine that made
    # position_transactions' foreign key need a hand-written short name.
    op.create_table(
        "security_dividend_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("security_id", sa.Integer(), nullable=False),
        sa.Column("ex_date", sa.Date(), nullable=False),
        sa.Column("per_share", sa.Numeric(precision=10, scale=6), nullable=False),
        sa.ForeignKeyConstraint(
            ["security_id"],
            ["securities.id"],
            name=op.f("fk_security_dividend_events_security_id_securities"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_security_dividend_events")),
        sa.UniqueConstraint(
            "security_id", "ex_date", name=op.f("uq_security_dividend_events_security_id")
        ),
    )
    # The FLOOR a successful deep fetch ran from, never a "synced on" date: a re-import that
    # extends portfolio_value_history backward moves the chart's left edge, and the service
    # re-arms every security whose recorded floor is shallower than the current one. NULL =
    # never deep-fetched. No server_default and no backfill: every existing row SHOULD read
    # as unfetched, which is precisely what a nullable add gives.
    op.add_column("securities", sa.Column("dividend_events_floor", sa.Date(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("securities", "dividend_events_floor")
    op.drop_table("security_dividend_events")
