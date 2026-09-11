"""The derived-key vocabulary (2026-09-11 spec §1.1).

One list, derived from `TAX_INPUT_DEFINITIONS` rather than hand-maintained beside it: the
nine totals the engine computes, the ENTERED keys each formula reads, and the human
caption shown beside a computed cell. Everything that refuses, skips or explains a derived
key — the PUT's 422, the what-if's, the importer's skip, the form's caption — reads from
here, so there is exactly one place a tenth total would be added.
"""

from app.tax_keys import (
    DERIVED_COMPONENTS,
    DERIVED_KEYS,
    FORMULA_CAPTIONS,
    HOUSEHOLD_DERIVED_KEYS,
    PER_PERSON_DERIVED_KEYS,
    PER_PERSON_KEYS,
    TAX_INPUT_DEFINITIONS,
    component_labels,
    is_derived_key,
    label_for,
)

_DEFINED = {key for key, *_ in TAX_INPUT_DEFINITIONS}


def test_derived_keys_are_the_nine_flagged_definitions_in_form_order():
    assert DERIVED_KEYS == (
        "gross_paycheck",
        "latest_w2_income",
        "other_w2_income",
        "stcg_total",
        "unqualified_dividends",
        "interest_total",
        "other_pretax_deductions",
        "itemized_deduction",
        "ltcg_total",
    )
    # Comprehension, not a hand list: the flag on the definition tuple is the source.
    assert set(DERIVED_KEYS) == {
        key for key, _l, _s, _o, derived in TAX_INPUT_DEFINITIONS if derived
    }


def test_derived_keys_split_into_four_per_person_and_five_household():
    assert PER_PERSON_DERIVED_KEYS == (
        "gross_paycheck",
        "latest_w2_income",
        "other_w2_income",
        "other_pretax_deductions",
    )
    assert set(PER_PERSON_DERIVED_KEYS) <= set(PER_PERSON_KEYS)
    # The other five, in DEPENDENCY order (stcg_total nets against a rebuilt ltcg_total,
    # itemized reads a MAGI built from everything above it) — not definition order.
    assert HOUSEHOLD_DERIVED_KEYS == (
        "ltcg_total",
        "unqualified_dividends",
        "interest_total",
        "stcg_total",
        "itemized_deduction",
    )
    assert set(PER_PERSON_DERIVED_KEYS) | set(HOUSEHOLD_DERIVED_KEYS) == set(DERIVED_KEYS)
    assert not set(HOUSEHOLD_DERIVED_KEYS) & set(PER_PERSON_KEYS)


def test_every_derived_key_has_components_that_are_defined_and_entered():
    assert set(DERIVED_COMPONENTS) == set(DERIVED_KEYS)
    for key, components in DERIVED_COMPONENTS.items():
        assert components, key
        for component in components:
            assert component in _DEFINED, (key, component)
            # Transitively expanded (spec §1.1): a component is never itself computed, so
            # "is any component entered?" is a question about stored rows alone.
            assert not is_derived_key(component), (key, component)


def test_stcg_components_carry_the_long_term_legs_it_nets_against():
    assert DERIVED_COMPONENTS["stcg_total"] == (
        "stcg_standard",
        "stcg_espp_component",
        "ltcg_brokerage",
        "ltcg_espp_component",
    )
    assert DERIVED_COMPONENTS["latest_w2_income"] == ("pay_periods", "annual_salary")
    # The keys MAGI reads to size the SALT cap are NOT components of the itemized total.
    assert DERIVED_COMPONENTS["itemized_deduction"] == (
        "itemized_salt",
        "itemized_donations",
        "itemized_vehicle_reg",
        "itemized_other",
    )


def test_every_derived_key_has_a_caption():
    assert set(FORMULA_CAPTIONS) == set(DERIVED_KEYS)
    assert FORMULA_CAPTIONS["gross_paycheck"] == "Annual Salary ÷ 24"
    assert FORMULA_CAPTIONS["ltcg_total"] == "Brokerage + ESPP long-term"
    assert all(caption.strip() for caption in FORMULA_CAPTIONS.values())


def test_is_derived_key_answers_for_entered_and_unknown_keys():
    assert is_derived_key("itemized_deduction")
    assert not is_derived_key("itemized_salt")
    assert not is_derived_key("capital_loss_deductions")  # a real carryforward, not a total
    assert not is_derived_key("a_key_no_definition_has")


def test_component_labels_reads_the_labels_the_422_sentences_interpolate():
    labels = component_labels("other_w2_income")
    assert labels.startswith("W2: Stock/RSUs Sold")
    assert labels == ", ".join(label_for(key, key) for key in DERIVED_COMPONENTS["other_w2_income"])
    assert component_labels("other_pretax_deductions") == "Pre-tax: Dental, Pre-tax: Vision"
