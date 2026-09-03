import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ToastProvider, { useToast } from './ToastProvider'

function Host({ onUndo }: { onUndo?: () => void }) {
  const toast = useToast()
  return (
    <>
      <button
        onClick={() =>
          toast.success(
            'Deleted the NVDA buy',
            onUndo === undefined ? undefined : { action: { label: 'Undo', onAction: onUndo } },
          )
        }
      >
        fire success
      </button>
      <button onClick={() => toast.error('Save failed')}>fire error</button>
    </>
  )
}

function renderHost(onUndo?: () => void) {
  return render(
    <ToastProvider>
      <Host onUndo={onUndo} />
    </ToastProvider>,
  )
}

// Two regions now (2026-09-03 shell spec §13): the polite one carries success/info,
// and errors get their own assertive one so a screen reader interrupts for a failure
// instead of queueing it behind a confirmation.
const region = () =>
  document.querySelector('.toast-region:not(.toast-region-alert)') as HTMLElement
const alertRegion = () => document.querySelector('.toast-region-alert') as HTMLElement

// ToastProvider's LEAVE_MS plus a hair. Every dismissal — manual, auto or via an action —
// now spends this window in the DOM wearing .toast-leaving before the entry is dropped,
// so any assertion that a toast is GONE has to spend it too.
const EXIT_WINDOW_MS = 200

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ToastProvider', () => {
  it('mounts BOTH regions BEFORE any toast fires, and a success lands in the polite one', () => {
    renderHost()
    expect(region().getAttribute('aria-live')).toBe('polite')
    expect(region().textContent).toBe('')
    // Always mounted, both of them: a live region must exist before content lands or the
    // announcement is missed.
    expect(alertRegion().getAttribute('aria-live')).toBe('assertive')
    expect(alertRegion().getAttribute('role')).toBe('alert')
    fireEvent.click(screen.getByText('fire success'))
    expect(region().textContent).toContain('Deleted the NVDA buy')
    expect(region().querySelector('.toast')?.className).toContain('toast-success')
    expect(alertRegion().textContent).toBe('')
  })

  it('auto-dismisses after ~6s', () => {
    renderHost()
    fireEvent.click(screen.getByText('fire success'))
    act(() => {
      vi.advanceTimersByTime(5999)
    })
    expect(screen.getByText('Deleted the NVDA buy')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(1 + EXIT_WINDOW_MS)
    })
    expect(screen.queryByText('Deleted the NVDA buy')).toBeNull()
  })

  // mouseOver/mouseOut, NOT mouseEnter/mouseLeave: React synthesizes onMouseEnter and
  // onMouseLeave from native mouseover/mouseout pairs (the EnterLeave plugin), so a
  // fired native "mouseenter" never reaches the handler. relatedTarget defaults to null,
  // which React reads as entering-from/leaving-to outside — exactly the hover contract.
  it('pauses on hover and re-arms a FULL window on leave', () => {
    renderHost()
    fireEvent.click(screen.getByText('fire success'))
    fireEvent.mouseOver(region())
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('Deleted the NVDA buy')).toBeTruthy()
    fireEvent.mouseOut(region())
    act(() => {
      vi.advanceTimersByTime(6000 + EXIT_WINDOW_MS)
    })
    expect(screen.queryByText('Deleted the NVDA buy')).toBeNull()
  })

  it('a toast born under the pointer waits for it to leave', () => {
    renderHost()
    fireEvent.mouseOver(region())
    fireEvent.click(screen.getByText('fire success'))
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('Deleted the NVDA buy')).toBeTruthy()
    fireEvent.mouseOut(region())
    act(() => {
      vi.advanceTimersByTime(6000 + EXIT_WINDOW_MS)
    })
    expect(screen.queryByText('Deleted the NVDA buy')).toBeNull()
  })

  it('runs the action once and consumes the toast', () => {
    const onUndo = vi.fn()
    renderHost(onUndo)
    fireEvent.click(screen.getByText('fire success'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(EXIT_WINDOW_MS)
    })
    expect(screen.queryByText('Deleted the NVDA buy')).toBeNull()
  })

  // The focus latch's release path. Browsers fire no focusout for a node that is REMOVED
  // while focused, so activating Undo (or Dismiss) by keyboard used to wedge the pause on
  // forever: every later toast was born unarmed and never auto-dismissed.
  it('re-arms after a keyboard Undo removes the focused button', () => {
    const onUndo = vi.fn()
    renderHost(onUndo)
    fireEvent.click(screen.getByText('fire success'))
    const undo = screen.getByRole('button', { name: 'Undo' })
    undo.focus()
    expect(region().contains(document.activeElement)).toBe(true)
    fireEvent.click(undo)
    expect(onUndo).toHaveBeenCalledTimes(1)
    // The button now outlives its click by the exit window (it is still focusable, and
    // still focused, while the toast is leaving) — the removal is what strands focus on
    // <body>, so the latch releases one exit window later, not synchronously.
    act(() => {
      vi.advanceTimersByTime(EXIT_WINDOW_MS)
    })

    fireEvent.click(screen.getByText('fire error'))
    act(() => {
      vi.advanceTimersByTime(6000 + EXIT_WINDOW_MS)
    })
    expect(screen.queryByText('Save failed')).toBeNull()
  })

  it('keeps the clock held when the pointer leaves but focus is still inside', () => {
    renderHost(vi.fn())
    fireEvent.click(screen.getByText('fire success'))
    fireEvent.mouseOver(region())
    screen.getByRole('button', { name: 'Undo' }).focus()
    // Pointer gone, keyboard still parked on Undo: the countdown must NOT restart.
    fireEvent.mouseOut(region())
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('Deleted the NVDA buy')).toBeTruthy()
  })

  it('routes an error to the assertive region, with the variant and a manual dismiss', () => {
    renderHost()
    fireEvent.click(screen.getByText('fire error'))
    const failure = document.querySelector('.toast-error')
    expect(failure).not.toBeNull()
    // A failure INTERRUPTS: it is announced out of turn and it stacks apart from the
    // polite confirmations, which never speak over anything.
    expect(screen.getByRole('alert').contains(failure)).toBe(true)
    expect(region().textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    act(() => {
      vi.advanceTimersByTime(EXIT_WINDOW_MS)
    })
    expect(screen.queryByText('Save failed')).toBeNull()
  })

  // Every timer this provider owns has to die WITH it. A dismissal in flight when the tree
  // unmounts left a ~160 ms removal ticking on; in a full-suite run it landed after jsdom
  // had been torn down and threw "window is not defined" from a file that had already
  // passed — invisible to any single-file run.
  it('clears every pending timer on unmount', () => {
    const { unmount } = renderHost()
    fireEvent.click(screen.getByText('fire success')) // an auto-dismiss clock
    fireEvent.click(screen.getByText('fire error'))
    // ...and a removal clock, from a toast caught mid-exit.
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0])
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('useToast outside a provider is a silent no-op (the test-compat posture)', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('fire success'))
    expect(document.querySelector('.toast')).toBeNull()
  })
})

