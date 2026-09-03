"""App-settings API: effective-value GET, full-form PUT, and the cron guard.

The guard cases are the recorded failure modes, not hypotheticals: '* * * * *' would hammer
Yahoo (plan-4 forward note), and numeric day-of-week is the 0=Mon prod mis-seed (APScheduler
numbers days 0=Mon, so "1-5" silently means Tue-Sat).
"""

import pytest

from app.models import AppSetting

SETTINGS = "/api/v1/settings"

VALID_BODY = {
    "swr_pct": "0.045",
    "espp_ticker": "nvda",
    "price_refresh_cron": "10 13 * * mon-fri",
}


async def test_settings_require_auth(client):
    assert (await client.get(SETTINGS)).status_code == 401


async def test_get_returns_effective_defaults_on_an_empty_table(auth_client):
    body = (await auth_client.get(SETTINGS)).json()
    assert body == {
        "swr_pct": "0.04",
        "espp_ticker": None,
        "price_refresh_cron": "10 13 * * mon-fri",
        "calendar_update_due_day": 1,
    }


async def test_get_falls_back_on_a_malformed_stored_value(auth_client, db):
    db.add(AppSetting(key="swr_pct", value={"value": "garbage"}))
    await db.commit()
    body = (await auth_client.get(SETTINGS)).json()
    assert body["swr_pct"] == "0.04"  # reader semantics: malformed == absent


async def test_put_hot_applies_the_cron_to_the_live_scheduler(auth_client, monkeypatch):
    # The router hands the validated cron to the scheduler AFTER the commit; in a
    # scheduler-less process the real call is a quiet False (test_scheduler pins that) —
    # here a spy proves the wiring and the argument.
    calls: list[str] = []
    monkeypatch.setattr(
        "app.api.app_settings.reschedule_price_refresh",
        lambda cron: calls.append(cron) or True,
    )
    body = {**VALID_BODY, "price_refresh_cron": "0 6 * * mon"}
    assert (await auth_client.put(SETTINGS, json=body)).status_code == 200
    assert calls == ["0 6 * * mon"]

    # A rejected cron never reaches the scheduler — validation runs first.
    bad = {**VALID_BODY, "price_refresh_cron": "* * * * *"}
    assert (await auth_client.put(SETTINGS, json=bad)).status_code == 422
    assert calls == ["0 6 * * mon"]


async def test_put_round_trips_and_stores_the_envelope(auth_client, db):
    r = await auth_client.put(SETTINGS, json=VALID_BODY)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "swr_pct": "0.045000",
        "espp_ticker": "NVDA",
        "price_refresh_cron": "10 13 * * mon-fri",
        "calendar_update_due_day": 1,
    }
    assert (await auth_client.get(SETTINGS)).json() == r.json()
    stored = await db.get(AppSetting, "swr_pct")
    assert stored.value == {"value": "0.045000"}  # plain-notation STRING (lossless re-read)
    assert (await db.get(AppSetting, "espp_ticker")).value == {"value": "NVDA"}


async def test_put_updates_rows_that_already_exist(auth_client, db):
    # The UPDATE branch is the only one prod ever takes: all three rows are seeded on every
    # boot, so an empty settings table exists in tests and nowhere else.
    db.add(AppSetting(key="swr_pct", value={"value": "0.01"}))
    db.add(AppSetting(key="espp_ticker", value={"value": "AAPL"}))
    db.add(AppSetting(key="price_refresh_cron", value={"value": "0 9 * * mon"}))
    await db.commit()
    r = await auth_client.put(SETTINGS, json=VALID_BODY)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "swr_pct": "0.045000",
        "espp_ticker": "NVDA",
        "price_refresh_cron": "10 13 * * mon-fri",
        "calendar_update_due_day": 1,
    }
    assert (await db.get(AppSetting, "swr_pct")).value == {"value": "0.045000"}
    assert (await db.get(AppSetting, "espp_ticker")).value == {"value": "NVDA"}
    assert (await db.get(AppSetting, "price_refresh_cron")).value == {"value": "10 13 * * mon-fri"}


async def test_put_clears_the_ticker_with_null(auth_client):
    body = dict(VALID_BODY, espp_ticker=None)
    r = await auth_client.put(SETTINGS, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["espp_ticker"] is None


@pytest.mark.parametrize("bad", ["1.5", "-0.1"])
async def test_put_rejects_out_of_range_swr(auth_client, bad):
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, swr_pct=bad))
    assert r.status_code == 422
    assert r.json()["detail"] == "swr_pct: must be a fraction between 0 and 1"


