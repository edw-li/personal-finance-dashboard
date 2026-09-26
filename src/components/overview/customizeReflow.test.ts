import { afterEach, describe, expect, it, vi } from 'vitest'
import { EASE_OUT, MOTION_MS } from '../../theme/motion'
import { childRects, deeperSpans, flipChildren } from './customizeReflow'

// 2026-09-25 polish spec §3.2 (OU-16): the two half-width charts pair only when they are adjacent;
// the spans are computed from the order the reader chose instead of hard-coded.
describe('deeperSpans', () => {
  const spans = (shown: Parameters<typeof deeperSpans>[0]) => Object.fromEntries(deeperSpans(shown))

  it('pairs the two charts where they sit side by side — the default order', () => {
    expect(spans(['ytd', 'performance', 'spending', 'money_flow'])).toEqual({ ytd: 12, performance: 6, spending: 6, money_flow: 12 })
  })

  it('pairs them in either order', () => {
    expect(spans(['spending', 'performance', 'ytd'])).toEqual({ spending: 6, performance: 6, ytd: 12 })
  })

  it('runs a chart with no half-width neighbour across the row', () => {
    expect(spans(['ytd', 'spending', 'money_flow'])).toEqual({ ytd: 12, spending: 12, money_flow: 12 })
    expect(spans(['performance', 'money_flow', 'spending'])).toEqual({ performance: 12, money_flow: 12, spending: 12 })
  })

  it('spans nothing when nothing is shown', () => {
    expect(deeperSpans([]).size).toBe(0)
  })
})

function box(left: number, top: number): DOMRect {
  return { left, top, right: left + 100, bottom: top + 50, width: 100, height: 50, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

/** A container 1200px wide holding children at the given boxes, each with a spy for animate() (jsdom
 *  has none, and lays nothing out). */
function container(boxes: DOMRect[]) {
  const root = document.createElement('div')
  root.getBoundingClientRect = () => ({ ...box(0, 0), right: 1200, width: 1200, bottom: 2000, height: 2000 }) as DOMRect
  const animate = vi.fn()
  for (const rect of boxes) {
    const child = document.createElement('div')
    child.getBoundingClientRect = () => rect
    child.animate = animate as unknown as Element['animate']
    root.appendChild(child)
  }
  return { root, animate }
}

describe('childRects', () => {
  it("reads each child's box under the id it draws, in render order", () => {
    const first = box(0, 0)
    const second = box(600, 0)
    const { root } = container([first, second])
    const rects = childRects(root, ['performance', 'spending'])
    expect([...rects.keys()]).toEqual(['performance', 'spending'])
    expect(rects.get('performance')).toBe(first)
    expect(rects.get('spending')).toBe(second)
  })

  it('is empty without a container', () => {
    expect(childRects(null, ['performance']).size).toBe(0)
  })
})

// 2026-09-25 polish spec §3.2 (OU-16): the popover's reflow glides instead of snapping behind it.
describe('flipChildren', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('glides a moved child from its old box, on --t-fast with the house curve', () => {
    const { root, animate } = container([box(0, 200)])
    flipChildren(root, ['spending'], new Map([['spending', box(600, 0)]]))
    expect(animate).toHaveBeenCalledWith([{ translate: '600px -200px' }, { translate: 'none' }], { duration: MOTION_MS.fast, easing: EASE_OUT })
  })

  // A half-width card that now runs the full row starts from its old left edge — which would hang it
  // ~580px past the grid's right side for the length of the glide, flashing a horizontal scrollbar.
  it('never slides a child past the container’s sides — a card that grew keeps only its vertical travel', () => {
    const { root, animate } = container([{ ...box(0, 400), right: 1200, width: 1200 } as DOMRect])
    flipChildren(root, ['spending'], new Map([['spending', box(600, 0)]]))
    expect(animate).toHaveBeenCalledWith([{ translate: '0px -400px' }, { translate: 'none' }], { duration: MOTION_MS.fast, easing: EASE_OUT })
  })

  it('fades in a child that was not there before', () => {
    const { root, animate } = container([box(0, 0)])
    flipChildren(root, ['money_flow'], new Map())
    expect(animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION_MS.fast, easing: EASE_OUT })
  })

  it('leaves a child that did not move alone', () => {
    const { root, animate } = container([box(0, 0)])
    flipChildren(root, ['ytd'], new Map([['ytd', box(0, 0)]]))
    expect(animate).not.toHaveBeenCalled()
  })

  it('does nothing for a reader who asked for less motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { root, animate } = container([box(0, 200)])
    flipChildren(root, ['spending'], new Map([['spending', box(600, 0)]]))
    expect(animate).not.toHaveBeenCalled()
  })

  it('does nothing where animate() is missing, or without a container', () => {
    const root = document.createElement('div')
    root.appendChild(document.createElement('div'))
    expect(() => flipChildren(root, ['spending'], new Map([['spending', box(600, 0)]]))).not.toThrow()
    expect(() => flipChildren(null, ['spending'], new Map())).not.toThrow()
  })
})
