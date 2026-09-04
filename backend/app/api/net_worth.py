from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.importer.cells import slugify
from app.models import ACCOUNT_GROUPS, Account, AccountBalance, NetWorthSnapshot, Person
from app.schemas.net_worth import (
    AccountCreate,
    AccountOut,
    AccountSeries,
    AccountUpdate,
    BalanceEntry,
    GroupSummary,
    MonthBalancesOut,
    MonthUpsert,
    MonthUpsertResult,
    OwnerSeries,
    OwnerTotal,
    SummaryOut,
    TimeseriesOut,
)
from app.services.changelog import ChangeBatch, batch_header, change_batch, row_image
from app.services.derived_accounts import derived_parent_balances
from app.services.money import mom_pct, quantize_money, require_first_of_month
from app.services.net_worth_calc import (
    ZERO,
    group_totals_for,
    load_balance_matrix,
    net_worth_for,
    owner_clause,
    owner_totals_for,
)

router = APIRouter(
    prefix="/net-worth", tags=["net-worth"], dependencies=[Depends(get_current_user)]
)

# The two NULLABLE account columns. Every other patchable column is NOT NULL, so the
# router's explicit-null-is-a-no-op rule must not swallow these: "person_id": null is how
# an account becomes JOINT, and "parent_account_id": null is how a component is unlinked
# (2026-08-26 spec §5.2).
NULLABLE_ACCOUNT_FIELDS = ("person_id", "parent_account_id")


async def _validate_links(
    db: AsyncSession,
    person_id: int | None,
    parent_account_id: int | None,
    account_id: int | None,
) -> None:
    """FK targets checked BEFORE any write, so a bad id 422s with a sentence instead of
    surfacing asyncpg's ForeignKeyViolationError as a 500. Deeper parent cycles (A->B->A)
    are deliberately unguarded: parent_account_id is presentation-only and the UI nests
    exactly one level (nestComponents), so a cycle costs a flat render, not bad money."""
    if person_id is not None and (await db.get(Person, person_id)) is None:
        raise HTTPException(status_code=422, detail=f"unknown person_id: {person_id}")
    if parent_account_id is not None:
        if parent_account_id == account_id:
            raise HTTPException(status_code=422, detail="an account cannot be its own parent")
        if (await db.get(Account, parent_account_id)) is None:
            raise HTTPException(
                status_code=422, detail=f"unknown parent_account_id: {parent_account_id}"
            )


def _check_component_link(is_component: bool | None, parent_account_id: int | None) -> None:
    """`is_component` and `parent_account_id` are two halves of ONE fact (2026-09-04
    honest-numbers spec §5): the flag is the key every rollup excludes on, the link is the
    parent the money folds into. Half of it produces the Settings card's "unlinked component
    — counts nowhere" row, or a component that is silently double-counted, so a request that
    sets one without the other is refused NAMING the missing half.

    Rows that already disagree are not touched: this fires only when a request supplies one
    of the two, so a legacy account keeps its shape until someone edits that part of it.
    """
    if is_component and parent_account_id is None:
        raise HTTPException(
            status_code=422,
            detail="is_component needs parent_account_id — name the account it folds into",
        )
    if parent_account_id is not None and not is_component:
        raise HTTPException(
            status_code=422,
            detail="parent_account_id needs is_component — a linked account must be a component",
        )


@router.get("/accounts", response_model=list[AccountOut])
async def list_accounts(db: AsyncSession = Depends(get_db)) -> list[Account]:
    result = await db.execute(select(Account).order_by(Account.sort_order, Account.id))
    return list(result.scalars().all())