async def test_put_collapses_a_negative_zero_swr(auth_client, db):
    # "-0" passes the `< 0` bound (it compares EQUAL to zero); the `+ ZERO` collapse is what
    # keeps "-0.000000" out of the stored envelope and off the wire.
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, swr_pct="-0"))
    assert r.status_code == 200, r.text
    assert r.json()["swr_pct"] == "0.000000"
    assert (await db.get(AppSetting, "swr_pct")).value == {"value": "0.000000"}


async def test_put_rejects_a_malformed_ticker(auth_client):
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, espp_ticker="bad ticker!"))
    assert r.status_code == 422  # portfolio's exact phrasing — assert the status only


async def test_put_rejects_an_unparseable_cron(auth_client):
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, price_refresh_cron="not a cron"))
    assert r.status_code == 422
    assert r.json()["detail"].startswith("price_refresh_cron: not a valid 5-field cron")


async def test_put_writes_nothing_when_a_later_field_is_rejected(auth_client, db):
    # Validate-all-then-write: the cron 422 lands before the first db.add, so a rejected
    # form never leaves the earlier fields half-saved (taxes PUT's posture).
    r = await auth_client.put(
        SETTINGS, json=dict(VALID_BODY, swr_pct="0.05", price_refresh_cron="not a cron")
    )
    assert r.status_code == 422
    assert await db.get(AppSetting, "swr_pct") is None


@pytest.mark.parametrize("fast", ["* * * * *", "10,40 13 * * mon-fri", "*/30 * * * *"])
async def test_put_rejects_sub_hourly_crons(auth_client, fast):
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, price_refresh_cron=fast))
    assert r.status_code == 422
    assert r.json()["detail"] == "price_refresh_cron: must not fire more often than hourly"


async def test_put_allows_an_exactly_hourly_cron(auth_client):
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, price_refresh_cron="0 * * * *"))
    assert r.status_code == 200, r.text


async def test_put_rejects_numeric_day_of_week(auth_client):
    # APScheduler numbers days 0=Mon (not UNIX 0=Sun): numeric "1-5" silently means
    # Tue-Sat — the recorded prod mis-seed. Day NAMES only.
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, price_refresh_cron="10 13 * * 1-5"))
    assert r.status_code == 422
    assert "day NAMES" in r.json()["detail"]


async def test_get_reports_a_legacy_cron_verbatim_but_put_refuses_to_echo_it(auth_client, db):
    # GET and PUT are deliberately asymmetric. read_cron_setting does NOT validate, so GET
    # reports what the scheduler would ACTUALLY use — here the recorded 0=Mon prod mis-seed.
    # PUT is the gate: loading that value into the settings form and saving it back 422s.
    # The form surfaces the detail verbatim, and that pressure is the point — the stored
    # cron only stops silently meaning Tue-Sat once someone is made to retype it as names.
    db.add(AppSetting(key="price_refresh_cron", value={"value": "10 13 * * 1-5"}))
    await db.commit()
    assert (await auth_client.get(SETTINGS)).json()["price_refresh_cron"] == "10 13 * * 1-5"
    r = await auth_client.put(SETTINGS, json=dict(VALID_BODY, price_refresh_cron="10 13 * * 1-5"))
    assert r.status_code == 422
    assert "day NAMES" in r.json()["detail"]


async def test_get_reports_the_default_calendar_due_day(auth_client):
    assert (await auth_client.get(SETTINGS)).json()["calendar_update_due_day"] == 1


async def test_put_stores_the_due_day_and_omitting_it_keeps_the_stored_value(auth_client, db):
    r = await auth_client.put(SETTINGS, json={**VALID_BODY, "calendar_update_due_day": 5})
    assert r.status_code == 200, r.text
    assert r.json()["calendar_update_due_day"] == 5
    assert (await db.get(AppSetting, "calendar_update_due_day")).value == {"value": 5}
    # The app-settings form does not know this field (the Calendar feed card owns it):
    # a PUT without it must not reset the day to 1.
    again = await auth_client.put(SETTINGS, json=VALID_BODY)
    assert again.json()["calendar_update_due_day"] == 5


@pytest.mark.parametrize("bad", [0, 29])
async def test_put_rejects_a_due_day_outside_1_to_28(auth_client, bad):
    r = await auth_client.put(SETTINGS, json={**VALID_BODY, "calendar_update_due_day": bad})
    assert r.status_code == 422
    assert r.json()["detail"] == "calendar_update_due_day: must be between 1 and 28"
