"""Uncommitted monthly writes used by standalone editors and the atomic review save.

Validation and derived-parent rules live here once. Callers own the transaction/Activity
commit, so a failed spending leg can never leave a new balance snapshot behind.
"""

from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Account,
    AccountBalance,
    MonthlyCashflow,
    MonthlySpending,
    NetWorthSnapshot,
    SpendingCategory,
)
from app.schemas.net_worth import BalanceEntry, MonthUpsert, MonthUpsertResult
from app.schemas.spending import SpendingMonthUpsert, SpendingUpsertResult
from app.services import clock
from app.services.changelog import ChangeBatch, row_image
from app.services.derived_accounts import derived_parent_balances
from app.services.money import MONEY_MAX_ABS_12_2, quantize_money, require_first_of_month
from app.services.spending_guard import EMPTY_MONTH_REFUSAL, records_something


async def write_balances(
    month: date,
    body: MonthUpsert,
    db: AsyncSession,
    batch: ChangeBatch,
    *,
    record_metadata: bool = False,
) -> MonthUpsertResult:
    """Upsert a month's balances, deriving every parent-with-components as it writes.

    Note for readers of the counts and the change log: ANY put on a month that holds
    components re-derives its parents, so a meta-only or single-row save can report extra
    `updated` rows (and log them) for parents nobody typed. That is deliberate — a month
    you touch is left consistent — and it is why a save's row count can exceed the
    payload's length.
    """
    require_first_of_month(month)
    ids = [entry.account_id for entry in body.balances]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="duplicate account_id in balances")
    # Validate everything BEFORE any write so a rejected body creates no snapshot.
    quantized: dict[int, Decimal] = {
        entry.account_id: quantize_money(entry.balance, f"balance[account_id={entry.account_id}]")
        for entry in body.balances
    }
    # The whole table, not just the submitted ids: derivation needs every account's
    # is_component/parent_account_id, and the refusal sentence needs the parent's NAME.
    accounts = list((await db.execute(select(Account))).scalars().all())
    by_id = {account.id: account for account in accounts}
    missing = sorted(set(ids) - set(by_id))
    if missing:
        raise HTTPException(status_code=422, detail=f"unknown account_id(s): {missing}")

    snapshot = (
        await db.execute(select(NetWorthSnapshot).where(NetWorthSnapshot.month == month))
    ).scalar_one_or_none()
    # The month's stored rows are read BEFORE the snapshot is created: a derivation refusal
    # must not leave a flushed snapshot behind, and the tests share one session with the app,
    # so even an uncommitted insert would be visible to the next request.
    existing = (
        {}
        if snapshot is None
        else {
            row.account_id: row
            for row in (
                await db.execute(
                    select(AccountBalance).where(AccountBalance.snapshot_id == snapshot.id)
                )
            ).scalars()
        }
    )
    # Spec §5: a parent with components has no balance of its own — it IS the sum of its
    # components this month. The payload wins; a component the payload leaves out falls back
    # to what the month already stores, and one absent from both contributes nothing. Every
    # flagged+linked component with a value counts, ACTIVE OR NOT: deactivation stops future
    # entry, it does not remove the money a closed bucket still holds this month.
    merged = {account_id: row.balance for account_id, row in existing.items()} | quantized
    derived = derived_parent_balances(accounts, merged)
    for parent_id, total in sorted(derived.items()):
        submitted = quantized.get(parent_id)
        if submitted is not None and submitted != total:
            # Storing a typed total that contradicts the components on the same screen is
            # exactly the drift this program removes — name the value the server would keep.
            raise HTTPException(
                status_code=422,
                detail=(
                    f"{by_id[parent_id].name} is derived from its components ({total}); "
                    "leave it out or send the components"
                ),
            )
    # A parent submitted EQUAL to the sum is accepted and ignored: the union below simply
    # writes the derived value, which is the same number.
    to_write = quantized | derived

    snapshot_created = snapshot is None
    if snapshot is None:
        if not body.balances:
            # An empty month would poison the summary KPI and the coverage ribbon.
            # DELETE /months/{month} exists now (2026-08-31 spec §B2), but the refusal
            # stays: an accidental empty create should not need an undo. Meta-only
            # PUTs remain legal on months that already exist.
            raise HTTPException(
                status_code=422,
                detail="refusing to create an empty month — include at least one balance",
            )
        snapshot = NetWorthSnapshot(
            month=month,
            recorded_on=body.recorded_on or clock.product_today(),
            notes=body.notes,
        )
        db.add(snapshot)
        await db.flush()
        batch.record_insert(snapshot, month=month)
    else:
        before_snapshot = row_image(snapshot)
        provided = body.model_fields_set
        if "recorded_on" in provided:
            snapshot.recorded_on = body.recorded_on
        if "notes" in provided:
            snapshot.notes = body.notes
        if record_metadata:
            batch.record_update(snapshot, before_snapshot, month=month)

    created = updated = unchanged = 0
    new_rows: list[AccountBalance] = []
    for account_id, value in to_write.items():
        row = existing.get(account_id)
        if row is None:
            row = AccountBalance(snapshot_id=snapshot.id, account_id=account_id, balance=value)
            db.add(row)
            new_rows.append(row)
            created += 1
        elif row.balance != value:
            before = row_image(row)
            row.balance = value
            batch.record_update(row, before, month=month)
            updated += 1
        else:
            unchanged += 1
    if new_rows:
        await db.flush()  # ids for the insert images
        for row in new_rows:
            batch.record_insert(row, month=month)
    # Meta-only edits (recorded_on, notes) are deliberately not logged (spec section 9).
    batch.label = (
        f"Entered {month:%b %Y} balances — {created} accounts"
        if snapshot_created
        else f"Saved {month:%b %Y} balances — {created + updated} updated"
    )
    return MonthUpsertResult(
        month=month,
        snapshot_created=snapshot_created,
        created=created,
        updated=updated,
        unchanged=unchanged,
        derived=[
            BalanceEntry(account_id=account_id, balance=value)
            for account_id, value in sorted(derived.items())
        ],
        batch_id=None,
    )


