import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { CoverageOut } from '../../types/api'
import { formatDate } from '../../utils/format'
import DataStatusCard from './DataStatusCard'

afterEach(cleanup)
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
const coverage: CoverageOut = {
  balances: ['2026-07-01', '2026-08-01'], spending: ['2026-07-01'], net_pay: ['2026-07-01'],
  spending_missing: ['2026-08-01'], net_pay_missing: ['2026-08-01'],
  latest: { balances: '2026-08-01', spending: '2026-07-01', net_pay: '2026-07-01' },
}
const value = (label: string) => screen.getByText(label).nextElementSibling as HTMLElement

it('lists the four clocks as definition rows, ambers the lagging feeds and states the comparison', () => {
  const quoted = daysAgo(1)
  render(<DataStatusCard asOf={quoted} coverage={coverage} comparison={{ month: '2026-07-01', included: 12 }} />)
  expect(screen.getByRole('heading', { name: 'Data status' })).toBeTruthy()
  expect(value('Prices as of').textContent).toBe(formatDate(quoted))
  expect(value('Prices as of').className).not.toContain('stale')
  expect(value('Balances through').textContent).toBe('Aug 2026')
  expect(value('Balances through').className).not.toContain('stale')
  expect(value('Spending through').textContent).toBe('Jul 2026 (Aug missing)')
  expect(value('Spending through').className).toContain('stale')
  expect(value('Net pay through').className).toContain('stale')
  expect(screen.getByText('Living spending compares Jul 2026 with 12 eligible months.')).toBeTruthy()
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
