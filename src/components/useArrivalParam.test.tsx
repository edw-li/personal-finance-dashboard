import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useArrivalParam } from './useArrivalParam'

const TABS = ['dividends', 'securities', 'realized'] as const

function Probe({ apply }: { apply: (value: string) => void }) {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  useArrivalParam('tab', TABS, apply)
  return (
    <>
      <div data-testid="location">{pathname + search}</div>
      <button type="button" onClick={() => navigate('/portfolio?tab=dividends')}>
        go
      </button>
    </>
  )
}

function renderProbe(initialEntry: string) {
  const apply = vi.fn()
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Probe apply={apply} />
    </MemoryRouter>,
  )
  return apply
}

afterEach(cleanup)

describe('useArrivalParam', () => {
  it('applies a valid arrival value once and strips the param', () => {
    const apply = renderProbe('/portfolio?tab=dividends')
    expect(apply).toHaveBeenCalledWith('dividends')
    expect(screen.getByTestId('location').textContent).toBe('/portfolio')
  })

  it('strips an invalid value without applying it', () => {
    const apply = renderProbe('/portfolio?tab=banana')
    expect(apply).not.toHaveBeenCalled()
    expect(screen.getByTestId('location').textContent).toBe('/portfolio')
  })

  it('does nothing when the param is absent', () => {
    const apply = renderProbe('/portfolio')
    expect(apply).not.toHaveBeenCalled()
    expect(screen.getByTestId('location').textContent).toBe('/portfolio')
  })

  it('fires again on an in-page navigate — the already-mounted palette case', () => {
    const apply = renderProbe('/portfolio')
    expect(apply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    expect(apply).toHaveBeenCalledWith('dividends')
    expect(screen.getByTestId('location').textContent).toBe('/portfolio')
  })

  it('leaves unrelated params in place when stripping', () => {
    const apply = renderProbe('/portfolio?whatif=NVDA&tab=securities')
    expect(apply).toHaveBeenCalledWith('securities')
    expect(screen.getByTestId('location').textContent).toBe('/portfolio?whatif=NVDA')
  })
})
