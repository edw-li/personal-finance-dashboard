"""paycheck_pace boundaries and coverage tiers (2026-08-27 spec §4.5 / §7).

A plain object stands in for the ORM row — the module takes anything with the profile's
columns (paycheck_calc's contract), which is what keeps it pure and this file DB-free.

The tone boundaries are the reason this file exists: warn at ratio >= 0.95, over at
> 1.0, and both judged on the QUANTIZED (4 dp) ratio so the verdict can never contradict
the percentage rendered beside it.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.limit_keys import (
    LIMIT_401K_ELECTIVE,
    LIMIT_415C_TOTAL,
    LIMIT_ESPP_423,
    LIMIT_HSA_FAMILY,
    LIMIT_HSA_SELF,
)
from app.services.limit_check import employer_hsa, employer_match, paycheck_pace
from app.services.pace_walk import Walked


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
    match_rate_1: Decimal = Decimal("0")
    match_band_1: Decimal = Decimal("0")
    match_rate_2: Decimal = Decimal("0")
    match_band_2: Decimal = Decimal("0")
    hsa_employer_annual: Decimal = Decimal("0")
    hsa_employer_per_dependent: Decimal = Decimal("0")
    hsa_dependents: int = 0


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


POLICY = {
    "match_rate_1": Decimal("1"),
    "match_band_1": Decimal("6000.00"),
    "match_rate_2": Decimal("0.5"),
    "match_band_2": Decimal("11000.00"),
}


def test_employer_match_golden():
    # 100 % of the first 6,000 + 50 % of the next 11,000 = 6,000 + 5,500.
    assert employer_match(FakeProfile(**POLICY), Decimal("24500.00"), None) == Decimal("11500.00")
    # Deferrals past the end of the second band earn nothing more...
    assert employer_match(FakeProfile(**POLICY), Decimal("50000.00"), None) == Decimal("11500.00")
    # ...and inside the first band the match simply follows the money.
    assert employer_match(FakeProfile(**POLICY), Decimal("2500.00"), None) == Decimal("2500.00")
    assert employer_match(FakeProfile(), Decimal("24500.00"), None) == Decimal("0")


def test_employer_match_caps_the_elective_at_the_402g_limit():
    """Payroll stops deferrals at the limit and the match follows actual contributions —
    13 % of 188,930 is 24,560.90, but only 24,500 of it is ever deferred."""
    p = FakeProfile(annual_salary=Decimal("188930.00"), trad_401k_pct=Decimal("0.13"), **POLICY)
    elective = p.trad_401k_pct * p.annual_salary
    assert employer_match(p, elective, Decimal("24500.00")) == Decimal("11500.00")


def test_total_additions_includes_the_match_and_renames_the_row():
    profile = FakeProfile(
        annual_salary=Decimal("188930.00"),
        trad_401k_pct=Decimal("0.13"),
        after_tax_401k_pct=Decimal("0.03"),
        **POLICY,
    )
    limits = {LIMIT_401K_ELECTIVE: Decimal("24500.00"), LIMIT_415C_TOTAL: Decimal("72000.00")}
    row = by_key(paycheck_pace(profile, limits, "none"))[LIMIT_415C_TOTAL]
    assert row.annualized == Decimal("41667.90")  # 24,500 capped + 5,667.90 + 11,500
    assert row.employer_match == Decimal("11500.00")
    assert row.ratio == Decimal("0.5787")
    assert row.tone == "ok"
    assert row.label == "415(c) total additions (incl. employer match)"


def test_no_policy_keeps_todays_caveat_and_a_null_match():
    row = by_key(paycheck_pace(FakeProfile(), {}, "none"))[LIMIT_415C_TOTAL]
    assert row.label == "415(c) total additions (excludes employer match)"
    assert row.employer_match is None


def test_a_policy_that_earns_nothing_this_year_still_renames_the_row():
    """Bands are the POLICY; the match is this year's pace. Somebody deferring nothing has
    the first and not the second — the label says one, `employer_match` the other."""
    row = by_key(paycheck_pace(FakeProfile(trad_401k_pct=Decimal("0"), **POLICY), {}, "none"))[
        LIMIT_415C_TOTAL
    ]
    assert row.label == "415(c) total additions (incl. employer match)"
    assert row.employer_match is None


def test_every_row_carries_the_default_measure_and_no_espp_extras():
    for item in paycheck_pace(FakeProfile(espp_pct=Decimal("0.11")), {}, "none"):
        assert item.measure == "annualized"
        assert item.soft_limit is None and item.soft_ratio is None
        assert item.halves is None and item.window_label is None
        assert item.current_rate is None


# The user's real policy: 2,000 a year for self-only coverage, deposited in January, plus
# 500 for each additional covered individual.
EMPLOYER_HSA = {
    "hsa_employer_annual": Decimal("2000.00"),
    "hsa_employer_per_dependent": Decimal("500.00"),
}


def test_employer_hsa_golden():
    # Self-only: the flat deposit, with no additional individual to add for.
    assert employer_hsa(FakeProfile(**EMPLOYER_HSA), "self") == Decimal("2000.00")
    # A family of three: the employee plus two more heads at 500 each.
    profile = FakeProfile(hsa_dependents=2, **EMPLOYER_HSA)
    assert employer_hsa(profile, "family") == Decimal("3000.00")
    # The SAME row under self-only coverage: it covers nobody else, so the count is ignored
    # rather than paid for (review decision 2026-09-07).
    assert employer_hsa(profile, "self") == Decimal("2000.00")
    # No HDHP is no deposit — the policy is real, the coverage is not.
    assert employer_hsa(profile, "none") == Decimal("0")
    # A hand-edited coverage string degrades to silence, exactly as the row does.
    assert employer_hsa(profile, "hdhp") == Decimal("0")
    assert employer_hsa(FakeProfile(), "self") == Decimal("0")


def test_hsa_row_adds_the_employer_deposit_and_names_it():
    """100 x 24 of the user's own money reaches 2,400 of a 4,400 cap; the employer's 2,000
    January deposit is what actually fills it."""
    profile = FakeProfile(hsa_per_check=Decimal("100.00"), **EMPLOYER_HSA)
    row = by_key(paycheck_pace(profile, {LIMIT_HSA_SELF: Decimal("4400.00")}, "self"))[
        LIMIT_HSA_SELF
    ]
    assert row.annualized == Decimal("4400.00")
    assert row.ratio == Decimal("1.0000")
    assert row.tone == "warn"
    assert row.label == "HSA — self-only (incl. employer)"
    assert row.employer_hsa == Decimal("2000.00")


def test_hsa_row_adds_a_per_head_deposit_for_each_additional_individual():
    profile = FakeProfile(hsa_per_check=Decimal("100.00"), hsa_dependents=2, **EMPLOYER_HSA)
    row = by_key(paycheck_pace(profile, {LIMIT_HSA_FAMILY: Decimal("8750.00")}, "family"))[
        LIMIT_HSA_FAMILY
    ]
    # 2,400 deferred + (2,000 + 500 x 2) deposited.
    assert row.annualized == Decimal("5400.00")
    assert row.employer_hsa == Decimal("3000.00")
    assert row.ratio == Decimal("0.6171")
    assert row.tone == "ok"


def test_a_policy_without_coverage_still_emits_no_hsa_row():
    """'none' is "no HDHP": neither cap applies, so there is nothing for the deposit to
    count against either."""
    profile = FakeProfile(hsa_per_check=Decimal("150.00"), **EMPLOYER_HSA)
    items = by_key(paycheck_pace(profile, {LIMIT_HSA_SELF: Decimal("4400.00")}, "none"))
    assert LIMIT_HSA_SELF not in items
    assert LIMIT_HSA_FAMILY not in items


def test_no_employer_policy_keeps_todays_hsa_label_and_a_null_deposit():
    profile = FakeProfile(hsa_per_check=Decimal("150.00"))
    row = by_key(paycheck_pace(profile, {LIMIT_HSA_SELF: Decimal("4400.00")}, "self"))[
        LIMIT_HSA_SELF
    ]
    assert row.annualized == Decimal("3600.00")
    assert row.label == "HSA — self-only"
    assert row.employer_hsa is None


# Edward's 2026 walked to 2026-09-07 (test_pace_walk's golden), as `paycheck_pace` receives it.
WALKED = Walked(
    so_far={
        "elective": Decimal("16373.93"),
        "after_tax": Decimal("3778.60"),
        "hsa_employee": Decimal("1600.00"),
        "espp": Decimal("13933.59"),
    },
    projected={
        "elective": Decimal("24560.90"),
        "after_tax": Decimal("5667.90"),
        "hsa_employee": Decimal("2400.00"),
        "espp": Decimal("21490.79"),
    },
    basis="paydays",
    backfilled_from=None,
    first_payday_passed=True,
)


def test_a_walked_elective_row_reads_so_far_against_the_projection():
    """The 2026-08-27 annualization said "a year at this rate", which reads as a lie in
    September. The walk answers both halves of the question at once."""
    items = by_key(
        paycheck_pace(FakeProfile(), {LIMIT_401K_ELECTIVE: Decimal("24500.00")}, "none", WALKED)
    )
    row = items[LIMIT_401K_ELECTIVE]
    assert row.so_far == Decimal("16373.93")
    assert row.annualized == Decimal("24560.90")
    # The verdict stays on the PROJECTION: the strip's question is "will this election hit
    # the cap", not "has it yet".
    assert row.ratio == Decimal("1.0025")
    assert row.tone == "over"


def test_a_walked_total_additions_row_matches_the_match_at_each_figure():
    profile = FakeProfile(**POLICY)
    limits = {LIMIT_401K_ELECTIVE: Decimal("24500.00"), LIMIT_415C_TOTAL: Decimal("72000.00")}
    row = by_key(paycheck_pace(profile, limits, "none", WALKED))[LIMIT_415C_TOTAL]
    # 24,500 capped + 5,667.90 after-tax + the full 11,500 match.
    assert row.annualized == Decimal("41667.90")
    # So far: 16,373.93 deferred + 3,778.60 after-tax + 6,000 + 50 % of the next 10,373.93.
    assert row.so_far == Decimal("31339.50")
    # The FIGURE beside the label is the year's match, not the part of it already earned —
    # it qualifies the projection the meter is judged on.
    assert row.employer_match == Decimal("11500.00")
    assert row.label == "415(c) total additions (incl. employer match)"


def test_a_walked_hsa_row_counts_the_january_deposit_once_it_has_landed():
    """The row that started this: 2,400 of 4,400 in September looked like a shortfall. It is
    two thirds of a year of deferrals — and the employer's January 2,000 is already in."""
    profile = FakeProfile(hsa_per_check=Decimal("100.00"), **EMPLOYER_HSA)
    row = by_key(paycheck_pace(profile, {LIMIT_HSA_SELF: Decimal("4400.00")}, "self", WALKED))[
        LIMIT_HSA_SELF
    ]
    assert row.so_far == Decimal("3600.00")
    assert row.annualized == Decimal("4400.00")
    assert row.ratio == Decimal("1.0000")
    assert row.tone == "warn"
    assert row.employer_hsa == Decimal("2000.00")
    assert row.label == "HSA — self-only (incl. employer)"


