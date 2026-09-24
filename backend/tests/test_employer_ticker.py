"""One employer-ticker reader (batch 2 integration, 2026-09-24). app_settings['espp_ticker'] is
read by services/employer_ticker.read_employer_ticker and nowhere else. The ESPP quote chain's
first hop, the Settings GET, the withholding and projection caches' bound ticker, and the
employer history backfill all resolve it there, so they cannot disagree about a stored shape.
Each is pinned below on every envelope shape against the ticker it must resolve, and a source
fence keeps a second copy of the rule from coming back."""

import re
from datetime import date
from pathlib import Path

import pytest

from app.api.espp import _espp_quote
from app.models import AppSetting
from app.services import read_cache
from app.services.employer_ticker import read_employer_ticker
from app.services.price_service import backfill_employer_history
from tests.test_price_service import FakeProvider, bar, rsu_grant, seed_security

APP = Path(__file__).resolve().parents[1] / "app"

# The stored envelope is convention only (Plan 1 note), so every shape a hand edit, an old
# import or a restore could leave has one answer: a trimmed, upper-cased ticker, or none.
SHAPES = [
    pytest.param(None, None, id="no-row"),
    pytest.param({"value": "NVDA"}, "NVDA", id="ticker"),
    pytest.param({"value": "  nvda "}, "NVDA", id="untrimmed-lowercase"),
    pytest.param({"value": ""}, None, id="empty"),
    pytest.param({"value": "   "}, None, id="blank"),
    pytest.param({"value": None}, None, id="null"),
    pytest.param({"value": 7}, None, id="number"),
    pytest.param(["NVDA"], None, id="not-an-envelope"),
    pytest.param({}, None, id="no-value-key"),
]


async def _store(db, stored):
    if stored is not None:
        db.add(AppSetting(key="espp_ticker", value=stored))
        await db.commit()


@pytest.mark.parametrize(("stored", "expected"), SHAPES)
async def test_every_reader_resolves_the_same_ticker(auth_client, db, stored, expected):
    await _store(db, stored)
    assert await read_employer_ticker(db) == expected
    # The quote chain's first hop: no security row is seeded, so a ticker degrades to no quote.
    assert await _espp_quote(db) == (expected, None, None)
    assert (await auth_client.get("/api/v1/settings")).json()["espp_ticker"] == expected

    # Both caches key their entries on the ticker their fingerprint's quote cell was bound with.
    async def build() -> bytes:
        return b"{}"

    await read_cache.cached_withholding(db, 2026, build, today=date(2026, 9, 24))
    await read_cache.cached_projection(db, ("knobs",), build)
    assert [key[1] for key in read_cache.WITHHOLDINGS.keys()] == [expected]
    assert [key[1] for key in read_cache.PROJECTIONS.keys()] == [expected]


@pytest.mark.parametrize(("stored", "expected"), SHAPES)
async def test_the_employer_backfill_reads_the_same_ticker(db, stored, expected):
    await seed_security(db, "NVDA")
    db.add(rsu_grant(date(2024, 9, 18)))
    await db.commit()
    await _store(db, stored)
    provider = FakeProvider({"NVDA": [bar(date(2024, 9, 4), "115")]})

    written = await backfill_employer_history(db, provider)

    assert [ticker for ticker, _start in provider.calls] == ([] if expected is None else [expected])
    assert written == (0 if expected is None else 1)


# A direct read of the setting: by primary key (how all four copies read it) or by a filter.
_DIRECT_READ = re.compile(
    r"""AppSetting\s*,\s*["']espp_ticker["']"""
    r"""|AppSetting\.key\s*==\s*["']espp_ticker["']"""
)


def test_one_module_reads_the_employer_ticker_setting():
    readers = sorted(
        path.relative_to(APP).as_posix()
        for path in APP.rglob("*.py")
        if _DIRECT_READ.search(path.read_text(encoding="utf-8"))
    )
    assert readers == ["services/employer_ticker.py"]
