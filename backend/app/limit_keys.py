"""The contribution-limit vocabulary (2026-08-27 two-income-streams spec §4.5).

Definitions in CODE, values in the database — the same split tax_input_definitions makes,
minus the table: labels and display order are the app's, and every number is the user's
(spec §2, "the app ships no IRS limit values"). Adding a key here — an IRA cap, a
catch-up tier — needs no migration, because contribution_limits.key is a plain string.

Keep every key <= 40 characters: that is the stored column's width.
"""

LIMIT_401K_ELECTIVE = "limit_401k_elective"
LIMIT_415C_TOTAL = "limit_415c_total"
LIMIT_HSA_SELF = "limit_hsa_self"
LIMIT_HSA_FAMILY = "limit_hsa_family"
LIMIT_ESPP_423 = "limit_espp_423"

# (key, label, sort_order). The SORT NUMBER is authoritative, not the tuple's order —
# readers sort by it — so a later key can be slotted between two existing ones without
# rewriting the block. Gaps of 10 exist for exactly that.
LIMIT_DEFINITIONS: tuple[tuple[str, str, int], ...] = (
    (LIMIT_401K_ELECTIVE, "401(k) elective deferral", 10),
    (LIMIT_415C_TOTAL, "415(c) total additions", 20),
    (LIMIT_HSA_SELF, "HSA — self-only", 30),
    (LIMIT_HSA_FAMILY, "HSA — family", 40),
    (LIMIT_ESPP_423, "ESPP §423 annual", 50),
)

ORDERED_DEFINITIONS: tuple[tuple[str, str, int], ...] = tuple(
    sorted(LIMIT_DEFINITIONS, key=lambda row: row[2])
)
LIMIT_KEYS: tuple[str, ...] = tuple(key for key, _label, _sort in ORDERED_DEFINITIONS)
LIMIT_LABELS: dict[str, str] = {key: label for key, label, _sort in ORDERED_DEFINITIONS}

# paycheck_profiles.hsa_coverage -> the cap that applies. 'none' is deliberately ABSENT:
# no HDHP means neither cap applies, so limit_check emits no HSA row at all rather than
# measuring against a tier nobody is enrolled in.
HSA_LIMIT_KEY_BY_COVERAGE: dict[str, str] = {
    "self": LIMIT_HSA_SELF,
    "family": LIMIT_HSA_FAMILY,
}
