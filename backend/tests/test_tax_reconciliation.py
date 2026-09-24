"""The "Will I owe?" reconciliation (2026-09-23 spec §W3), pure.

No database: the router gathers the facts (each person's materialized inputs, their counted
check grid already capped at the year's limits, the vest and ESPP projections) and hands over
a PRICER — the liability at cents with some (key, person, value) replacements laid over the
stored rows. These tests stand in a pricer that records what it was asked and answers a
figure of the test's choosing, so every row, effect and flag is hand-checkable. The pricer's
real twin (the preview's adoption rule over `_engine_feed_from_rows`) is pinned against the
engine in test_withholding_api.py.
"""

from datetime import date
from decimal import Decimal

from app.services.tax_reconciliation import (
    FLAG_ABOVE,
    NEVER_RECONCILED_NOTE,
    EsppFacts,
    PaycheckFacts,
    PersonFacts,
    RsuFacts,
    cap_401k,
    cap_hsa,
    reconcile,
)

D = Decimal
LIABILITY = D("80000.00")
WITHHELD = D("100000.00")
NO_ESPP = EsppFacts(ordinary=D("0.00"), long_term=D("0.00"), short_term=D("0.00"), lots=0)


ZERO = D("0.00")  # a module singleton: ruff's B008 bans calls in argument defaults


def paycheck(
    *,
    checks=24,
    first=date(2026, 1, 16),
    gross=ZERO,
    trad=ZERO,
    hsa=ZERO,
    trad_capped_at=None,
    hsa_capped_at=None,
):
    return PaycheckFacts(
        checks=checks,
        first_check=first,
        gross=gross,
        trad_401k=trad,
        hsa=hsa,
        trad_capped_at=trad_capped_at,
        hsa_capped_at=hsa_capped_at,
    )


def person(person_id, name, *, bucket=None, paycheck=None):
    return PersonFacts(person_id=person_id, name=name, bucket=bucket or {}, paycheck=paycheck)


class Pricer:
    """Records every overlay list and answers the liability plus a per-key effect."""

    def __init__(self, effects: dict[str, Decimal] | None = None):
        self.calls: list[list[tuple]] = []
        self.effects = effects or {}

    def __call__(self, overlays):
        self.calls.append(list(overlays))
        return LIABILITY + sum((self.effects.get(key, D("0")) for key, _p, _v in overlays), D("0"))


def run(people, *, price=None, rsu=None, espp=NO_ESPP, household=None, primary_id=1, notes=()):
    return reconcile(
        people=people,
        primary_id=primary_id,
        rsu=rsu,
        espp=espp,
        household=household or {},
        liability=LIABILITY,
        withheld_projected=WITHHELD,
        price=price or Pricer(),
        notes=list(notes),
    )


EDWARD_BUCKET = {
    "pay_periods": D("20.0000"),
    "annual_salary": D("188930.0000"),
    "latest_w2_income": D("157441.6667"),
    "w2_salary_checkpoint": D("27000.0000"),
    "trad_401k_contributions": D("21965.8200"),
    "hsa_contributions": D("2300.0000"),
    "w2_stock_rsus_sold": D("120000.0000"),
}


def edward(**over):
    return person(
        1,
        "Edward",
        bucket=EDWARD_BUCKET,
        paycheck=paycheck(
            gross=D("188930.00"),
            trad=D("24500.00"),
            hsa=D("2400.00"),
            trad_capped_at=D("24500.00"),
            **over,
        ),
    )


# --- the rows ------------------------------------------------------------------------------


def test_the_salary_row_overlays_the_difference_onto_the_checkpoint():
    price = Pricer({"w2_salary_checkpoint": D("1234.56")})
    out = run([edward()], price=price)
    salary = out.rows[0]
    assert (salary.key, salary.source, salary.label) == ("salary", "paycheck", "Salary wages")
    assert (salary.person_id, salary.person_name) == (1, "Edward")
    assert salary.typed == D("184441.67")  # 20 x 188,930 / 24 + 27,000
    assert salary.projected == D("188930.00")
    assert salary.difference == D("4488.33")
    assert salary.typed_keys == ["pay_periods", "annual_salary", "w2_salary_checkpoint"]
    # The checkpoint moves by the FULL-precision difference, so the overlaid wages land exactly
    # on the projection: 157,441.6667 + 31,488.3333 = 188,930.0000.
    assert [("w2_salary_checkpoint", 1, D("31488.3333"))] in price.calls
    assert salary.tax_effect == D("1234.56")
    assert salary.facts.typed_pay_periods == D("20")
    assert salary.facts.typed_checkpoint == D("27000.00")
    assert (salary.facts.projected_checks, salary.facts.projected_from) == (24, date(2026, 1, 16))


