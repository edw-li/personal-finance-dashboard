import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCallback, useState } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useArrivalParam, useArrivalValue } from './useArrivalParam'

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

  it('keeps the anchor it arrived with — the command is one-shot, the anchor is not', () => {
    const apply = vi.fn()
    render(
      <MemoryRouter initialEntries={['/portfolio?tab=dividends#dividends']}>
        <AnchorProbe apply={apply} />
      </MemoryRouter>,
    )
    expect(apply).toHaveBeenCalledWith('dividends')
    expect(screen.getByTestId('location').textContent).toBe('/portfolio#dividends')
  })
})

// The two hooks strip through one shared consume step, so the anchor case is pinned on
// both: a page reads location.hash to scroll and ring the card the link aimed at, and a
// strip that dropped the hash would undo the arrival it just delivered.
function AnchorProbe({ apply }: { apply: (value: string) => void }) {
  const { pathname, search, hash } = useLocation()
  useArrivalParam('tab', TABS, apply)
  return <div data-testid="location">{pathname + search + hash}</div>
}

function ValueProbe({ apply }: { apply: (value: string) => void }) {
  const { pathname, search } = useLocation()
  // Stable identity, as the hook's contract requires: a fresh callback each render would
  // re-run the strip effect forever.
  const stable = useCallback((value: string) => apply(value), [apply])
  useArrivalValue('ticker', stable)
  return <div data-testid="location">{pathname + search}</div>
}

function renderValueProbe(initialEntry: string) {
  const apply = vi.fn()
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ValueProbe apply={apply} />
    </MemoryRouter>,
  )
  return apply
}

describe('useArrivalValue', () => {
  it('hands any non-empty value over and strips the param', () => {
    const apply = renderValueProbe('/portfolio?ticker=NVDA')
    expect(apply).toHaveBeenCalledWith('NVDA')
    expect(screen.getByTestId('location').textContent).toBe('/portfolio')
  })

  it('trims before applying', () => {
    const apply = renderValueProbe('/portfolio?ticker=%20nvda%20')
    expect(apply).toHaveBeenCalledWith('nvda')
  })

  it('strips a blank value without applying it', () => {
    const apply = renderValueProbe('/portfolio?ticker=%20')
    expect(apply).not.toHaveBeenCalled()
    expect(screen.getByTestId('location').textContent).toBe('/portfolio')
  })

  it('leaves unrelated params in place when stripping', () => {
    const apply = renderValueProbe('/portfolio?tab=securities&ticker=NVDA')
    expect(apply).toHaveBeenCalledWith('NVDA')
    expect(screen.getByTestId('location').textContent).toBe('/portfolio?tab=securities')
  })

  it('keeps the anchor it arrived with, like its enum twin', () => {
    const apply = vi.fn()
    function HashValueProbe() {
      const { pathname, search, hash } = useLocation()
      const stable = useCallback((value: string) => apply(value), [])
      useArrivalValue('restore', stable)
      return <div data-testid="location">{pathname + search + hash}</div>
    }
    render(
      <MemoryRouter initialEntries={['/settings?restore=finance-export.zip#restore']}>
        <HashValueProbe />
      </MemoryRouter>,
    )
    expect(apply).toHaveBeenCalledWith('finance-export.zip')
    expect(screen.getByTestId('location').textContent).toBe('/settings#restore')
  })

  // The cold-load case the palette's entity links always hit: the page cannot resolve a
  // slug until its payload lands, and a param stripped at mount would be gone by then.
  it('holds the param while apply answers false, and applies it when the data lands', async () => {
    const apply = vi.fn().mockReturnValue(false)
    function LateProbe() {
      const { pathname, search } = useLocation()
      const [ready, setReady] = useState(false)
      // The stand-in for "the fetch resolved": a new identity, and a different answer.
      const stable = useCallback((value: string) => apply(value, ready), [ready])
      useArrivalValue('ticker', stable)
      return (
        <>
          <div data-testid="location">{pathname + search}</div>
          <button type="button" onClick={() => setReady(true)}>
            load
          </button>
        </>
      )
    }
    render(
      <MemoryRouter initialEntries={['/portfolio?ticker=NVDA']}>
        <LateProbe />
      </MemoryRouter>,
    )
    expect(apply).toHaveBeenCalledWith('NVDA', false)
    // Not consumed: the value is still in the URL, waiting.
    expect(screen.getByTestId('location').textContent).toBe('/portfolio?ticker=NVDA')

    apply.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'load' }))
    expect(apply).toHaveBeenCalledWith('NVDA', true)
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/portfolio'),
    )
  })
})
