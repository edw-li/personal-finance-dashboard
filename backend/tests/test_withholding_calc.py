from datetime import date
from decimal import Decimal

from app.services.withholding_calc import (
    WithholdingEstimate,
    additional_medicare_tier,
    check_dates,
    estimate,
)

D = Decimal

MEDICARE = [(D("0.0145"), D("0"))]
SS = [(D("0.062"), D("0")), (D("0"), D("168600"))]
SDI = [(D("0.011"), D("0"))]
ZERO_D = D("0")

# Module-level singletons because ruff's B008 bans call expressions in argument defaults;
# Decimal is immutable, so these are the same values the defaults would have held.
WITHHOLDING = D("0.30")
TRAD = D("0.05")
DENTAL_VISION = D("50")
HSA = D("100")


class Profile:
    def __init__(
        self,
        effective,
        salary,
        periods=24,
        withholding=WITHHOLDING,
        trad=TRAD,
        dv=DENTAL_VISION,
        hsa=HSA,
    ):
        self.effective_date = effective
        self.annual_salary = salary
        self.pay_periods_per_year = periods
        self.trad_401k_pct = trad
        self.roth_401k_pct = D("0")
        self.after_tax_401k_pct = D("0")
        self.espp_pct = D("0")
        self.withholding_pct = withholding
        self.dental_vision_per_check = dv
        self.hsa_per_check = hsa


def test_check_dates_grid_p24():
    dates = check_dates(2026, 24)
    assert len(dates) == 24
    assert dates[0] == date(2026, 1, 16)  # ceil(365/24) = 16
    assert dates[1] == date(2026, 1, 31)  # ceil(730/24) = 31
    assert dates[-1] == date(2026, 12, 31)  # ceil(24*365/24) = 365


def test_salary_leg_single_profile():
    # gross 10000; taxable 10000 - (500 + 50 + 100) = 9350; withholding/check 2805.
    # July 1 is day 182; checks land on ceil(15.2083 x i): i=11 -> day 168, i=12 -> day 183.
    result = estimate(
        year=2026,
        today=date(2026, 7, 1),
        profiles=[Profile(date(2025, 1, 1), D("240000"))],
        past_vests=[],
        future_vests=[],
        medicare=MEDICARE,
        social_security=SS,
        disability=SDI,
    )
    assert result.checks_elapsed == 11
    assert result.checks_total == 24
    assert result.salary_ytd == D("30855.00")  # 11 x 2805
    assert result.salary_projected == D("67320.00")  # 24 x 2805


def test_salary_leg_profile_switch_mid_year():
    # Raise effective Jul 1: checks implied on/after Jul 1 use the new profile.
    result = estimate(
        year=2026,
        today=date(2026, 12, 31),
        profiles=[Profile(date(2025, 1, 1), D("240000")), Profile(date(2026, 7, 1), D("360000"))],
        past_vests=[],
        future_vests=[],
        medicare=MEDICARE,
        social_security=SS,
        disability=SDI,
    )
    # New gross 15000; taxable 15000 - (750 + 50 + 100) = 14100; withholding 4230.
    # Checks 1-11 (days 16..168) old profile; checks 12-24 (days 183..365) new: 11x2805 + 13x4230.
    assert result.salary_projected == D("85845.00")


def test_vest_legs_supplemental_and_marginal_fica():
    # One past vest: 100 sh @ 500 = 50000 income. Salary gross YTD: 11 checks x 10000 = 110000.
    # Supplemental: 50000 x 0.3223 = 16115. Marginal FICA on top of 110000:
    #   medicare 50000 x 0.0145 = 725
    #   ss: min(160000,168600)x0.062 - 110000x0.062 = 9920 - 6820 = 3100
    #   sdi 50000 x 0.011 = 550                      -> 4375 total
    result = estimate(
        year=2026,
        today=date(2026, 7, 1),
        profiles=[Profile(date(2025, 1, 1), D("240000"))],
        past_vests=[(date(2026, 6, 17), 100, D("500"))],
        future_vests=[(date(2026, 9, 16), 100, D("520"))],
        medicare=MEDICARE,
        social_security=SS,
        disability=SDI,
    )
    assert result.vest_income_ytd == D("50000.00")
    assert result.vest_supplemental_ytd == D("16115.00")
    assert result.vest_fica_ytd == D("4375.00")
    # Projection adds the future vest at its given price (52000) on top of full-year salary
    # gross 240000: ss cap bites — full salary gross = 240000; vest income total = 102000
    #   FICA(240000) ss = 168600x0.062 = 10453.20 (capped); FICA(342000) ss = 10453.20 -> marginal 0
    #   medicare marginal = 102000 x 0.0145 = 1479; sdi marginal = 102000 x 0.011 = 1122
    assert result.vest_income_projected == D("102000.00")
    assert result.vest_supplemental_projected == D("32874.60")  # 102000 x 0.3223
    assert result.vest_fica_projected == D("2601.00")  # 1479 + 1122 + 0


