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

const region = () => document.querySelector('.toast-region') as HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ToastProvider', () => {
  it('mounts the polite region BEFORE any toast fires, and toasts land inside it', () => {
    renderHost()
    expect(region().getAttribute('aria-live')).toBe('polite')
    expect(region().textContent).toBe('')
    fireEvent.click(screen.getByText('fire success'))
    expect(region().textContent).toContain('Deleted the NVDA buy')
    expect(region().querySelector('.toast')?.className).toContain('toast-success')
  })

  it('auto-dismisses after ~6s', () => {
    renderHost()
    fireEvent.click(screen.getByText('fire success'))
    act(() => {
      vi.advanceTimersByTime(5999)
    })
    expect(screen.getByText('Deleted the NVDA buy')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(1)
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
      vi.advanceTimersByTime(6000)
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
      vi.advanceTimersByTime(6000)
    })
    expect(screen.queryByText('Deleted the NVDA buy')).toBeNull()
  })

  it('runs the action once and consumes the toast', () => {
    const onUndo = vi.fn()
    renderHost(onUndo)
    fireEvent.click(screen.getByText('fire success'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
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

    fireEvent.click(screen.getByText('fire error'))
    act(() => {
      vi.advanceTimersByTime(6000)
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

  it('carries the error variant and a manual dismiss', () => {
    renderHost()
    fireEvent.click(screen.getByText('fire error'))
    expect(document.querySelector('.toast-error')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Save failed')).toBeNull()
  })

  it('useToast outside a provider is a silent no-op (the test-compat posture)', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('fire success'))
    expect(document.querySelector('.toast')).toBeNull()
  })
})
