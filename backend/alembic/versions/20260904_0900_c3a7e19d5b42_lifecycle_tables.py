"""lifecycle tables — change_log, lifecycle_runs, user_preferences

The three operational tables of the 2026-09-03 data-lifecycle spec §6: the application-level
change log behind Activity and Undo, the run trail that stores import/restore reports, and
server-side preferences keyed per (user, key). Additive; the downgrade drops the three.

Revision ID: c3a7e19d5b42
Revises: b8e4d17c2a90
Create Date: 2026-09-04 09:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3a7e19d5b42"
down_revision: str | Sequence[str] | None = "b8e4d17c2a90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "change_log",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.String(length=12), nullable=False),
        sa.Column("actor", sa.String(length=255), nullable=True),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("table_name", sa.String(length=60), nullable=False),
        sa.Column("pk", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("op", sa.String(length=6), nullable=False),
        sa.Column("before", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("month", sa.Date(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_change_log")),
    )
    op.create_index(op.f("ix_change_log_at"), "change_log", ["at"], unique=False)
    op.create_index(op.f("ix_change_log_batch_id"), "change_log", ["batch_id"], unique=False)
    op.create_index(op.f("ix_change_log_month"), "change_log", ["month"], unique=False)
    op.create_index(
        op.f("ix_change_log_table_name_at"), "change_log", ["table_name", "at"], unique=False
    )

    op.create_table(
        "lifecycle_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("dry_run", sa.Boolean(), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("actor", sa.String(length=255), nullable=True),
        sa.Column("filename", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("report", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lifecycle_runs")),
    )
    op.create_index(op.f("ix_lifecycle_runs_at"), "lifecycle_runs", ["at"], unique=False)

    op.create_table(
        "user_preferences",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=60), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_preferences_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "key", name=op.f("pk_user_preferences")),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("user_preferences")
    op.drop_index(op.f("ix_lifecycle_runs_at"), table_name="lifecycle_runs")
    op.drop_table("lifecycle_runs")
    op.drop_index(op.f("ix_change_log_table_name_at"), table_name="change_log")
    op.drop_index(op.f("ix_change_log_month"), table_name="change_log")
    op.drop_index(op.f("ix_change_log_batch_id"), table_name="change_log")
    op.drop_index(op.f("ix_change_log_at"), table_name="change_log")
    op.drop_table("change_log")
