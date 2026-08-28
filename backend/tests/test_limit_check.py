"""paycheck_pace boundaries and coverage tiers (2026-08-27 spec §4.5 / §7).

A plain object stands in for the ORM row — the module takes anything with the profile's
columns (paycheck_calc's contract), which is what keeps it pure and this file DB-free.

The tone boundaries are the reason this file exists: warn at ratio >= 0.95, over at
> 1.0, and both judged on the QUANTIZED (4 dp) ratio so the verdict can never contradict
the percentage rendered beside it.
"""

from dataclasses import dataclass
from decimal import Decimal

from app.limit_keys import (
    LIMIT_401K_ELECTIVE,
    LIMIT_415C_TOTAL,
    LIMIT_ESPP_423,
    LIMIT_HSA_FAMILY,
    LIMIT_HSA_SELF,
)
from app.services.limit_check import paycheck_pace


@dataclass
class FakeProfile:
    annual_salary: Decimal = Decimal("100000.00")
    pay_periods_per_year: int = 24
    trad_401k_pct: Decimal = Decimal("0.100000000")
    roth_401k_pct: Decimal = Decimal("0")
    after_tax_401k_pct: Decimal = Decimal("0")
    espp_pct: Decimal = Decimal("0")
    withholding_pct: Decimal = Decimal("0.300000000")
    dental_vision_per_check: Decimal = Decimal("0")
    hsa_per_check: Decimal = Decimal("0")


def by_key(items):
    return {item.key: item for item in items}


def test_elective_deferral_sums_traditional_and_roth():
    profile = FakeProfile(
        trad_401k_pct=Decimal("0.080000000"), roth_401k_pct=Decimal("0.050000000")
    )
    item = by_key(paycheck_pace(profile, {}, "none"))[LIMIT_401K_ELECTIVE]
    assert item.annualized == Decimal("13000.00")
    assert item.label == "401(k) elective deferral"


def test_total_additions_adds_after_tax_and_names_the_match_caveat():
    profile = FakeProfile(
        trad_401k_pct=Decimal("0.080000000"),
        roth_401k_pct=Decimal("0.050000000"),
        after_tax_401k_pct=Decimal("0.030000000"),
    )
    item = by_key(paycheck_pace(profile, {}, "none"))[LIMIT_415C_TOTAL]
    assert item.annualized == Decimal("16000.00")
    # The one thing this app cannot see, said in the row's own label (spec §6).
    assert item.label == "415(c) total additions (excludes employer match)"


def test_a_missing_limit_gives_no_ratio_and_no_verdict():
    item = by_key(paycheck_pace(FakeProfile(), {}, "none"))[LIMIT_401K_ELECTIVE]
    assert item.limit is None
    assert item.ratio is None
    # 'ok' is the ABSENCE of a verdict here, not an all-clear — the UI renders a
    # call-to-action instead of a meter when `limit` is None.
    assert item.tone == "ok"


def test_ratio_is_quantized_to_four_places():
    profile = FakeProfile(trad_401k_pct=Decimal("0.100000000"))  # 10_000
    item = by_key(paycheck_pace(profile, {LIMIT_401K_ELECTIVE: Decimal("30000.00")}, "none"))[
        LIMIT_401K_ELECTIVE
    ]
    assert item.ratio == Decimal("0.3333")
    assert item.tone == "ok"


def ratio_case(annual_dollars: str, limit: str):
    """One elective-deferral row at an exact annualized figure against an exact cap."""
    profile = FakeProfile(annual_salary=Decimal(annual_dollars), trad_401k_pct=Decimal("1"))
    limits = {LIMIT_401K_ELECTIVE: Decimal(limit)}
    return by_key(paycheck_pace(profile, limits, "none"))[LIMIT_401K_ELECTIVE]


def test_boundary_0_949_is_ok():
    item = ratio_case("9490.00", "10000.00")
    assert item.ratio == Decimal("0.9490")
    assert item.tone == "ok"


def test_boundary_just_under_95_percent_is_ok():
    item = ratio_case("9499.00", "10000.00")
    assert item.ratio == Decimal("0.9499")
    assert item.tone == "ok"


def test_boundary_exactly_95_percent_warns():
    item = ratio_case("9500.00", "10000.00")
    assert item.ratio == Decimal("0.9500")
    assert item.tone == "warn"


def test_boundary_exactly_100_percent_warns_and_does_not_over():
    """`over` is strictly ABOVE the cap: contributing exactly the maximum is the goal,
    not a mistake."""
    item = ratio_case("10000.00", "10000.00")
    assert item.ratio == Decimal("1.0000")
    assert item.tone == "warn"


def test_boundary_100_1_percent_is_over():
    item = ratio_case("10010.00", "10000.00")
    assert item.ratio == Decimal("1.0010")
    assert item.tone == "over"


