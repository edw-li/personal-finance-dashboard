import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SandboxPanel from './SandboxPanel'
import type { Sandbox } from './useSandbox'

const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../components/ToastProvider', () => ({ useToast: () => toast }))

type S = { a?: string }
type R = { v: string }

function sandbox(over: Partial<Sandbox<S, R>> = {}): Sandbox<S, R> {
  return {
    scenario: { a: '1' },
    entries: ['a:1'],
    empty: false,
    set: vi.fn(),
    reset: vi.fn(),
    baseline: { v: '0' },
    result: { v: '1' },
    busy: false,
    error: null,
    errorStatus: null,
    stale: false,
    pins: [],
    pin: vi.fn(),
    unpin: vi.fn(),
    pinResults: {},
    link: '/taxes?year=2026&whatif=a%3A1',
    ...over,
  }
}

function mount(sb: Sandbox<S, R>, over: Partial<Parameters<typeof SandboxPanel<S, R>>[0]> = {}) {
  const onToggle = vi.fn()
  render(
    <SandboxPanel<S, R>
      eyebrow="What if — 2026"
      hint="Model a scenario — nothing is saved"
      open
      onToggle={onToggle}
      sandbox={sb}
      presets={<div data-testid="presets" />}
      compare={<div data-testid="compare" />}
      apply={<button type="button">Apply 1 override</button>}
      staleNoun="this scenario"
      {...over}
    >
      <div data-testid="controls" />
    </SandboxPanel>,
  )
  return onToggle
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SandboxPanel', () => {
  it('closed: eyebrow, toggle with aria-expanded=false, the closed hint, nothing else', () => {
    const onToggle = mount(sandbox(), { open: false, closedHint: <p>Try a scenario.</p> })
    expect(screen.getByRole('heading', { name: /What if — 2026/ })).toBeTruthy()
    const toggle = screen.getByRole('button', { name: 'Try it' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('Try a scenario.')).toBeTruthy()
    expect(screen.queryByTestId('controls')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset to actual' })).toBeNull()
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('open: presets · controls · compare · pin row · Apply, in that order; Reset resets', () => {
    const sb = sandbox()
    mount(sb)
    const ids = [...document.querySelectorAll('[data-testid], .sandbox-pins, .sandbox-apply')].map(
      (el) => el.getAttribute('data-testid') ?? el.className,
    )
    expect(ids).toEqual(['presets', 'controls', 'compare', 'sandbox-pins', 'sandbox-apply'])
    expect(screen.getByRole('button', { name: 'Close' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to actual' }))
    expect(sb.reset).toHaveBeenCalledTimes(1)
  })

  it('empty scenario: Reset disabled, Pin and Copy link disabled, no Apply slot', () => {
    mount(sandbox({ empty: true, entries: [], scenario: {} }))
    expect((screen.getByRole('button', { name: 'Reset to actual' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Pin this scenario' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Copy link' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Apply 1 override' })).toBeNull()
  })

  it('pins: label box feeds pin(), chips unpin, Copy link writes the origin + link and toasts', async () => {
    const sb = sandbox({ pins: [{ id: 'p1', label: 'Sell 40 VTI', createdAt: 't', entries: ['a:1'] }] })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount(sb)
    fireEvent.change(screen.getByLabelText('Pin label'), { target: { value: 'My pin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pin this scenario' }))
    expect(sb.pin).toHaveBeenCalledWith('My pin')
    expect((screen.getByLabelText('Pin label') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Sell 40 VTI' }))
    expect(sb.unpin).toHaveBeenCalledWith('p1')
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/taxes?year=2026&whatif=a%3A1`)
    await Promise.resolve()
    expect(toast.success).toHaveBeenCalledWith('Link copied')
  })

  it('a failed run keeps the compare on screen under the stale line; no result shows the error alone', () => {
    mount(sandbox({ error: 'lot 4 already sold', stale: true }))
    expect(screen.getByRole('alert').textContent).toBe('lot 4 already sold — this scenario may be showing earlier data.')
    expect(screen.getByTestId('compare')).toBeTruthy()
    cleanup()
    mount(sandbox({ result: null, error: 'no paycheck profiles' }))
    expect(screen.getByRole('alert').textContent).toBe('no paycheck profiles')
    expect(screen.queryByTestId('compare')).toBeNull()
  })

  it('renders no pin row when asked (hidePins) and a custom reset label', () => {
    mount(sandbox(), { hidePins: true, resetLabel: 'Reset to derived' })
    expect(document.querySelector('.sandbox-pins')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset to derived' })).toBeTruthy()
  })
})