async def write_spending(
    month: date, body: SpendingMonthUpsert, db: AsyncSession, batch: ChangeBatch
) -> SpendingUpsertResult:
    require_first_of_month(month)
    ids = [entry.category_id for entry in body.amounts]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="duplicate category_id in amounts")
    quantized: dict[int, Decimal] = {
        entry.category_id: quantize_money(
            entry.amount,
            f"amount[category_id={entry.category_id}]",
            max_abs=MONEY_MAX_ABS_12_2,  # Numeric(12,2): 10 integer digits, not 12
        )
        for entry in body.amounts
    }
    # net_pay is tri-state (the notes-null convention, spec 2026-08-21 §4.2 rider):
    # omitted = leave it alone; a string = upsert; an EXPLICIT null = clear the month's
    # cashflow row. model_fields_set is what tells an omitted field from a null one.
    net_pay_present = "net_pay" in body.model_fields_set
    net_pay_provided = net_pay_present and body.net_pay is not None
    net_pay_clear = net_pay_present and body.net_pay is None
    net_pay_value = (
        quantize_money(body.net_pay, "net_pay", max_abs=MONEY_MAX_ABS_12_2)
        if net_pay_provided
        else None
    )
    if net_pay_value is not None and net_pay_value < 0:
        # Take-home pay can't be negative; a typo'd minus sign would flip the
        # savings-rate denominator into flattering nonsense (Task 7 review).
        raise HTTPException(status_code=422, detail="net_pay must be non-negative")
    # Spec §4: every category $0.00 with no take-home is what put a fake $0 month on
    # production's Sep 2026 — refuse it unless the client says it means it. An EXPLICIT
    # net_pay null passes only when it is the WHOLE body: that body records something (it
    # deletes the month's cashflow row) and writes no zeros. Beside a page of zeros the
    # same null would clear the take-home AND store 19 rows of $0.00 — Sep 2026 exactly —
    # so the delete must not buy those zeros a way past the guard.
    if not (
        body.confirm_zero
        or (net_pay_clear and not quantized)
        or records_something(quantized.values(), net_pay_value)
    ):
        raise HTTPException(status_code=422, detail=EMPTY_MONTH_REFUSAL)
    if ids:
        known = set(
            (
                await db.execute(select(SpendingCategory.id).where(SpendingCategory.id.in_(ids)))
            ).scalars()
        )
        missing = sorted(set(ids) - known)
        if missing:
            raise HTTPException(status_code=422, detail=f"unknown category_id(s): {missing}")

    existing = {
        row.category_id: row
        for row in (
            await db.execute(select(MonthlySpending).where(MonthlySpending.month == month))
        ).scalars()
    }
    created = updated = unchanged = skipped_blank = 0
    new_rows: list[MonthlySpending] = []
    for category_id, value in quantized.items():
        row = existing.get(category_id)
        if row is None:
            # A ZERO for a category this month has never stored is a blank box, not an
            # entry (2026-09-09 audit item 1): the wizard seeds every active category with
            # "0.00", so inserting these is what fabricated production's phantom rows —
            # nineteen $0.00 records beside a take-home figure, which every average, mover,
            # heatmap and budget seed then read as "spent nothing on housing". Only
            # `confirm_zero` — the "Record this month as $0" checkbox — means them.
            #
            # A category that DOES have a stored row falls through to the update branch
            # below, because correcting a figure down to zero is an edit and must persist.
            if value == 0 and not body.confirm_zero:
                skipped_blank += 1
                continue
            row = MonthlySpending(month=month, category_id=category_id, amount=value)
            db.add(row)
            new_rows.append(row)
            created += 1
        elif row.amount != value:
            before = row_image(row)
            row.amount = value
            batch.record_update(row, before, month=month)
            updated += 1
        else:
            unchanged += 1
    if new_rows:
        await db.flush()
        for row in new_rows:
            batch.record_insert(row, month=month)
    net_pay_cleared = False
    net_pay_note = ""
    if net_pay_provided:
        cashflow = await db.get(MonthlyCashflow, month)
        if cashflow is None:
            cashflow = MonthlyCashflow(month=month, net_pay=net_pay_value)
            db.add(cashflow)
            await db.flush()
            batch.record_insert(cashflow, month=month)
        else:
            before = row_image(cashflow)
            cashflow.net_pay = net_pay_value
            batch.record_update(cashflow, before, month=month)
        net_pay_note = ", take-home set"
    elif net_pay_clear:
        cashflow = await db.get(MonthlyCashflow, month)
        if cashflow is not None:
            batch.record_delete(cashflow, month=month)
            await db.delete(cashflow)
            net_pay_cleared = True
            net_pay_note = ", take-home cleared"
    batch.label = f"Saved {month:%b %Y} spending — {created + updated} updated{net_pay_note}"
    return SpendingUpsertResult(
        month=month,
        created=created,
        updated=updated,
        unchanged=unchanged,
        net_pay_set=net_pay_provided,
        skipped_blank=skipped_blank,
        net_pay_cleared=net_pay_cleared,
        batch_id=None,
    )
