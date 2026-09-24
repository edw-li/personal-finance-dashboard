import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TimeStatusOut } from '../../types/api'
import { setServerToday } from '../../utils/productToday'
import { TIME_OCT_16, TIME_OCT_3, TIME_SEP_23 } from '../../testing/timeStatusFixtures'
import WhatsDue from './WhatsDue'

afterEach(cleanup)
beforeEach(() => setServerToday('2026-10-03'))

function strip(time: TimeStatusOut | null, onOpen = vi.fn()) {
  return render(
    <MemoryRouter>
      <WhatsDue time={time} onOpen={onOpen} />
    </MemoryRouter>,
  )
}

it("lists each due part as a link to its month and step (2026-09-23 spec §M2)", () => {
  strip(TIME_OCT_3)
  const nav = screen.getByRole('navigation', { name: "What's due" })
  const links = within(nav).getAllByRole('link')
  expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
    ['Oct 1 balances · recorded early, on Sep 22 — update or confirm', '/update?month=2026-10-01&step=balances'],
    [
      'September spending & take-home · entered during September — add the rest or confirm',
      '/update?month=2026-09-01&step=spending',
    ],
  ])
  expect(links.every((a) => !a.className.includes('is-overdue'))).toBe(true)
})

it('turns an overdue part amber and says so in words, never by colour alone', () => {
  setServerToday('2026-10-16')
  strip(TIME_OCT_16)
  const links = screen.getAllByRole('link')
  expect(links.every((a) => a.className.includes('is-overdue'))).toBe(true)
  expect(links.map((a) => a.textContent)).toEqual([
    'Oct 1 balances · recorded early, on Sep 22 — update or confirm · overdue',
    'September spending & take-home · entered during September — add the rest or confirm · overdue',
  ])
})

it('hands a plain click to the wizard instead of navigating', () => {
  const onOpen = vi.fn()
  strip(TIME_OCT_3, onOpen)
  fireEvent.click(screen.getAllByRole('link')[1])
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ month: '2026-09-01', step: 'spending' }))
  // A modified click keeps the link's own behaviour (a new tab), so the wizard is not asked.
  fireEvent.click(screen.getAllByRole('link')[0], { ctrlKey: true })
  expect(onOpen).toHaveBeenCalledTimes(1)
})

it('says nothing is due, naming the early snapshot', () => {
  setServerToday('2026-09-23')
  strip(TIME_SEP_23)
  expect(
    screen.getByText('Nothing due — Oct 1 balances recorded early (Sep 22); update or confirm them on Oct 1'),
  ).toBeTruthy()
  expect(screen.queryAllByRole('link')).toEqual([])
})

it('renders nothing without a time status (an empty book, a failed /coverage)', () => {
  const { container } = strip(null)
  expect(container.innerHTML).toBe('')
})
