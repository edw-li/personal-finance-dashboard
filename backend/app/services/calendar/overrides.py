"""The user-edit overlay (2026-09-03 calendar spec §13), applied AFTER folding so an
override on a folded key lands on the folded event. A key with no event is silently
unmatched — harmless. An override amount wins and turns the basis to `confirmed` (the
user paid it); the drawer says "your figure" through `amount_overridden`."""

from dataclasses import dataclass, replace
from decimal import Decimal

from .model import Event, money


@dataclass(frozen=True)
class Override:
    key: str
    done: bool
    hidden: bool
    note: str | None
    amount: Decimal | None


def apply(events: list[Event], overrides: dict[str, Override]) -> list[Event]:
    if not overrides:
        return list(events)
    out: list[Event] = []
    for event in events:
        override = overrides.get(event.key)
        if override is None:
            out.append(event)
            continue
        changes: dict = {"done": override.done, "hidden": override.hidden, "note": override.note}
        if override.amount is not None:
            changes.update(amount=money(override.amount), basis="confirmed", amount_overridden=True)
        out.append(replace(event, **changes))
    return out
