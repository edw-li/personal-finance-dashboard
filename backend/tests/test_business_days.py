"""Golden-table tests: every expected literal below was hand-derived from the calendar
(2026-01-01 is a Thursday, 2027-01-01 a Friday, 2028-01-01 a Saturday). If one fails,
the CODE is wrong, not the table."""

from datetime import date

from app.services.business_days import (
    next_business_day,
    previous_business_day,
    semi_monthly_paydays,
    us_bank_holidays,
)


def test_us_bank_holidays_2026_golden_table():
    assert us_bank_holidays(2026) == {
        date(2026, 1, 1),  # New Year's Day (Thu)
        date(2026, 1, 19),  # MLK Day (3rd Mon)
        date(2026, 2, 16),  # Washington's Birthday (3rd Mon)
        date(2026, 5, 25),  # Memorial Day (last Mon)
        date(2026, 6, 19),  # Juneteenth (Fri)
        date(2026, 7, 4),  # Independence Day — a SATURDAY: no weekday observation
        date(2026, 9, 7),  # Labor Day (1st Mon)
        date(2026, 10, 12),  # Columbus Day (2nd Mon)
        date(2026, 11, 11),  # Veterans Day (Wed)
        date(2026, 11, 26),  # Thanksgiving (4th Thu)
        date(2026, 12, 25),  # Christmas (Fri)
    }


def test_us_bank_holidays_2027_golden_table():
    assert us_bank_holidays(2027) == {
        date(2027, 1, 1),  # New Year's Day (Fri)
        date(2027, 1, 18),  # MLK Day
        date(2027, 2, 15),  # Washington's Birthday
        date(2027, 5, 31),  # Memorial Day — the last Monday IS the 31st
        date(2027, 6, 19),  # Juneteenth — a SATURDAY: no weekday observation
        date(2027, 7, 5),  # Independence Day OBSERVED — Jul 4 2027 is a SUNDAY
        date(2027, 9, 6),  # Labor Day
        date(2027, 10, 11),  # Columbus Day
        date(2027, 11, 11),  # Veterans Day (Thu)
        date(2027, 11, 25),  # Thanksgiving
        date(2027, 12, 25),  # Christmas — a SATURDAY: no weekday observation
    }


def test_holiday_sets_always_carry_eleven_entries():
    for year in (2026, 2027, 2028):
        assert len(us_bank_holidays(year)) == 11


def test_business_day_stepping_over_weekends_and_holidays():
    # A qualifying day answers itself (both directions).
    assert previous_business_day(date(2026, 8, 14)) == date(2026, 8, 14)  # a Friday
    assert next_business_day(date(2026, 8, 14)) == date(2026, 8, 14)
    # Weekend: Saturday steps back to Friday, forward to Monday.
    assert previous_business_day(date(2026, 8, 15)) == date(2026, 8, 14)
    assert next_business_day(date(2026, 8, 15)) == date(2026, 8, 17)
    # A holiday Monday steps back across the whole weekend.
    assert previous_business_day(date(2026, 5, 25)) == date(2026, 5, 22)  # Memorial Day
    # The Fed Saturday rule: Fri Jul 3 2026 is a REGULAR business day (Jul 4 is a
    # Saturday, and Reserve Banks stay open the preceding Friday).
    assert next_business_day(date(2026, 7, 3)) == date(2026, 7, 3)
    # A Sunday-observed holiday: Mon Jul 5 2027 is closed, so Sun Jul 4 lands on Tue.
    assert next_business_day(date(2027, 7, 4)) == date(2027, 7, 6)
    # Weekend + holiday chain: Sat Jan 15 2028 -> Sun 16 -> Mon 17 (MLK) -> Tue Jan 18.
    # (The real IRS roll-forward for that Q4 due date.)
    assert next_business_day(date(2028, 1, 15)) == date(2028, 1, 18)


def test_semi_monthly_paydays_plain_weekday_month():
    # June 2026: the 15th is a Monday, the 30th a Tuesday — nothing adjusts (and July 4
    # falling on a Saturday moves nothing anywhere near it).
    assert semi_monthly_paydays(2026, 6) == (date(2026, 6, 15), date(2026, 6, 30))


def test_semi_monthly_paydays_weekend_adjustments():
    # Aug 2026: Sat 15th -> Fri 14th; Mon 31st stands.
    assert semi_monthly_paydays(2026, 8) == (date(2026, 8, 14), date(2026, 8, 31))
    # Feb 2026: Sun 15th -> Fri 13th; Sat 28th -> Fri 27th.
    assert semi_monthly_paydays(2026, 2) == (date(2026, 2, 13), date(2026, 2, 27))
    # May 2026: Fri 15th stands; Sun 31st -> Fri 29th.
    assert semi_monthly_paydays(2026, 5) == (date(2026, 5, 15), date(2026, 5, 29))
    # Jan 2027: Fri 15th stands (the spec's named check); Sun 31st -> Fri 29th.
    assert semi_monthly_paydays(2027, 1) == (date(2027, 1, 15), date(2027, 1, 29))


def test_semi_monthly_payday_on_a_bank_holiday():
    # May 2027: the 31st IS Memorial Day (a Monday) — the end-of-month payday crosses
    # the holiday AND the weekend back to Fri May 28. The 15th is a Saturday -> Fri 14th.
    assert semi_monthly_paydays(2027, 5) == (date(2027, 5, 14), date(2027, 5, 28))
