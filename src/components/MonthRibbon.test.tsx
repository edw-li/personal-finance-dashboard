import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import MonthRibbon from './MonthRibbon'

afterEach(cleanup)

it('renders a chip per month, marks coverage and selection, and fires onSelect', () => {
  const onSelect = vi.fn()
  render(
    <MonthRibbon
      anchor="2026-03-01"
      count={3}
      filledMonths={new Set(['2026-01-01', '2026-03-01'])}
      selected="2026-03-01"
      onSelect={onSelect}
    />,
  )
  const chips = screen.getAllByRole('button')
  expect(chips).toHaveLength(3)
  expect(chips[0].className).toContain('filled') // Jan has data
  expect(chips[1].className).not.toContain('filled') // Feb missing
  expect(chips[2].className).toContain('selected')
  // Plain attribute asserts — this project doesn't install jest-dom matchers.
  expect(chips[1].getAttribute('aria-label')).toBe('Feb 2026 — no data')
  expect(chips[2].getAttribute('aria-pressed')).toBe('true')
  expect(chips[1].getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(chips[1])
  expect(onSelect).toHaveBeenCalledWith('2026-02-01')
})
