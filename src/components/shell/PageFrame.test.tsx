import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PageFrame, { usePageFrame } from './PageFrame'

afterEach(cleanup)

// jsdom has no IntersectionObserver; PageFrame must degrade to "never stuck".
type IOCallback = (entries: { isIntersecting: boolean }[]) => void
let observers: IOCallback[] = []
beforeEach(() => {
  observers = []
  vi.stubGlobal(
    'IntersectionObserver',
    vi.fn((cb: IOCallback) => ({
      observe: () => observers.push(cb),
      disconnect: () => {},
      unobserve: () => {},
    })),
  )
})

function CacheProbe() {
  return <span data-testid="cache">{String(usePageFrame().fromCache)}</span>
}

describe('PageFrame', () => {
  it('renders the title row with actions, the subheader and children when ready', () => {
    render(
      <PageFrame
        title="Net worth"
        actions={<button>Enter month</button>}
        subheader={<p>as of Sep 2026</p>}
        resource={{ status: 'ready' }}
      >
        <p>body</p>
      </PageFrame>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Net worth' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enter month' })).toBeTruthy()
    expect(screen.getByText('as of Sep 2026')).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
    expect(document.querySelector('.page-frame-scope')).toBeNull()
  })

  it('loading with no data: header, scope row and the skeleton — no children', () => {
    render(
      <PageFrame
        title="Portfolio"
        scopeRow={<span>scope</span>}
        resource={{ status: 'loading' }}
        skeleton={{ tiles: 3, cards: [{ span: 12, height: 200 }] }}
      >
        <p>body</p>
      </PageFrame>,
    )
    expect(screen.getByText('scope')).toBeTruthy()
    expect(screen.getByRole('status', { name: '' }).textContent).toBe('Loading…')
    expect(document.querySelectorAll('.stat-tile')).toHaveLength(3)
    expect(screen.queryByText('body')).toBeNull()
  })

  it('error with no data: an alert with the message and Retry', () => {
    const retry = vi.fn()
    render(
      <PageFrame title="Taxes" resource={{ status: 'error', error: 'boom', retry }}>
        <p>body</p>
      </PageFrame>,
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('boom')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('body')).toBeNull()
  })

  it('error with data on screen: children stay and a stale line names it', () => {
    render(
      <PageFrame title="Spending" resource={{ status: 'ready', error: 'offline', retry: () => {} }}>
        <p>body</p>
      </PageFrame>,
    )
    expect(screen.getByText('body')).toBeTruthy()
    expect(screen.getByText(/Showing earlier data — offline/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('busy dims the body and fromCache reaches the context', () => {
    render(
      <PageFrame title="Overview" resource={{ status: 'ready', busy: true, fromCache: true }}>
        <CacheProbe />
      </PageFrame>,
    )
    expect(document.querySelector('.loading-dim.is-loading')).toBeTruthy()
    expect(screen.getByTestId('cache').textContent).toBe('true')
  })

  it('the scope row gains is-stuck when its sentinel leaves the viewport', () => {
    render(
      <PageFrame title="Net worth" scopeRow={<span>scope</span>} resource={{ status: 'ready' }}>
        <p>body</p>
      </PageFrame>,
    )
    const row = document.querySelector('.page-frame-scope') as HTMLElement
    expect(row.classList.contains('is-stuck')).toBe(false)
    // act(): the observer callback is not a React event, so its setState is only flushed here.
    act(() => observers.forEach((cb) => cb([{ isIntersecting: false }])))
    expect(row.classList.contains('is-stuck')).toBe(true)
    act(() => observers.forEach((cb) => cb([{ isIntersecting: true }])))
    expect(row.classList.contains('is-stuck')).toBe(false)
  })
})
