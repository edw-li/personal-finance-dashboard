import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, useLayoutEffect, useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { installPointerEvents } from '../../testing/pointer'
import { EASE_OUT, MOTION_MS } from '../../theme/motion'
import DragHandle from './DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from './ReorderStatus'
import { AUTO_SCROLL_MAX } from './reorderMath'
import type { ReorderItem } from './reorderMath'
import { useReorder } from './useReorder'

const LABELS: Record<string, string> = {
  A: 'Alpha',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  P: 'Parent',
  C1: 'Comp one',
  C2: 'Comp two',
  Q: 'Quebec',
}

function List({
  items,
  onCommit,
  disabled = false,
}: {
  items: ReorderItem<string>[]
  onCommit: (next: string[], moved: string) => void
  disabled?: boolean
}) {
  const reorder = useReorder({
    items,
    labelOf: (id) => LABELS[id] ?? id,
    rangeLabelOf: (range) => (range === 'g' ? 'Group' : undefined),
    disabled,
    onCommit,
  })
  return (
    <div>
      <ReorderInstructions id={reorder.instructionsId} />
      <ReorderLiveRegion text={reorder.announcement} />
      <p data-testid="active">{String(reorder.active)}</p>
      <button type="button" onClick={() => reorder.markSaved('B')}>
        mark Bravo saved
      </button>
      <ul>
        {items.map((item) => (
          <li key={item.id} {...reorder.itemProps(item.id)}>
            <DragHandle name={LABELS[item.id] ?? item.id} {...reorder.handleProps(item.id)} />
            {LABELS[item.id]}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A capped table like the Settings boxes (settings.css): a box that scrolls, its header cells
 *  sticky. Rows are named by id ("Reorder r3"). */
function TableList({ items }: { items: ReorderItem<string>[] }) {
  const reorder = useReorder({ items, labelOf: (id) => id, onCommit: () => {} })
  return (
    <div data-testid="scroller" style={{ overflowY: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th style={{ position: 'sticky', top: 0 }}>Name</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} {...reorder.itemProps(item.id)}>
              <td>
                <DragHandle name={item.id} {...reorder.handleProps(item.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A list that applies its commits, the way every consumer's optimistic order does. */
function Stateful({
  initial,
  onCommit = () => {},
  disabled,
}: {
  initial: ReorderItem<string>[]
  onCommit?: (next: string[], moved: string) => void
  disabled?: boolean
}) {
  const [items, setItems] = useState(initial)
  return (
    <List
      items={items}
      disabled={disabled}
      onCommit={(next, moved) => {
        const byId = new Map(items.map((item) => [item.id, item]))
        const at = new Map(next.map((id, index) => [id, index]))
        const position = (id: string) => at.get(id) ?? 0
        setItems(
          next.flatMap((id) => {
            const item = byId.get(id)
            if (item === undefined) return []
            // Like a real list re-deriving its nesting: carried rows follow the new order.
            const carries = item.carries && [...item.carries].sort((a, b) => position(a) - position(b))
            return [carries === undefined ? item : { ...item, carries }]
          }),
        )
        onCommit(next, moved)
      }}
    />
  )
}

const flat = (...ids: string[]): ReorderItem<string>[] => ids.map((id) => ({ id }))

/** jsdom has no layout: every row gets a box `height` tall, stacked from y=200 in CURRENT DOM order
 *  (well clear of the viewport's auto-scroll zones). Call again after a reorder. */
function layoutRows(height = 40, start = 200) {
  document.querySelectorAll<HTMLElement>('[data-reorder-id]').forEach((row, index) => {
    const top = start + index * height
    row.getBoundingClientRect = () =>
      ({
        top,
        bottom: top + height,
        height,
        left: 0,
        right: 300,
        width: 300,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect
  })
}

function box(top: number, height: number, width = 300): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: width, width, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

/** A scroller box at client `top`, `height` tall, holding a `header`-px sticky header (0: none)
 *  and the rows in CURRENT DOM order, `rowHeight` each, below it. Unlike layoutRows, the rows MOVE
 *  with scrollTop — clamped to the content, as a browser clamps it — so a re-measure after a scroll
 *  sees where they went. Returns the scroller. */
function scrollBox({
  top,
  height,
  header = 0,
  rowHeight = 40,
  scrollTop = 0,
}: {
  top: number
  height: number
  header?: number
  rowHeight?: number
  scrollTop?: number
}): HTMLElement {
  const scroller = screen.getByTestId('scroller')
  const rowsInOrder = [...scroller.querySelectorAll<HTMLElement>('[data-reorder-id]')]
  const content = header + rowsInOrder.length * rowHeight
  let offset = scrollTop
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => offset,
    set: (value: number) => {
      offset = Math.min(Math.max(0, value), content - height)
    },
    configurable: true,
  })
  Object.defineProperty(scroller, 'scrollHeight', { value: content, configurable: true })
  Object.defineProperty(scroller, 'clientHeight', { value: height, configurable: true })
  scroller.getBoundingClientRect = () => box(top, height)
  scroller.querySelectorAll('th').forEach((th) => {
    th.getBoundingClientRect = () => box(top, header) // stuck at the box's top
  })
  rowsInOrder.forEach((element, index) => {
    element.getBoundingClientRect = () => box(top + header + index * rowHeight - offset, rowHeight)
  })
  return scroller
}

function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-reorder-id="${id}"]`)
  if (element === null) throw new Error(`no row ${id}`)
  return element
}

/** Every drop line in the document — reduced motion's overlay (spec §2.5 as amended by lane R7). */
const lines = () => [...document.querySelectorAll<HTMLElement>('.reorder-drop-line')]
/** The one drop line's placement: [top, left, width], or null when it is hidden. */
function linePlacement(): [string, string, string] | null {
  const all = lines()
  expect(all).toHaveLength(1)
  const [line] = all
  expect(line.parentElement).toBe(document.body)
  return line.hidden ? null : [line.style.top, line.style.left, line.style.width]
}

const grip = (name: string) => screen.getByRole('button', { name: `Reorder ${name}` })
const order = () =>
  [...document.querySelectorAll('[data-reorder-id]')].map((element) => element.getAttribute('data-reorder-id'))
const live = () => document.querySelector('[aria-live="assertive"]')?.textContent ?? ''

/** A cancel eases the moved rows home: they carry the settle transition and keep their state until
 *  MOTION_MS.fast has passed — still there 1ms before — then both are gone. (Fake timers.) */
function expectEasedHome(ids: string[]) {
  const held = () => {
    for (const id of ids) {
      expect(row(id).style.transition).toBe(`transform ${MOTION_MS.fast}ms ${EASE_OUT}`)
      expect(row(id).hasAttribute('data-reorder')).toBe(true)
    }
  }
  held()
  act(() => {
    vi.advanceTimersByTime(MOTION_MS.fast - 1)
  })
  held()
  act(() => {
    vi.advanceTimersByTime(1)
  })
  for (const id of ids) {
    expect(row(id).style.transition).toBe('')
    expect(row(id).hasAttribute('data-reorder')).toBe(false)
  }
}

function reduceMotion() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
}

beforeAll(() => installPointerEvents())

beforeEach(() => {
  // jsdom logs "not implemented" for window.scrollBy; the hook only scrolls near an edge.
  window.scrollBy = vi.fn()
})

afterEach(() => {
  // vitest runs without globals here, so RTL never registers its own afterEach cleanup. First, so a
  // list unmounts (and clears its drag's timers) while the test's clock is still the one it armed.
  cleanup()
  // No test may leave a drop line behind: every list has unmounted, whatever state its drag was in.
  expect(lines()).toEqual([])
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.classList.remove('reorder-active')
})

describe('useReorder — keyboard', () => {
  it('Space lifts, arrows preview, Space drops: one commit, the new order, focus kept on the grip', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    expect(grip('Alpha').getAttribute('aria-describedby')).toBe(
      document.querySelector('.visually-hidden')?.id,
    )
    grip('Alpha').focus()
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(live()).toBe('Picked up Alpha. Position 1 of 4.')
    expect(grip('Alpha').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('active').textContent).toBe('true')
    expect(row('A').getAttribute('data-reorder')).toBe('lifted')
    expect(row('A').getAttribute('data-reorder-mode')).toBe('keyboard')
    expect(row('B').getAttribute('data-reorder')).toBe('shifting')

    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    expect(live()).toBe('Alpha, position 3 of 4.')
    expect(row('A').style.transform).toBe('translateY(80px)')
    expect(row('B').style.transform).toBe('translateY(-40px)')
    expect(row('C').style.transform).toBe('translateY(-40px)')
    expect(row('D').style.transform).toBe('')
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(['B', 'C', 'A', 'D'], 'A')
    expect(order()).toEqual(['B', 'C', 'A', 'D'])
    expect(live()).toBe('Dropped Alpha at position 3 of 4.')
    expect(row('A').style.transform).toBe('')
    expect(row('A').hasAttribute('data-reorder')).toBe(false)
    expect(row('B').hasAttribute('data-reorder')).toBe(false)
    expect(document.activeElement).toBe(grip('Alpha'))
    expect(grip('Alpha').getAttribute('aria-pressed')).toBeNull()
    expect(screen.getByTestId('active').textContent).toBe('false')
  })

  it('Enter lifts too; Home and End jump to the ends; the arrows clamp there', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Charlie'), { key: 'Enter' })
    fireEvent.keyDown(grip('Charlie'), { key: 'Home' })
    expect(live()).toBe('Charlie, position 1 of 4.')
    fireEvent.keyDown(grip('Charlie'), { key: 'ArrowUp' })
    expect(live()).toBe('Charlie, position 1 of 4.')
    fireEvent.keyDown(grip('Charlie'), { key: 'End' })
    fireEvent.keyDown(grip('Charlie'), { key: 'ArrowDown' })
    expect(live()).toBe('Charlie, position 4 of 4.')
    fireEvent.keyDown(grip('Charlie'), { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(['A', 'B', 'D', 'C'], 'C')
  })

  it('a held Space or Enter never lifts, drops and lifts again — key repeats are ignored', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    // The lift's Space, still held — swallowed (false: defaultPrevented), never a button click.
    expect(fireEvent.keyDown(grip('Alpha'), { key: ' ', repeat: true })).toBe(false)
    expect(onCommit).not.toHaveBeenCalled()
    expect(grip('Alpha').getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(grip('Alpha'), { key: ' ' }) // a fresh press drops
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(fireEvent.keyDown(grip('Alpha'), { key: 'Enter', repeat: true })).toBe(false) // held past the drop
    expect(grip('Alpha').getAttribute('aria-pressed')).toBeNull()
    expect(live()).toBe('Dropped Alpha at position 2 of 3.')
  })

  it('a drop where it started commits nothing', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Bravo'), { key: ' ' })
    fireEvent.keyDown(grip('Bravo'), { key: 'ArrowDown' })
    fireEvent.keyDown(grip('Bravo'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Bravo'), { key: ' ' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(live()).toBe('Dropped Bravo where it was.')
  })

  it('Escape cancels, eases every row home, and never reaches a popover listening on document', () => {
    vi.useFakeTimers()
    const onCommit = vi.fn()
    // usePopoverDismiss's shape: a document capture listener that acts on Escape only (the lift's
    // Enter and the ArrowUp rightly pass through to it).
    const popover = vi.fn()
    const popoverKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') popover()
    }
    document.addEventListener('keydown', popoverKeys, true)
    onTestFinished(() => document.removeEventListener('keydown', popoverKeys, true))
    render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Bravo'), { key: 'Enter' })
    fireEvent.keyDown(grip('Bravo'), { key: 'ArrowUp' })
    expect(row('B').style.transform).toBe('translateY(-40px)')
    // fireEvent answers dispatchEvent: false means the Escape was defaultPrevented (spec §2.3).
    expect(fireEvent.keyDown(grip('Bravo'), { key: 'Escape' })).toBe(false)
    expect(popover).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
    expect(live()).toBe('Cancelled. Bravo is back at position 2 of 3.')
    expect(row('B').style.transform).toBe('')
    expect(row('A').style.transform).toBe('')
    expectEasedHome(['A', 'B'])
    expect(order()).toEqual(['A', 'B', 'C'])
  })

  it('tabbing away (the grip blurs) cancels a keyboard lift', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    grip('Bravo').focus()
    fireEvent.keyDown(grip('Bravo'), { key: ' ' })
    fireEvent.keyDown(grip('Bravo'), { key: 'ArrowDown' })
    act(() => {
      grip('Bravo').blur()
    })
    expect(live()).toBe('Cancelled. Bravo is back at position 2 of 3.')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('data landing under a live lift cancels it at once and says the list changed; the next Space lifts afresh', () => {
    const onCommit = vi.fn()
    const { rerender } = render(<List items={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Bravo'), { key: ' ' })
    fireEvent.keyDown(grip('Bravo'), { key: 'ArrowDown' })
    rerender(<List items={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    expect(live()).toBe('Cancelled — the list changed.')
    expect(grip('Bravo').getAttribute('aria-pressed')).toBeNull()
    // At once, no easing home: the rows have already re-rendered.
    expect(row('B').style.transform).toBe('')
    expect(row('B').style.transition).toBe('')
    expect(row('B').hasAttribute('data-reorder')).toBe(false)
    expect(row('C').hasAttribute('data-reorder')).toBe(false)
    layoutRows()
    fireEvent.keyDown(grip('Bravo'), { key: ' ' })
    expect(live()).toBe('Picked up Bravo. Position 2 of 4.')
    // The list turning busy under a live lift is the same cancel.
    rerender(<List items={flat('A', 'B', 'C', 'D')} onCommit={onCommit} disabled />)
    expect(live()).toBe('Cancelled — the list changed.')
    expect(grip('Bravo').getAttribute('aria-pressed')).toBeNull()
    expect(row('B').hasAttribute('data-reorder')).toBe(false)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('data landing after the unit let go keeps the sentence that stands', () => {
    vi.useFakeTimers()
    const onCommit = vi.fn()
    const { rerender } = render(<List items={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Bravo'), { key: ' ' })
    fireEvent.keyDown(grip('Bravo'), { key: 'Escape' })
    expect(live()).toBe('Cancelled. Bravo is back at position 2 of 3.')
    rerender(<List items={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />) // mid settle-back
    expect(live()).toBe('Cancelled. Bravo is back at position 2 of 3.')
    expect(row('B').style.transition).toBe('')
    expect(row('B').hasAttribute('data-reorder')).toBe(false)
  })

  it('keeps the landing slot on screen when its scroller hangs past the window', () => {
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto' }}>
        <Stateful initial={flat('A', 'B', 'C', 'D')} />
      </div>,
    )
    const scroller = screen.getByTestId('scroller')
    Object.defineProperty(scroller, 'scrollHeight', { value: 900, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 420, configurable: true })
    scroller.getBoundingClientRect = () =>
      ({ top: 600, bottom: 1020, height: 420, left: 0, right: 300, width: 300, x: 0, y: 600, toJSON: () => ({}) }) as DOMRect
    layoutRows(40, 600) // rows at 600..760 from the scroller's top; jsdom's window is 768 tall
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    expect(window.scrollBy).not.toHaveBeenCalled() // landing at 680..720: on screen
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    // Landing at 720..760, past 768 − 40: the page scrolls 32 — judged where the unit LANDS.
    expect(window.scrollBy).toHaveBeenCalledWith(0, 32)
  })

  it('a busy list keeps its grips focusable but inert', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B')} onCommit={onCommit} disabled />)
    layoutRows()
    expect(grip('Alpha').getAttribute('aria-disabled')).toBe('true')
    expect((grip('Alpha') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(live()).toBe('')
    expect(grip('Alpha').getAttribute('aria-pressed')).toBeNull()
  })

  it('a range of one has a disabled grip', () => {
    render(<Stateful initial={flat('A')} />)
    expect((grip('Alpha') as HTMLButtonElement).disabled).toBe(true)
  })

  it('carried rows travel with their unit; a component moves among its siblings only', () => {
    const onCommit = vi.fn()
    const items: ReorderItem<string>[] = [
      { id: 'P', range: 'g', carries: ['C1', 'C2'] },
      { id: 'C1', range: 'parent:P' },
      { id: 'C2', range: 'parent:P' },
      { id: 'Q', range: 'g' },
    ]
    render(<Stateful initial={items} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Quebec'), { key: ' ' })
    expect(live()).toBe('Picked up Quebec. Position 2 of 2 in Group.')
    fireEvent.keyDown(grip('Quebec'), { key: 'ArrowUp' })
    expect(row('Q').style.transform).toBe('translateY(-120px)')
    expect(row('P').style.transform).toBe('translateY(40px)')
    expect(row('C1').style.transform).toBe('translateY(40px)')
    expect(row('C2').style.transform).toBe('translateY(40px)')
    fireEvent.keyDown(grip('Quebec'), { key: ' ' })
    expect(onCommit).toHaveBeenLastCalledWith(['Q', 'P', 'C1', 'C2'], 'Q')

    layoutRows()
    fireEvent.keyDown(grip('Comp two'), { key: ' ' })
    expect(live()).toBe('Picked up Comp two. Position 2 of 2.')
    fireEvent.keyDown(grip('Comp two'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Comp two'), { key: ' ' })
    expect(onCommit).toHaveBeenLastCalledWith(['Q', 'P', 'C2', 'C1'], 'C2')

    // The parent's unit now carries its components in their new order.
    layoutRows()
    fireEvent.keyDown(grip('Parent'), { key: ' ' })
    fireEvent.keyDown(grip('Parent'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Parent'), { key: ' ' })
    expect(onCommit).toHaveBeenLastCalledWith(['P', 'C2', 'C1', 'Q'], 'P')
  })

  it('works under StrictMode: a keyboard lift, move and drop commit exactly once', () => {
    const onCommit = vi.fn()
    render(
      <StrictMode>
        <Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />
      </StrictMode>,
    )
    layoutRows()
    grip('Alpha').focus()
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(live()).toBe('Picked up Alpha. Position 1 of 3.')
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    expect(row('A').style.transform).toBe('translateY(40px)')
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(['B', 'A', 'C'], 'A')
    expect(order()).toEqual(['B', 'A', 'C'])
    expect(row('A').hasAttribute('data-reorder')).toBe(false)
    expect(document.activeElement).toBe(grip('Alpha'))
  })

  it('markSaved flashes the unit for MOTION_MS.flash', () => {
    vi.useFakeTimers()
    render(<Stateful initial={flat('A', 'B', 'C')} />)
    fireEvent.click(screen.getByRole('button', { name: 'mark Bravo saved' }))
    expect(row('B').hasAttribute('data-reorder-saved')).toBe(true)
    expect(row('A').hasAttribute('data-reorder-saved')).toBe(false)
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.flash - 1)
    })
    expect(row('B').hasAttribute('data-reorder-saved')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(row('B').hasAttribute('data-reorder-saved')).toBe(false)
  })
})

describe('useReorder — pointer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('a press that travels under 4px is a click: no lift, no commit', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 223 })
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 223 })
    expect(live()).toBe('')
    expect(onCommit).not.toHaveBeenCalled()
    expect(row('A').hasAttribute('data-reorder')).toBe(false)
  })

  it('drags: the unit follows the pointer, peers make room, the drop eases in and commits once', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 230 })
    expect(live()).toBe('Picked up Alpha. Position 1 of 4.')
    expect(document.documentElement.classList.contains('reorder-active')).toBe(true)
    expect(row('A').getAttribute('data-reorder')).toBe('lifted')
    expect(row('A').hasAttribute('data-reorder-mode')).toBe(false)
    expect(row('B').getAttribute('data-reorder')).toBe('shifting')
    expect(screen.getByTestId('active').textContent).toBe('true')

    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 305 })
    expect(row('A').style.transform).toBe('translateY(85px)')
    expect(row('B').style.transform).toBe('translateY(-40px)')
    expect(row('C').style.transform).toBe('translateY(-40px)')
    expect(row('D').style.transform).toBe('')
    expect(live()).toBe('Alpha, position 3 of 4.')

    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 305 })
    // A browser releases the capture right after every up: the settling drop must ride it out.
    fireEvent.lostPointerCapture(grip('Alpha'), { pointerId: 1 })
    expect(row('A').style.transform).toBe('translateY(80px)') // easing into its gap
    expect(live()).toBe('Alpha, position 3 of 4.')
    expect(onCommit).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast - 1)
    })
    expect(onCommit).not.toHaveBeenCalled() // the settle holds until the last millisecond
    expect(row('A').style.transform).toBe('translateY(80px)')
    expect(row('A').getAttribute('data-reorder')).toBe('lifted')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(['B', 'C', 'A', 'D'], 'A')
    expect(order()).toEqual(['B', 'C', 'A', 'D'])
    expect(row('A').style.transform).toBe('')
    expect(row('B').hasAttribute('data-reorder')).toBe(false)
    expect(document.documentElement.classList.contains('reorder-active')).toBe(false)
    expect(live()).toBe('Dropped Alpha at position 3 of 4.')
  })

  it("a data change during the drop's settle cancels the commit and says the list changed", () => {
    const onCommit = vi.fn()
    const { rerender } = render(<List items={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 305 })
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 305 })
    expect(row('A').style.transform).toBe('translateY(80px)') // settling: still lifted
    rerender(<List items={flat('A', 'B', 'C', 'D', 'E')} onCommit={onCommit} />)
    expect(live()).toBe('Cancelled — the list changed.')
    expect(row('A').style.transform).toBe('')
    expect(row('A').hasAttribute('data-reorder')).toBe(false)
    expect(document.documentElement.classList.contains('reorder-active')).toBe(false)
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(onCommit).not.toHaveBeenCalled()
    expect(order()).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('auto-scrolls near the window edge, and the lifted unit rides the scroll under the pointer', () => {
    render(<Stateful initial={flat('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J')} />)
    layoutRows(40, 500) // ten rows, 500..900: the list runs past jsdom's 768px window
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 520 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 750 }) // inside the bottom 40px
    expect(row('A').style.transform).toBe('translateY(230px)')
    act(() => {
      vi.advanceTimersByTime(32) // fake rAF: two frames
    })
    const scrolls = vi.mocked(window.scrollBy).mock.calls
    expect(scrolls.length).toBeGreaterThan(0)
    for (const [x, y] of scrolls) {
      expect(x).toBe(0)
      expect(y).toBeGreaterThan(0)
    }
    // The stubbed scrollBy moves nothing, so the test scrolls the page itself: the pointer now sits
    // 100px further down the list and the unit follows it — clamped at the list's end.
    const scrollY = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(100)
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(row('A').style.transform).toBe('translateY(330px)')
    scrollY.mockReturnValue(400)
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(row('A').style.transform).toBe('translateY(360px)') // J's bottom, 900, less A's, 540
  })

  it('a pointer drop gives focus back to the moved grip when it held focus', () => {
    // A browser blurs an element whose ROW is moved; jsdom blurs only a moved node itself. So the
    // commit does what the reorder's DOM move does in a browser.
    const blurLikeTheMove = () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={blurLikeTheMove} />)
    layoutRows()
    grip('Alpha').focus()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 305 })
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 305 })
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(order()).toEqual(['B', 'C', 'A', 'D'])
    expect(document.activeElement).toBe(grip('Alpha'))
  })

  it('a drop never takes focus from elsewhere', () => {
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} />)
    layoutRows()
    const elsewhere = screen.getByRole('button', { name: 'mark Bravo saved' })
    elsewhere.focus()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 305 })
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 305 })
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(order()).toEqual(['B', 'C', 'A', 'D'])
    expect(document.activeElement).toBe(elsewhere)
  })

  it('auto-scroll stops once the end of the range is in view — the held row never scrolls away', () => {
    let scrollY = 0
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY)
    const scrollBy = vi.fn((_x: number, dy: number) => {
      scrollY += dy
    })
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy
    render(<Stateful initial={flat('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J')} />)
    layoutRows(40, 500) // the range: 500..900 in list coordinates, past jsdom's 768px window
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 520 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 750 }) // held in the bottom zone
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    // The page scrolled until the range's end (900) showed clear of the bottom zone,
    // 900 − (768 − 40) = 172, and by at most one more step.
    expect(scrollY).toBeGreaterThanOrEqual(172)
    expect(scrollY).toBeLessThan(172 + AUTO_SCROLL_MAX)
    const scrolls = scrollBy.mock.calls.length
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(scrollBy.mock.calls.length).toBe(scrolls) // still held in the zone: the page stays put
  })

  it("judges the range's end in the band the reader sees: a scroller hanging past the window scrolls on until that end clears the window's bottom zone", () => {
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto' }}>
        <Stateful initial={flat('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J')} />
      </div>,
    )
    const scroller = screen.getByTestId('scroller')
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 420, configurable: true })
    Object.defineProperty(scroller, 'scrollTop', { value: 0, writable: true, configurable: true })
    // The box runs 600..1020, past jsdom's 768px window: the reader sees only its 600..768.
    scroller.getBoundingClientRect = () =>
      ({ top: 600, bottom: 1020, height: 420, left: 0, right: 300, width: 300, x: 0, y: 600, toJSON: () => ({}) }) as DOMRect
    layoutRows(40, 600) // the range: 0..400 of the scroller's content
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 620 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 750 }) // held in the window's bottom zone
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    // The end (400) must clear the WINDOW's bottom zone: 400 − (768 − 600 − 40) = 272. Judged in the
    // box, it cleared at 20 — while still 212px below the window, out of the pointer's reach.
    expect(scroller.scrollTop).toBeGreaterThanOrEqual(272)
    expect(scroller.scrollTop).toBeLessThan(272 + AUTO_SCROLL_MAX)
    const held = scroller.scrollTop
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(scroller.scrollTop).toBe(held)
    expect(window.scrollBy).not.toHaveBeenCalled()
  })

  it('the row in hand keeps following the pointer when the PAGE scrolls under its box — every scroll re-tracks', () => {
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto' }}>
        <Stateful initial={flat('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J')} />
      </div>,
    )
    // A 200px Settings-like box at 100, rows 0..400 of its content: A at 100..140.
    const scroller = scrollBox({ top: 100, height: 200 })
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 120 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 170 }) // clear of both zones
    expect(row('A').style.transform).toBe('translateY(50px)')
    // A wheel scrolls the PAGE 30px: the box, and the list in it, rise under the still pointer.
    scroller.getBoundingClientRect = () => box(70, 200)
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    // The pointer now stands 30px further down the list, and the row stays under it.
    expect(row('A').style.transform).toBe('translateY(80px)')
    expect(live()).toBe('Alpha, position 3 of 10.') // its leading edge (120) passed B's and C's middles
  })

  it("auto-scroll stops only once the range's first row clears the box's sticky header — never parked beneath it", () => {
    const ids = Array.from({ length: 20 }, (_, index) => `r${index}`)
    // Two ranges of ten, like the Settings roster's groups; the drag stays in the second.
    render(<TableList items={ids.map((id, index) => ({ id, range: index < 10 ? 'first' : 'second' }))} />)
    // A 420px box at 100 under a 60px header — taller than the 40px edge zone, as Categories &
    // weights' two-line 46px header is at 1280. Scrolled to its end (440): the second range starts at
    // 460 of the content, its first row hidden under the header at 120..160.
    const scroller = scrollBox({ top: 100, height: 420, header: 60, scrollTop: 440 })
    fireEvent.pointerDown(grip('r19'), { pointerId: 1, button: 0, clientY: 500 })
    fireEvent.pointerMove(grip('r19'), { pointerId: 1, clientY: 130 }) // over the header: full speed up
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    // The zone starts at the header's foot (160), so the scroll stops once the range's first row
    // (460) shows the 40px edge zone clear below it: 460 − (60 + 40) = 360, by at most one step
    // more. Judged from the box's own top it stopped at 404, the row still 4px under the header.
    expect(scroller.scrollTop).toBeLessThanOrEqual(360)
    expect(scroller.scrollTop).toBeGreaterThan(360 - AUTO_SCROLL_MAX)
    expect(row('r10').getBoundingClientRect().top).toBeGreaterThanOrEqual(160 + 40)
    const held = scroller.scrollTop
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(scroller.scrollTop).toBe(held) // still held in the zone: the box stays put
  })

  it('a throwing onCommit still leaves every row clean, and its error is rethrown after', () => {
    render(
      <Stateful
        initial={flat('A', 'B', 'C', 'D')}
        onCommit={() => {
          throw new Error('save exploded')
        }}
      />,
    )
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 305 })
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 305 })
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(MOTION_MS.fast)
      }),
    ).toThrow('save exploded')
    for (const id of ['A', 'B', 'C', 'D']) {
      expect(row(id).style.transform).toBe('')
      expect(row(id).style.transition).toBe('')
      expect(row(id).hasAttribute('data-reorder')).toBe(false)
    }
    expect(document.documentElement.classList.contains('reorder-active')).toBe(false)
  })

  it('a tall unit passes a short last peer: its leading edge decides, not its centre', () => {
    const onCommit = vi.fn()
    // Settings › Accounts' shape: a parent carrying three components, then one short peer at the
    // end of the range.
    const items: ReorderItem<string>[] = [
      { id: 'P', range: 'g', carries: ['C1', 'C2', 'C3'] },
      { id: 'C1', range: 'parent:P' },
      { id: 'C2', range: 'parent:P' },
      { id: 'C3', range: 'parent:P' },
      { id: 'Q', range: 'g' },
    ]
    render(<Stateful initial={items} onCommit={onCommit} />)
    layoutRows() // P's unit 200..360 (four rows), Q 360..400 (midpoint 380)
    fireEvent.pointerDown(grip('Parent'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Parent'), { pointerId: 1, clientY: 420 }) // clamped at +40
    // Its centre stops at 320, short of Q's midpoint; its bottom edge, at 400, is past it.
    expect(row('P').style.transform).toBe('translateY(40px)')
    expect(row('C3').style.transform).toBe('translateY(40px)')
    expect(row('Q').style.transform).toBe('translateY(-160px)')
    expect(live()).toBe('Parent, position 2 of 2.')
    fireEvent.pointerUp(grip('Parent'), { pointerId: 1, clientY: 420 })
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(['Q', 'P', 'C1', 'C2', 'C3'], 'P')
  })

  it('clamps the unit to the list', () => {
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} />)
    layoutRows()
    fireEvent.pointerDown(grip('Bravo'), { pointerId: 1, button: 0, clientY: 260 })
    fireEvent.pointerMove(grip('Bravo'), { pointerId: 1, clientY: 900 })
    expect(row('B').style.transform).toBe('translateY(80px)')
    expect(live()).toBe('Bravo, position 4 of 4.')
    fireEvent.pointerMove(grip('Bravo'), { pointerId: 1, clientY: -400 })
    expect(row('B').style.transform).toBe('translateY(-40px)')
    expect(live()).toBe('Bravo, position 1 of 4.')
  })

  it('a drop where it started eases home and commits nothing', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Bravo'), { pointerId: 1, button: 0, clientY: 260 })
    fireEvent.pointerMove(grip('Bravo'), { pointerId: 1, clientY: 270 })
    fireEvent.pointerMove(grip('Bravo'), { pointerId: 1, clientY: 262 })
    fireEvent.pointerUp(grip('Bravo'), { pointerId: 1, clientY: 262 })
    fireEvent.lostPointerCapture(grip('Bravo'), { pointerId: 1 }) // the browser's implicit release
    expect(live()).toBe('Dropped Bravo where it was.') // not a cancel
    expectEasedHome(['B'])
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('pointercancel and Escape abandon the drag; a second pointer is ignored', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 290 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 2, clientY: 220 })
    expect(row('A').style.transform).toBe('translateY(70px)')
    fireEvent.pointerCancel(grip('Alpha'), { pointerId: 1 })
    expect(live()).toBe('Cancelled. Alpha is back at position 1 of 3.')
    expectEasedHome(['A', 'B'])

    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 290 })
    fireEvent.keyDown(grip('Alpha'), { key: 'Escape' })
    expect(live()).toBe('Cancelled. Alpha is back at position 1 of 3.')
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 290 }) // mid-settle: changes nothing
    expectEasedHome(['A', 'B'])
    expect(onCommit).not.toHaveBeenCalled()
    expect(order()).toEqual(['A', 'B', 'C'])
  })

  it('Escape during a pending press abandons it, never the popover around it', () => {
    const onCommit = vi.fn()
    // usePopoverDismiss's shape: a document capture listener that acts on Escape only.
    const popover = vi.fn()
    const popoverKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') popover()
    }
    document.addEventListener('keydown', popoverKeys, true)
    onTestFinished(() => document.removeEventListener('keydown', popoverKeys, true))
    render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 222 }) // still pending: under 4px
    // fireEvent answers dispatchEvent: false means the Escape was defaultPrevented (spec §2.3.7).
    expect(fireEvent.keyDown(grip('Alpha'), { key: 'Escape' })).toBe(false)
    expect(popover).not.toHaveBeenCalled()
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 300 }) // +80px: the press is gone
    expect(live()).toBe('')
    expect(row('A').hasAttribute('data-reorder')).toBe(false)
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 300 })
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(onCommit).not.toHaveBeenCalled()

    // A plain click leaves nothing listening: the next Escape is the popover's again.
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 220 })
    expect(fireEvent.keyDown(grip('Alpha'), { key: 'Escape' })).toBe(true)
    expect(popover).toHaveBeenCalledTimes(1)
  })

  // Spec §2.6 names window blur among the cancels to pin; a resize and a capture lost with no up
  // (the OS took the pointer) share its path.
  it('a window blur, a resize or a lost capture abandons the drag', () => {
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    const abandons: (() => void)[] = [
      () => act(() => {
        window.dispatchEvent(new FocusEvent('blur'))
      }),
      () => act(() => {
        window.dispatchEvent(new Event('resize'))
      }),
      () => fireEvent.lostPointerCapture(grip('Alpha'), { pointerId: 1 }),
    ]
    for (const abandon of abandons) {
      fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
      fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 290 })
      expect(live()).toBe('Alpha, position 3 of 3.') // +70: its bottom (310) is past C's midpoint (300)
      abandon()
      expect(live()).toBe('Cancelled. Alpha is back at position 1 of 3.')
      expectEasedHome(['A', 'B'])
      expect(document.documentElement.classList.contains('reorder-active')).toBe(false)
    }
    expect(onCommit).not.toHaveBeenCalled()
    expect(order()).toEqual(['A', 'B', 'C'])
  })

  it('a secondary button never starts a drag', () => {
    render(<Stateful initial={flat('A', 'B')} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 2, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 300 })
    expect(live()).toBe('')
  })

  it('unmounting tears a live drag down inside the same commit, not a passive tick later', () => {
    const seen: boolean[] = []
    // A sibling's layout effect runs in the very commit that unmounts the list.
    function Probe() {
      useLayoutEffect(() => {
        seen.push(document.documentElement.classList.contains('reorder-active'))
      })
      return null
    }
    function Host({ show }: { show: boolean }) {
      return (
        <>
          {show && <Stateful initial={flat('A', 'B')} />}
          <Probe />
        </>
      )
    }
    const { rerender } = render(<Host show />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 250 })
    expect(document.documentElement.classList.contains('reorder-active')).toBe(true)
    rerender(<Host show={false} />)
    expect(seen.at(-1)).toBe(false)
  })

  it('a list unmounting while a drop settles into its gap still commits the drop — once', () => {
    const onCommit = vi.fn()
    const { unmount } = render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 305 })
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 305 })
    expect(onCommit).not.toHaveBeenCalled() // still settling
    unmount() // a popover closed right after the drop
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(['B', 'C', 'A', 'D'], 'A')
    expect(document.documentElement.classList.contains('reorder-active')).toBe(false)
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('a parent that owns the order keeps a drop its list unmounted during', () => {
    const committed = vi.fn()
    // R4's shape: the page owns the order; its list mounts only while a popover is open.
    function Parent() {
      const [items, setItems] = useState(flat('A', 'B', 'C', 'D'))
      const [open, setOpen] = useState(true)
      return (
        <>
          <p data-testid="parent-order">{items.map((item) => item.id).join(',')}</p>
          <button type="button" onClick={() => setOpen(false)}>
            Done
          </button>
          {open && (
            <List
              items={items}
              onCommit={(next, moved) => {
                setItems(next.map((id) => ({ id })))
                committed(next, moved)
              }}
            />
          )}
        </>
      )
    }
    render(<Parent />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 305 })
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 305 })
    fireEvent.click(screen.getByRole('button', { name: 'Done' })) // closed mid-settle
    expect(screen.queryByRole('button', { name: 'Reorder Alpha' })).toBeNull()
    expect(screen.getByTestId('parent-order').textContent).toBe('B,C,A,D')
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(committed).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('parent-order').textContent).toBe('B,C,A,D')
  })

  it('a list unmounting mid settle-back commits nothing — a cancel or an unmoved drop owes no order', () => {
    const onCommit = vi.fn()
    const cancelled = render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 290 })
    fireEvent.keyDown(grip('Alpha'), { key: 'Escape' }) // easing home
    cancelled.unmount()

    const unmoved = render(<Stateful initial={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Bravo'), { pointerId: 1, button: 0, clientY: 260 })
    fireEvent.pointerMove(grip('Bravo'), { pointerId: 1, clientY: 270 })
    fireEvent.pointerUp(grip('Bravo'), { pointerId: 1, clientY: 270 }) // dropped where it was
    unmoved.unmount()

    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("a consumer's error from that unmount commit cannot break the teardown", () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = render(
      <Stateful
        initial={flat('A', 'B', 'C', 'D')}
        onCommit={() => {
          throw new Error('save exploded')
        }}
      />,
    )
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 305 })
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 305 })
    expect(() => unmount()).not.toThrow()
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('useReorder'),
      expect.objectContaining({ message: 'save exploded' }),
    )
    expect(document.documentElement.classList.contains('reorder-active')).toBe(false)
  })

  it('unmounting mid-drag leaves no cursor class behind', () => {
    const { unmount } = render(<Stateful initial={flat('A', 'B')} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 250 })
    expect(document.documentElement.classList.contains('reorder-active')).toBe(true)
    unmount()
    expect(document.documentElement.classList.contains('reorder-active')).toBe(false)
  })
})

describe('useReorder — development contract checks', () => {
  const reportsIn = (error: { mock: { calls: unknown[][] } }) =>
    error.mock.calls.filter(([message]) => String(message).startsWith('useReorder:'))

  it('reports a list that breaks the items contract — once per change of its rows, StrictMode or not', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken: ReorderItem<string>[] = [
      { id: 'A', range: 'x' },
      { id: 'B', range: 'y' },
      { id: 'C', range: 'x' },
    ]
    const { rerender } = render(
      <StrictMode>
        <List items={broken} onCommit={vi.fn()} />
      </StrictMode>,
    )
    expect(reportsIn(error)).toEqual([[expect.stringContaining('range "x" is not one block')]])
    rerender(
      <StrictMode>
        <List items={[...broken]} onCommit={vi.fn()} disabled />
      </StrictMode>,
    ) // the same rows, only busy now: not again
    expect(reportsIn(error)).toHaveLength(1)
  })

  it('stays quiet for a well-formed list, carried rows included', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const items: ReorderItem<string>[] = [
      { id: 'P', range: 'g', carries: ['C1', 'C2'] },
      { id: 'C1', range: 'parent:P' },
      { id: 'C2', range: 'parent:P' },
      { id: 'Q', range: 'g' },
    ]
    render(<List items={items} onCommit={vi.fn()} />)
    expect(reportsIn(error)).toEqual([])
  })
})

describe('useReorder — reduced motion (spec §2.5)', () => {
  it('keyboard: peers never move, a drop line marks the landing edge, the drop commits at once', () => {
    reduceMotion()
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(row('B').hasAttribute('data-reorder')).toBe(false)
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    expect(row('A').style.transform).toBe('')
    expect(row('B').style.transform).toBe('')
    expect(row('C').getAttribute('data-reorder-drop')).toBe('after')
    // The line is the overlay, centred on C's bottom (320), as wide as the row.
    expect(linePlacement()).toEqual(['319px', '0px', '300px'])
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowUp' })
    expect(row('C').hasAttribute('data-reorder-drop')).toBe(false)
    expect(linePlacement()).toBeNull() // back in its own slot: nothing to mark
    fireEvent.keyDown(grip('Alpha'), { key: 'End' })
    expect(linePlacement()).toEqual(['359px', '0px', '300px'])
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(onCommit).toHaveBeenCalledWith(['B', 'C', 'D', 'A'], 'A')
    expect(row('D').hasAttribute('data-reorder-drop')).toBe(false)
    expect(lines()).toEqual([])
  })

  it('pointer: the unit still follows the pointer; the line marks a move upward on the top edge', () => {
    reduceMotion()
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.pointerDown(grip('Delta'), { pointerId: 1, button: 0, clientY: 340 })
    fireEvent.pointerMove(grip('Delta'), { pointerId: 1, clientY: 255 })
    expect(row('D').style.transform).toBe('translateY(-85px)')
    expect(row('B').style.transform).toBe('')
    expect(row('B').getAttribute('data-reorder-drop')).toBe('before')
    expect(linePlacement()).toEqual(['239px', '0px', '300px']) // on B's top (240)
    fireEvent.pointerUp(grip('Delta'), { pointerId: 1, clientY: 255 })
    fireEvent.lostPointerCapture(grip('Delta'), { pointerId: 1 }) // the browser's implicit release
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(['A', 'D', 'B', 'C'], 'D')
    expect(live()).toBe('Dropped Delta at position 2 of 4.')
    expect(lines()).toEqual([])
  })

  it('pointer: ONE line, drawn once there is a landing slot — it moves with the slot and hides back home', () => {
    reduceMotion()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 230 }) // lifted, still in its own slot
    expect(row('A').getAttribute('data-reorder')).toBe('lifted')
    expect(lines()).toEqual([])
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 305 }) // position 3: after C
    expect(linePlacement()).toEqual(['319px', '0px', '300px'])
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 265 }) // position 2: after B
    expect(linePlacement()).toEqual(['279px', '0px', '300px'])
    expect(row('B').getAttribute('data-reorder-drop')).toBe('after')
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 225 }) // home: no landing edge
    expect(linePlacement()).toBeNull()
    expect(document.querySelector('[data-reorder-drop]')).toBeNull()
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 225 })
    expect(lines()).toEqual([])
  })

  it("the line stands one layer above its list: over the row in hand in the page, over the popover a list sits in", () => {
    reduceMotion()
    render(
      <>
        <Stateful initial={flat('A', 'B', 'C', 'D')} />
        {/* Overview › Customize's shape: .popover-surface is position: absolute; z-index: 20. */}
        <div style={{ position: 'absolute', zIndex: 20 }}>
          <TableList items={flat('r0', 'r1', 'r2')} />
        </div>
      </>,
    )
    layoutRows()
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    expect(lines().map((line) => line.style.zIndex)).toEqual(['3'])
    fireEvent.keyDown(grip('Alpha'), { key: 'Escape' })
    fireEvent.keyDown(grip('r0'), { key: ' ' })
    fireEvent.keyDown(grip('r0'), { key: 'ArrowDown' })
    expect(lines().map((line) => line.style.zIndex)).toEqual(['21'])
    fireEvent.keyDown(grip('r0'), { key: 'Escape' })
    expect(lines()).toEqual([])
  })

  it('keyboard: the line is measured after the keep-in-view scroll, and follows any later scroll', () => {
    reduceMotion()
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto' }}>
        <Stateful initial={flat('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J')} />
      </div>,
    )
    // A 190px box at 100 over rows 0..400 of its content, scrolled to its top.
    const scroller = scrollBox({ top: 100, height: 190 })
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    expect(scroller.scrollTop).toBe(0)
    expect(linePlacement()).toEqual(['219px', '0px', '300px']) // after C: 100 + 120
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    // Landing at 120..160, past 190 − 40: the box scrolls 10 — and the line marks D's bottom where
    // it stands AFTER that scroll (100 + 160 − 10), not before it (260).
    expect(scroller.scrollTop).toBe(10)
    expect(linePlacement()).toEqual(['249px', '0px', '300px'])
    // Any later scroll — a wheel under a keyboard lift — takes the line along with its edge.
    scroller.scrollTop = 80
    fireEvent.scroll(scroller)
    expect(linePlacement()).toEqual(['179px', '0px', '300px'])
    fireEvent.keyDown(grip('Alpha'), { key: 'Escape' })
    expect(lines()).toEqual([])
  })

  it("the line hides while its edge is under the box's sticky header — the attribute still marks the slot", () => {
    vi.useFakeTimers() // the pointer rests in the top zone: no real frame may scroll mid-test
    reduceMotion()
    const ids = Array.from({ length: 12 }, (_, index) => `r${index}`)
    render(<TableList items={flat(...ids)} />)
    // A 420px box at 100 under a 60px header, scrolled 60: r0 at 100..140 and r1 at 140..180 have
    // their tops under the header (100..160); r2 stands at 180..220, r3 at 220..260.
    scrollBox({ top: 100, height: 420, header: 60, scrollTop: 60 })
    fireEvent.pointerDown(grip('r3'), { pointerId: 1, button: 0, clientY: 240 })
    fireEvent.pointerMove(grip('r3'), { pointerId: 1, clientY: 130 }) // position 1: before r0
    expect(row('r0').getAttribute('data-reorder-drop')).toBe('before')
    expect(linePlacement()).toBeNull()
    fireEvent.pointerMove(grip('r3'), { pointerId: 1, clientY: 200 }) // position 3: before r2
    expect(row('r2').getAttribute('data-reorder-drop')).toBe('before')
    expect(linePlacement()).toEqual(['179px', '0px', '300px'])
  })

  it('reads no computed style after the lift — not per pointer move, not per auto-scroll frame', () => {
    vi.useFakeTimers()
    reduceMotion()
    const ids = Array.from({ length: 20 }, (_, index) => `r${index}`)
    render(<TableList items={flat(...ids)} />)
    scrollBox({ top: 100, height: 420, header: 60, scrollTop: 440 }) // r19 at 480..520
    const handle = grip('r19') // a role query reads computed styles itself: found before the spy
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 500 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 440 }) // lifted; before r18: the line is made
    expect(linePlacement()).toEqual(['439px', '0px', '300px'])
    const styles = vi.spyOn(window, 'getComputedStyle')
    for (const y of [430, 420, 410, 400, 390]) fireEvent.pointerMove(handle, { pointerId: 1, clientY: y })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 130 }) // over the header: frames scroll the box
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(styles).not.toHaveBeenCalled()
  })

  it('a scroll listener that outlives its drag draws nothing — after a drop that commits at once, and after a cancel', () => {
    reduceMotion()
    // As if a drag's detach never ran: the window keeps every scroll listener it is given (put back
    // when the test ends). A direct commit leaves the drag's phase 'lifted', so only a guard on the
    // machine's live drag stops such a listener re-painting the list and re-making its line.
    const add = window.addEventListener.bind(window)
    const remove = window.removeEventListener.bind(window)
    const kept: EventListenerOrEventListenerObject[] = []
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'scroll' && listener !== null) kept.push(listener)
      add(type, listener, options)
    })
    vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => {
      if (type !== 'scroll') remove(type, listener, options)
    })
    onTestFinished(() => kept.forEach((listener) => remove('scroll', listener, true)))
    const onCommit = vi.fn()
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    const untouched = () => {
      expect(lines()).toEqual([])
      for (const id of ['A', 'B', 'C', 'D']) expect(row(id).style.transform).toBe('')
    }
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 305 })
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 305 }) // commits at once
    expect(onCommit).toHaveBeenCalledTimes(1)
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    untouched()
    layoutRows()
    fireEvent.pointerDown(grip('Bravo'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Bravo'), { pointerId: 1, clientY: 305 })
    fireEvent.keyDown(grip('Bravo'), { key: 'Escape' }) // a cancel
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    untouched()
    expect(kept.length).toBeGreaterThan(0) // the listeners really were kept
  })

  it('the line is gone once the drag lets go — a drop, a cancel, a hard reset, an unmount', () => {
    reduceMotion()
    const onCommit = vi.fn()
    const toPositionThree = () => {
      fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
      fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 305 })
      expect(linePlacement()).toEqual(['319px', '0px', '300px'])
    }
    const { rerender, unmount } = render(<List items={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    layoutRows()
    toPositionThree()
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 305 }) // a drop commits at once
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(lines()).toEqual([])
    toPositionThree()
    fireEvent.keyDown(grip('Alpha'), { key: 'Escape' }) // a cancel
    expect(lines()).toEqual([])
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 305 })
    toPositionThree()
    rerender(<List items={flat('A', 'B', 'C', 'D', 'E')} onCommit={onCommit} />) // data landed: a hard reset
    expect(live()).toBe('Cancelled — the list changed.')
    expect(lines()).toEqual([])
    layoutRows()
    toPositionThree()
    unmount()
    expect(lines()).toEqual([])
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('works under StrictMode: ONE line per drag, placed, and gone at the drop — keyboard and pointer', () => {
    reduceMotion()
    const onCommit = vi.fn()
    render(
      <StrictMode>
        <Stateful initial={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />
      </StrictMode>,
    )
    layoutRows()
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowDown' })
    expect(linePlacement()).toEqual(['319px', '0px', '300px']) // exactly one, after C
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(onCommit).toHaveBeenLastCalledWith(['B', 'C', 'A', 'D'], 'A')
    expect(lines()).toEqual([])
    layoutRows() // B, C, A, D from 200
    fireEvent.pointerDown(grip('Delta'), { pointerId: 1, button: 0, clientY: 340 })
    fireEvent.pointerMove(grip('Delta'), { pointerId: 1, clientY: 255 }) // position 2: before C
    expect(linePlacement()).toEqual(['239px', '0px', '300px'])
    fireEvent.pointerUp(grip('Delta'), { pointerId: 1, clientY: 255 })
    expect(onCommit).toHaveBeenCalledTimes(2)
    expect(onCommit).toHaveBeenLastCalledWith(['B', 'D', 'C', 'A'], 'D')
    expect(lines()).toEqual([])
  })

  it('with motion allowed no line is ever created — the peers make room instead', () => {
    vi.useFakeTimers()
    const observer = new MutationObserver(() => {})
    observer.observe(document.body, { childList: true, subtree: true })
    render(<Stateful initial={flat('A', 'B', 'C', 'D')} />)
    layoutRows()
    fireEvent.pointerDown(grip('Alpha'), { pointerId: 1, button: 0, clientY: 220 })
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 305 })
    expect(row('B').style.transform).toBe('translateY(-40px)')
    fireEvent.pointerMove(grip('Alpha'), { pointerId: 1, clientY: 265 })
    fireEvent.pointerUp(grip('Alpha'), { pointerId: 1, clientY: 265 })
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(order()).toEqual(['B', 'A', 'C', 'D'])
    layoutRows()
    fireEvent.keyDown(grip('Charlie'), { key: ' ' })
    fireEvent.keyDown(grip('Charlie'), { key: 'Home' })
    fireEvent.keyDown(grip('Charlie'), { key: ' ' })
    expect(order()).toEqual(['C', 'B', 'A', 'D'])
    const created = observer
      .takeRecords()
      .flatMap((record) => [...record.addedNodes])
      .filter((node) => node instanceof HTMLElement && node.classList.contains('reorder-drop-line'))
    observer.disconnect()
    expect(created).toEqual([])
    expect(lines()).toEqual([])
  })
})
