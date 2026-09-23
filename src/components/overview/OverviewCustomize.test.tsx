import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_OVERVIEW_LAYOUT } from '../../prefs/overviewLayout'
import type { OverviewLayout } from '../../prefs/overviewLayout'
import OverviewCustomize from './OverviewCustomize'

// Overview › Customize (2026-09-23 drag-to-reorder spec §6). This file pins the popover's own
// lists — their order, the Hidden divider, the ticks, the drag and its Escape. The layout
// reaching the page's tiles and the pref store is pinned in OverviewPage.test.tsx.

type Legend = 'Summary tiles' | 'Deeper views'

const DEFAULT_CARDS = ['ytd', 'performance', 'spending', 'money_flow']

/** The page's wiring (OverviewPage.tsx): the layout is state, and every change lands at once. */
function Harness({
  initial = DEFAULT_OVERVIEW_LAYOUT,
  onChange = () => {},
}: {
  initial?: OverviewLayout
  onChange?: (value: OverviewLayout) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <OverviewCustomize
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

function openPopover(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
  return screen.getByRole('dialog', { name: 'Customize overview' })
}

const list = (legend: Legend) => screen.getByRole('group', { name: legend })
const grip = (name: string) => screen.getByRole('button', { name: `Reorder ${name}` }) as HTMLButtonElement
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement

/** A list as a reader meets it, top to bottom: "⋮ [x] Net worth" is a view that shows (grip,
 *  ticked box, label), "— Hidden —" the divider, "[ ] Portfolio" a hidden view (box, label, no
 *  grip). A leftover position number or ↑/↓ would show up in the label text. */
function lines(legend: Legend): string[] {
  return [...list(legend).querySelectorAll<HTMLElement>('.overview-customize-row, .overview-customize-divider')].map(
    (row) => {
      if (row.classList.contains('overview-customize-divider')) return `— ${row.textContent} —`
      const ticked = (row.querySelector('input') as HTMLInputElement).checked
      return `${row.querySelector('.reorder-grip') === null ? '' : '⋮ '}${ticked ? '[x]' : '[ ]'} ${row.textContent}`
    },
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OverviewCustomize — the lists (2026-09-23 spec §6)', () => {
  it('lists the views that show in their stored order, each with a grip, then the hidden ones under "Hidden" in default order', () => {
    render(<Harness initial={{ tiles: ['tax', 'net_worth'], cards: ['money_flow', 'ytd'] }} />)
    openPopover()
    expect(lines('Summary tiles')).toEqual([
      '⋮ [x] Estimated tax',
      '⋮ [x] Net worth',
      '— Hidden —',
      '[ ] Portfolio',
      '[ ] Living spending',
    ])
    expect(lines('Deeper views')).toEqual([
      '⋮ [x] Money flow',
      '⋮ [x] Year to date',
      '— Hidden —',
      '[ ] Portfolio performance',
      '[ ] Recent spending',
    ])
    // Only the views that show are drag items, and the ↑/↓ buttons are gone.
    expect(list('Summary tiles').querySelectorAll('[data-reorder-id]')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Move .* (earlier|later)$/ })).toBeNull()
  })

  it('draws no divider while every view shows', () => {
    render(<Harness />)
    openPopover()
    expect(lines('Summary tiles')).toEqual([
      '⋮ [x] Net worth',
      '⋮ [x] Portfolio',
      '⋮ [x] Living spending',
      '⋮ [x] Estimated tax',
    ])
    expect(within(list('Deeper views')).queryByText('Hidden')).toBeNull()
  })

  it('gives each list its own hidden instructions and its own live region', () => {
    render(<Harness />)
    openPopover()
    for (const [legend, name] of [
      ['Summary tiles', 'Net worth'],
      ['Deeper views', 'Year to date'],
    ] as const) {
      const instructions = document.getElementById(grip(name).getAttribute('aria-describedby') ?? '')
      expect(instructions?.textContent).toBe(
        'Press Space or Enter to pick up. Use the arrow keys to move, Home or End to jump, Space or Enter to drop, Escape to cancel.',
      )
      expect(list(legend).contains(instructions)).toBe(true)
      expect(list(legend).querySelectorAll('[aria-live="assertive"]')).toHaveLength(1)
    }
  })

  it('ticking a hidden view appends it to the order; unticking one that shows moves it under Hidden', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ tiles: ['tax', 'net_worth'], cards: [...DEFAULT_OVERVIEW_LAYOUT.cards] }} onChange={onChange} />)
    openPopover()
    fireEvent.click(box('Portfolio'))
    expect(onChange).toHaveBeenLastCalledWith({ tiles: ['tax', 'net_worth', 'portfolio'], cards: DEFAULT_CARDS })
    expect(lines('Summary tiles')).toEqual([
      '⋮ [x] Estimated tax',
      '⋮ [x] Net worth',
      '⋮ [x] Portfolio',
      '— Hidden —',
      '[ ] Living spending',
    ])
    fireEvent.click(box('Recent spending'))
    expect(onChange).toHaveBeenLastCalledWith({
      tiles: ['tax', 'net_worth', 'portfolio'],
      cards: ['ytd', 'performance', 'money_flow'],
    })
    expect(lines('Deeper views')).toEqual([
      '⋮ [x] Year to date',
      '⋮ [x] Portfolio performance',
      '⋮ [x] Money flow',
      '— Hidden —',
      '[ ] Recent spending',
    ])
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('a ticked or unticked box keeps the keyboard caret as its row crosses the divider', () => {
    render(<Harness />)
    openPopover()
    box('Portfolio').focus()
    fireEvent.click(box('Portfolio'))
    expect(lines('Summary tiles').at(-1)).toBe('[ ] Portfolio')
    expect(document.activeElement).toBe(box('Portfolio'))
    fireEvent.click(box('Portfolio'))
    expect(lines('Summary tiles').at(-1)).toBe('⋮ [x] Portfolio')
    expect(document.activeElement).toBe(box('Portfolio'))
  })

  it('keeps one summary tile — its box and grip are disabled — while the deeper views may all go', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ tiles: ['portfolio'], cards: ['ytd'] }} onChange={onChange} />)
    const dialog = openPopover()
    expect(box('Portfolio').disabled).toBe(true)
    expect(grip('Portfolio').disabled).toBe(true)
    // Opening hands the caret to the first control that can take it: the lone tile's grip and box
    // cannot, so it lands on the first hidden tile's box.
    expect(document.activeElement).toBe(box('Net worth'))
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.click(box('Year to date'))
    expect(onChange).toHaveBeenLastCalledWith({ tiles: ['portfolio'], cards: [] })
    expect(lines('Deeper views')).toEqual([
      '— Hidden —',
      '[ ] Year to date',
      '[ ] Portfolio performance',
      '[ ] Recent spending',
      '[ ] Money flow',
    ])
  })

  it('Reset to defaults brings every view back in its default place', () => {
    const onChange = vi.fn()
    render(<Harness initial={{ tiles: ['tax'], cards: [] }} onChange={onChange} />)
    openPopover()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(onChange).toHaveBeenCalledWith(DEFAULT_OVERVIEW_LAYOUT)
    expect(lines('Summary tiles')).toEqual([
      '⋮ [x] Net worth',
      '⋮ [x] Portfolio',
      '⋮ [x] Living spending',
      '⋮ [x] Estimated tax',
    ])
    expect(lines('Deeper views')).toEqual([
      '⋮ [x] Year to date',
      '⋮ [x] Portfolio performance',
      '⋮ [x] Recent spending',
      '⋮ [x] Money flow',
    ])
  })
})
