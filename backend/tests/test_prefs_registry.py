import re
from pathlib import Path

import pytest

from app.services.prefs_registry import (
    NAV_PATHS,
    PALETTE_RECENTS_MAX,
    PREF_REGISTRY,
    PrefValueError,
    validate_pref,
)

NAV_ITEMS_TS = Path(__file__).resolve().parents[2] / "src" / "components" / "navItems.ts"


def test_registry_lists_exactly_the_five_keys_with_consumers():
    # Only keys with a consumer are registered (spec §10); the audit's other candidates
    # (currency style, liability sign, fiscal-year start) wait for theirs.
    assert set(PREF_REGISTRY) == {"theme", "density", "scope", "palette_recents", "landing_page"}
    assert PREF_REGISTRY["theme"].default == "dark"
    assert PREF_REGISTRY["density"].default == "comfortable"
    assert PREF_REGISTRY["scope"].default == {"owner": "all", "range": "1y"}
    assert PREF_REGISTRY["palette_recents"].default == []
    assert PREF_REGISTRY["landing_page"].default == "/"


def test_nav_paths_pin_the_frontend_registry():
    # The twin of src/components/navItems.ts NAV_ITEMS — the one place the app's routes are
    # listed; a page added there without a matching entry here fails until it is.
    source = NAV_ITEMS_TS.read_text(encoding="utf-8")
    frontend = set(re.findall(r"to: '([^']+)'", source))
    assert frontend == set(NAV_PATHS)
    assert NAV_PATHS[0] == "/"


@pytest.mark.parametrize(
    ("key", "good", "bad", "message"),
    [
        ("theme", "light", "neon", "must be one of system, dark, light"),
        ("density", "compact", "huge", "must be one of comfortable, compact"),
        ("landing_page", "/net-worth", "/nope", "must be one of /, /update"),
        (
            "scope",
            {"owner": "joint", "range": "ytd"},
            {"owner": "bob", "range": "ytd"},
            "owner must be all, joint or a person id",
        ),
        (
            "scope",
            {"owner": 2, "range": "all"},
            {"owner": 2, "range": "5y"},
            "range must be one of all, 1y, ytd",
        ),
        (
            "scope",
            {"owner": "all", "range": "1y"},
            {"owner": "all"},
            "must be an object with owner and range",
        ),
        (
            "palette_recents",
            ["nav:/", "action:refresh-prices"],
            ["x"] * (PALETTE_RECENTS_MAX + 1),
            "at most 8",
        ),
        ("palette_recents", [], [1, 2], "at most 8"),
    ],
)
def test_validate_pref_normalizes_good_values_and_names_the_bad_ones(key, good, bad, message):
    assert validate_pref(key, good) == good
    with pytest.raises(PrefValueError, match=re.escape(message)):
        validate_pref(key, bad)


def test_validate_pref_refuses_the_wrong_shape_and_unknown_keys():
    with pytest.raises(PrefValueError):
        validate_pref("theme", 3)
    with pytest.raises(PrefValueError):
        validate_pref("scope", {"owner": True, "range": "1y"})  # a bool is not a person id
    with pytest.raises(PrefValueError):
        validate_pref("scope", {"owner": 0, "range": "1y"})
    with pytest.raises(KeyError):
        validate_pref("currency_style", "compact")
