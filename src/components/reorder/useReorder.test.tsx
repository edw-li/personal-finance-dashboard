import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, useLayoutEffect, useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { installPointerEvents } from '../../testing/pointer'
import { EASE_OUT, MOTION_MS } from '../../theme/motion'
import DragHandle from './DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from './ReorderStatus'
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

function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-reorder-id="${id}"]`)
  if (element === null) throw new Error(`no row ${id}`)
  return element
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
      expect(live()).toBe('Alpha, position 2 of 3.')
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
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowUp' })
    fireEvent.keyDown(grip('Alpha'), { key: 'ArrowUp' })
    expect(row('C').hasAttribute('data-reorder-drop')).toBe(false)
    fireEvent.keyDown(grip('Alpha'), { key: 'End' })
    fireEvent.keyDown(grip('Alpha'), { key: ' ' })
    expect(onCommit).toHaveBeenCalledWith(['B', 'C', 'D', 'A'], 'A')
    expect(row('D').hasAttribute('data-reorder-drop')).toBe(false)
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
    fireEvent.pointerUp(grip('Delta'), { pointerId: 1, clientY: 255 })
    fireEvent.lostPointerCapture(grip('Delta'), { pointerId: 1 }) // the browser's implicit release
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(['A', 'D', 'B', 'C'], 'D')
    expect(live()).toBe('Dropped Delta at position 2 of 4.')
  })
})