def test_the_deposit_waits_for_the_years_first_payday():
    """Read on January 2nd, nothing has been deposited yet — the projection still counts it."""
    early = Walked(
        so_far=dict.fromkeys(WALKED.so_far, Decimal("0.00")),
        projected=WALKED.projected,
        basis="paydays",
        backfilled_from=None,
        first_payday_passed=False,
    )
    profile = FakeProfile(hsa_per_check=Decimal("100.00"), **EMPLOYER_HSA)
    row = by_key(paycheck_pace(profile, {LIMIT_HSA_SELF: Decimal("4400.00")}, "self", early))[
        LIMIT_HSA_SELF
    ]
    assert row.so_far == Decimal("0.00")
    assert row.annualized == Decimal("4400.00")


def test_an_unwalked_row_answers_exactly_as_it_did_before_the_walk():
    """The pure callers hand over no walk, and their figure is still "a year at this rate" —
    with no past to point at, so_far is null rather than a fabricated zero."""
    profile = FakeProfile(hsa_per_check=Decimal("100.00"), **EMPLOYER_HSA)
    items = paycheck_pace(profile, {LIMIT_HSA_SELF: Decimal("4400.00")}, "self")
    assert [item.so_far for item in items] == [None, None, None]
    assert by_key(items)[LIMIT_HSA_SELF].annualized == Decimal("4400.00")


