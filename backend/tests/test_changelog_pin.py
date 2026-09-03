"""The change-log's hand-maintained path list (2026-09-03 data-lifecycle spec §9), pinned
the way EXPORTED_TABLES is: every route in the two money-bearing routers that commits must
either be listed as LOGGED (and commit THROUGH its ChangeBatch) or be named EXEMPT with a
reason. A new write path lands here red until someone decides — that decision is the
feature. Exempt today: nothing."""

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
        "delete_category_budget",
        "put_month",
        "delete_month",
    },
}
EXEMPT: dict[str, dict[str, str]] = {}  # module -> {function: reason}


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
