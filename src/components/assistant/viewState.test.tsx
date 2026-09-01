import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ASSISTANT_OPEN_EVENT,
  readAssistantView,
  requestAssistantOpen,
  subscribeAssistantView,
  useAssistantView,
} from './viewState'

function Publisher({ year }: { year: number }) {
  useAssistantView({ year })
  return null
}

// vitest runs without `globals`, so RTL never registers its own auto-cleanup; a test that
// fails before its explicit unmount would otherwise leave a publisher mounted and leak its
// view into the next test (markdown.test.tsx's note).
afterEach(cleanup)

describe('assistant view state', () => {
  it('publishes on mount, replaces on update, clears on unmount', () => {
    const { rerender, unmount } = render(<Publisher year={2026} />)
    expect(readAssistantView()).toEqual({ year: 2026 })
    rerender(<Publisher year={2024} />)
    expect(readAssistantView()).toEqual({ year: 2024 })
    unmount()
    expect(readAssistantView()).toEqual({})
  })

  it('notifies subscribers on every publish', () => {
    const spy = vi.fn()
    const unsubscribe = subscribeAssistantView(spy)
    const { unmount } = render(<Publisher year={2026} />)
    unmount()
    expect(spy).toHaveBeenCalledTimes(2) // mount + unmount clear
    unsubscribe()
  })

  it('requestAssistantOpen dispatches the window event', () => {
    const spy = vi.fn()
    window.addEventListener(ASSISTANT_OPEN_EVENT, spy)
    requestAssistantOpen()
    expect(spy).toHaveBeenCalledTimes(1)
    window.removeEventListener(ASSISTANT_OPEN_EVENT, spy)
  })
})