def test_no_profiles_degrades_with_warning():
    result = estimate(
        year=2026,
        today=date(2026, 7, 1),
        profiles=[],
        past_vests=[],
        future_vests=[],
        medicare=MEDICARE,
        social_security=SS,
        disability=SDI,
    )
    assert result.salary_ytd == D("0.00")
    assert result.checks_total == 0
    assert any("paycheck profile" in w for w in result.warnings)


# --- extra pins (self-review): grid edges, cadence choice, the early-checks fallback ---


def test_check_dates_leap_year_and_biweekly_still_end_dec_31():
    leap = check_dates(2028, 24)
    assert len(leap) == 24
    assert leap[0] == date(2028, 1, 16)  # ceil(366/24) = 16
    assert leap[-1] == date(2028, 12, 31)  # ceil(24*366/24) = 366
    biweekly = check_dates(2026, 26)
    assert len(biweekly) == 26
    assert biweekly[0] == date(2026, 1, 15)  # ceil(365/26) = 15
    assert biweekly[-1] == date(2026, 12, 31)


def test_grid_follows_the_current_profiles_cadence_not_the_old_one():
    # Old profile is biweekly (P=26, gross 8000 -> taxable 7450 -> withholding 2235); the
    # CURRENT one is semi-monthly, so the grid is 24 checks and the old rate is applied to
    # the 11 pre-Jul-1 slots of THAT grid.
    result = estimate(
        year=2026,
        today=date(2026, 12, 31),
        profiles=[
            Profile(date(2026, 7, 1), D("360000")),
            Profile(date(2025, 1, 1), D("208000"), periods=26),
        ],
        past_vests=[],
        future_vests=[],
        medicare=MEDICARE,
        social_security=SS,
        disability=SDI,
    )
    assert isinstance(result, WithholdingEstimate)
    assert result.warnings == []
    assert result.checks_total == 24
    assert result.salary_projected == D("79575.00")  # 11 x 2235 + 13 x 4230
    assert result.salary_gross_projected == D("283000.00")  # 11 x 8000 + 13 x 15000


def test_first_profile_covers_earlier_checks_with_a_warning():
    # Profile effective Mar 1 but the grid opens Jan 16: those checks fall back to it.
    # today == the final check date, so every check counts as elapsed (boundary inclusive).
    result = estimate(
        year=2026,
        today=date(2026, 12, 31),
        profiles=[Profile(date(2026, 3, 1), D("240000"))],
        past_vests=[],
        future_vests=[],
        medicare=MEDICARE,
        social_security=SS,
        disability=SDI,
    )
    assert result.checks_elapsed == 24
    assert result.salary_ytd == D("67320.00")  # all 24 checks at 2805
    assert any("effective date" in w for w in result.warnings)


def test_profile_effective_later_this_year_still_projects_a_full_year():
    # today precedes every check AND every profile: `current` is empty and falls back to the
    # earliest profile, so the year projects in full while YTD stays 0.
    result = estimate(
        year=2026,
        today=date(2026, 1, 5),
        profiles=[Profile(date(2026, 3, 1), D("240000"))],
        past_vests=[],
        future_vests=[(date(2026, 9, 16), 100, D("520"))],
        medicare=MEDICARE,
        social_security=SS,
        disability=SDI,
    )
    assert result.checks_elapsed == 0
    assert result.checks_total == 24
    assert result.salary_ytd == D("0.00")
    assert result.salary_gross_ytd == D("0.00")
    assert result.salary_projected == D("67320.00")
    assert result.vest_fica_ytd == D("0.00")


