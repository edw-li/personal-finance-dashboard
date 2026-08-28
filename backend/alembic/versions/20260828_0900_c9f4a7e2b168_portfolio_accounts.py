"""portfolio accounts

Portfolio ownership (2026-08-28 household-portfolio spec §3 item 1): the free-text
`account` label on position_transactions / dividend_payments becomes a real
`portfolio_accounts` row with an owner, and both tables point at it by FK.

Backfill: one row per EXACT distinct label found in either column — case and whitespace
preserved, so two historically distinct spellings stay two accounts (a morning-list note,
never a silent merge) — each owned by the PRIMARY person. f3a91c7e2b45 seeds that member
earlier in this chain, so the roster is always there in practice; the guard below is for a
hand-edited database, and it fails LOUDLY rather than quietly minting joint accounts,
because "everything is joint" is not a state this app may drift into.

position_transactions.portfolio_account_id is NOT NULL (its label always was);
dividend_payments.portfolio_account_id is NULLABLE (its label always was) — a dividend with
no account stays unattributed and still crosses the wire as `account: null`. The
auto-ingest partial unique index moves to the FK column with identical semantics: one auto
row per (security, portfolio account, ex-date).

Downgrade restores both text columns from the join before dropping the FKs and the table.
Ownership is LOST on the way down — person_id has nowhere to live in the old shape.

Revision ID: c9f4a7e2b168
Revises: b5f2c8d31e7a
Create Date: 2026-08-28 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9f4a7e2b168"
down_revision: str | Sequence[str] | None = "b5f2c8d31e7a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Named explicitly rather than by convention: the derived name for position_transactions
# would be 64 characters, one past Postgres' 63-byte identifier limit, and SQLAlchemy would
# silently truncate it to a hash suffix. The models carry these same two names.
TXN_FK = "fk_position_transactions_portfolio_account"
DIV_FK = "fk_dividend_payments_portfolio_account"
AUTO_INDEX = "ux_dividend_auto_event"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "portfolio_accounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("person_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["person_id"],
            ["people.id"],
            name=op.f("fk_portfolio_accounts_person_id_people"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_portfolio_accounts")),
        sa.UniqueConstraint("label", name=op.f("uq_portfolio_accounts_label")),
    )
    # One row per label across BOTH columns (UNION dedupes), all owned by the primary
    # person. The scalar subquery is safe: ux_people_single_primary caps it at one row.
    op.execute(
        "INSERT INTO portfolio_accounts (label, person_id) "
        "SELECT label, (SELECT id FROM people WHERE is_primary ORDER BY id LIMIT 1) "
        "FROM ("
        "  SELECT account AS label FROM position_transactions"
        "  UNION"
        "  SELECT account AS label FROM dividend_payments WHERE account IS NOT NULL"
        ") AS labels"
    )
    unowned = op.get_bind().scalar(
        sa.text("SELECT count(*) FROM portfolio_accounts WHERE person_id IS NULL")
    )
    if unowned:
        # The sentence that says what to do, instead of a database that quietly reads
        # "every portfolio account is joint" the moment owner views land.
        raise RuntimeError(
            f"{unowned} portfolio_accounts rows have no owner: seed the people table "
            "(app.seed.seed_people) before upgrading"
        )

    op.add_column(
        "position_transactions", sa.Column("portfolio_account_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        TXN_FK,
        "position_transactions",
        "portfolio_accounts",
        ["portfolio_account_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.execute(
        "UPDATE position_transactions t SET portfolio_account_id = pa.id "
        "FROM portfolio_accounts pa WHERE pa.label = t.account"
    )
    orphans = op.get_bind().scalar(
        sa.text("SELECT count(*) FROM position_transactions WHERE portfolio_account_id IS NULL")
    )
    if orphans:
        raise RuntimeError(
            f"{orphans} position_transactions rows did not match a portfolio account label — "
            "the backfill above should be exhaustive; inspect the table before retrying"
        )
    op.alter_column("position_transactions", "portfolio_account_id", nullable=False)

    op.add_column(
        "dividend_payments", sa.Column("portfolio_account_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        DIV_FK,
        "dividend_payments",
        "portfolio_accounts",
        ["portfolio_account_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.execute(
        "UPDATE dividend_payments d SET portfolio_account_id = pa.id "
        "FROM portfolio_accounts pa WHERE pa.label = d.account"
    )
    # Stays NULLABLE by design (see the docstring): only a row that HAD a label and did not
    # find its account is a bug.
    stragglers = op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM dividend_payments "
            "WHERE account IS NOT NULL AND portfolio_account_id IS NULL"
        )
    )
    if stragglers:
        raise RuntimeError(
            f"{stragglers} dividend_payments rows did not match a portfolio account label — "
            "the backfill above should be exhaustive; inspect the table before retrying"
        )

    # The auto-ingest idempotency key moves to the FK with identical semantics: one auto
    # row per (security, portfolio account, ex-date). Mirrored on the model, which is what
    # builds the pytest database (Base.metadata.create_all runs no migrations).
    op.drop_index(AUTO_INDEX, table_name="dividend_payments")
    op.create_index(
        AUTO_INDEX,
        "dividend_payments",
        ["security_id", "portfolio_account_id", "ex_date"],
        unique=True,
        postgresql_where=sa.text("source = 'auto'"),
    )

    op.drop_column("position_transactions", "account")
    op.drop_column("dividend_payments", "account")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "position_transactions", sa.Column("account", sa.VARCHAR(length=80), nullable=True)
    )
    op.add_column("dividend_payments", sa.Column("account", sa.VARCHAR(length=80), nullable=True))
    # Restore the labels from the join BEFORE the FKs go away — after the drop there is
    # nothing left to read them from.
    op.execute(
        "UPDATE position_transactions t SET account = pa.label "
        "FROM portfolio_accounts pa WHERE pa.id = t.portfolio_account_id"
    )
    op.execute(
        "UPDATE dividend_payments d SET account = pa.label "
        "FROM portfolio_accounts pa WHERE pa.id = d.portfolio_account_id"
    )
    op.alter_column("position_transactions", "account", nullable=False)

    op.drop_index(AUTO_INDEX, table_name="dividend_payments")
    op.create_index(
        AUTO_INDEX,
        "dividend_payments",
        ["security_id", "account", "ex_date"],
        unique=True,
        postgresql_where=sa.text("source = 'auto'"),
    )

    op.drop_constraint(TXN_FK, "position_transactions", type_="foreignkey")
    op.drop_column("position_transactions", "portfolio_account_id")
    op.drop_constraint(DIV_FK, "dividend_payments", type_="foreignkey")
    op.drop_column("dividend_payments", "portfolio_account_id")
    op.drop_table("portfolio_accounts")
