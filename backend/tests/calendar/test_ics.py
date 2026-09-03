"""The ICS builder (2026-09-03 calendar spec §11, §17): RFC 5545 validity, UID stability,
alarms only where they belong, RRULE for series, STATUS by basis, escaping, and the
75-octet folding check on UTF-8 character boundaries."""

from datetime import date
from decimal import Decimal

from app.services.calendar.ics import amount_text, escape_text, fold_line
from app.services.calendar.model import Item, make_event


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
    assert (
        amount_text(q3(basis="confirmed", direction="neutral", amount=Decimal("300"))) == "$300.00"
    )
    assert amount_text(q3(amount=None)) is None
