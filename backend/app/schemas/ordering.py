"""The one request body every reorder endpoint takes (2026-09-23 drag-to-reorder spec §3.2)."""

from pydantic import BaseModel, Field


class OrderIn(BaseModel):
    """`ids` is the list's COMPLETE new order: every row the endpoint lists, each once. The
    length bounds keep a runaway body away from the permutation check; the ids themselves
    are judged there (services.ordering.check_permutation: 422 duplicate, 409 stale), so an
    unknown id reads as a stale list rather than a malformed request."""

    ids: list[int] = Field(min_length=1, max_length=10_000)