def test_the_401k_row_reports_the_cap_and_replaces_the_key():
    price = Pricer({"trad_401k_contributions": D("-600.00")})
    trad = next(row for row in run([edward()], price=price).rows if row.key == "trad_401k")
    assert (trad.label, trad.typed, trad.projected) == (
        "Traditional 401(k)",
        D("21965.82"),
        D("24500.00"),
    )
    assert trad.facts.capped_at == D("24500.00")
    assert [("trad_401k_contributions", 1, D("24500.00"))] in price.calls
    assert trad.tax_effect == D("-600.00")


def test_an_input_nobody_entered_reads_not_entered_and_is_still_compared():
    grace = person(
        2,
        "Grace",
        bucket={
            "pay_periods": D("10"),
            "annual_salary": D("24000"),
            "latest_w2_income": D("10000"),
        },
        paycheck=paycheck(
            checks=8, first=date(2026, 9, 16), gross=D("8000.00"), trad=D("800.00"), hsa=D("600.00")
        ),
    )
    rows = {row.key: row for row in run([grace], primary_id=1).rows}
    assert rows["salary"].typed == D("10000.00") and rows["salary"].projected == D("8000.00")
    assert rows["trad_401k"].typed is None and rows["trad_401k"].projected == D("800.00")
    assert rows["trad_401k"].difference == D("800.00")
    assert rows["hsa"].typed is None and rows["hsa"].projected == D("600.00")
    # Not the primary: no RSU or ESPP row is hers to reconcile.
    assert set(rows) == {"salary", "trad_401k", "hsa"}


def test_a_row_with_nothing_on_either_side_is_left_out():
    quiet = person(
        1, "Me", bucket={"hsa_contributions": D("0")}, paycheck=paycheck(gross=D("1000"))
    )
    keys = [row.key for row in run([quiet]).rows]
    assert "hsa" not in keys and "trad_401k" not in keys


def test_a_person_without_a_paycheck_profile_gets_a_note_and_no_paycheck_rows():
    partner = person(2, "Grace", bucket={"annual_salary": D("24000")}, paycheck=None)
    out = run([edward(), partner])
    assert [row.person_id for row in out.rows if row.source == "paycheck"] == [1, 1, 1]
    assert (
        "Grace has no paycheck profile, so their inputs are not reconciled — their withholding "
        "comes from the entered W-2 rows"
    ) in out.notes


def test_a_primary_without_a_paycheck_profile_is_told_where_to_add_one():
    me = person(1, "Edward", bucket={"annual_salary": D("100000")}, paycheck=None)
    out = run([me])
    assert out.rows == []
    assert (
        "Edward has no paycheck profile, so their paycheck inputs are not reconciled — add one on "
        "the Paycheck page to project their salary"
    ) in out.notes


def test_the_notes_always_say_what_is_never_reconciled_and_carry_the_callers():
    out = run([edward()], notes=["No 2026 HSA self-only limit is stored"])
    assert out.notes[-1] == NEVER_RECONCILED_NOTE
    assert "No 2026 HSA self-only limit is stored" in out.notes