def test_vests_without_any_profile_still_compute_against_a_zero_gross():
    # The degraded shape the router hits when every stored profile is fenced out: the salary
    # leg zeroes and warns, but the vest legs are still real money and must be estimated —
    # against a gross of 0, so the whole vest income sits in the FIRST FICA bracket.
    result = estimate(
        year=2026,
        today=date(2026, 7, 1),
        profiles=[],
        past_vests=[(date(2026, 6, 17), 100, D("500"))],
        future_vests=[(date(2026, 9, 16), 100, D("520"))],
        medicare=MEDICARE,
        social_security=SS,
        disability=SDI,
    )
    assert result.salary_ytd == D("0.00")
    assert result.salary_gross_projected == D("0.00")
    assert (result.checks_elapsed, result.checks_total) == (0, 0)
    assert any("paycheck profile" in w for w in result.warnings)
    assert result.vest_income_ytd == D("50000.00")
    assert result.vest_supplemental_ytd == D("16115.00")  # 50000 x 0.3223
    # 50000 x (0.0145 + 0.062 + 0.011): nothing has used the SS cap, so it applies in full.
    assert result.vest_fica_ytd == D("4375.00")
    assert result.vest_income_projected == D("102000.00")
    assert result.vest_supplemental_projected == D("32874.60")  # 102000 x 0.3223
    # 102000 x 0.0145 + 102000 x 0.011 + 102000 x 0.062 = 1479 + 1122 + 6324.
    assert result.vest_fica_projected == D("8925.00")


def test_additional_medicare_tier_rides_the_bracket_walk():
    # Medicare with the 0.9% surtax tier at 200000; salary gross YTD 110000 + a 100000 vest
    # crosses it. medicare: (200000 x 0.0145 + 10000 x 0.0235) - 110000 x 0.0145 = 1540;
    # ss: 168600 x 0.062 (capped) - 110000 x 0.062 = 3633.20; sdi: 100000 x 0.011 = 1100.
    addl_medicare = [(D("0.0145"), D("0")), (D("0.0235"), D("200000"))]
    result = estimate(
        year=2026,
        today=date(2026, 7, 1),
        profiles=[Profile(date(2025, 1, 1), D("240000"))],
        past_vests=[(date(2026, 6, 17), 100, D("1000"))],
        future_vests=[],
        medicare=addl_medicare,
        social_security=SS,
        disability=SDI,
    )
    assert result.salary_gross_ytd == D("110000.00")
    assert result.vest_supplemental_ytd == D("32230.00")  # 100000 x 0.3223
    assert result.vest_fica_ytd == D("6273.20")  # 1540 + 3633.20 + 1100


# --- two-earner block (2026-08-26 spec §5.6) ---

# An MFJ medicare table: 1.45% base, then the 0.9% surtax folded into a 2.35% row at the
# JOINT threshold. The single table below carries the same tier at 200,000.
MEDICARE_MFJ = [(D("0.0145"), D("0")), (D("0.0235"), D("250000"))]
MEDICARE_SINGLE = [(D("0.0145"), D("0")), (D("0.0235"), D("200000"))]

PARTNER_MISSING = (
    "partner withholding not entered — their W-2 withholding counts as 0 until you enter it"
)


def run(**over):
    """`estimate` with the salary/vest legs SILENCED — these tests are about the two-earner
    block only, and `warnings` is most of what they assert on.

    Silenced, not empty: `profiles=[]` is not neutral, it raises NO_PROFILES_WARNING, which
    would sit in every list below and hide the one warning under test. One ordinary profile
    and no vests is the quiet configuration.
    """
    kwargs = dict(
        year=2026,
        today=date(2026, 7, 1),
        profiles=[Profile(date(2025, 1, 1), D("240000"))],
        past_vests=[],
        future_vests=[],
        medicare=MEDICARE,
        social_security=SS,
        disability=SDI,
    )
    kwargs.update(over)
    return estimate(**kwargs)


