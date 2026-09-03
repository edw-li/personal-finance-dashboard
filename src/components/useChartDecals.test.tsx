import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DECALS_KEY, readChartDecals, setChartDecals, useChartDecals } from './useChartDecals'

function Probe() {
  return <span data-testid="probe">{String(useChartDecals())}</span>
}
beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('chart decals store', () => {
  it('reads off by default, persists a choice under finance.chartDecals, and notifies live readers', () => {
    expect(readChartDecals()).toBe(false)
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('false')
    act(() => setChartDecals(true))
    expect(localStorage.getItem(DECALS_KEY)).toBe('on')
    expect(screen.getByTestId('probe').textContent).toBe('true')
    act(() => setChartDecals(false))
    expect(screen.getByTestId('probe').textContent).toBe('false')
  })
  it('seeds from a persisted value', () => {
    localStorage.setItem(DECALS_KEY, 'on')
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('true')
  })
})
