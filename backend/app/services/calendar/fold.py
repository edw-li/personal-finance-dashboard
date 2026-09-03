"""Same-day folding (2026-09-03 calendar spec §7): rsu_vest and payday events sharing a
date merge into ONE event whose `items` keep the constituents (sorted by label) and whose
amount is the sum — or null when any part is null, because a partial sum would read as a
total. Every other family passes through untouched."""

from dataclasses import replace
from decimal import Decimal

from .generators.rsu import after_sell_to_cover
from .model import FOLDABLE_TYPES, Event, Item


def _total(items: tuple[Item, ...]) -> Decimal | None:
    if any(item.amount is None for item in items):
        return None
    return sum((item.amount for item in items if item.amount is not None), Decimal("0"))


def _merge(group: list[Event]) -> Event:
    first = group[0]
    items = tuple(sorted((item for event in group for item in event.items), key=lambda i: i.label))
    total = _total(items)
    if first.type == "rsu_vest":
        detail = "; ".join(f"{item.label}: {item.detail}" for item in items)
        if total is not None:
            detail += f" · ≈ ${after_sell_to_cover(total):,.2f} after sell-to-cover"
        return replace(
            first,
            label=f"RSU vest — {len(items)} grants",
            short_label=f"RSU vest · {len(items)} grants",
            detail=detail,
            amount=total,
            items=items,
        )
    # payday: one chip for the household's checks that day, every person named in items.
    return replace(
        first,
        label="Payday — " + " & ".join(item.label for item in items),
        short_label=f"Payday · {len(items)}",
        detail=f"{len(items)} paychecks",
        amount=total,
        items=items,
        person_id=None,
    )


def fold_same_day(events: list[Event]) -> list[Event]:
    groups: dict[tuple[str, object], list[Event]] = {}
    passthrough: list[Event] = []
    for event in events:
        if event.type in FOLDABLE_TYPES:
            groups.setdefault((event.type, event.event_date), []).append(event)
        else:
            passthrough.append(event)
    folded = [group[0] if len(group) == 1 else _merge(group) for group in groups.values()]
    return passthrough + folded
