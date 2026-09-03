"""The ICS builder (2026-09-03 calendar spec §11, §17): RFC 5545 validity, UID stability,
alarms only where they belong, RRULE for series, STATUS by basis, escaping, and the
75-octet folding check on UTF-8 character boundaries."""

from dataclasses import replace
from datetime import date
from decimal import Decimal

from app.services.calendar.generators.custom import CustomRow, custom_events
from app.services.calendar.ics import amount_text, escape_text, fold_line, render
from app.services.calendar.model import Item, Window, make_event


def unfold(text: str) -> str:
    return text.replace("\r\n ", "")


def physical_lines(text: str) -> list[str]:
    assert text.endswith("\r\n")
    return text[:-2].split("\r\n")


def q3(**over):
    # label and short_label live in the dict too, so an override can replace them:
    # make_event takes both POSITIONALLY, and a bare **over would hand it two values
    # for `label`.
    fields = dict(
        label="Tax deadline — Q3 estimated payment",
        short_label="Q3 est. tax",
        detail="Q3 estimated payment",
        amount=Decimal("1200"),
        direction="out",
        basis="estimated",
        href="/taxes",
    )
    fields.update(over)
    return make_event(
        date(2026, 9, 15),
        "tax_deadline",
        "2026-q3",
        fields.pop("label"),
        fields.pop("short_label"),
        **fields,
    )


def payday():
    return make_event(
        date(2026, 9, 15),
        "payday",
        "payday",
        "Payday — Me & Sam",
        "Payday · 2",
        detail="2 paychecks",
        amount=Decimal("6812.44"),
        direction="in",
        basis="scheduled",
        href="/paycheck",
        items=(Item("Me", Decimal("4000.00"), 1, None), Item("Sam", Decimal("2812.44"), 2, None)),
    )


def test_escape_text_is_rfc_5545_backslash_first():
    assert escape_text("a,b;c\nd\\e") == "a\\,b\\;c\\nd\\\\e"
    assert escape_text("crlf\r\nline") == "crlf\\nline"
    assert escape_text("lone\rcr") == "lone\\ncr"


def test_fold_line_leaves_short_lines_and_folds_on_character_boundaries():
    assert fold_line("SUMMARY:short") == "SUMMARY:short"
    folded = fold_line("DESCRIPTION:" + "é" * 60)  # 12 + 120 octets
    parts = folded.split("\r\n")
    assert len(parts) == 2 and parts[1].startswith(" ")
    for part in parts:
        assert len(part.encode("utf-8")) <= 75
        part.encode("utf-8").decode("utf-8")  # no split code point anywhere
    assert unfold(folded) == "DESCRIPTION:" + "é" * 60


def test_fold_line_first_line_is_exactly_75_octets_when_ascii():
    parts = fold_line("X:" + "a" * 200).split("\r\n")
    assert [len(p.encode()) for p in parts] == [75, 75, 54]  # 202 octets: 75 + (1+74) + (1+53)


def test_amount_text_signs_by_direction_and_tildes_estimates():
    assert amount_text(payday()) == "+$6,812.44"
    assert amount_text(q3()) == "~-$1,200.00"
    estimate_free = q3(basis="confirmed", direction="neutral", amount=Decimal("300"))
    assert amount_text(estimate_free) == "$300.00"
    assert amount_text(q3(amount=None)) is None


def test_render_is_a_valid_publish_calendar_with_crlf_and_the_required_properties():
    text = render([payday(), q3()], public_url="https://finance.example.com")
    lines = physical_lines(text)
    assert lines[0] == "BEGIN:VCALENDAR" and lines[-1] == "END:VCALENDAR"
    for required in (
        "VERSION:2.0",
        "PRODID:-//finance-dashboard//calendar//EN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Finance dashboard",
        "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
        "X-PUBLISHED-TTL:PT12H",
    ):
        assert required in lines
    assert lines.count("BEGIN:VEVENT") == lines.count("END:VEVENT") == 2
    assert lines.count("BEGIN:VALARM") == lines.count("END:VALARM") == 1
    assert "\n" not in text.replace("\r\n", "")  # every newline is CRLF
    unfolded = unfold(text).split("\r\n")
    assert "UID:payroll:payday:2026-09-15@finance-dashboard" in unfolded
    assert "DTSTAMP:20260915T000000Z" in unfolded
    assert "DTSTART;VALUE=DATE:20260915" in unfolded
    assert "SUMMARY:Payday — Me & Sam · +$6\\,812.44" in unfolded
    assert "SUMMARY:Tax deadline — Q3 estimated payment · ~-$1\\,200.00" in unfolded
    description = (
        "DESCRIPTION:Amount: +$6\\,812.44 (in\\, scheduled)"
        "\\n- Me: $4\\,000.00\\n- Sam: $2\\,812.44"
        "\\n2 paychecks\\nhttps://finance.example.com/paycheck"
    )
    assert description in unfolded
    assert "CATEGORIES:payday" in unfolded and "CATEGORIES:tax_deadline" in unfolded


