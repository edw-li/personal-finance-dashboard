import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ASSISTANT_OPEN_EVENT,
  type AssistantView,
  readAssistantView,
  requestAssistantOpen,
  subscribeAssistantView,
  useAssistantView,
  useAssistantViewVersion,
} from './viewState'

function Publisher({ year }: { year: number }) {
  useAssistantView({ year })
  return null
}

/** Drawer-shaped reader: subscribes to the version, reads the live view at render time. */
function Consumer({ seen }: { seen: AssistantView[] }) {
  useAssistantViewVersion()
  seen.push(readAssistantView())
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
    try {
      const { unmount } = render(<Publisher year={2026} />)
      unmount()
      expect(spy).toHaveBeenCalledTimes(2) // mount + unmount clear
    } finally {
      // A failed expectation must not leak this listener into the rest of the file.
      unsubscribe()
    }
  })

  it('does not republish when a re-render passes an equal view', () => {
    const { rerender } = render(<Publisher year={2026} />)
    const spy = vi.fn()
    const unsubscribe = subscribeAssistantView(spy)
    try {
      rerender(<Publisher year={2026} />) // fresh object literal, identical JSON
      expect(spy).not.toHaveBeenCalled()
      expect(readAssistantView()).toEqual({ year: 2026 })
    } finally {
      unsubscribe()
    }
  })

  it('re-renders version consumers with the new view, never blanking mid-change', () => {
    const seen: AssistantView[] = []
    const { rerender } = render(
      <>
        <Publisher year={2026} />
        <Consumer seen={seen} />
      </>,
    )
    expect(seen.at(-1)).toEqual({ year: 2026 })

    const afterMount = seen.length
    rerender(
      <>
        <Publisher year={2024} />
        <Consumer seen={seen} />
      </>,
    )
    expect(seen.at(-1)).toEqual({ year: 2024 })
    // The clear-then-republish pair inside one commit is batched: a subscriber must never
    // paint the blank view between the two.
    expect(seen.slice(afterMount)).not.toContainEqual({})
  })

  it('requestAssistantOpen dispatches the window event', () => {
    const spy = vi.fn()
    window.addEventListener(ASSISTANT_OPEN_EVENT, spy)
    requestAssistantOpen()
    expect(spy).toHaveBeenCalledTimes(1)
    window.removeEventListener(ASSISTANT_OPEN_EVENT, spy)
  })
})
