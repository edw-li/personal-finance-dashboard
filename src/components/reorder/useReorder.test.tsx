import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPointerEvents } from '../../testing/pointer'
import { MOTION_MS } from '../../theme/motion'
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
        setItems(
          next.flatMap((id) => {
            const item = byId.get(id)
            return item === undefined ? [] : [item]
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
  document.documentElement.className = ''
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
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast)
    })
    expect(row('B').hasAttribute('data-reorder')).toBe(false)
    expect(order()).toEqual(['A', 'B', 'C'])
    document.removeEventListener('keydown', popoverKeys, true)
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

  it('data landing under a live lift cancels it silently; the next Space lifts afresh', () => {
    const onCommit = vi.fn()
    const { rerender } = render(<List items={flat('A', 'B', 'C')} onCommit={onCommit} />)
    layoutRows()
    fireEvent.keyDown(grip('Bravo'), { key: ' ' })
    fireEvent.keyDown(grip('Bravo'), { key: 'ArrowDown' })
    rerender(<List items={flat('A', 'B', 'C', 'D')} onCommit={onCommit} />)
    expect(grip('Bravo').getAttribute('aria-pressed')).toBeNull()
    expect(row('B').style.transform).toBe('')
    expect(row('C').hasAttribute('data-reorder')).toBe(false)
    layoutRows()
    fireEvent.keyDown(grip('Bravo'), { key: ' ' })
    expect(live()).toBe('Picked up Bravo. Position 2 of 4.')
    expect(onCommit).not.toHaveBeenCalled()
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
  })

  it('markSaved flashes the unit for MOTION_MS.flash', () => {
    vi.useFakeTimers()
    render(<Stateful initial={flat('A', 'B', 'C')} />)
    fireEvent.click(screen.getByRole('button', { name: 'mark Bravo saved' }))
    expect(row('B').hasAttribute('data-reorder-saved')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(MOTION_MS.flash)
    })
    expect(row('B').hasAttribute('data-reorder-saved')).toBe(false)
  })
})
