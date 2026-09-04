import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { XFADE_MS } from '../skeletonMetrics'
import Feed, { FeedBanner } from './Feed'

// No `globals: true` in vite.config.ts, so RTL never registers its own auto-cleanup —
// every suite in this repo unmounts by hand or leftover alerts leak into the next test.
afterEach(cleanup)

// SkeletonCard announces its label as visually-hidden text, not an aria-label, so the
// skeleton assertions query by text (the plan's Step 3 note allows for exactly this).
describe('Feed', () => {
  it('shows the skeleton while busy with no data, and nothing when idle with no data', () => {
    const { rerender } = render(
      <Feed data={null} busy staleNoun="the table" skeleton={{ height: 200, label: 'Loading rows…' }}>
        {() => <p>rows</p>}
      </Feed>,
    )
    expect(screen.getByText('Loading rows…')).toBeTruthy()
    expect(screen.queryByText('rows')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(
      <Feed data={null} busy={false} staleNoun="the table" skeleton={{ height: 200, label: 'Loading rows…' }}>
        {() => <p>rows</p>}
      </Feed>,
    )
    expect(screen.queryByText('Loading rows…')).toBeNull()
    expect(screen.queryByText('rows')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders the empty node when idle with no data and one is given', () => {
    render(
      <Feed data={null} busy={false} staleNoun="the table" skeleton={{ height: 200, label: 'x' }} empty={<p>none yet</p>}>
        {() => <p>rows</p>}
      </Feed>,
    )
    expect(screen.getByText('none yet')).toBeTruthy()
    expect(screen.queryByText('rows')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders children from the data and dims them while busy', () => {
    const { container, rerender } = render(
      <Feed data={{ n: 3 }} busy={false} staleNoun="the table" skeleton={{ height: 200, label: 'x' }}>
        {(d) => <p>{d.n} rows</p>}
      </Feed>,
    )
    expect(screen.getByText('3 rows')).toBeTruthy()
    expect(container.querySelector('.loading-dim.is-loading')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(
      <Feed data={{ n: 3 }} busy staleNoun="the table" skeleton={{ height: 200, label: 'x' }}>
        {(d) => <p>{d.n} rows</p>}
      </Feed>,
    )
    expect(container.querySelector('.loading-dim.is-loading')).toBeTruthy()
  })

  it('banner: bare error with no data, stale cue with data, Retry with the given label', () => {
    const retry = vi.fn()
    const { rerender } = render(
      <Feed data={null} busy={false} error="offline" staleNoun="the table" retry={retry} retryLabel="Retry loading rows" skeleton={{ height: 1, label: 'x' }}>
        {() => null}
      </Feed>,
    )
    expect(screen.getByRole('alert').textContent).toBe('offline Retry')
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading rows' }))
    expect(retry).toHaveBeenCalledTimes(1)
    rerender(
      <Feed data={{}} busy={false} error="offline" staleNoun="the table" retry={retry} skeleton={{ height: 1, label: 'x' }}>
        {() => <p>rows</p>}
      </Feed>,
    )
    expect(screen.getByRole('alert').textContent).toBe('offline — the table may be showing earlier data. Retry')
  })

  it('treats an empty error as no error, so no lone stale cue appears', () => {
    // ApiError('') is reachable — an HTTP/2 response's statusText is '' — and with data
    // behind it a truthiness-free guard would render a bare " — the table may be…" banner.
    render(
      <Feed data={{}} busy={false} error="" staleNoun="the table" skeleton={{ height: 1, label: 'x' }}>
        {() => <p>rows</p>}
      </Feed>,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('rows')).toBeTruthy()
  })
})

describe('Feed cross-fade (motion spec §7)', () => {
  const props = { busy: false, staleNoun: 'the table', skeleton: { height: 200, label: 'Loading rows…' } }
  beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: false })) })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
  it('holds the ghost OVER the content for one --t-xfade, drops it, and re-arms', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Feed {...props} data={null} busy>{() => <p>rows</p>}</Feed>)
    rerender(<Feed {...props} data={{ n: 1 }}>{() => <p>rows</p>}</Feed>)
    expect(screen.getByText('rows')).toBeTruthy() // content and ghost coexist, in ONE box
    expect(document.querySelector('.xfade.is-fading .xfade-veil')?.getAttribute('aria-hidden')).toBe('true')
    act(() => { vi.advanceTimersByTime(XFADE_MS) })
    expect(document.querySelector('.xfade-veil')).toBeNull()
    rerender(<Feed {...props} data={null} busy>{() => <p>rows</p>}</Feed>) // a scope change…
    rerender(<Feed {...props} data={{ n: 2 }}>{() => <p>rows</p>}</Feed>) // …and the next arrival fades too
    expect(document.querySelector('.xfade-veil')).toBeTruthy()
  })
  it('does not fade content that was never behind a ghost', () => {
    render(<Feed {...props} data={{ n: 1 }}>{() => <p>rows</p>}</Feed>)
    expect(document.querySelector('.xfade.is-fading')).toBeNull()
  })
  it('swaps instantly under prefers-reduced-motion — no veil, no fade class', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { rerender } = render(<Feed {...props} data={null} busy>{() => <p>rows</p>}</Feed>)
    rerender(<Feed {...props} data={{ n: 1 }}>{() => <p>rows</p>}</Feed>)
    expect(document.querySelector('.xfade-veil')).toBeNull()
    expect([document.querySelector('.xfade.is-fading'), screen.queryByText('rows')?.textContent]).toEqual([null, 'rows'])
  })
  it('pins the CSS: one token for the dim, inside the no-preference gate', () => {
    const css = readFileSync(path.join(__dirname, '..', 'panels.css'), 'utf8').replace(/\s+/g, ' ')
    expect(css).toContain('@media (prefers-reduced-motion: no-preference) { .loading-dim { transition: opacity var(--t-fast, 120ms) ease; } }')
    expect(css).not.toContain('transition: opacity 0.15s ease')
    expect(css).toContain(`var(--t-xfade, ${XFADE_MS}ms)`)
    // The veil IS the skeleton the reader was already looking at; left on .loading-fallback's
    // 250ms-delayed appear it fades in from nothing and the swap flashes blank instead.
    expect(css).toContain('.xfade-veil .loading-fallback { opacity: 1; animation: none; }')
  })
})