def test_tone_follows_the_rounded_ratio_not_the_raw_one():
    """0.94996 rounds to 0.9500 and PRINTS as 95.00 % — labelling that `ok` would put the
    verdict at odds with the number next to it (the paycheck router's displayed-net rule)."""
    item = ratio_case("9499.60", "10000.00")
    assert item.ratio == Decimal("0.9500")
    assert item.tone == "warn"


def test_hsa_coverage_self_uses_the_self_only_cap():
    profile = FakeProfile(hsa_per_check=Decimal("150.00"))
    items = by_key(
        paycheck_pace(
            profile,
            {LIMIT_HSA_SELF: Decimal("4400.00"), LIMIT_HSA_FAMILY: Decimal("8900.00")},
            "self",
        )
    )
    assert LIMIT_HSA_FAMILY not in items
    row = items[LIMIT_HSA_SELF]
    assert row.annualized == Decimal("3600.00")  # 150 x 24
    assert row.limit == Decimal("4400.00")
    assert row.label == "HSA — self-only"


def test_hsa_coverage_family_uses_the_family_cap():
    profile = FakeProfile(hsa_per_check=Decimal("150.00"))
    items = by_key(
        paycheck_pace(
            profile,
            {LIMIT_HSA_SELF: Decimal("4400.00"), LIMIT_HSA_FAMILY: Decimal("8900.00")},
            "family",
        )
    )
    assert LIMIT_HSA_SELF not in items
    assert items[LIMIT_HSA_FAMILY].limit == Decimal("8900.00")


def test_hsa_coverage_none_emits_no_hsa_row():
    profile = FakeProfile(hsa_per_check=Decimal("150.00"))
    items = by_key(paycheck_pace(profile, {LIMIT_HSA_SELF: Decimal("4400.00")}, "none"))
    assert LIMIT_HSA_SELF not in items
    assert LIMIT_HSA_FAMILY not in items


def test_an_unrecognized_coverage_string_emits_no_hsa_row():
    """A hand-edited row degrades to silence rather than guessing a tier (§6: no silent
    fallbacks, and picking one of two caps at random is the worst possible guess)."""
    profile = FakeProfile(hsa_per_check=Decimal("150.00"))
    items = by_key(paycheck_pace(profile, {LIMIT_HSA_SELF: Decimal("4400.00")}, "hdhp"))
    assert LIMIT_HSA_SELF not in items


def test_hsa_uses_the_profiles_own_cadence():
    profile = FakeProfile(hsa_per_check=Decimal("100.00"), pay_periods_per_year=26)
    items = by_key(paycheck_pace(profile, {LIMIT_HSA_SELF: Decimal("4400.00")}, "self"))
    assert items[LIMIT_HSA_SELF].annualized == Decimal("2600.00")


def test_espp_zero_percent_emits_no_row():
    items = by_key(
        paycheck_pace(
            FakeProfile(espp_pct=Decimal("0")), {LIMIT_ESPP_423: Decimal("25000")}, "none"
        )
    )
    assert LIMIT_ESPP_423 not in items


def test_espp_enrolled_measures_against_the_423_cap():
    profile = FakeProfile(espp_pct=Decimal("0.110000000"), annual_salary=Decimal("188930.00"))
    items = by_key(paycheck_pace(profile, {LIMIT_ESPP_423: Decimal("25000.00")}, "none"))
    row = items[LIMIT_ESPP_423]
    assert row.annualized == Decimal("20782.30")
    assert row.ratio == Decimal("0.8313")
    assert row.tone == "ok"


def test_row_order_is_deferral_then_total_then_hsa_then_espp():
    profile = FakeProfile(
        after_tax_401k_pct=Decimal("0.030000000"),
        espp_pct=Decimal("0.110000000"),
        hsa_per_check=Decimal("100.00"),
    )
    keys = [item.key for item in paycheck_pace(profile, {}, "family")]
    assert keys == [LIMIT_401K_ELECTIVE, LIMIT_415C_TOTAL, LIMIT_HSA_FAMILY, LIMIT_ESPP_423]


def test_an_all_zero_profile_still_reports_the_two_401k_rows():
    """Zero contributions are information — "you are putting in nothing" is a true and
    useful meter. Only the two OPT-IN rows (HSA coverage, ESPP enrolment) disappear."""
    profile = FakeProfile(trad_401k_pct=Decimal("0"))
    items = paycheck_pace(profile, {LIMIT_401K_ELECTIVE: Decimal("24500.00")}, "none")
    assert [item.key for item in items] == [LIMIT_401K_ELECTIVE, LIMIT_415C_TOTAL]
    assert items[0].annualized == Decimal("0.00")
    assert items[0].ratio == Decimal("0.0000")
    assert items[0].tone == "ok"
