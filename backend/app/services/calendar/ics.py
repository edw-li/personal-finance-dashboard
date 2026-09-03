"""One RFC 5545 builder for the download and the feed (2026-09-03 calendar spec §11).

Pure and DETERMINISTIC: no clock — DTSTAMP is the event date at T000000Z — so identical
inputs render identical bytes, which is what lets the feed's ETag turn most polls into a
304. UIDs are the event KEY (a function of source facts, never of a label), so a rename
updates a subscribed calendar instead of duplicating it. Lines over 75 octets fold with
CRLF + one space on UTF-8 CHARACTER boundaries (§3.1)."""

from decimal import Decimal

from .model import DEADLINE_TYPES, Event, key

PRODID = "-//finance-dashboard//calendar//EN"
CALNAME = "Finance dashboard"
REFRESH_INTERVAL = "PT12H"
UID_DOMAIN = "finance-dashboard"
# 09:00 three days before an all-day start: -(2 days + 15 hours) from midnight.
ALARM_TRIGGER = "-P2DT15H"
MAX_OCTETS = 75
FREQ = {"weekly": "WEEKLY", "monthly": "MONTHLY", "yearly": "YEARLY"}
SIGN = {"in": "+", "out": "-", "neutral": ""}


def escape_text(value: str) -> str:
    """RFC 5545 §3.3.11 TEXT escaping: backslash FIRST, then semicolon, comma, newlines
    (CRLF, lone CR and LF all become the literal `\\n`). Byte-identical to the retired
    frontend builder's escapeIcsText."""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\r", "\\n")
        .replace("\n", "\\n")
    )


def fold_line(line: str) -> str:
    """Content lines longer than 75 octets fold into 75-octet physical lines; every
    continuation starts with one space (which counts toward its 75). Splits land between
    code points, never inside one."""
    if len(line.encode("utf-8")) <= MAX_OCTETS:
        return line
    parts: list[str] = []
    current: list[str] = []
    used = 0
    budget = MAX_OCTETS
    for char in line:
        size = len(char.encode("utf-8"))
        if used + size > budget:
            parts.append("".join(current))
            # Every later physical line spends one of its 75 octets on the fold space.
            current, used, budget = [char], size, MAX_OCTETS - 1
        else:
            current.append(char)
            used += size
    parts.append("".join(current))
    return "\r\n ".join(parts)


def amount_text(event: Event) -> str | None:
    """Signed money for a SUMMARY: "+$6,812.44", "-$395.00", "~+$41,200.00" — the sign is
    the direction, the tilde the estimate. ASCII hyphen-minus on purpose: calendar apps
    render it everywhere."""
    if event.amount is None:
        return None
    tilde = "~" if event.basis == "estimated" else ""
    return f"{tilde}{SIGN[event.direction]}${event.amount:,.2f}"


def _money(value: Decimal | None) -> str:
    return "—" if value is None else f"${value:,.2f}"


def _description(event: Event, public_url: str | None) -> str:
    amount = amount_text(event)
    lines = [f"Amount: {amount} ({event.direction}, {event.basis})" if amount else "Amount unknown"]
    if event.done:
        lines.append("Done")
    lines.extend(
        f"- {item.label}: {_money(item.amount)}" + (f" ({item.detail})" if item.detail else "")
        for item in event.items
    )
    if event.detail:
        lines.append(event.detail)
    if event.note:
        lines.append(f"Note: {event.note}")
    if event.href:
        # An absolute link only when the deploy told us its origin: a bare path in a phone's
        # calendar app is useless, but a GUESSED host would be worse than the path.
        lines.append(f"{public_url.rstrip('/')}{event.href}" if public_url else event.href)
    return "\n".join(lines)


def _vevent(event: Event, *, series: bool, public_url: str | None) -> list[str]:
    # A recurring custom row renders ONCE, anchored on the series start, with an RRULE —
    # its UID is the key of that FIRST occurrence, so extending `until` updates the same
    # calendar entry rather than adding one.
    start = event.series_start if series and event.series_start is not None else event.event_date
    uid = key(event.source, event.entity_ref, start) if series else event.key
    amount = amount_text(event)
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}@{UID_DOMAIN}",
        f"DTSTAMP:{start:%Y%m%d}T000000Z",
        f"DTSTART;VALUE=DATE:{start:%Y%m%d}",
    ]
    if series and event.recurrence in FREQ:
        rrule = f"RRULE:FREQ={FREQ[event.recurrence]}"
        if event.until is not None:
            rrule += f";UNTIL={event.until:%Y%m%d}"
        lines.append(rrule)
    lines += [
        f"SUMMARY:{escape_text(event.label + (f' · {amount}' if amount else ''))}",
        f"DESCRIPTION:{escape_text(_description(event, public_url))}",
        f"CATEGORIES:{event.type}",
        f"STATUS:{'TENTATIVE' if event.basis == 'estimated' else 'CONFIRMED'}",
    ]
    if event.type in DEADLINE_TYPES and not event.done:
        lines += [
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{escape_text(event.label)}",
            f"TRIGGER:{ALARM_TRIGGER}",
            "END:VALARM",
        ]
    lines.append("END:VEVENT")
    return lines


def render(events: list[Event], *, public_url: str | None = None, calname: str = CALNAME) -> str:
    """The whole VCALENDAR as CRLF text. Hidden events are omitted entirely; a recurring
    custom series is one VEVENT; everything else is one VEVENT per event."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_text(calname)}",
        f"REFRESH-INTERVAL;VALUE=DURATION:{REFRESH_INTERVAL}",
        f"X-PUBLISHED-TTL:{REFRESH_INTERVAL}",
    ]
    rendered_series: set[int] = set()
    for event in events:
        if event.hidden:
            continue
        if event.recurrence is not None and event.event_id is not None:
            if event.event_id in rendered_series:
                continue
            rendered_series.add(event.event_id)
            lines += _vevent(event, series=True, public_url=public_url)
        else:
            lines += _vevent(event, series=False, public_url=public_url)
    lines.append("END:VCALENDAR")
    return "".join(f"{fold_line(line)}\r\n" for line in lines)
