import { describe, expect, it } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import type { CalendarLiving } from '../../types/api'
import {
  cashLine,
  daysInWindow,
  formatCompactCents,
  formatWholeDollars,
  fromCents,
  livingFor,
  monthSummary,
  proratedLivingCents,
  signedCompact,
  summarize,
  toCents,
  weekSummary,
  windowSummary,
} from './cashflow'

const vest = calendarEvent({ date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated' })
const payday = calendarEvent({ date: '2026-09-15', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' })
const q3 = calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Tax deadline — Q3', amount: '395.00', direction: 'out', basis: 'estimated', done: true })
const fee = calendarEvent({ date: '2026-09-20', type: 'card_fee', label: 'Venture X annual fee', amount: '395.00', direction: 'out', basis: 'confirmed', hidden: true })
const unknown = calendarEvent({ date: '2026-09-03', type: 'ex_dividend', label: 'Ex-dividend — NVDA', amount: null, direction: 'in', basis: 'estimated' })
const october = calendarEvent({ date: '2026-10-15', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' })

describe('cents', () => {
  it('converts 2dp strings to integer cents and back without floats', () => {
    expect(toCents('6812.44')).toBe(681244)
    expect(toCents('-0.05')).toBe(-5)
    expect(toCents('41200')).toBe(4120000)
    expect(toCents('12.5')).toBe(1250)
    expect(fromCents(681244)).toBe('6812.44')
    expect(fromCents(-5)).toBe('-0.05')
    expect(fromCents(0)).toBe('0.00')
    expect(() => toCents('1e3')).toThrow()
  })

  it('formats compact magnitudes and signed compacts with the estimate tilde', () => {
    expect(formatCompactCents(681244)).toBe('$6.8k')
    expect(formatCompactCents(39500)).toBe('$395')
    expect(formatCompactCents(4120000)).toBe('$41.2k')
    expect(formatCompactCents(123456789)).toBe('$1.2M')
    expect(signedCompact(4120000, 'in', true)).toBe('~+$41.2k')
    expect(signedCompact(39500, 'out', false)).toBe('−$395')
    expect(signedCompact(30000, 'neutral', false)).toBe('$300')
    // A zero is a zero (spec §14): no sign to carry, and an estimate of nothing is not "~".
    expect(signedCompact(0, 'out', true)).toBe('$0')
    expect(signedCompact(0, 'in', false)).toBe('$0')
  })
})

describe('summaries', () => {
  it('sums cash in (non-rsu), cash out, net and vesting; hidden excluded, done included, unknown skipped', () => {
    const s = summarize([vest, payday, q3, fee, unknown])
    expect(s).toEqual({
      cashIn: 681244,
      cashOut: 39500,
      net: 641744,
      vesting: 4120000,
      estimated: { cashIn: false, cashOut: true, vesting: true },
      unknown: 1,
    })
  })

  it('month, week and window filters', () => {
    const all = [vest, payday, q3, october]
    expect(monthSummary(all, '2026-09-01').cashIn).toBe(681244)
    expect(monthSummary(all, '2026-10-01').cashIn).toBe(681244)
    expect(monthSummary(all, '2026-10-01').vesting).toBe(0)
    expect(weekSummary(all, ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'])).toMatchObject({ cashIn: 681244, cashOut: 39500, vesting: 4120000 })
    expect(windowSummary(all, '2026-09-16', '2026-10-31')).toMatchObject({ cashIn: 681244, vesting: 4120000, cashOut: 0 })
  })

  it('renders the cash line with only the non-zero legs', () => {
    expect(cashLine(summarize([vest, payday, q3]))).toBe('+$6.8k in · ~−$395 out · ~$41.2k vesting')
    expect(cashLine(summarize([payday]))).toBe('+$6.8k in')
    expect(cashLine(summarize([unknown]))).toBe('amounts unknown')
  })
})

const LIVING: CalendarLiving[] = ['2026-09-01', '2026-10-01', '2026-11-01'].map((month) => ({
  month,
  amount: '5478.00',
  basis: 'budget',
  months_in_average: null,
}))

describe('living-cost helpers (2026-09-23 spec §B2)', () => {
  it('livingFor finds the month by its prefix, and absent stays absent', () => {
    expect(livingFor(LIVING, '2026-10-01')?.month).toBe('2026-10-01')
    expect(livingFor(LIVING, '2026-12-01')).toBeNull()
    expect(livingFor(undefined, '2026-10-01')).toBeNull()
  })

  it('formatWholeDollars rounds half up to whole dollars', () => {
    expect(formatWholeDollars(547800)).toBe('$5,478')
    expect(formatWholeDollars(541748)).toBe('$5,417')
    expect(formatWholeDollars(541750)).toBe('$5,418')
    expect(formatWholeDollars(-541750)).toBe('−$5,418')
    expect(formatWholeDollars(0)).toBe('$0')
  })

  it('daysInWindow counts the inclusive days of the window inside a month', () => {
    expect(daysInWindow('2026-09-01', '2026-09-23', '2026-11-07')).toBe(8)
    expect(daysInWindow('2026-10-01', '2026-09-23', '2026-11-07')).toBe(31)
    expect(daysInWindow('2026-11-01', '2026-09-23', '2026-11-07')).toBe(7)
    expect(daysInWindow('2026-12-01', '2026-09-23', '2026-11-07')).toBe(0)
    expect(daysInWindow('2026-09-01', '2026-09-10', '2026-09-20')).toBe(11)
    // February of a leap year, whole.
    expect(daysInWindow('2028-02-01', '2028-01-15', '2028-03-15')).toBe(29)
  })

  it('proratedLivingCents spreads each month by its days, in integer cents', () => {
    // 547,800 x 8/30 + 547,800 + 547,800 x 7/30 = 146,080 + 547,800 + 127,820.
    expect(proratedLivingCents(LIVING, '2026-09-23', '2026-11-07')).toBe(821700)
    // 10,001 x 15/30 = 5,000.5 → HALF_UP.
    const odd: CalendarLiving[] = [{ ...LIVING[0], amount: '100.01' }]
    expect(proratedLivingCents(odd, '2026-09-01', '2026-09-15')).toBe(5001)
    // A month the window touches without an estimate: no partial sum.
    expect(proratedLivingCents(LIVING.slice(0, 2), '2026-09-23', '2026-11-07')).toBeNull()
    expect(proratedLivingCents([], '2026-09-23', '2026-11-07')).toBeNull()
  })
})
