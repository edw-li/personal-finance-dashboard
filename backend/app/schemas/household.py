"""Household wire shapes (2026-08-26 spec §5.1). Pinned contract — later waves
(net-worth owner views, per-person tax inputs) are written against these exact keys."""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_primary: bool


class PersonCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class PersonUpdate(BaseModel):
    """Rename only. is_primary is deliberately ABSENT: pydantic ignores unknown keys, so a
    body trying to promote a partner is a silent no-op rather than a 422 — the invariant
    belongs to ux_people_single_primary, not to request validation."""

    name: str = Field(min_length=1, max_length=80)


class MarriageDateIn(BaseModel):
    """Full-form single-field PUT: an explicit null (or an omitted key) CLEARS the stored
    date — the notes:/net_pay: null contract."""

    marriage_date: date | None = None


class MarriageDateOut(BaseModel):
    marriage_date: date | None


class HouseholdOut(BaseModel):
    people: list[PersonOut]
    marriage_date: date | None
