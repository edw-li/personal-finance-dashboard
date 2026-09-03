import re
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import (
    Account,
    AccountBalance,
    AppSetting,
    LatestPrice,
    LifecycleRun,
    NetWorthSnapshot,
)
from app.services.snapshot import (
    RESTORE_POINT_NAME_RE,
    RESTORE_POINTS_KEEP,
    SNAPSHOT_NAME_RE,
    csv_for_rows,
    json_cell,
    json_row,
    parse_cell,
    restore_points_dir,
    row_dict,
    snapshot_name,
    snapshot_stamp,
    snapshots_dir,
    trim_directory,
    write_restore_point,
)


@pytest.mark.parametrize(
    ("column", "raw", "expected"),
    [
        (AccountBalance.__table__.c.balance, "1234.50", Decimal("1234.50")),
        (NetWorthSnapshot.__table__.c.month, "2026-05-01", date(2026, 5, 1)),
        (
            LatestPrice.__table__.c.quoted_at,
            "2026-08-17T00:00:00+00:00",
            datetime(2026, 8, 17, tzinfo=UTC),
        ),
        (Account.__table__.c.is_active, True, True),
        (Account.__table__.c.sort_order, 2, 2),
        (Account.__table__.c.name, "Café Fund", "Café Fund"),
        (Account.__table__.c.parent_account_id, None, None),
        (AppSetting.__table__.c.value, {"value": "0.04"}, {"value": "0.04"}),
        (AppSetting.__table__.c.value, ["a", "b"], ["a", "b"]),
    ],
)
def test_parse_cell_inverts_json_cell(column, raw, expected):
    parsed = parse_cell(column, raw)
    assert parsed == expected
    assert type(parsed) is type(expected)
    # And back: the two spellings live side by side so they cannot drift (spec §7).
    assert json_cell(parsed) == raw


def test_parse_cell_refuses_a_non_boolean_for_a_boolean_column():
    with pytest.raises(ValueError, match="is_active"):
        parse_cell(Account.__table__.c.is_active, "true")


async def test_row_helpers_and_csv_for_rows_match_the_export_spellings(db):
    snapshot = NetWorthSnapshot(month=date(2026, 5, 1), recorded_on=date(2026, 5, 3), notes=None)
    account = Account(name="Café Fund", slug="cafe-fund", group="cash", sort_order=2)
    db.add_all([snapshot, account])
    await db.flush()
    db.add(
        AccountBalance(snapshot_id=snapshot.id, account_id=account.id, balance=Decimal("1234.50"))
    )
    await db.commit()
    columns = list(Account.__table__.columns)
    raw = row_dict(account, columns)
    assert raw["name"] == "Café Fund" and raw["parent_account_id"] is None
    assert json_row(account) == {
        "id": account.id,
        "name": "Café Fund",
        "slug": "cafe-fund",
        "group": "cash",
        "sort_order": 2,
        "is_active": True,
        "is_component": False,
        "parent_account_id": None,
        "person_id": None,
    }
    text = csv_for_rows(columns, [raw])
    assert text.splitlines() == [
        "id,name,slug,group,sort_order,is_active,is_component,parent_account_id,person_id",
        f"{account.id},Café Fund,cafe-fund,cash,2,true,false,,",
    ]
    balance = (await db.execute(select(AccountBalance))).scalar_one()
    balance_columns = list(AccountBalance.__table__.columns)
    balance_text = csv_for_rows(balance_columns, [row_dict(balance, balance_columns)])
    assert balance_text.splitlines()[1].endswith(",1234.50")
    # Parsed JSON rows write the SAME csv as live rows — the restore's identity hash relies on it.
    parsed = {
        c.key: parse_cell(c, v) for c, v in zip(columns, json_row(account).values(), strict=True)
    }
    assert csv_for_rows(columns, [parsed]) == text


def test_name_grammar():
    stamp = datetime(2026, 9, 4, 23, 30, 5, tzinfo=UTC)
    assert snapshot_name(stamp) == "finance-export-20260904-233005.zip"
    assert snapshot_stamp("finance-export-20260904-233005.zip") == stamp
    assert snapshot_stamp("finance-export-2026.zip") is None
    assert SNAPSHOT_NAME_RE.fullmatch("../finance-export-20260904-233005.zip") is None
    assert RESTORE_POINT_NAME_RE.fullmatch("pre-restore-20260904-233005-123456.zip")
    assert snapshots_dir().parent == restore_points_dir().parent


def test_data_dir_is_isolated_per_test(tmp_path):
    # conftest points settings.data_dir at a per-test tmp tree; nothing lands in ./data.
    assert str(tmp_path) in settings.data_dir


def test_trim_directory_keeps_the_newest_names(tmp_path):
    for stamp in (
        "20260901-000000-000001",
        "20260902-000000-000001",
        "20260903-000000-000001",
        "20260904-000000-000001",
    ):
        (tmp_path / f"pre-restore-{stamp}.zip").write_bytes(b"x")
    (tmp_path / "unrelated.txt").write_bytes(b"x")
    removed = trim_directory(tmp_path, RESTORE_POINT_NAME_RE, keep=3)
    assert removed == ["pre-restore-20260901-000000-000001.zip"]
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "pre-restore-20260902-000000-000001.zip",
        "pre-restore-20260903-000000-000001.zip",
        "pre-restore-20260904-000000-000001.zip",
        "unrelated.txt",
    ]


async def test_write_restore_point_writes_trims_and_records(db):
    db.add(Account(name="A", slug="a", group="cash", sort_order=1))
    await db.commit()
    points = []
    for _ in range(RESTORE_POINTS_KEEP + 1):
        points.append(await write_restore_point(db, actor="me@example.com"))
    names = sorted(p.name for p in restore_points_dir().iterdir())
    # Atomic publish: the bytes land in <name>.part and os.replace renames them into place,
    # so a finished write leaves NO .part behind — and a crashed one leaves only a .part,
    # which matches no name pattern and can never be offered as a restorable archive.
    assert [n for n in names if n.endswith(".part")] == []
    assert len(names) == RESTORE_POINTS_KEEP  # the oldest was trimmed
    assert names == sorted(p.name for p in points)[1:]
    assert all(RESTORE_POINT_NAME_RE.fullmatch(n) for n in names)
    assert points[-1].size_bytes == points[-1].path.stat().st_size > 0
    runs = (await db.execute(select(LifecycleRun).order_by(LifecycleRun.id))).scalars().all()
    assert [r.kind for r in runs] == ["restore_point"] * (RESTORE_POINTS_KEEP + 1)
    assert runs[-1].filename == points[-1].name
    assert runs[-1].actor == "me@example.com" and runs[-1].ok is True
    assert runs[-1].report == {
        "tables": {
            **{
                t: 0
                for _, t in __import__(
                    "app.services.snapshot", fromlist=["EXPORTED_TABLES"]
                ).EXPORTED_TABLES
            },
            "accounts": 1,
        }
    }
    assert re.fullmatch(r"pre-restore-\d{8}-\d{6}-\d{6}\.zip", points[0].name)
