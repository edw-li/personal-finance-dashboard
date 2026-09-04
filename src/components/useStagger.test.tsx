import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { STAGGER_CAP } from '../theme/motion'
import { useStagger } from './useStagger'

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
