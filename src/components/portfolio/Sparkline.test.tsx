import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NEGATIVE, POSITIVE } from '../../charts/theme'
import Sparkline from './Sparkline'

afterEach(cleanup)

const pt = (d: string, c: string) => ({ d, c })

describe('Sparkline', () => {
  it('renders an em-dash placeholder with fewer than 2 points', () => {
    const { container } = render(<Sparkline points={[pt('2026-01-01', '10')]} />)
    expect(container.textContent).toBe('—')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('draws a rising line in the positive color', () => {
    const { container } = render(
      <Sparkline points={[pt('2026-01-01', '10'), pt('2026-06-01', '15')]} />,
    )
    const line = container.querySelector('polyline')
    expect(line).not.toBeNull()
    expect(line!.getAttribute('stroke')).toBe(POSITIVE)
  })

  it('draws a falling line in the negative color and survives a flat series', () => {
    const { container } = render(
      <Sparkline points={[pt('2026-01-01', '15'), pt('2026-06-01', '10')]} />,
    )
    expect(container.querySelector('polyline')!.getAttribute('stroke')).toBe(NEGATIVE)
    const flat = render(
      <Sparkline points={[pt('2026-01-01', '10'), pt('2026-06-01', '10')]} />,
    )
    expect(flat.container.querySelector('polyline')).not.toBeNull() // no NaN coords
  })
})