def walked(**over) -> Walked:
    fields = {
        "so_far": WALKED.so_far,
        "projected": WALKED.projected,
        "basis": "paydays",
        "backfilled_from": None,
        "first_payday_passed": True,
    }
    fields.update(over)
    return Walked(**fields)


def test_every_walked_row_carries_the_walks_backfill_caveat():
    """A new hire's January paydays borrow the earliest profile, and each row the walk feeds
    says so — the caveat belongs to the FIGURE, not to the ESPP row alone."""
    profile = FakeProfile(hsa_per_check=Decimal("100.00"), **EMPLOYER_HSA)
    limits = {LIMIT_HSA_SELF: Decimal("4400.00")}
    items = paycheck_pace(profile, limits, "self", walked(backfilled_from=date(2026, 3, 1)))
    assert [item.backfilled_from for item in items] == [date(2026, 3, 1)] * 3
    # A timeline that covers the whole window borrowed nothing, and neither does an unwalked
    # row — which has no window to have borrowed in.
    assert [item.backfilled_from for item in paycheck_pace(profile, limits, "self", walked())] == [
        None
    ] * 3
    assert [item.backfilled_from for item in paycheck_pace(profile, limits, "self")] == [None] * 3


def test_a_try_it_knob_cannot_rewrite_the_employer_legs_already_paid():
    """A scenario prices the REST of the year: the past was paid under the stored policy, so
    the so-far match and the January deposit follow the base profile (spec §2.5)."""
    base = FakeProfile(hsa_per_check=Decimal("100.00"), **POLICY, **EMPLOYER_HSA)
    scenario = FakeProfile(
        hsa_per_check=Decimal("100.00"),
        match_rate_1=Decimal("2"),
        match_band_1=Decimal("6000.00"),
        match_rate_2=Decimal("1"),
        match_band_2=Decimal("11000.00"),
        hsa_employer_annual=Decimal("4000.00"),
        hsa_employer_per_dependent=Decimal("500.00"),
    )
    limits = {LIMIT_401K_ELECTIVE: Decimal("24500.00"), LIMIT_HSA_SELF: Decimal("4400.00")}
    rows = by_key(paycheck_pace(scenario, limits, "self", WALKED, base))
    # 415(c): the projection earns the doubled match (2 x 6,000 + 1 x 11,000), the past keeps
    # the 11,186.97 the stored policy actually paid on 16,373.93 of deferrals.
    assert rows[LIMIT_415C_TOTAL].employer_match == Decimal("23000.00")
    assert rows[LIMIT_415C_TOTAL].annualized == Decimal("53167.90")
    assert rows[LIMIT_415C_TOTAL].so_far == Decimal("31339.50")
    # HSA: 4,000 deposited under the knob, 2,000 under the policy that actually deposited.
    assert rows[LIMIT_HSA_SELF].employer_hsa == Decimal("4000.00")
    assert rows[LIMIT_HSA_SELF].annualized == Decimal("6400.00")
    assert rows[LIMIT_HSA_SELF].so_far == Decimal("3600.00")


def test_without_a_base_the_row_prices_both_figures_from_the_profile_in_hand():
    """The GET hands over one row for both jobs, and nothing changes for it."""
    profile = FakeProfile(hsa_per_check=Decimal("100.00"), **POLICY, **EMPLOYER_HSA)
    limits = {LIMIT_401K_ELECTIVE: Decimal("24500.00"), LIMIT_HSA_SELF: Decimal("4400.00")}
    assert by_key(paycheck_pace(profile, limits, "self", WALKED)) == by_key(
        paycheck_pace(profile, limits, "self", WALKED, profile)
    )