def test_uid_is_stable_across_renders_and_a_label_change():
    first = render([q3()])
    assert render([q3()]) == first  # byte-identical
    renamed = render([q3(label="Tax deadline — Q3 (renamed)", detail="renamed")])
    uid = next(line for line in unfold(first).split("\r\n") if line.startswith("UID:"))
    assert uid == "UID:tax:2026-q3:2026-09-15@finance-dashboard"
    assert uid in unfold(renamed).split("\r\n")


def test_status_follows_basis_and_alarms_only_deadline_types_never_done():
    lines = unfold(render([payday(), q3(), replace(q3(), done=True)])).split("\r\n")
    assert lines.count("STATUS:CONFIRMED") == 1  # the scheduled payday
    assert lines.count("STATUS:TENTATIVE") == 2  # both estimated deadlines
    assert lines.count("BEGIN:VALARM") == 1  # the open deadline only
    assert "TRIGGER:-P2DT15H" in lines and "ACTION:DISPLAY" in lines
    done_description = (
        "DESCRIPTION:Amount: ~-$1\\,200.00 (out\\, estimated)"
        "\\nDone\\nQ3 estimated payment\\n/taxes"
    )
    assert done_description in lines


def test_hidden_events_are_omitted_entirely():
    text = render([replace(payday(), hidden=True), q3()])
    assert "payroll:payday" not in text and text.count("BEGIN:VEVENT") == 1


def test_a_recurring_custom_series_is_one_vevent_with_an_rrule():
    rows = [
        CustomRow(
            8, date(2026, 8, 5), "Piano lesson", None, recurrence="weekly", until=date(2026, 8, 19)
        )
    ]
    events = custom_events(rows, Window(date(2026, 8, 1), date(2026, 8, 31)))
    assert len(events) == 3
    lines = unfold(render(events)).split("\r\n")
    assert lines.count("BEGIN:VEVENT") == 1
    assert "UID:custom:8:2026-08-05@finance-dashboard" in lines
    assert "DTSTART;VALUE=DATE:20260805" in lines
    assert "RRULE:FREQ=WEEKLY;UNTIL=20260819" in lines
    open_series = custom_events(
        [
            CustomRow(
                9,
                date(2026, 1, 31),
                "Rent",
                None,
                amount=Decimal("2400"),
                direction="out",
                recurrence="monthly",
            )
        ],
        Window(date(2026, 1, 1), date(2026, 3, 31)),
    )
    assert "RRULE:FREQ=MONTHLY" in unfold(render(open_series)).split("\r\n")


def test_summary_and_description_are_escaped():
    text = unfold(render([q3(label="Vest; big, day", detail="line one\nline two")]))
    assert "SUMMARY:Vest\\; big\\, day · ~-$1\\,200.00" in text
    assert "\\nline one\\nline two\\n" in text


def test_the_rfc_5545_folding_check_over_a_whole_calendar():
    long_note = "Ünïcödé " * 30  # multibyte text long enough to fold several times
    text = render([replace(payday(), note=long_note), q3()])
    for line in physical_lines(text):
        assert len(line.encode("utf-8")) <= 75, line
        line.encode("utf-8").decode("utf-8")
    continuation = [line for line in physical_lines(text) if line.startswith(" ")]
    assert continuation, "a note that long must fold"
    assert all(len(line) > 1 for line in continuation)
    assert escape_text(long_note) in unfold(text)
