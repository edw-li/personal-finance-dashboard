import { cleanup, render } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScrollEdges } from './useScrollEdges'

afterEach(cleanup)

// A scroller that is NOT in the DOM on the first render — the shape of every page that renders a
// table only once rows arrive. The hook is called unconditionally (rules of hooks) and told
// whether its target exists through `active`.
function LateScroller({ show }: { show: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useScrollEdges(ref, show)
  // eslint-disable-next-line react-hooks/refs
  return show ? createElement('div', { ref, 'data-testid': 'scroller' }) : null
}

function Scroller() {
  const ref = useRef<HTMLDivElement>(null)
  useScrollEdges(ref)
  // react-hooks/refs sees `createElement(type, props)` as "a ref handed to a function"; in JSX
  // (<div ref={ref} />) the same hand-off is the one the rule allows. A .ts harness cannot write
  // JSX, and the ref is never READ here — React attaches it after the commit, as always.
  // eslint-disable-next-line react-hooks/refs
  return createElement('div', { ref, 'data-testid': 'scroller' })
}

// jsdom lays nothing out: the scroller's box is faked as own properties (the Element.prototype
// getters are configurable, so an instance property shadows them), and scrollLeft is a real
// settable property there. The hook re-measures on `scroll`, so a fake box is applied and then
// announced through a scroll event.
function box(el: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
}

describe('useScrollEdges', () => {
  it('names the hidden edge, follows the scroll position and clears at the far end', () => {
    const { getByTestId } = render(createElement(Scroller))
    const el = getByTestId('scroller')
    // A 0×0 box on mount is "fits": no attribute, so no mask.
    expect(el.hasAttribute('data-scroll-more')).toBe(false)
    box(el, 600, 300)
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('right')
    el.scrollLeft = 150
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('left right')
    el.scrollLeft = 300
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('left')
  })

  it('carries no attribute when the content fits, re-reads on window resize, and cleans up', () => {
    const view = render(createElement(Scroller))
    const el = view.getByTestId('scroller')
    box(el, 300, 300)
    el.dispatchEvent(new Event('scroll'))
    expect(el.hasAttribute('data-scroll-more')).toBe(false)
    box(el, 600, 300)
    window.dispatchEvent(new Event('resize'))
    expect(el.getAttribute('data-scroll-more')).toBe('right')
    view.unmount()
    expect(el.hasAttribute('data-scroll-more')).toBe(false)
  })

  it('attaches when a conditionally rendered scroller arrives, not only on a warm mount', () => {
    const view = render(createElement(LateScroller, { show: false }))
    expect(view.queryByTestId('scroller')).toBeNull()
    view.rerender(createElement(LateScroller, { show: true }))
    const el = view.getByTestId('scroller')
    box(el, 600, 300)
    el.dispatchEvent(new Event('scroll'))
    // Without `active` in the effect's deps the effect never re-ran after its null-ref return, so
    // no listener existed and the table below an empty state stayed unmasked for its whole life.
    expect(el.getAttribute('data-scroll-more')).toBe('right')
  })
})

// Vertical twins (2026-09-24 table-scroll spec §2.3). A capped table box scrolls both ways, and
// `axes: 'xy'` names its hidden top and bottom edges too; every existing caller stays on 'x'.
function BothWays({ axes }: { axes?: 'x' | 'xy' }) {
  const ref = useRef<HTMLDivElement>(null)
  useScrollEdges(ref, true, axes)
  // eslint-disable-next-line react-hooks/refs
  return createElement('div', { ref, 'data-testid': 'scroller' }, createElement('table'))
}

function tall(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

describe('useScrollEdges, vertical', () => {
  it("names the hidden top and bottom after the sideways edges, with the right edge's 1px tolerance", () => {
    const { getByTestId } = render(createElement(BothWays, { axes: 'xy' }))
    const el = getByTestId('scroller')
    tall(el, 1000, 400)
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('bottom')
    el.scrollTop = 300
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('top bottom')
    // 599.5 + 400 is within a pixel of 1000: a box whose content rounds fractionally is at its foot.
    // …and 598.5 + 400 is a full 1.5px short of it: still "more below" — the tolerance is one pixel, not more.
    el.scrollTop = 598.5
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('top bottom')
    el.scrollTop = 599.5
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('top')
    box(el, 600, 300)
    el.scrollLeft = 100
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('left right top')
  })

  it('stays sideways-only by default, so every existing scroller keeps its exact attribute', () => {
    const { getByTestId } = render(createElement(BothWays, {}))
    const el = getByTestId('scroller')
    tall(el, 1000, 400)
    box(el, 600, 300)
    el.dispatchEvent(new Event('scroll'))
    expect(el.getAttribute('data-scroll-more')).toBe('right')
  })

  it("watches the box's table in 'xy', so rows landing refresh the edges without a scroll", () => {
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
        disconnect() {}
      },
    )
    try {
      const { getByTestId } = render(createElement(BothWays, { axes: 'xy' }))
      const el = getByTestId('scroller')
      expect(observed).toHaveLength(2)
      expect(observed[0]).toBe(el)
      expect(observed[1]).toBe(el.querySelector('table'))
      tall(el, 1000, 400)
      fire()
      expect(el.getAttribute('data-scroll-more')).toBe('bottom')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("observes only the box in the default 'x' — the table is watched in 'xy' alone", () => {
    const observed: Element[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(target: Element) {
          observed.push(target)
        }
        disconnect() {}
      },
    )
    try {
      const { getByTestId } = render(createElement(BothWays, {}))
      expect(observed).toHaveLength(1)
      expect(observed[0]).toBe(getByTestId('scroller'))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
