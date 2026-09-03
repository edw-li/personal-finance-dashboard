"""calendar feed tokens

The credential behind GET /calendar/feed.ics?token= (2026-09-03 calendar spec §11): the
sha256 of a `secrets.token_urlsafe(32)` plaintext that is shown ONCE, a label, and a
last-used stamp for the Settings card. Hash at rest — a database read never yields a
working feed URL. Cascades with the user. Additive; downgrade drops the table.

Revision ID: c3e5a7b9d1f4
Revises: b2d4f6a8c0e3
Create Date: 2026-09-04 09:12:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3e5a7b9d1f4"
down_revision: str | Sequence[str] | None = "b2d4f6a8c0e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "calendar_feed_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=60), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_calendar_feed_tokens_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calendar_feed_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_calendar_feed_tokens_token_hash")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("calendar_feed_tokens")
