import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import { SaveButton } from './SaveButton'
import { SaveStatus } from './SaveStatus'
import { SAVED_MS, useSaveState } from './useSaveState'
import type { SaveState, SaveStatusKind } from './useSaveState'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const hook = (dirty: boolean) =>
  renderHook(({ dirty: d }) => useSaveState({ dirty: d }), { initialProps: { dirty } })

describe('useSaveState', () => {
  it('reads clean and dirty off the form', () => {
    const { result, rerender } = hook(false)
    expect(result.current.status).toBe('clean')
    expect(result.current.error).toBeNull()
    rerender({ dirty: true })
    expect(result.current.status).toBe('dirty')
  })

  it("runs a save: saving, then saved for 2.5 s, then clean — and answers the save's result", async () => {
    const { result, rerender } = hook(true)
    const save = deferred<string>()
    let answer!: Promise<string | undefined>
    act(() => {
      answer = result.current.run(() => save.promise)
    })
    expect(result.current.status).toBe('saving')
    await act(async () => {
      save.resolve('stored')
      await answer
    })
    rerender({ dirty: false }) // the form now matches what is stored
    expect(result.current.status).toBe('saved')
    expect(await answer).toBe('stored')
    act(() => {
      vi.advanceTimersByTime(SAVED_MS - 1)
    })
    expect(result.current.status).toBe('saved')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.status).toBe('clean')
  })

  it('reads "Unsaved changes" at once when the form is edited inside the saved window', async () => {
    const { result, rerender } = hook(false)
    await act(async () => {
      await result.current.run(async () => 'stored')
    })
    expect(result.current.status).toBe('saved')
    rerender({ dirty: true })
    expect(result.current.status).toBe('dirty')
    act(() => {
      vi.advanceTimersByTime(SAVED_MS)
    })
    expect(result.current.status).toBe('dirty')
  })

  it('keeps the error until clearError, and answers undefined', async () => {
    const { result } = hook(true)
    let answer: unknown = 'unset'
    await act(async () => {
      answer = await result.current.run(() =>
        Promise.reject(new ApiError('Budget must be a non-negative amount', 422)),
      )
    })
    expect(answer).toBeUndefined()
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Budget must be a non-negative amount')
    act(() => {
      vi.advanceTimersByTime(SAVED_MS * 4)
    })
    expect(result.current.status).toBe('error')
    act(() => {
      result.current.clearError()
    })
    expect(result.current.status).toBe('dirty')
    expect(result.current.error).toBeNull()
  })

  it('clears the error when the next run starts', async () => {
    const { result } = hook(true)
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error('nope')))
    })
    const save = deferred<void>()
    act(() => {
      void result.current.run(() => save.promise)
    })
    expect(result.current.status).toBe('saving')
    expect(result.current.error).toBeNull()
    await act(async () => save.resolve())
  })

  it('runs one save at a time — a second run while saving saves nothing', async () => {
    const { result } = hook(true)
    const first = deferred<string>()
    const second = vi.fn(async () => 'twice')
    let answer: unknown = 'unset'
    act(() => {
      void result.current.run(() => first.promise)
    })
    await act(async () => {
      answer = await result.current.run(second)
    })
    expect(second).not.toHaveBeenCalled()
    expect(answer).toBeUndefined()
    await act(async () => first.resolve('once'))
  })

  it('takes an aborted save as no save at all, not an error', async () => {
    const { result } = hook(true)
    await act(async () => {
      await result.current.run(() => Promise.reject(new DOMException('Aborted', 'AbortError')))
    })
    expect(result.current.status).toBe('dirty')
    expect(result.current.error).toBeNull()
  })

  it('arms no timer for a form that has gone', async () => {
    const { result, unmount } = hook(false)
    const save = deferred<void>()
    act(() => {
      void result.current.run(() => save.promise)
    })
    unmount()
    await act(async () => save.resolve())
    expect(vi.getTimerCount()).toBe(0)
  })
})

const state = (status: SaveStatusKind, error: string | null = null): SaveState => ({
  status,
  error,
  run: async () => undefined,
  clearError: () => {},
})

