import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import PerformanceLede from './PerformanceLede'

afterEach(cleanup)

// Code review 9: the Portfolio and Overview performance cards set the same sentence the same way —
// the words in the strip's muted ink, the figure in its bold ink — so they share one component.
it('sets the words muted and the figure in bold, one space between', () => {
  const { container } = render(
    <p>
      <PerformanceLede line={{ text: 'Over 1Y: ahead of the same money in VOO by', amount: '$37.2K' }} />
    </p>,
  )
  expect(container.textContent).toBe('Over 1Y: ahead of the same money in VOO by $37.2K')
  expect(container.querySelector('b')?.textContent).toBe('$37.2K')
})

it('has no figure to bold when the portfolio is level', () => {
  const { container } = render(
    <p>
      <PerformanceLede line={{ text: 'Level with the same deposits in VOO', amount: null }} />
    </p>,
  )
  expect(container.textContent).toBe('Level with the same deposits in VOO')
  expect(container.querySelector('b')).toBeNull()
})
