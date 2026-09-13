import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { STAGGER_CAP } from '../theme/motion'
import { tagStagger, useStagger } from './useStagger'

// jsdom reports a zero rect for everything, which would call the whole document visible.
// One prototype stub answers with the top each fixture declares (innerHeight is 768).
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return { top: Number(this.dataset.top ?? 0) } as DOMRect
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** A tile row, then one card per top, each holding a nested card. */
function Harness({ ready, tops }: { ready: boolean; tops: number[] }) {
  const ref = useStagger<HTMLDivElement>(ready)
  return (
    <div ref={ref}>
      <div className="kpi-row" data-top="0" data-name="tiles" />
      {tops.map((top, i) => (
        <div className="card" data-top={top} data-name={`card${i}`} key={i}>
          <div className="card" data-top={top} data-name={`nested${i}`} />
        </div>
      ))}
    </div>
  )
}
const tagged = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-stagger]')).map(
    (el) => `${el.dataset.name}:${el.dataset.stagger}`,
  )

it('tags viewport groups in document order; a nested card rides its parent', () => {
  render(<Harness ready tops={[100, 300, 500]} />)
  expect(tagged()).toEqual(['tiles:0', 'card0:1', 'card1:2', 'card2:3'])
})

it('leaves everything below the fold untagged — no entrance; the reveal has it', () => {
  render(<Harness ready tops={[100, 900, 1600]} />)
  expect(tagged()).toEqual(['tiles:0', 'card0:1'])
})

it('waits for the payload, tags once, and caps the cascade at six groups', () => {
  const { rerender } = render(<Harness ready={false} tops={[1, 2, 3, 4, 5, 6, 7]} />)
  expect(tagged()).toEqual([])
  rerender(<Harness ready tops={[1, 2, 3, 4, 5, 6, 7]} />)
  expect(tagged().map((t) => t.split(':')[1])).toEqual(['0', '1', '2', '3', '4', '5', '5', '5'])
  expect(STAGGER_CAP).toBe(5)
  // A revalidation re-renders with the same status; re-tagging would replay the cascade.
  rerender(<Harness ready tops={[900, 900, 900, 900, 900, 900, 900]} />)
  expect(tagged()).toHaveLength(8)
})

it('exports the loop as tagStagger: starts at the given index, skips hidden groups, returns the next index', () => {
  render(
    <div data-testid="root">
      <div className="card" data-top="10" data-name="a" />
      <div hidden>
        <div className="card" data-top="0" data-name="hidden" />
      </div>
      <div className="card" data-top="20" data-name="b" />
      <div className="card" data-top="2000" data-name="below" />
    </div>,
  )
  // A hidden view's card measures 0×0 at the top of the viewport; tagging it would replay the
  // entrance the moment the view is shown (spec §2.4: no per-card cascade on a tab switch).
  const next = tagStagger(document.querySelector('[data-testid="root"]') as HTMLElement, 2)
  expect(tagged()).toEqual(['a:2', 'b:3'])
  expect(next).toBe(4)
})

it('the hook and the helper agree: a hidden wrapper at arrival is left untagged by useStagger too', () => {
  function Hidden() {
    const ref = useStagger<HTMLDivElement>(true)
    return (
      <div ref={ref}>
        <div className="card" data-top="0" data-name="shown" />
        <div hidden>
          <div className="card" data-top="0" data-name="hidden" />
        </div>
      </div>
    )
  }
  render(<Hidden />)
  expect(tagged()).toEqual(['shown:0'])
})
