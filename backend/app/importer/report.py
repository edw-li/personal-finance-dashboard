"""Import report — the single shape behind the CLI printer and the API response."""

from pydantic import BaseModel, Field

SAMPLE_CAP = 50

SHEET_KEYS = (
    "reference_data",
    "positions",
    "portfolio",
    "net_worth",
    "spending",
    "taxes",
    "espp",
    "paycheck",
    "focal_history",
)


class EntityCounts(BaseModel):
    creates: int = 0
    updates: int = 0
    skips: int = 0
    deletes: int = 0


class SheetReport(BaseModel):
    entities: dict[str, EntityCounts] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    samples: list[str] = Field(default_factory=list)
    samples_truncated: int = 0

    def counts(self, entity: str) -> EntityCounts:
        return self.entities.setdefault(entity, EntityCounts())

    def add_sample(self, text: str) -> None:
        if len(self.samples) < SAMPLE_CAP:
            self.samples.append(text)
        else:
            self.samples_truncated += 1


class ImportReport(BaseModel):
    dry_run: bool
    applied: bool = False
    sheets: dict[str, SheetReport]
    # The restore point an apply saved before its first write (2026-09-23 spec §B3). Set
    # whenever the apply got past the parse — `applied` false included, when an applier then
    # reported errors and the apply rolled back: the point was committed first and stays on
    # the volume either way. None on a dry run, and when parse errors stopped the import
    # before anything was saved. (An applier that RAISES answers 500 with no report at all;
    # its point is still listed in Settings › Data › Restore.)
    restore_point: str | None = None

    @classmethod
    def new(cls, dry_run: bool) -> "ImportReport":
        return cls(dry_run=dry_run, sheets={key: SheetReport() for key in SHEET_KEYS})

    @property
    def has_errors(self) -> bool:
        return any(sheet.errors for sheet in self.sheets.values())

    def render_text(self) -> str:
        lines = [f"dry_run={self.dry_run} applied={self.applied}"]
        for key, sheet in self.sheets.items():
            lines.append(f"\n== {key} ==")
            for entity, counts in sheet.entities.items():
                lines.append(
                    f"  {entity}: +{counts.creates} ~{counts.updates} "
                    f"={counts.skips} -{counts.deletes}"
                )
            for warning in sheet.warnings:
                lines.append(f"  WARN: {warning}")
            for error in sheet.errors:
                lines.append(f"  ERROR: {error}")
            for sample in sheet.samples:
                lines.append(f"  {sample}")
            if sheet.samples_truncated:
                lines.append(f"  ... and {sheet.samples_truncated} more changes")
        return "\n".join(lines)
