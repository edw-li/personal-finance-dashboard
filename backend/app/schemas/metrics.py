from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.month_review import MonthReviewOut

MetricUnit = Literal["USD", "ratio", "count"]


class ExcludedMonth(BaseModel):
    month: date
    reason: str


class MetricWindow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_month: date = Field(alias="from")
    to_month: date = Field(alias="to")
    included: list[date]
    excluded: list[ExcludedMonth]
    unreviewed_history_count: int


class MetricComponent(BaseModel):
    label: str
    value: Decimal | None
    unit: MetricUnit = "USD"


class MetricEvidence(BaseModel):
    id: str
    definition_version: str = "spending-v1"
    label: str
    definition: str
    value: Decimal | None
    unit: MetricUnit = "USD"
    scope: str = "household"
    # Fraction digits after unit formatting: 7 on an exact 9dp contribution ratio
    # keeps its intentionally floored election intact when displayed as a percentage.
    display_precision: int | None = Field(default=None, ge=0, le=9, strict=True)
    window: MetricWindow | None = None
    completeness: Literal["complete", "unreviewed_history", "incomplete", "unavailable", "mixed"]
    components: list[MetricComponent] = []
    source_link: str
    source_label: str
    as_of: date | None = None
    warnings: list[str] = []


class SpendingMetricsOut(BaseModel):
    month: date | None
    input_revision: str | None
    review: MonthReviewOut | None
    metrics: list[MetricEvidence]
    comparison: MetricEvidence
    rolling: MetricEvidence