def test_additional_medicare_tier_is_read_off_the_stored_table():
    assert additional_medicare_tier(MEDICARE_MFJ) == (D("0.0090"), D("250000"))
    assert additional_medicare_tier(MEDICARE_SINGLE) == (D("0.0090"), D("200000"))
    # A flat table has no tier at all, and neither does an empty one.
    assert additional_medicare_tier(MEDICARE) is None
    assert additional_medicare_tier([]) is None
    # A terminal 0-rate row (the SS wage-base shape) is a CAP, not a surtax tier.
    assert additional_medicare_tier(SS) is None


def test_additional_medicare_gap_is_the_two_earner_trap_in_dollars():
    # 240k + 150k = 390k combined. Owed on a joint return: (390000 - 250000) x 0.9% = 1260.
    # Withheld by the two employers: only the 40k above ONE employer's 200k = 360. The
    # 900.00 difference is the trap: neither salary alone crosses 200k of its own employer's
    # wages far enough to cover a joint liability that starts at 250k.
    result = run(medicare=MEDICARE_MFJ, primary_wages=D("240000"), partner_wages=D("150000"))
    assert result.additional_medicare_gap == D("900.00")


def test_additional_medicare_gap_is_zero_for_one_earner_on_a_single_table():
    # The self-cancelling case, and the reason the single path needs no branch: one earner's
    # owed side and their employer's withheld side are the SAME expression.
    result = run(medicare=MEDICARE_SINGLE, primary_wages=D("390000"), partner_wages=ZERO_D)
    assert result.additional_medicare_gap == D("0.00")


def test_additional_medicare_gap_goes_negative_when_one_earner_carries_the_household():
    # 390k from one job on a JOINT table: the employer withholds above its own 200k while
    # the return only owes above 250k, so 450.00 is over-withheld. Signed, not clamped.
    result = run(medicare=MEDICARE_MFJ, primary_wages=D("390000"), partner_wages=ZERO_D)
    assert result.additional_medicare_gap == D("-450.00")


def test_additional_medicare_gap_is_zero_without_a_surtax_tier():
    result = run(medicare=MEDICARE, primary_wages=D("240000"), partner_wages=D("150000"))
    assert result.additional_medicare_gap == D("0.00")


def test_partner_withholding_sums_both_jurisdictions():
    result = run(
        medicare=MEDICARE_MFJ,
        primary_wages=D("240000"),
        partner_wages=D("150000"),
        partner_withheld_fed=D("18000"),
        partner_withheld_state=D("6000"),
    )
    assert result.partner_withheld_total == D("24000.00")
    assert result.warnings == []


def test_partner_with_wages_but_no_withholding_entered_warns_and_counts_zero():
    # Entered-not-simulated is the whole asymmetry of this leg: an empty field is a 0, and
    # a silent 0 here would understate the household's withholding without saying so.
    result = run(medicare=MEDICARE_MFJ, primary_wages=D("240000"), partner_wages=D("150000"))
    assert result.partner_withheld_total == D("0.00")
    assert result.warnings == [PARTNER_MISSING]


def test_one_entered_jurisdiction_is_enough_to_silence_the_warning():
    # Zero state withholding is a real answer (a no-income-tax state, or a W-4 that zeroed
    # it); only BOTH fields being unset means "not entered".
    result = run(
        medicare=MEDICARE_MFJ,
        primary_wages=D("240000"),
        partner_wages=D("150000"),
        partner_withheld_fed=D("18000"),
    )
    assert result.partner_withheld_total == D("18000.00")
    assert result.warnings == []


def test_no_partner_means_no_warning_and_no_partner_total():
    result = run(medicare=MEDICARE_MFJ, primary_wages=D("240000"))
    assert result.partner_withheld_total == D("0.00")
    assert result.warnings == []


def test_single_earner_defaults_leave_the_estimate_byte_identical():
    # The whole point of the defaults: the existing single-earner call site passes none of
    # the new arguments and gets exactly today's object back.
    base = estimate(
        year=2026,
        today=date(2026, 7, 1),
        profiles=[Profile(date(2025, 1, 1), D("240000"))],
        past_vests=[],
        future_vests=[],
        medicare=MEDICARE,
        social_security=SS,
        disability=SDI,
    )
    assert base.salary_ytd == D("30855.00")
    assert base.salary_projected == D("67320.00")
    assert base.partner_withheld_total == D("0.00")
    assert base.additional_medicare_gap == D("0.00")
    assert base.warnings == []