@router.post("/accounts", response_model=AccountOut, status_code=201)
async def create_account(
    body: AccountCreate,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Account:
    slug = slugify(body.name)
    # len guard: unicode lowercasing can EXPAND ('İ' -> 2 code points), so a <=120-char
    # name can slugify past String(120) — 422 here, never a DBAPIError 500.
    if not slug or len(slug) > 120:
        raise HTTPException(
            status_code=422,
            detail="name must contain an ASCII letter or digit and slugify to "
            "at most 120 characters",
        )
    existing = (
        (
            await db.execute(
                select(Account).where((Account.slug == slug) | (Account.name == body.name))
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"account {slug!r} already exists")
    await _validate_links(db, body.person_id, body.parent_account_id, None)
    _check_component_link(body.is_component, body.parent_account_id)
    account = Account(
        name=body.name,
        slug=slug,
        group=body.group,
        sort_order=body.sort_order,
        is_component=body.is_component,
        person_id=body.person_id,
        parent_account_id=body.parent_account_id,
    )
    db.add(account)
    await db.flush()
    batch.record_insert(account)
    batch.label = f"Created account {account.name}"
    await batch.commit()
    return account


async def _get_account(db: AsyncSession, account_id: int) -> Account:
    account = await db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="account not found")
    return account


@router.patch("/accounts/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: int,
    body: AccountUpdate,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Account:
    account = await _get_account(db, account_id)
    # Every patchable account column is NOT NULL *except* the two in
    # NULLABLE_ACCOUNT_FIELDS, so an explicit null is a no-op request for the rest
    # ("name": null must never reach the ORM) and a real write for those two.
    updates = {
        field: value
        for field, value in body.model_dump(exclude_unset=True).items()
        if value is not None or field in NULLABLE_ACCOUNT_FIELDS
    }
    new_name = updates.get("name")
    if new_name is not None and not slugify(new_name):
        # Same rule as create: PATCH must not produce a blank/whitespace display name.
        raise HTTPException(
            status_code=422,
            detail="name must contain at least one ASCII letter or digit",
        )
    if new_name is not None and new_name != account.name:
        clash = (
            (
                await db.execute(
                    select(Account).where(Account.name == new_name, Account.id != account_id)
                )
            )
            .scalars()
            .first()
        )
        if clash is not None:
            raise HTTPException(status_code=409, detail="account name already in use")
    await _validate_links(
        db, updates.get("person_id"), updates.get("parent_account_id"), account_id
    )
    if "is_component" in updates or "parent_account_id" in updates:
        # Judge the row the PATCH would LEAVE BEHIND, not the keys it happens to carry:
        # `updates` already drops explicit nulls for every column except the two nullable
        # ones, so an unlink really is in here and an `is_component: null` really is not.
        _check_component_link(
            updates.get("is_component", account.is_component),
            updates.get("parent_account_id", account.parent_account_id),
        )
    # slug is the importer's natural key — never rewritten here. A sheet-side rename is
    # the importer's job (per-run alias semantics, Plan 2 forward note).
    before = row_image(account)
    for field, value in updates.items():
        setattr(account, field, value)
    batch.record_update(account, before)
    batch.label = f"Updated account {account.name}"
    await batch.commit()
    return account


@router.delete("/accounts/{account_id}", status_code=204)
async def delete_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    account = await _get_account(db, account_id)
    balance_count = (
        await db.execute(
            select(func.count())
            .select_from(AccountBalance)
            .where(AccountBalance.account_id == account_id)
        )
    ).scalar_one()
    if balance_count:
        raise HTTPException(
            status_code=409,
            detail=f"account has {balance_count} balance rows — deactivate it instead",
        )
    batch.record_delete(account)
    batch.label = f"Deleted account {account.name}"
    await db.delete(account)
    await batch.commit()
    return Response(status_code=204, headers=batch_header(batch.id if batch.rows else None))


QUARTER_END_MONTHS = (3, 6, 9, 12)

# A bounded string, not an int: the value is either a person id or the literal "joint", and
# a length cap keeps a garbage query out of the parser before owner_clause even sees it.
OwnerQuery = Annotated[str | None, Query(max_length=32)]


def _owner_filter(owner: str | None) -> ColumnElement[bool] | None:
    """HTTP contract only — owner_clause owns the SEMANTICS. Absent means household, and
    the endpoint's answer is then byte-identical to the pre-ownership one."""
    if owner is None:
        return None
    try:
        return owner_clause(owner)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


async def _owner_rows(
    db: AsyncSession, accounts: list[Account]
) -> list[tuple[int | None, str | None]]:
    """The owner identities present in `accounts`: primary person first, the rest by id,
    Joint (NULL-owned) last. Components are excluded from every rollup, so they must not
    conjure an owner row either — otherwise a partner whose only row is a 401(k) bucket
    would appear with a phantom $0.00 column."""
    owned = {a.person_id for a in accounts if not a.is_component}
    people = list(
        (await db.execute(select(Person).order_by(Person.is_primary.desc(), Person.id)))
        .scalars()
        .all()
    )
    rows: list[tuple[int | None, str | None]] = [(p.id, p.name) for p in people if p.id in owned]
    if None in owned:
        rows.append((None, None))  # Joint — the client owns that word, not the server
    return rows


@router.get("/timeseries", response_model=TimeseriesOut)
async def timeseries(
    granularity: Literal["monthly", "quarterly"] = "monthly",
    owner: OwnerQuery = None,
    db: AsyncSession = Depends(get_db),
) -> TimeseriesOut:
    snapshots, accounts, balances = await load_balance_matrix(db, _owner_filter(owner))
    if granularity == "quarterly":
        snapshots = [s for s in snapshots if s.month.month in QUARTER_END_MONTHS]
    net_worth = [net_worth_for(s.id, accounts, balances) for s in snapshots]
    mom = [
        None if i == 0 else mom_pct(net_worth[i], net_worth[i - 1]) for i in range(len(net_worth))
    ]
    per_snapshot_groups = [group_totals_for(s.id, accounts, balances) for s in snapshots]
    group_totals = {
        group: [totals[group] for totals in per_snapshot_groups] for group in ACCOUNT_GROUPS
    }
    # Same in-memory matrix, regrouped: no extra queries, and the toggle on the page is a
    # re-render rather than a refetch.
    per_snapshot_owners = [owner_totals_for(s.id, accounts, balances) for s in snapshots]
    owner_rows = await _owner_rows(db, accounts)
    return TimeseriesOut(
        months=[s.month for s in snapshots],
        accounts=[AccountOut.model_validate(a) for a in accounts],
        series=[
            AccountSeries(
                account_id=a.id,
                values=[balances.get((s.id, a.id)) for s in snapshots],
            )
            for a in accounts
        ],
        group_totals=group_totals,
        net_worth=net_worth,
        mom_pct=mom,
        # After the quarterly filter, so the list stays aligned with `months`.
        notes=[s.notes for s in snapshots],
        owner_series=[
            OwnerSeries(
                person_id=person_id,
                name=name,
                values=[totals.get(person_id, ZERO) for totals in per_snapshot_owners],
            )
            for person_id, name in owner_rows
        ],
    )


@router.get("/summary", response_model=SummaryOut)
async def summary(
    owner: OwnerQuery = None,
    # Annotated + a plain None default, like OwnerQuery above and NOT `= Query(default=None)`:
    # assistant_context calls this function directly, and a params.Query left sitting in the
    # default would sail past `is None` and reach the 404 formatter as a non-date.
    month: Annotated[date | None, Query()] = None,
    db: AsyncSession = Depends(get_db),
) -> SummaryOut:
    """The latest month by default; `month=YYYY-MM-01` views that snapshot (which may be the
    latest) with ITS month-over-month delta (against the snapshot immediately before it), for
    the ribbon's click-to-view (2026-09-03 shell spec §7). The charts are unaffected — they
    span all months."""
    if month is not None:
        # 422 like /months/{month}: a mid-month value must not read as "no snapshot for 2026-02".
        require_first_of_month(month)
    snapshots, accounts, balances = await load_balance_matrix(db, _owner_filter(owner))
    if month is None:
        index = len(snapshots) - 1  # -1 on an empty book
    else:
        index = next((i for i, snap in enumerate(snapshots) if snap.month == month), -1)
        if index == -1:
            raise HTTPException(status_code=404, detail=f"no snapshot for {month:%Y-%m}")
    if index == -1:
        return SummaryOut(
            month=None,
            net_worth=None,
            mom_delta=None,
            mom_pct=None,
            groups=[],
            owner_totals=[],
        )
    viewed = snapshots[index]
    previous = snapshots[index - 1] if index > 0 else None
    viewed_nw = net_worth_for(viewed.id, accounts, balances)
    viewed_groups = group_totals_for(viewed.id, accounts, balances)
    prev_nw = net_worth_for(previous.id, accounts, balances) if previous else None
    prev_groups = group_totals_for(previous.id, accounts, balances) if previous else None
    viewed_owners = owner_totals_for(viewed.id, accounts, balances)
    owner_rows = await _owner_rows(db, accounts)
    return SummaryOut(
        month=viewed.month,
        net_worth=viewed_nw,
        mom_delta=None if prev_nw is None else viewed_nw - prev_nw,
        mom_pct=mom_pct(viewed_nw, prev_nw),
        groups=[
            GroupSummary(
                group=group,
                total=viewed_groups[group],
                mom_delta=None
                if prev_groups is None
                else viewed_groups[group] - prev_groups[group],
            )
            for group in ACCOUNT_GROUPS
        ],
        owner_totals=[
            OwnerTotal(person_id=person_id, name=name, total=viewed_owners.get(person_id, ZERO))
            for person_id, name in owner_rows
        ],
    )


@router.get("/months/{month}", response_model=MonthBalancesOut)
async def get_month(month: date, db: AsyncSession = Depends(get_db)) -> MonthBalancesOut:
    require_first_of_month(month)
    snapshot = (
        await db.execute(select(NetWorthSnapshot).where(NetWorthSnapshot.month == month))
    ).scalar_one_or_none()
    if snapshot is None:
        return MonthBalancesOut(
            month=month, exists=False, recorded_on=None, notes=None, balances=[]
        )
    rows = (
        (
            await db.execute(
                select(AccountBalance)
                .where(AccountBalance.snapshot_id == snapshot.id)
                .order_by(AccountBalance.account_id)
            )
        )
        .scalars()
        .all()
    )
    return MonthBalancesOut(
        month=month,
        exists=True,
        recorded_on=snapshot.recorded_on,
        notes=snapshot.notes,
        balances=[BalanceEntry(account_id=r.account_id, balance=r.balance) for r in rows],
    )


@router.put("/months/{month}", response_model=MonthUpsertResult)
async def put_month(
    month: date,
    body: MonthUpsert,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> MonthUpsertResult:
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
    # to what the month already stores, and one absent from both contributes nothing.
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
            recorded_on=body.recorded_on or date.today(),
            notes=body.notes,
        )
        db.add(snapshot)
        await db.flush()
        batch.record_insert(snapshot, month=month)
    else:
        provided = body.model_fields_set
        if "recorded_on" in provided:
            snapshot.recorded_on = body.recorded_on
        if "notes" in provided:
            snapshot.notes = body.notes

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
    batch_id = await batch.commit()
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
        batch_id=batch_id,
    )


@router.delete("/months/{month}", status_code=204)
async def delete_month(
    month: date,
    db: AsyncSession = Depends(get_db),
    batch: ChangeBatch = Depends(change_batch),
) -> Response:
    """Remove a month wholesale (2026-08-31 spec §B2): the snapshot row goes and the FK's
    ON DELETE CASCADE takes every account_balances row with it (declared on the model, so
    create_all schemas carry it too). 404 when no snapshot exists — the wizard's paired
    spending delete tolerates that, so a spending-only month still clears fully."""
    require_first_of_month(month)
    snapshot = (
        await db.execute(select(NetWorthSnapshot).where(NetWorthSnapshot.month == month))
    ).scalar_one_or_none()
    if snapshot is None:
        raise HTTPException(status_code=404, detail="no snapshot exists for this month")
    balances = (
        (
            await db.execute(
                select(AccountBalance)
                .where(AccountBalance.snapshot_id == snapshot.id)
                .order_by(AccountBalance.id)
            )
        )
        .scalars()
        .all()
    )
    # Explicit ORM deletes rather than the FK cascade alone, so every row is IMAGED and the
    # session holds no stale instances. Children first, parent LAST: undo replays in reverse.
    for row in balances:
        batch.record_delete(row, month=month)
        await db.delete(row)
    batch.record_delete(snapshot, month=month)
    await db.delete(snapshot)
    batch.label = f"Deleted {month:%b %Y} balances"
    batch_id = await batch.commit()
    return Response(status_code=204, headers=batch_header(batch_id))
