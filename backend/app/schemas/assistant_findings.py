import json
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.metrics import MetricEvidence


class EvidenceBundle(BaseModel):
    title: str
    month: date | None
    summary_text: str
    metrics: list[MetricEvidence]
    as_of: datetime
    context: dict[str, Any]
    receipt: str


class FindingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1, max_length=32000)
    model_used: str | None = Field(default=None, max_length=60)
    context: dict[str, Any]
    evidence: list[MetricEvidence] = Field(max_length=100)
    evidence_as_of: datetime
    receipt: str = Field(min_length=1, max_length=2048)

    @field_validator("title", "content")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value

    @field_validator("context")
    @classmethod
    def bounded_context(cls, value: dict) -> dict:
        if len(json.dumps(value, allow_nan=False)) > 32000:
            raise ValueError("saved source context is too large")
        return value


class FindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    content: str
    model_used: str | None
    context: dict[str, Any]
    evidence: list[MetricEvidence]
    evidence_as_of: datetime
    created_at: datetime
