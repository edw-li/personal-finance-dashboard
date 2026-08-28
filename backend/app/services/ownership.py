"""The household ownership grammar, in one place.

`owner=<person id>|joint`, absent = household — the query vocabulary the net-worth pages
established (2026-08-26 spec §5.2) and the portfolio pages now share. Only the PARSE lives
here; each vertical builds its own clause on its own owner column, because "mine" means a
different table there.
"""

JOINT = "joint"
INT32_MAX = 2**31 - 1


def parse_owner(owner: str) -> int | None:
    """`joint` -> None (the NULL-owned rows only); a person id -> that id.

    Raises ValueError on anything else so the routers answer 422; an out-of-range id would
    otherwise reach asyncpg as an int32 overflow, i.e. a 500. `isascii()` guards the
    superscript digits that `str.isdigit()` accepts and `int()` then rejects.
    """
    if owner == JOINT:
        return None
    if not (owner.isascii() and owner.isdigit()) or not 1 <= int(owner) <= INT32_MAX:
        raise ValueError(f"owner must be a person id or {JOINT!r}")
    return int(owner)
