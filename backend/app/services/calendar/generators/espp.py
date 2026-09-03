"""ESPP dates (spec §6 espp row): purchase period ends (stored + derived), unsold lots'
qualifying dates, offering starts. The purchase carries the modeler's `contribution` —
eligible earnings x the period's rate — which needs no share price, so the calendar and the
ESPP modeler cannot disagree about it. Qualifying dates and offering starts carry no money.
"""

from datetime import date

from app.services.espp_calc import OfferingInfo, StoredPeriod, half_up2, plan_year_rows

from ..model import Event, Window, make_event


def espp_events(
    stored_periods: list[StoredPeriod],
    offerings: list[OfferingInfo],
    unsold_lots: list[tuple[date, date]],  # (purchase_date, qualifying_date)
    window: Window,
) -> list[Event]:
    events: list[Event] = []
    # Pricing inputs deliberately empty: the calendar needs labels and end dates only.
    for year in range(window.start.year, window.end.year + 1):
        rows, _warnings = plan_year_rows(year, stored_periods, [], None, None)
        for row in rows:
            if window.contains(row.period_end):
                # run_modeler's contribution line — eligible earnings x the period's rate —
                # needs no price, so the calendar computes exactly the figure the modeler
                # would (spec §6 espp row). A derived row with nothing to seed from is
                # unknowable, never $0.00.
                eligible = row.semi_annual_base + row.additional_payments
                contribution = half_up2(eligible * row.contribution_pct) if eligible > 0 else None
                events.append(
                    make_event(
                        row.period_end,
                        "espp_purchase",
                        "purchase",
                        f"ESPP purchase — {row.label}",
                        "ESPP purchase",
                        detail=(
                            row.label
                            if contribution is None
                            else f"{row.label} · contribution ≈ ${contribution:,.2f}"
                        ),
                        amount=contribution,
                        direction="neutral",  # converts already-deducted pay (spec §6)
                        basis="estimated",
                        href="/espp",
                    )
                )
    for purchase_date, qualifying_date in unsold_lots:
        if window.contains(qualifying_date):
            events.append(
                make_event(
                    qualifying_date,
                    "espp_qualify",
                    f"qualify-{purchase_date.isoformat()}",
                    f"ESPP lot qualifies — {purchase_date.isoformat()}",
                    "ESPP lot qualifies",
                    detail=f"{purchase_date.isoformat()} lot qualifies",
                    basis="confirmed",
                    href="/espp",
                )
            )
    for offering in offerings:
        if window.contains(offering.offering_start):
            events.append(
                make_event(
                    offering.offering_start,
                    "offering_start",
                    "offering",
                    "ESPP offering starts",
                    "ESPP offering",
                    detail=f"subscription price {offering.subscription_price}",
                    basis="confirmed",
                    href="/espp",
                )
            )
    return events
