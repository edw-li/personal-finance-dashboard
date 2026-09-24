import { beforeEach, describe, expect, it } from 'vitest'
import type { NetWorthSummary } from '../../types/api'
import { setServerToday } from '../../utils/productToday'
import { SEP_1 } from '../../testing/timeStatusFixtures'
import { monthStory } from './story'

beforeEach(() => setServerToday('2026-10-03'))

const summary = (over: Partial<NetWorthSummary>): NetWorthSummary => ({
  month: '2026-10-01',
  net_worth: '933250.90',
  mom_delta: '126583.02',
  mom_pct: '0.157',
  groups: [],
  owner_totals: [],
  as_of: '2026-10-01',
  provisional: false,
  previous: SEP_1,
  days_since_previous: 30,
  ...over,
})
const ready = (s: NetWorthSummary) => ({ status: 'ready' as const, summary: s, balances: { 1: '10.00' } })

describe("monthStory (2026-09-23 spec §M5)", () => {
  it('a final next 1st: the change from this 1st to the next', () => {
    const story = monthStory('2026-09-01', ready(summary({})))
    expect(story.text).toBe("September's change: ▲ $126,583.02 (Sep 1 → Oct 1)")
    expect(story.tone).toBe('positive')
    expect(story.title).toBe('Largest balance changes · Sep 1 → Oct 1')
    expect(story.to).toEqual({ 1: '10.00' })
    expect(story.unavailable).toBeNull()
  })

  it('a provisional next 1st reads to its as-of day', () => {
    expect(monthStory('2026-09-01', ready(summary({ as_of: '2026-09-22', provisional: true }))).text).toBe(
      "September's change: ▲ $126,583.02 (Sep 1 → Sep 22 · provisional)",
    )
  })

  it('a fall reads ▼ with its sign; no change reads a clean zero', () => {
    const fall = monthStory('2026-09-01', ready(summary({ mom_delta: '-1000.00' })))
    expect(fall.text).toBe("September's change: ▼ -$1,000.00 (Sep 1 → Oct 1)")
    expect(fall.tone).toBe('negative')
    const flat = monthStory('2026-09-01', ready(summary({ mom_delta: '-0.001' })))
    expect(flat.text).toBe("September's change: ▲ $0.00 (Sep 1 → Oct 1)")
    expect(flat.tone).toBeNull()
  })

  it('no next 1st yet', () => {
    const story = monthStory('2026-09-01', { status: 'missing' })
    expect(story.text).toBe("September's change appears once Oct 1 balances are recorded")
    expect(story.unavailable).toBe(story.text)
    expect(story.to).toBeNull()
  })

  it('the next 1st compares with an older snapshot: this month has none', () => {
    const older = { ...SEP_1, month: '2026-08-01', as_of: '2026-08-01', recorded_on: '2026-08-01' }
    expect(monthStory('2026-09-01', ready(summary({ previous: older }))).text).toBe(
      "September's change needs Sep 1 balances",
    )
    expect(monthStory('2026-09-01', ready(summary({ previous: null, mom_delta: null }))).text).toBe(
      "September's change needs Sep 1 balances",
    )
  })

  it('loading says nothing yet; a failed read says so', () => {
    expect(monthStory('2026-09-01', { status: 'loading' }).text).toBeNull()
    expect(monthStory('2026-09-01', { status: 'failed' }).text).toBe(
      "September's change could not be loaded — reload to try again",
    )
  })

  it('names the year outside the server year', () => {
    expect(monthStory('2025-12-01', { status: 'missing' }).text).toBe(
      "December 2025's change appears once Jan 1 balances are recorded",
    )
  })
})
