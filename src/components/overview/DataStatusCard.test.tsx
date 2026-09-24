import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { copyInOctober } from '../../testing/timeFixtures'
import type { CoverageOut } from '../../types/api'
import { formatDate } from '../../utils/format'
import { setServerToday } from '../../utils/productToday'
import DataStatusCard from './DataStatusCard'

afterEach(cleanup)
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
const coverage: CoverageOut = {
  balances: ['2026-07-01', '2026-08-01'], spending: ['2026-07-01'], net_pay: ['2026-07-01'],
  spending_missing: ['2026-08-01'], net_pay_missing: ['2026-08-01'],
  latest: { balances: '2026-08-01', spending: '2026-07-01', net_pay: '2026-07-01' },
}
const value = (label: string) => screen.getByText(label).nextElementSibling as HTMLElement

it('lists the four clocks as definition rows, ambers the overdue feeds and states the comparison', () => {
  // Oct 16 on the real-data copy (2026-09-23 spec §T4): Oct 1 typed early and still provisional,
  // September's spending partly entered and its take-home missing — both late now.
  setServerToday('2026-10-16')
  const quoted = daysAgo(1)
  const late: CoverageOut = {
    ...coverage,
    balances: ['2026-08-01', '2026-09-01', '2026-10-01'],
    spending: ['2026-08-01', '2026-09-01'],
    net_pay: ['2026-08-01'],
    spending_missing: [],
    net_pay_missing: [],
    time: copyInOctober('2026-10-16'),
  }
  render(<DataStatusCard asOf={quoted} coverage={late} comparison={{ month: '2026-07-01', included: 12 }} />)
  expect(screen.getByRole('heading', { name: 'Data status' })).toBeTruthy()
  expect(value('Prices as of').textContent).toBe(formatDate(quoted))
  expect(value('Prices as of').className).not.toContain('stale')
  expect(value('Balances as of').textContent).toBe('Sep 22 — provisional, for Oct 1 · overdue — confirm or update them')
  expect(value('Balances as of').className).toContain('stale')
  expect(value('Spending through').textContent).toBe('Aug 2026 · Sep partly entered — overdue')
  expect(value('Spending through').className).toContain('stale')
  expect(value('Net pay through').textContent).toBe('Aug 2026 · Sep overdue')
  expect(value('Net pay through').className).toContain('stale')
  expect(screen.getByText('Living spending compares Jul 2026 with 12 eligible months.')).toBeTruthy()
})

it('trails the balances without amber while nothing is overdue — the routine', () => {
  setServerToday('2026-10-03')
  render(<DataStatusCard asOf={daysAgo(1)} coverage={{ ...coverage, time: copyInOctober('2026-10-03') }} />)
  expect(document.querySelectorAll('.stale')).toHaveLength(0)
})

it('ambers a stale quote, and says a feed never started without amber', () => {
  render(<DataStatusCard asOf={daysAgo(9)} coverage={{ balances: [], spending: [], net_pay: [] }} />)
  expect(value('Prices as of').className).toContain('stale')
  expect(value('Balances').textContent).toBe('no months')
  expect(value('Spending').textContent).toBe('no months')
  expect(value('Net pay').textContent).toBe('no months')
  expect(document.querySelectorAll('.stale')).toHaveLength(1)
  expect(screen.queryByText(/Living spending compares/)).toBeNull()
})

it('says the quotes were never refreshed when there is no quote date', () => {
  render(<DataStatusCard asOf={null} />)
  expect(value('Prices').textContent).toBe('never refreshed')
  expect(document.querySelectorAll('dt')).toHaveLength(1)
})
