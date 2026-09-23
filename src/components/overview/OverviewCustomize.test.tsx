import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_OVERVIEW_LAYOUT } from '../../prefs/overviewLayout'
import type { OverviewLayout } from '../../prefs/overviewLayout'
import { installPointerEvents } from '../../testing/pointer'
import { MOTION_MS } from '../../theme/motion'
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

/** jsdom has no layout: every drag row gets a box `height` tall, stacked from y=200 in DOM order
 *  (the tiles' rows first, then the cards'), clear of the viewport's 40px auto-scroll zones.
 *  useReorder measures these once at lift (R0's useReorder.test.tsx helper). */
function layoutRows(height = 40, start = 200) {
  document.querySelectorAll<HTMLElement>('[data-reorder-id]').forEach((row, index) => {
    const top = start + index * height
    row.getBoundingClientRect = () =>
      ({ top, bottom: top + height, height, left: 0, right: 360, width: 360, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
  })
}

const live = (legend: Legend) => list(legend).querySelector('[aria-live="assertive"]')?.textContent ?? ''

describe('OverviewCustomize — dragging (2026-09-23 spec §6, §2.3–§2.4)', () => {
  beforeAll(() => installPointerEvents())

  beforeEach(() => {
    // jsdom only logs window.scrollBy as not implemented; the hook scrolls when a row nears an edge.
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  })

  it('Space lifts a tile, ↓ moves it, Space drops: one layout change, the rows follow, the grip keeps its focus', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    openPopover()
    layoutRows()
    grip('Net worth').focus()
    fireEvent.keyDown(grip('Net worth'), { key: ' ' })
    expect(live('Summary tiles')).toBe('Picked up Net worth. Position 1 of 4.')
    expect(grip('Net worth').getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(grip('Net worth'), { key: 'ArrowDown' })
    expect(live('Summary tiles')).toBe('Net worth, position 2 of 4.')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(grip('Net worth'), { key: ' ' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      tiles: ['portfolio', 'net_worth', 'living_spending', 'tax'],
      cards: DEFAULT_CARDS,
    })
    expect(lines('Summary tiles')).toEqual([
      '⋮ [x] Portfolio',
      '⋮ [x] Net worth',
      '⋮ [x] Living spending',
      '⋮ [x] Estimated tax',
    ])
    expect(live('Summary tiles')).toBe('Dropped Net worth at position 2 of 4.')
    expect(document.activeElement).toBe(grip('Net worth'))
  })

  it('the deeper views reorder on their own: End sends one to the bottom and the tiles stay put', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    openPopover()
    layoutRows()
    fireEvent.keyDown(grip('Year to date'), { key: 'Enter' })
    expect(live('Deeper views')).toBe('Picked up Year to date. Position 1 of 4.')
    expect(live('Summary tiles')).toBe('')
    fireEvent.keyDown(grip('Year to date'), { key: 'End' })
    fireEvent.keyDown(grip('Year to date'), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      tiles: ['net_worth', 'portfolio', 'living_spending', 'tax'],
      cards: ['performance', 'spending', 'money_flow', 'ytd'],
    })
  })

  it('Escape while a row is lifted cancels only the drag; the next Escape closes the popover and hands focus back', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    openPopover()
    layoutRows()
    grip('Portfolio').focus()
    fireEvent.keyDown(grip('Portfolio'), { key: ' ' })
    fireEvent.keyDown(grip('Portfolio'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Portfolio'), { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Customize overview' })).toBeTruthy()
    expect(live('Summary tiles')).toBe('Cancelled. Portfolio is back at position 2 of 4.')
    expect(lines('Summary tiles')[1]).toBe('⋮ [x] Portfolio')
    fireEvent.keyDown(grip('Portfolio'), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Customize overview' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Customize' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('lifting a row makes every box of its own list inert until the lift ends', () => {
    render(<Harness initial={{ tiles: ['net_worth', 'portfolio'], cards: ['ytd'] }} />)
    openPopover()
    layoutRows()
    fireEvent.keyDown(grip('Net worth'), { key: ' ' })
    expect(box('Net worth').disabled).toBe(true)
    expect(box('Living spending').disabled).toBe(true)
    expect(box('Year to date').disabled).toBe(false)
    fireEvent.keyDown(grip('Net worth'), { key: 'Escape' })
    expect(box('Net worth').disabled).toBe(false)
    expect(box('Living spending').disabled).toBe(false)
  })

  it('a mouse drag lands where the gap opened and commits once; released far below the popover, it leaves it open', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    openPopover()
    layoutRows()
    // Pressing the grip is a pointerdown INSIDE the surface: usePopoverDismiss lets it be.
    fireEvent.pointerDown(grip('Net worth'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Net worth'), { pointerId: 1, clientY: 230 })
    expect(live('Summary tiles')).toBe('Picked up Net worth. Position 1 of 4.')
    fireEvent.pointerMove(grip('Net worth'), { pointerId: 1, clientY: 305 })
    expect(live('Summary tiles')).toBe('Net worth, position 3 of 4.')
    // Far below the popover the row clamps to the end of its list. Capture keeps the up on the
    // grip, and the popover's dismissal listens to pointerdown only, so nothing here closes it.
    fireEvent.pointerMove(grip('Net worth'), { pointerId: 1, clientY: 900 })
    expect(live('Summary tiles')).toBe('Net worth, position 4 of 4.')
    fireEvent.pointerUp(grip('Net worth'), { pointerId: 1, clientY: 900 })
    expect(onChange).not.toHaveBeenCalled() // still easing into its gap
    // The lift lasts through the settle: a tick now would still pull the list out from under it.
    expect(box('Portfolio').disabled).toBe(true)
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(box('Portfolio').disabled).toBe(false)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      tiles: ['portfolio', 'living_spending', 'tax', 'net_worth'],
      cards: DEFAULT_CARDS,
    })
    expect(lines('Summary tiles')).toEqual([
      '⋮ [x] Portfolio',
      '⋮ [x] Living spending',
      '⋮ [x] Estimated tax',
      '⋮ [x] Net worth',
    ])
    expect(screen.getByRole('dialog', { name: 'Customize overview' })).toBeTruthy()
  })

  // R0's development contract check (useReorder's console.error) guards lists whose ranges are
  // split or whose carried rows wander. Each list here is one range with nothing carried, so it must
  // stay silent through every change of its rows — and React has nothing to warn about either.
  it('keeps the console quiet through a tick and a drag: each list is one well-formed range', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Harness initial={{ tiles: ['tax', 'net_worth'], cards: ['money_flow', 'ytd'] }} />)
    openPopover()
    fireEvent.click(box('Portfolio'))
    layoutRows()
    grip('Portfolio').focus()
    for (const key of [' ', 'Home', ' ']) fireEvent.keyDown(grip('Portfolio'), { key })
    expect(lines('Summary tiles').slice(0, 3)).toEqual(['⋮ [x] Portfolio', '⋮ [x] Estimated tax', '⋮ [x] Net worth'])
    expect(error.mock.calls).toEqual([])
  })
})

