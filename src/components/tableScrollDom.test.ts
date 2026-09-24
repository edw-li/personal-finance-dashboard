import { cleanup, render } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealInBox, useStickyInsets } from './tableScrollDom'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function Box({ foot }: { foot: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useStickyInsets(ref)
  return createElement(
    'div',
    // react-hooks/refs reads createElement(type, props) as "a ref handed to a function"; the ref is
    // never READ here — React attaches it after the commit (useScrollEdges.test.ts's note). In a
    // call split over lines the rule reports the props line, so the directive sits on it.
    // eslint-disable-next-line react-hooks/refs
    { ref, 'data-testid': 'box' },
    createElement(
      'table',
      null,
      createElement('thead', null, createElement('tr', null, createElement('th', null, 'Col'))),
      createElement('tbody', null, createElement('tr', null, createElement('td', null, 'x'))),
      foot ? createElement('tfoot', null, createElement('tr', null, createElement('td', null, 'Total'))) : null,
    ),
  )
}

/** jsdom lays nothing out: a section's height comes from this table, keyed by tag name. */
function sectionHeights(heights: Record<string, number>): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const height = heights[this.tagName] ?? 0
    return { top: 0, bottom: height, left: 0, right: 0, width: 0, height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
}

describe('useStickyInsets', () => {
  it("writes the header's and the footer's heights on the box, fractions kept", () => {
    sectionHeights({ THEAD: 30.4, TFOOT: 33 })
    const { getByTestId } = render(createElement(Box, { foot: true }))
    const box = getByTestId('box')
    expect(box.style.getPropertyValue('--table-head-h')).toBe('30.4px')
    expect(box.style.getPropertyValue('--table-foot-h')).toBe('33px')
  })

  it('writes 0px for a table with no tfoot', () => {
    sectionHeights({ THEAD: 30 })
    const { getByTestId } = render(createElement(Box, { foot: false }))
    expect(getByTestId('box').style.getPropertyValue('--table-foot-h')).toBe('0px')
  })

  it('re-measures when the table resizes, and clears both on unmount', () => {
    const observed: Element[] = []
    let fire: () => void = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          fire = callback
        }
        observe(target: Element) {
          observed.push(target)
        }
        disconnect() {
          fire = () => {}
        }
      },
    )
    const heights: Record<string, number> = { THEAD: 30 }
    sectionHeights(heights)
    const view = render(createElement(Box, { foot: false }))
    const box = view.getByTestId('box')
    // Identity, not toEqual: toEqual compares DOM nodes structurally, so any lookalike table passes.
    expect(observed).toHaveLength(1)
    expect(observed[0]).toBe(box.querySelector('table'))
    heights.THEAD = 52 // the header wrapped onto two lines
    fire()
    expect(box.style.getPropertyValue('--table-head-h')).toBe('52px')
    view.unmount()
    fire() // a late resize: disconnected, the observer stays quiet, so nothing is written back
    expect(box.style.getPropertyValue('--table-head-h')).toBe('')
    expect(box.style.getPropertyValue('--table-foot-h')).toBe('')
  })

  it('picks up a tfoot that arrives with the data (Net worth renders its totals row once data lands)', () => {
    let fire: () => void = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          fire = callback
        }
        observe() {}
        disconnect() {}
      },
    )
    sectionHeights({ THEAD: 30, TFOOT: 33 })
    const view = render(createElement(Box, { foot: false }))
    const box = view.getByTestId('box')
    expect(box.style.getPropertyValue('--table-foot-h')).toBe('0px')
    view.rerender(createElement(Box, { foot: true }))
    fire() // the table grew by its totals row
    expect(box.style.getPropertyValue('--table-foot-h')).toBe('33px')
  })
})

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

