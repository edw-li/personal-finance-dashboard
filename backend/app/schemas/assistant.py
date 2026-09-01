"""Assistant vertical schemas (2026-09-01 spec §3–§5)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class AssistantKeyStatus(BaseModel):
    configured: bool
    source: Literal["env", "override"] | None


class AssistantSettingsOut(BaseModel):
    key: AssistantKeyStatus
    default_model: str


class AssistantSettingsUpdate(BaseModel):
    # Tri-state api_key (read via model_fields_set): absent = unchanged, null or blank =
    # clear the override (fall back to env), non-blank string = set.
    api_key: str | None = None
    default_model: str | None = None


class AssistantModelOut(BaseModel):
    key: str
    label: str
    available: bool
    supports_tools: bool
    default: bool


class AssistantModelsOut(BaseModel):
    configured: bool
    key_source: Literal["env", "override"] | None
    # true = the catalog answered 200; false = key rejected or catalog unreachable;
    # null = no key configured (nothing was probed).
    key_ok: bool | None
    checked_at: datetime | None
    models: list[AssistantModelOut]


class ChatContextIn(BaseModel):
    route: str = Field(max_length=100)
    search: dict[str, str] = Field(default_factory=dict)
    view: dict[str, str | int | None] = Field(default_factory=dict)


class ChatMessageIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatIn(BaseModel):
    model: str
    context: ChatContextIn
    # The client sends its transcript tail; 20 × 8k chars bounds the upstream bill.
    messages: list[ChatMessageIn] = Field(max_length=20)


class PreviewIn(BaseModel):
    context: ChatContextIn


class PreviewSectionOut(BaseModel):
    name: str
    rows: int


class PreviewOut(BaseModel):
    sections: list[PreviewSectionOut]