def test_the_rsu_row_offers_apply_only_when_the_figures_differ():
    rsu = RsuFacts(
        projected=D("171235.24"),
        future_income=D("48520.44"),
        reference_projected=D("171235.24"),
        reference_future=D("48520.44"),
        reference_price=D("228.87"),
        reference_date=date(2026, 9, 1),
    )
    row = next(row for row in run([edward()], rsu=rsu).rows if row.key == "rsu")
    assert (row.label, row.source, row.typed, row.projected) == (
        "RSU income",
        "comp",
        D("120000.00"),
        D("171235.24"),
    )
    assert row.apply is not None
    assert (row.apply.key, row.apply.person_id, row.apply.value) == (
        "w2_stock_rsus_sold",
        1,
        D("171235.24"),
    )
    matched_bucket = {**EDWARD_BUCKET, "w2_stock_rsus_sold": D("171235.2400")}
    matched = person(1, "Edward", bucket=matched_bucket, paycheck=paycheck(gross=D("188930.00")))
    same = next(row for row in run([matched], rsu=rsu).rows if row.key == "rsu")
    assert same.apply is None
    assert same.tax_effect == D("0.00")


def test_the_espp_row_replaces_the_three_components_by_term():
    price = Pricer()
    espp = EsppFacts(ordinary=D("1891.85"), long_term=D("46893.86"), short_term=D("0.00"), lots=1)
    household = {"ltcg_espp_component": D("0"), "stcg_espp_component": D("0")}
    row = next(
        row
        for row in run([edward()], espp=espp, household=household, price=price).rows
        if row.key == "espp"
    )
    assert (row.label, row.source, row.typed, row.projected) == (
        "ESPP sale income",
        "espp",
        D("0.00"),
        D("48785.71"),
    )
    assert row.typed_keys == [
        "w2_espp_sale_component",
        "ltcg_espp_component",
        "stcg_espp_component",
    ]
    assert [
        ("w2_espp_sale_component", 1, D("1891.85")),
        ("ltcg_espp_component", None, D("46893.86")),
        ("stcg_espp_component", None, D("0.00")),
    ] in price.calls


def test_liability_if_matched_is_one_run_with_every_overlay():
    price = Pricer(
        {
            "w2_salary_checkpoint": D("1000"),
            "trad_401k_contributions": D("-500"),
            "hsa_contributions": D("-20"),
        }
    )
    out = run([edward()], price=price)
    assert out.liability_if_matched == LIABILITY + D("480")
    assert out.balance_if_matched == LIABILITY + D("480") - WITHHELD
    # One call per row, and one with every overlay at once.
    assert len(price.calls[-1]) == 3


def test_liability_if_matched_is_the_typed_liability_when_nothing_differs():
    out = run([])
    assert out.rows == []
    assert out.liability_if_matched == LIABILITY
    assert out.balance_if_matched == LIABILITY - WITHHELD
    assert out.flagged_count == 0


# --- flags (stateless) -----------------------------------------------------------------------


def test_a_difference_worth_more_than_250_of_tax_is_flagged_on_every_row_kind():
    for key in ("w2_salary_checkpoint", "trad_401k_contributions", "hsa_contributions"):
        above = run([edward()], price=Pricer({key: D("260.00")}))
        below = run([edward()], price=Pricer({key: D("-240.00")}))
        flagged = [row.key for row in above.rows if row.flagged]
        assert len(flagged) == 1, key
        assert [row.key for row in below.rows if row.flagged] == [], key
        assert above.flagged_count == 1
    assert FLAG_ABOVE == D("250.00")


def test_the_same_inputs_give_the_same_flags_in_any_order():
    price = Pricer({"w2_salary_checkpoint": D("5000"), "hsa_contributions": D("100")})
    first = run([edward()], price=price)
    again = run([edward()], price=price)
    assert [row.flagged for row in first.rows] == [row.flagged for row in again.rows]
    assert first == again


# --- the caps --------------------------------------------------------------------------------


def test_the_401k_cap_binds_and_splits_by_rate():
    assert cap_401k(D("24560.90"), D("0"), D("24500.00")) == (D("24500.00"), D("24500.00"))
    # Traditional 20,000 + Roth 10,000 over a 24,500 limit: 24,500 x 2/3 is traditional.
    assert cap_401k(D("20000.00"), D("10000.00"), D("24500.00")) == (
        D("16333.33"),
        D("24500.00"),
    )
    # Under the limit: nothing stops, nothing to report.
    assert cap_401k(D("12000.00"), D("0"), D("24500.00")) == (D("12000.00"), None)
    # No limit stored: uncapped.
    assert cap_401k(D("30000.00"), D("0"), None) == (D("30000.00"), None)


