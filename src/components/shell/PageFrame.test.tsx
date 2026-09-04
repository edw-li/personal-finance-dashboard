import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PageFrame, { usePageFrame } from './PageFrame'

afterEach(() => {
  cleanup()
  // Every test here stubs IntersectionObserver; restore it so a stub can never leak.
  vi.unstubAllGlobals()
  // …and one test spies on HTMLElement.prototype.offsetHeight, which every later file in the
  // same worker would otherwise inherit.
  vi.restoreAllMocks()
})

// jsdom has no IntersectionObserver; PageFrame must degrade to "never stuck".
type IOCallback = (entries: { isIntersecting: boolean }[]) => void
let observers: IOCallback[] = []
let disconnects: ReturnType<typeof vi.fn>[] = []
beforeEach(() => {
  observers = []
  disconnects = []
  vi.stubGlobal(
    'IntersectionObserver',
    vi.fn((cb: IOCallback) => {
      // One disconnect spy per constructed observer, so tests can count teardowns.
      const disconnect = vi.fn()
      disconnects.push(disconnect)
      return { observe: () => observers.push(cb), disconnect, unobserve: () => {} }
    }),
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
    // The entrance animates the content region ONLY: the title row and the scope row
    // appear at once, so neither may sit inside the wrapper (2026-09-05 spec §2).
    const body = document.querySelector('.page-frame-body')
    expect(body?.textContent).toContain('body')
    expect(document.querySelector('.page-frame-body .page-frame-header')).toBeNull()
  })

  it('loading with no data: header, scope row and the skeleton — no children', () => {
    render(
      <PageFrame
        title="Portfolio"
        scopeRow={<span>scope</span>}
        resource={{ status: 'loading' }}
        skeleton={{ tiles: 3, strip: true, cards: [{ span: 12, height: 200 }] }}
      >
        <p>body</p>
      </PageFrame>,
    )
    expect(screen.getByText('scope')).toBeTruthy()
    expect(screen.getByRole('status', { name: '' }).textContent).toBe('Loading…')
    expect(document.querySelectorAll('.stat-tile')).toHaveLength(3)
    // The whole spec reaches PageSkeleton: a prop the frame forgets to forward is a ghost the
    // page asked for and never gets — the owner strip's box would go missing on net worth.
    expect(document.querySelector('.skeleton-strip')).toBeTruthy()
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

  it('a batched observer callback reads the newest entry, not the oldest', () => {
    render(
      <PageFrame title="Net worth" scopeRow={<span>scope</span>} resource={{ status: 'ready' }}>
        <p>body</p>
      </PageFrame>,
    )
    const row = document.querySelector('.page-frame-scope') as HTMLElement
    act(() => observers.forEach((cb) => cb([{ isIntersecting: true }, { isIntersecting: false }])))
    expect(row.classList.contains('is-stuck')).toBe(true)
  })

  it('observes the sentinel once per scope row and disconnects on unmount', () => {
    const view = render(
      <PageFrame title="Net worth" scopeRow={<span>scope</span>} resource={{ status: 'ready' }}>
        <p>body</p>
      </PageFrame>,
    )
    expect(disconnects).toHaveLength(1)
    // scopeRow is inline JSX — a new object on every parent render. Keying the effect on
    // its presence keeps one observer alive instead of churning one per render.
    view.rerender(
      <PageFrame
        title="Net worth"
        scopeRow={<span>scope</span>}
        resource={{ status: 'ready', busy: true }}
      >
        <p>body</p>
      </PageFrame>,
    )
    expect(disconnects).toHaveLength(1)
    expect(disconnects[0]).not.toHaveBeenCalled()
    view.unmount()
    expect(disconnects[0]).toHaveBeenCalledTimes(1)
  })

  it('without IntersectionObserver the scope row still renders and is never stuck', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    expect(() =>
      render(
        <PageFrame title="Net worth" scopeRow={<span>scope</span>} resource={{ status: 'ready' }}>
          <p>body</p>
        </PageFrame>,
      ),
    ).not.toThrow()
    expect(screen.getByText('scope')).toBeTruthy()
    // The only casualty is the hairline; the row itself is still there.
    expect(document.querySelector('.page-frame-scope')).toBeTruthy()
    expect(document.querySelector('.page-frame-scope.is-stuck')).toBeNull()
  })

  // The scroll-linked reveal's view() timelines measure against the viewport, whose top is
  // covered by this very row: without the inset a card scrolled back into view is already
  // fully bright when it emerges from under it (2026-09-05 spec §4).
  it('writes the sticky row height onto the body, and re-reads it when the row reflows', () => {
    let notify: (() => void) | null = null
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn((cb: () => void) => ({
        observe: () => { notify = cb },
        disconnect: () => {},
        unobserve: () => {},
      })),
    )
    // jsdom lays nothing out, so the row's box is the one thing that has to be faked.
    let rowHeight = 57
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('page-frame-scope') ? rowHeight : 0
    })
    render(
      <PageFrame title="Net worth" scopeRow={<span>scope</span>} resource={{ status: 'ready' }}>
        <p>body</p>
      </PageFrame>,
    )
    const body = document.querySelector<HTMLElement>('.page-frame-body')
    expect(body?.style.getPropertyValue('--sticky-inset')).toBe('57px')
    // The density toggle rescales the root font and the row grows with no re-render at all.
    rowHeight = 71
    act(() => notify?.())
    expect(body?.style.getPropertyValue('--sticky-inset')).toBe('71px')
  })

  it('leaves the inset unset when the page declares no scope row', () => {
    vi.stubGlobal('ResizeObserver', vi.fn(() => ({ observe: () => {}, disconnect: () => {}, unobserve: () => {} })))
    render(
      <PageFrame title="Overview" resource={{ status: 'ready' }}>
        <p>body</p>
      </PageFrame>,
    )
    // Absent, not '0px': the CSS fallback in view(var(--sticky-inset, 0px) 0px) is the same
    // answer, and one source for it means one place to be wrong.
    expect(
      document.querySelector<HTMLElement>('.page-frame-body')?.style.getPropertyValue('--sticky-inset'),
    ).toBe('')
  })

  it('without ResizeObserver the body still renders and simply carries no inset', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    expect(() =>
      render(
        <PageFrame title="Net worth" scopeRow={<span>scope</span>} resource={{ status: 'ready' }}>
          <p>body</p>
        </PageFrame>,
      ),
    ).not.toThrow()
    expect(
      document.querySelector<HTMLElement>('.page-frame-body')?.style.getPropertyValue('--sticky-inset'),
    ).toBe('')
  })

  it('the stale line is a status region, so it is announced without stealing focus', () => {
    render(
      <PageFrame title="Spending" resource={{ status: 'ready', error: 'offline' }}>
        <p>body</p>
      </PageFrame>,
    )
    expect(screen.getByText(/Showing earlier data — offline/).getAttribute('role')).toBe('status')
  })
})
