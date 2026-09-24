"""MetricEvidence.completeness gains "provisional" (2026-09-23 spec §0.4(e)): a receipt for
balances recorded before their date says so (T1, T10)."""

import pytest
from pydantic import ValidationError

from app.schemas.metrics import MetricEvidence


def evidence(completeness: str) -> MetricEvidence:
    return MetricEvidence(
        id="net_worth_change",
        label="Net-worth change",
        definition="The change between two snapshots.",
        value=None,
        completeness=completeness,
        source_link="/net-worth",
        source_label="Net worth",
    )


def test_provisional_is_a_completeness():
    assert evidence("provisional").completeness == "provisional"


def test_the_vocabulary_is_still_closed():
    with pytest.raises(ValidationError):
        evidence("roughly")
