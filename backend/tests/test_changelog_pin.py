"""The change-log's hand-maintained path list (2026-09-03 data-lifecycle spec §9), pinned
the way EXPORTED_TABLES is: every route in the money-bearing routers that commits must
either be listed as LOGGED (and commit THROUGH its ChangeBatch) or be named EXEMPT with a
reason. A new write path lands here red until someone decides — that decision is the
feature.

`taxes.py` joined the list on 2026-09-09: its inputs PUT became change-logged so the
Data-health card's §199A repair could offer Undo, and the four routes beside it are named
EXEMPT rather than left unlisted, so the next person to touch one has to decide about it
too."""

import ast
from pathlib import Path

API = Path(__file__).resolve().parents[1] / "app" / "api"

LOGGED: dict[str, set[str]] = {
    "net_worth.py": {
        "create_account",
        "update_account",
        "delete_account",
        "put_month",
        "delete_month",
    },
    "spending.py": {
        "create_category",
        "update_category",
        "delete_category",
        "put_category_budget",
        "seed_budgets",
        "delete_category_budget",
        "put_month",
        "delete_month",
    },
    # The Data-health card repairs a year's itemized total through this route (2026-09-09
    # taxes spec 4h), and a repair that rewrites money has to be undoable.
    "taxes.py": {"put_inputs"},
}
# module -> {function: reason}. An exempt route still commits directly; the reason says
# why that is the right answer for now, not that nobody looked.
EXEMPT: dict[str, dict[str, str]] = {
    "taxes.py": {
        "update_year": "sets one enum on a year row — no money moves, and the status is "
        "visible on the page it is set from",
        "delete_year": "removes a whole year vertical through an ON DELETE CASCADE, which "
        "a row-image undo cannot replay — a snapshot restore is the exit",
        "put_brackets": "replaces a jurisdiction's rate table wholesale; the tables are "
        "reference data the user retypes from the IRS/FTB, not their own figures",
        "clone_brackets": "copies those same tables into another filing status, and refuses "
        "when the target already has rows — the undo is a second clone",
    }
}


def _committing_functions(source: str):
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.AsyncFunctionDef | ast.FunctionDef):
            body = ast.get_source_segment(source, node) or ""
            if "db.commit(" in body or "batch.commit(" in body:
                yield node.name, body


def test_every_write_path_in_the_two_routers_is_logged_or_exempt():
    for module, expected in LOGGED.items():
        source = (API / module).read_text(encoding="utf-8")
        seen: set[str] = set()
        for name, body in _committing_functions(source):
            seen.add(name)
            if name in EXEMPT.get(module, {}):
                continue
            assert name in expected, f"{module}:{name} commits but is neither logged nor exempt"
            assert "batch.commit(" in body and "db.commit(" not in body, (
                f"{module}:{name} must commit through its ChangeBatch, not db.commit()"
            )
        assert expected <= seen, (
            f"{module}: listed paths missing or no longer writing: {expected - seen}"
        )


def test_exempt_entries_name_a_reason():
    for module, entries in EXEMPT.items():
        for name, reason in entries.items():
            assert reason.strip(), f"{module}:{name} is exempt without a reason"
