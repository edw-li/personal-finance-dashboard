"""Explicitly saved, owner-scoped assistant findings with immutable evidence.

Revision ID: f12026091203
Revises: f12026091202
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "f12026091203"
down_revision = "f12026091202"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_findings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("model_used", sa.String(60), nullable=True),
        sa.Column("context", postgresql.JSONB(), nullable=False),
        sa.Column("evidence", postgresql.JSONB(), nullable=False),
        sa.Column("evidence_as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_assistant_findings_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assistant_findings")),
    )
    op.create_index(
        op.f("ix_assistant_findings_user_id"), "assistant_findings", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_assistant_findings_user_id"), table_name="assistant_findings")
    op.drop_table("assistant_findings")