/** A 400px box at y=100 whose pinned header is 30px, scrolled to 1000, and a row at `rowTop`. */
function scene(rowTop: number, rowHeight = 44, foot = 0) {
  const box = document.createElement('div')
  const row = document.createElement('div')
  box.style.setProperty('--table-head-h', '30px')
  box.style.setProperty('--table-foot-h', `${foot}px`)
  Object.defineProperty(box, 'clientHeight', { value: 400, configurable: true })
  Object.defineProperty(box, 'clientTop', { value: 0, configurable: true })
  box.getBoundingClientRect = () => rect(100, 400)
  row.getBoundingClientRect = () => rect(rowTop, rowHeight)
  box.scrollTop = 1000
  return { box, row }
}

describe('revealInBox', () => {
  it('leaves a row that already shows inside the band alone', () => {
    const { box, row } = scene(200)
    expect(revealInBox(box, row)).toBe(false)
    expect(box.scrollTop).toBe(1000)
  })

  it('treats a row flush with either edge of the band as shown (a second reveal is a no-op)', () => {
    // Where a reveal leaves a row: its top on the band's top (130), or its bottom on the band's
    // bottom (456 + 44 = 500).
    for (const rowTop of [130, 456]) {
      const { box, row } = scene(rowTop)
      expect(revealInBox(box, row)).toBe(false)
      expect(box.scrollTop).toBe(1000)
    }
  })

  it('scrolls up so a row under the pinned header lands just below it', () => {
    const { box, row } = scene(110) // the band starts at 100 + 30 = 130
    expect(revealInBox(box, row)).toBe(true)
    expect(box.scrollTop).toBe(980)
  })

  it('counts a pinned group line as part of the header', () => {
    const { box, row } = scene(150) // the band starts at 130 + 32 = 162
    expect(revealInBox(box, row, 32)).toBe(true)
    expect(box.scrollTop).toBe(988)
  })

  it('scrolls down just enough for a row below the band, clear of a pinned footer', () => {
    const { box, row } = scene(480, 44, 33) // the band ends at 100 + 400 − 33 = 467; the row at 524
    expect(revealInBox(box, row)).toBe(true)
    expect(box.scrollTop).toBe(1057)
  })

  it('aligns a row taller than the band by its top', () => {
    const { box, row } = scene(600, 500) // down by min(1100 − 500, 600 − 130) = 470
    expect(revealInBox(box, row)).toBe(true)
    expect(box.scrollTop).toBe(1470)
  })

  it("keeps the band inside the box's top border and above a sideways scrollbar", () => {
    // Both sit inside the box's rect (100 to 517: a 2px border, 400px of rows, a 15px scrollbar),
    // so the band runs from 100 + 2 + 30 = 132 to 100 + 2 + 400 = 502 — not to the rect's bottom.
    const framed = (rowTop: number) => {
      const { box, row } = scene(rowTop)
      Object.defineProperty(box, 'clientTop', { value: 2, configurable: true })
      box.getBoundingClientRect = () => rect(100, 417)
      return { box, row }
    }
    const behindBar = framed(466) // the row's bottom at 510, under the scrollbar
    expect(revealInBox(behindBar.box, behindBar.row)).toBe(true)
    expect(behindBar.box.scrollTop).toBe(1008)
    const underHead = framed(131) // a pixel under the header, which starts below the border
    expect(revealInBox(underHead.box, underHead.row)).toBe(true)
    expect(underHead.box.scrollTop).toBe(999)
  })

  it('reveals against the bare box before its pinned rows are measured', () => {
    // Unset, both properties parse to NaN, which fails every comparison: without the `|| 0` the
    // reveal would silently do nothing. Unmeasured, the band is the whole box, 100 to 500; one row
    // above it and one below, so each limit's fallback is exercised.
    const bare = (rowTop: number) => {
      const { box, row } = scene(rowTop)
      box.style.removeProperty('--table-head-h')
      box.style.removeProperty('--table-foot-h')
      return { box, row }
    }
    const above = bare(90) // up by 100 − 90 = 10
    expect(revealInBox(above.box, above.row)).toBe(true)
    expect(above.box.scrollTop).toBe(990)
    const below = bare(480) // down by min(524 − 500, 480 − 100) = 24
    expect(revealInBox(below.box, below.row)).toBe(true)
    expect(below.box.scrollTop).toBe(1024)
  })
})