describe('FeedBanner', () => {
  it('renders nothing for any falsy error and an alert otherwise', () => {
    const { container, rerender } = render(<FeedBanner error={null} />)
    expect(container.firstChild).toBeNull()
    rerender(<FeedBanner error={undefined} />)
    expect(container.firstChild).toBeNull()
    rerender(<FeedBanner error="" />)
    expect(container.firstChild).toBeNull()
    rerender(<FeedBanner error="bad input" />)
    expect(screen.getByRole('alert').textContent).toBe('bad input')
  })

  it('offers Retry when given one', () => {
    const retry = vi.fn()
    render(<FeedBanner error="bad" retry={retry} retryLabel="Retry the model" />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry the model' }))
    expect(retry).toHaveBeenCalled()
  })

  it('offers a named action button beside the message, disabled while it is running', () => {
    const onAction = vi.fn()
    const { rerender } = render(
      <FeedBanner
        error="This month was saved with no spending."
        action={{ label: 'Delete the empty month', onAction }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete the empty month' }))
    expect(onAction).toHaveBeenCalled()
    // A second click while the first request is in flight would DELETE twice — the second
    // 404s and the caller would show "Delete failed" for a delete that worked.
    rerender(
      <FeedBanner
        error="This month was saved with no spending."
        action={{ label: 'Delete the empty month', onAction, disabled: true }}
      />,
    )
    expect(
      (screen.getByRole('button', { name: 'Delete the empty month' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('renders Retry before an action when a banner offers both', () => {
    render(
      <FeedBanner
        error="bad"
        retry={() => {}}
        retryLabel="Retry the feed"
        action={{ label: 'Delete it', onAction: () => {} }}
      />,
    )
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Retry', 'Delete it'])
  })
})