def test_the_hsa_cap_subtracts_the_employer_deposit_and_ignores_no_coverage():
    # At the cap is not over it: 4,400 - 2,000 = 2,400 stops nothing.
    assert cap_hsa(D("2400.00"), D("4400.00"), D("2000.00")) == (D("2400.00"), None)
    assert cap_hsa(D("3000.00"), D("4400.00"), D("2000.00")) == (D("2400.00"), D("2400.00"))
    # A deposit larger than the limit leaves no room, never a negative one.
    assert cap_hsa(D("600.00"), D("4400.00"), D("5000.00")) == (D("0.00"), D("0.00"))
    # Coverage 'none' or no stored limit: the caller passes no limit, and nothing caps.
    assert cap_hsa(D("600.00"), None, D("0")) == (D("600.00"), None)


# --- the RSU flag: judged at the month's reference close, inside a ±10 % band (§W3) --------
#
# 100,000 of vests are behind today (at their vest-day closes); 200 shares are still to come.
# The reference close (on or before the 1st) is 250, today's quote 270 — 8 % up. A pricer
# that taxes RSU income at 30 % makes every effect hand-checkable.

PAST = D("100000")
REFERENCE = RsuFacts(
    projected=D("154000.00"),  # 100,000 + 200 x 270, today's quote
    future_income=D("54000.00"),
    reference_projected=D("150000"),  # 100,000 + 200 x 250
    reference_future=D("50000"),
    reference_price=D("250.0000"),
    reference_date=date(2026, 9, 1),
)


def rsu_pricer(typed: Decimal):
    def price(overlays):
        return LIABILITY + sum(
            (
                (value - typed) * D("0.3")
                for key, _p, value in overlays
                if key == "w2_stock_rsus_sold"
            ),
            D("0"),
        )

    return price


def rsu_row(typed: str, rsu: RsuFacts = REFERENCE):
    bucket = {"w2_stock_rsus_sold": D(typed)}
    me = person(1, "Edward", bucket=bucket, paycheck=None)
    out = run([me], rsu=rsu, price=rsu_pricer(D(typed)))
    return next(row for row in out.rows if row.key == "rsu")


def test_a_row_matched_at_the_reference_close_never_flags_on_an_8_percent_quote_move():
    row = rsu_row("150000")
    assert row.tax_effect == D("1200.00")  # shown on today's quote: 4,000 x 30 %
    assert row.flagged is False


def test_a_row_matched_at_todays_quote_stays_quiet_inside_the_band():
    # Applied today: 4,000 below the reference figure, inside the 5,000 band.
    row = rsu_row("154000")
    assert row.tax_effect == D("0.00")
    assert row.flagged is False


def test_a_difference_inside_the_band_is_not_flagged_even_when_its_effect_is():
    # 4,000 short of the reference: inside 10 % of the 50,000 still to vest.
    row = rsu_row("146000")
    assert row.tax_effect == D("2400.00")  # the SHOWN effect, today's quote
    assert row.flagged is False


def test_a_real_difference_is_flagged_on_what_is_left_after_the_band():
    # 30,000 short of the reference, less the 5,000 band: 25,000 x 30 % = 7,500 of tax.
    row = rsu_row("120000")
    assert row.tax_effect == D("10200.00")  # 34,000 x 30 %, today's quote
    assert row.flagged is True
    assert row.facts.quote_tolerance == D("5000.00")
    assert (row.facts.reference_price, row.facts.reference_date) == (
        D("250.0000"),
        date(2026, 9, 1),
    )
    assert row.facts.future_vest_income == D("54000.00")


def test_the_band_only_shrinks_toward_zero():
    # 800 over the reference and a 5,000 band: nothing left to flag, never a flip in sign.
    row = rsu_row("149200")
    assert row.flagged is False


def test_without_a_reference_price_the_flag_reads_the_shown_effect():
    bare = RsuFacts(
        projected=D("154000.00"),
        future_income=D("54000.00"),
        reference_projected=None,
        reference_future=None,
        reference_price=None,
        reference_date=None,
    )
    row = rsu_row("153000", bare)
    assert row.tax_effect == D("300.00")
    assert row.flagged is True
    assert row.facts.quote_tolerance is None
