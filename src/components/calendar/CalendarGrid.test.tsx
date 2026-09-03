import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import type { CalendarEvent } from '../../types/api'
import CalendarGrid, { gutterText, shiftMonth } from './CalendarGrid'
import { summarize } from './cashflow'

afterEach(cleanup)

const SEP15 = '2026-09-15'
const fixtures: CalendarEvent[] = [
  calendarEvent({ date: SEP15, type: 'payday', label: 'Payday', short_label: 'Payday', amount: '6812.44', direction: 'in' }),
  calendarEvent({ date: SEP15, type: 'tax_deadline', label: 'Tax deadline — Q3 estimated payment', short_label: 'Q3 est. tax', amount: '395.00', direction: 'out', basis: 'estimated' }),
  calendarEvent({ date: SEP15, type: 'ex_dividend', label: 'Ex-dividend — NVDA', short_label: 'Ex-div NVDA' }),
  calendarEvent({ date: SEP15, type: 'custom', label: 'Zoo', id: 3 }),
  calendarEvent({ date: SEP15, type: 'espp_qualify', label: 'ESPP lot qualifies — 2024-08-30', short_label: 'ESPP lot qualifies' }),
  calendarEvent({ date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 4 grants', short_label: 'RSU vest · 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated' }),
  calendarEvent({ date: '2026-09-02', type: 'update_due', label: 'Monthly update — enter August 2026', short_label: 'Monthly update', done: true }),
]

function mount(over: Partial<Parameters<typeof CalendarGrid>[0]> = {}) {
  const handlers = {
    onActiveDay: vi.fn(),
    onOpenDay: vi.fn(),
    onToggleEvent: vi.fn(),
    onMonthStep: vi.fn(),
  }
  render(
    <CalendarGrid
      month="2026-09-01"
      events={fixtures}
      today="2026-09-03"
      activeDay={SEP15}
      focusTick={0}
      openKey={null}
      popoverRef={createRef<HTMLDivElement>()}
      renderDetails={(event) => <span>details for {event.label}</span>}
      {...handlers}
      {...over}
    />,
  )
  return handlers
}

const cell = (day: string) =>
  document.querySelector(`[role="gridcell"][data-day="${day}"]`) as HTMLElement

describe('CalendarGrid', () => {
  it('is an ARIA grid with one tab stop on the active day and a Week header', () => {
    mount()
    expect(screen.getByRole('grid', { name: 'Sep 2026 calendar' })).toBeTruthy()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Week',
    ])
    const cells = screen.getAllByRole('gridcell').filter((c) => c.hasAttribute('data-day'))
    expect(cells.filter((c) => c.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(cell(SEP15).getAttribute('aria-selected')).toBe('true')
    expect(cell('2026-09-16').getAttribute('aria-selected')).toBe('false')
    // Chips in the active cell are tabbable; elsewhere they are not.
    expect(cell(SEP15).querySelector('button.cal-chip')?.getAttribute('tabindex')).toBe('0')
    expect(cell('2026-09-16').querySelector('button.cal-chip')?.getAttribute('tabindex')).toBe('-1')
  })

  it('caps a day at three slots: two chips plus "+N more" in priority order', () => {
    const handlers = mount()
    const chips = Array.from(cell(SEP15).querySelectorAll('button.cal-chip')).map(
      (c) => c.textContent,
    )
    expect(chips).toEqual(['Zoo', 'Q3 est. tax ~−$395'])
    const more = cell(SEP15).querySelector('button.cal-more') as HTMLElement
    expect(more.textContent).toBe('+3 more')
    fireEvent.click(more)
    expect(handlers.onOpenDay).toHaveBeenCalledWith(SEP15)
    // A one-event day shows it in full, with no overflow button.
    expect(cell('2026-09-16').querySelectorAll('button.cal-chip')).toHaveLength(1)
    expect(cell('2026-09-16').querySelector('button.cal-more')).toBeNull()
  })

  it('renders chip text, title, source color and the done strike-through', () => {
    mount()
    const vest = cell('2026-09-16').querySelector('button.cal-chip') as HTMLElement
    expect(vest.textContent).toBe('RSU vest · 4 grants ~+$41.2k')
    expect(vest.getAttribute('title')).toBe('RSU vest — 4 grants · $41,200.00 · estimated')
    expect(vest.getAttribute('style')).toContain('border-left-color: var(--chart-1)')
    expect(cell('2026-09-02').querySelector('button.cal-chip')?.classList.contains('is-done')).toBe(
      true,
    )
  })

  it('day number opens the day; a chip toggles its event with the anchor', () => {
    const handlers = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open Sep 16, 2026' }))
    expect(handlers.onOpenDay).toHaveBeenCalledWith('2026-09-16')
    const chip = cell('2026-09-16').querySelector('button.cal-chip') as HTMLElement
    fireEvent.click(chip)
    expect(handlers.onToggleEvent).toHaveBeenCalledWith(fixtures[5], chip)
  })

  it('shows the anchored popover for the open key', () => {
    mount({ openKey: 'rsu:vest:2026-09-16' })
    const dialog = screen.getByRole('dialog', { name: 'RSU vest — 4 grants' })
    expect(dialog.textContent).toContain('details for RSU vest — 4 grants')
    expect(cell('2026-09-16').querySelector('button.cal-chip')?.getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('moves the active day with the keyboard and steps the month at the edges', () => {
    const handlers = mount()
    const active = cell(SEP15)
    fireEvent.keyDown(active, { key: 'ArrowRight' })
    expect(handlers.onActiveDay).toHaveBeenLastCalledWith('2026-09-16')
    fireEvent.keyDown(active, { key: 'ArrowDown' })
    expect(handlers.onActiveDay).toHaveBeenLastCalledWith('2026-09-22')
    fireEvent.keyDown(active, { key: 'Home' })
    expect(handlers.onActiveDay).toHaveBeenLastCalledWith('2026-09-13')
    fireEvent.keyDown(active, { key: 'End' })
    expect(handlers.onActiveDay).toHaveBeenLastCalledWith('2026-09-19')
    expect(handlers.onMonthStep).not.toHaveBeenCalled()
    fireEvent.keyDown(active, { key: 'PageDown' })
    expect(handlers.onMonthStep).toHaveBeenLastCalledWith(1)
    expect(handlers.onActiveDay).toHaveBeenLastCalledWith('2026-10-15')
    fireEvent.keyDown(active, { key: 'Enter' })
    expect(handlers.onOpenDay).toHaveBeenCalledWith(SEP15)
  })

  it('an arrow off the last day of the month steps the month', () => {
    const handlers = mount({ activeDay: '2026-09-30' })
    fireEvent.keyDown(cell('2026-09-30'), { key: 'ArrowRight' })
    expect(handlers.onMonthStep).toHaveBeenCalledWith(1)
    expect(handlers.onActiveDay).toHaveBeenCalledWith('2026-10-01')
  })

  it('every row ends with a Week totals gutter reading in / out', () => {
    mount()
    const gutters = screen.getAllByRole('gridcell', { name: 'Week totals' })
    expect(gutters).toHaveLength(5) // September 2026 spans five Sunday-first rows
    expect(gutters[2].textContent).toBe('+$6.8k / ~−$395') // the week of Sep 13-19
    expect(gutters[4].textContent).toBe('—') // Sep 27 - Oct 3: nothing
  })

  it('helpers: shiftMonth clamps to month end; gutterText', () => {
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftMonth('2026-03-15', -1)).toBe('2026-02-15')
    expect(shiftMonth('2026-12-31', 1)).toBe('2027-01-31')
    expect(gutterText(summarize([]))).toBe('—')
  })
})
