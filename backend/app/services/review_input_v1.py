"""Frozen v1 canonical input contract shared by adoption migration and live reviews.

Keep this module dependency-free and immutable when introducing v2. Historical adoption
must hash exactly the input images present during migration, never first-read data.
"""

import hashlib
import json
from datetime import date, datetime
from decimal import Decimal

ACCOUNT_FIELDS = ("id", "group", "is_component", "parent_account_id", "person_id")
CATEGORY_FIELDS = ("id", "kind")
PAYROLL_FIELDS = (
    "person_id",
    "effective_date",
    "annual_salary",
    "pay_periods_per_year",
    "trad_401k_pct",
    "roth_401k_pct",
    "after_tax_401k_pct",
    "espp_pct",
    "hsa_per_check",
)


def canonical(value):
    if isinstance(value, Decimal):
        return format(value.normalize(), "f") if value else "0"
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): canonical(cell) for key, cell in sorted(value.items())}
    if isinstance(value, (tuple, list)):
        return [canonical(cell) for cell in value]
    return value


def revision(value: object) -> str:
    return hashlib.sha256(
        json.dumps(canonical(value), sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def month_input(month, snapshots, balances, spending, cashflow, accounts, categories, profiles):
    snapshot = next((row for row in snapshots if row["month"] == month), None)
    balance_rows = sorted(
        (row for row in balances if snapshot and row["snapshot_id"] == snapshot["id"]),
        key=lambda row: row["account_id"],
    )
    spend_rows = sorted(
        (row for row in spending if row["month"] == month), key=lambda row: row["category_id"]
    )
    account_ids = {row["account_id"] for row in balance_rows}
    category_ids = {row["category_id"] for row in spend_rows}
    current_profiles = {}
    for profile in sorted(profiles, key=lambda row: (row["effective_date"], row["person_id"])):
        if profile["effective_date"] <= month:
            current_profiles[profile["person_id"]] = profile
    return {
        "definition": "month-input-v1",
        "month": month,
        "snapshot": None
        if snapshot is None
        else {key: snapshot[key] for key in ("recorded_on", "notes")},
        "balances": [{key: row[key] for key in ("account_id", "balance")} for row in balance_rows],
        "spending": [{key: row[key] for key in ("category_id", "amount")} for row in spend_rows],
        "net_pay": next((row["net_pay"] for row in cashflow if row["month"] == month), None),
        "accounts": [
            {key: row[key] for key in ACCOUNT_FIELDS}
            for row in sorted(accounts, key=lambda row: row["id"])
            if row["id"] in account_ids
        ],
        "categories": [
            {key: row[key] for key in CATEGORY_FIELDS}
            for row in sorted(categories, key=lambda row: row["id"])
            if row["id"] in category_ids
        ],
        "payroll": [
            {key: row[key] for key in PAYROLL_FIELDS} for _, row in sorted(current_profiles.items())
        ],
    }