describe('SaveStatus', () => {
  it('says nothing while the form is clean', () => {
    const { container } = render(<SaveStatus state={state('clean')} />)
    expect(container.innerHTML).toBe('')
  })

  it('says "Unsaved changes", muted and unannounced, while dirty', () => {
    render(<SaveStatus state={state('dirty')} />)
    const line = screen.getByText('Unsaved changes')
    expect(line.className).toBe('save-status save-status-dirty')
    expect(line.hasAttribute('role')).toBe(false)
  })

  it('keeps one status region standing through the save, so "Saved ✓" is announced into it', () => {
    const { rerender } = render(<SaveStatus state={state('saving')} />)
    const region = screen.getByRole('status')
    expect(region.textContent).toBe('Saving…')
    rerender(<SaveStatus state={state('saved')} />)
    // The same node: a live region must exist before its news arrives.
    expect(screen.getByRole('status')).toBe(region)
    expect(region.textContent).toBe('Saved ✓')
    expect(region.className).toBe('save-status save-status-saved')
  })

  it('puts a failure in an alert, the message verbatim', () => {
    render(<SaveStatus state={state('error', 'Budget must be a non-negative amount')} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Budget must be a non-negative amount')
    expect(alert.className).toBe('save-status save-status-error')
  })
})

describe('SaveButton', () => {
  it('is quiet with nothing to save — clean, or just saved — and says why', () => {
    const onClick = vi.fn()
    for (const status of ['clean', 'saved'] as const) {
      const { unmount } = render(
        <SaveButton state={state(status)} onClick={onClick}>
          Save
        </SaveButton>,
      )
      const button = screen.getByRole('button', { name: 'Save' })
      expect(button.getAttribute('aria-disabled')).toBe('true')
      expect(button.getAttribute('title')).toBe('No changes to save')
      fireEvent.click(button)
      unmount()
    }
    expect(onClick).not.toHaveBeenCalled()
  })

  it('saves when dirty, and after a failure (the form still differs)', () => {
    const onClick = vi.fn()
    for (const status of ['dirty', 'error'] as const) {
      const { unmount } = render(
        <SaveButton state={state(status, status === 'error' ? 'nope' : null)} onClick={onClick} title="Save the budget">
          Save
        </SaveButton>,
      )
      const button = screen.getByRole('button', { name: 'Save' })
      expect(button.hasAttribute('aria-disabled')).toBe(false)
      expect(button.getAttribute('title')).toBe('Save the budget')
      fireEvent.click(button)
      unmount()
    }
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('is busy while saving: a spinner, aria-busy, quiet', () => {
    render(<SaveButton state={state('saving')}>Save</SaveButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.querySelector('.busy-spinner')).not.toBeNull()
  })

  it("keeps a caller's aria-disabled while there is something to save (an invalid form)", () => {
    render(
      <SaveButton state={state('dirty')} aria-disabled>
        Save
      </SaveButton>,
    )
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true')
  })
})

describe('the three together', () => {
  /** A budget editor, the way wave 2 wires one: the stored figure moves inside the save. */
  function BudgetForm({ save }: { save: (amount: string) => Promise<void> }) {
    const [stored, setStored] = useState('80')
    const [amount, setAmount] = useState('80')
    const saveState = useSaveState({ dirty: amount !== stored })
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void saveState.run(async () => {
            await save(amount)
            setStored(amount)
          })
        }}
      >
        <input
          aria-label="Budget"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value)
            saveState.clearError()
          }}
        />
        <SaveButton type="submit" className="button button-primary" state={saveState}>
          Save
        </SaveButton>
        <SaveStatus state={saveState} />
      </form>
    )
  }

  it('quiet, then live with "Unsaved changes", then busy, then quiet with "Saved ✓", then clean', async () => {
    const pending = deferred<void>()
    render(<BudgetForm save={() => pending.promise} />)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(screen.getByLabelText('Budget'), { target: { value: '95' } })
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    fireEvent.click(button)
    expect(button.getAttribute('aria-busy')).toBe('true')
    await act(async () => pending.resolve())
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('title')).toBe('No changes to save')
    expect(screen.getByRole('status').textContent).toBe('Saved ✓')
    act(() => {
      vi.advanceTimersByTime(SAVED_MS)
    })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })
})
