"""Preference registry (2026-09-03 data-lifecycle spec §10): key → shape + default.

Only keys with a CONSUMER are registered — theme/density (ThemeProvider), scope (useScope's
memory), palette_recents (the command palette), landing_page (App's first-arrival redirect).
The audit's other candidates wait for theirs. Values are stored as JSONB exactly as
validated here; the router turns PrefValueError into a 422 that names the key.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


class PrefValueError(ValueError):
    """The value does not fit the key's shape; the message is the router's 422 detail."""


# Twin of src/components/navItems.ts NAV_ITEMS (every `to:`), pinned by test_prefs_registry.
NAV_PATHS: tuple[str, ...] = (
    "/",
    "/update",
    "/net-worth",
    "/portfolio",
    "/spending",
    "/credit-cards",
    "/paycheck",
    "/comp",
    "/espp",
    "/taxes",
    "/projection",
    "/calendar",
    "/settings",
)
THEMES = ("system", "dark", "light")
DENSITIES = ("comfortable", "compact")
RANGES = ("all", "1y", "ytd")
PALETTE_RECENTS_MAX = 8


def _one_of(allowed: tuple[str, ...]) -> Callable[[Any], Any]:
    def validate(value: Any) -> Any:
        if not isinstance(value, str) or value not in allowed:
            raise PrefValueError(f"must be one of {', '.join(allowed)}")
        return value

    return validate


def _person_id(value: Any) -> bool:
    # bool subclasses int: True would otherwise read as person 1.
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _scope(value: Any) -> Any:
    if not isinstance(value, dict) or set(value) != {"owner", "range"}:
        raise PrefValueError("must be an object with owner and range")
    owner = value["owner"]
    if owner not in ("all", "joint") and not _person_id(owner):
        raise PrefValueError("owner must be all, joint or a person id")
    if value["range"] not in RANGES:
        raise PrefValueError(f"range must be one of {', '.join(RANGES)}")
    return {"owner": owner, "range": value["range"]}


def _recents(value: Any) -> Any:
    ok = (
        isinstance(value, list)
        and len(value) <= PALETTE_RECENTS_MAX
        and all(isinstance(item, str) and 0 < len(item) <= 120 for item in value)
    )
    if not ok:
        raise PrefValueError(f"must be a list of at most {PALETTE_RECENTS_MAX} entry ids")
    return value


@dataclass(frozen=True)
class PrefSpec:
    key: str
    default: Any
    validate: Callable[[Any], Any]


PREF_REGISTRY: dict[str, PrefSpec] = {
    spec.key: spec
    for spec in (
        PrefSpec("theme", "dark", _one_of(THEMES)),
        PrefSpec("density", "comfortable", _one_of(DENSITIES)),
        PrefSpec("scope", {"owner": "all", "range": "1y"}, _scope),
        PrefSpec("palette_recents", [], _recents),
        PrefSpec("landing_page", "/", _one_of(NAV_PATHS)),
    )
}


def validate_pref(key: str, value: Any) -> Any:
    """The normalized value, or PrefValueError; KeyError for a key that is not registered."""
    return PREF_REGISTRY[key].validate(value)