/** Comments first, over the WHOLE file (overviewCss.test.ts's rule): a `}` inside a comment would
 *  otherwise truncate a block. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every declaration of `selector`, concatenated across blocks. */
function declarationsFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = [...stripComments(css).matchAll(new RegExp(`(^|[,{}])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  if (blocks.length === 0) throw new Error(`no ${selector} block`)
  return blocks.map((match) => match[2]).join(' ')
}

// The rows' CSS lives with the page (OverviewPage.css). It is pinned here rather than in
// overviewCss.test.ts because that file is outside this lane's fence and an in-flight lane edits it.
describe('OverviewPage.css — the Customize rows (2026-09-23 spec §6)', () => {
  const css = readFileSync(path.resolve(__dirname, '../../pages/OverviewPage.css'), 'utf8')

  it('gives every row one height and one gap, grip or not, and room for the lifted surface', () => {
    // One height so the list reads as one even column — for the eye: the drag measures each row
    // at lift, and shiftsFor copes with unequal heights.
    const row = declarationsFor(css, '.overview-customize-row')
    expect(row).toContain('--customize-pad: .35rem;')
    expect(row).toContain('--customize-gap: .35rem;')
    expect(row).toContain('--customize-grip: 1.25rem;')
    expect(row).toContain('min-height: 1.75rem;')
    // Side room for the lifted row's surface, handed back by the negative margin.
    expect(row).toContain('padding: 0 var(--customize-pad);')
    expect(row).toContain('margin: .3rem calc(-1 * var(--customize-pad));')
    expect(row).toContain('gap: var(--customize-gap);')
  })

  it("stands a hidden row's box under the boxes above it and draws the divider quietly", () => {
    expect(declarationsFor(css, '.overview-customize-row > .reorder-grip')).toContain('flex: 0 0 var(--customize-grip);')
    // The inset is the row's own three measures, never restated as a literal length.
    const inset = declarationsFor(css, '.overview-customize-row.is-off')
    expect(inset).toContain('padding-left: calc(var(--customize-pad) + var(--customize-grip) + var(--customize-gap));')
    expect(inset).not.toMatch(/\d*\.?\d+rem/)
    expect(declarationsFor(css, '.overview-customize-divider')).toContain('color: var(--muted);')
    expect(declarationsFor(css, '.overview-customize-divider::after')).toContain('border-top: 1px solid var(--border);')
  })

  it('keeps no rule for the retired position number or ↑/↓ buttons', () => {
    const plain = stripComments(css)
    expect(plain).not.toContain('.overview-customize-row > span')
    expect(plain).not.toContain('.overview-customize-row .button')
  })
})
