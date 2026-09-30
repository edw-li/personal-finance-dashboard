"""Live review inputs; retain v1 fingerprints for totals without a member breakdown."""

from app.services.review_input_v1 import month_input as month_input_v1


def month_input(month, snapshots, balances, spending, cashflow, accounts, categories, profiles):
    data = month_input_v1(
        month, snapshots, balances, spending, cashflow, accounts, categories, profiles
    )
    pay = next((row for row in cashflow if row["month"] == month), None)
    if pay is not None and pay.get("net_pay_by_person") is not None:
        data["definition"] = "month-input-v2"
        data["net_pay_by_person"] = pay["net_pay_by_person"]
    return data