// Spec §5: the exit is CSS, but the REMOVAL is a timer — the entry lingers in a `leaving`
// phase so the animation has something to animate. Everything that re-arms survivors has
// to step over those entries, or a toast on its way out gets a second clock.
describe('toast exit animation', () => {
  const toastEl = () => document.querySelector('.toast') as HTMLElement | null

  it('dismiss marks the toast leaving, then removes it after the exit window', () => {
    renderHost()
    fireEvent.click(screen.getByText('fire success'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    const toast = toastEl()
    expect(toast).not.toBeNull()
    expect((toast as HTMLElement).className).toContain('toast-leaving')
    act(() => {
      vi.advanceTimersByTime(EXIT_WINDOW_MS)
    })
    expect(toastEl()).toBeNull()
  })

  it('auto-dismiss also runs the leaving phase', () => {
    renderHost()
    fireEvent.click(screen.getByText('fire success'))
    act(() => {
      vi.advanceTimersByTime(6000)
    })
    expect(toastEl()?.className).toContain('toast-leaving')
    act(() => {
      vi.advanceTimersByTime(EXIT_WINDOW_MS)
    })
    expect(toastEl()).toBeNull()
  })

  it('a second dismiss on a leaving toast is a no-op (no double timers, no crash)', () => {
    renderHost()
    fireEvent.click(screen.getByText('fire success'))
    const close = screen.getByRole('button', { name: 'Dismiss notification' })
    fireEvent.click(close)
    // The button is still mounted (the toast is only leaving) — a second press must not
    // queue a second removal.
    fireEvent.click(close)
    expect(toastEl()?.className).toContain('toast-leaving')
    act(() => {
      vi.advanceTimersByTime(EXIT_WINDOW_MS)
    })
    expect(toastEl()).toBeNull()
    // And nothing is left ticking that could fire into an empty region.
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(region().textContent).toBe('')
  })

  it('hovering the region does not resurrect a leaving toast', () => {
    renderHost()
    fireEvent.click(screen.getByText('fire success'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    // hold + release while it dies: releaseTimers re-arms survivors, and a dying toast
    // is not one — a fresh 6 s window here would put it back on screen.
    fireEvent.mouseOver(region())
    fireEvent.mouseOut(region())
    expect(toastEl()?.className).toContain('toast-leaving')
    act(() => {
      vi.advanceTimersByTime(EXIT_WINDOW_MS)
    })
    expect(toastEl()).toBeNull()
  })

  it('a double-click on Undo fires the action once — the leaving button must not re-fire', () => {
    const onUndo = vi.fn()
    renderHost(onUndo)
    fireEvent.click(screen.getByText('fire success'))
    // The leaving toast keeps its buttons mounted for the exit window; before the
    // one-shot guard, the second press of a habitual double-click re-ran the Undo
    // re-POST and duplicated the restored row.
    const undo = screen.getByRole('button', { name: 'Undo' })
    fireEvent.click(undo)
    fireEvent.click(undo)
    expect(onUndo).toHaveBeenCalledTimes(1)
  })
})
