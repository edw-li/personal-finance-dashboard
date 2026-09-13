import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { XFADE_MS } from '../skeletonMetrics'
import { CASCADE_WINDOW_MS } from '../useStagger'
import Feed, { FeedBanner } from './Feed'
import PageFrame from './PageFrame'

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
    expect(css).toContain('@media (prefers-reduced-motion: no-preference) { .loading-dim { transition: opacity var(--t-fast) ease; } }')
    expect(css).not.toContain('transition: opacity 0.15s ease')
    expect(css).toContain(`var(--t-xfade)`)
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

  it('offers NO Retry without a retry prop — Retry is opt-in (motion spec §9)', () => {
    // A Retry here invites a re-send of a form the server already refused, and looks like a fix.
    render(<FeedBanner error="Account name is required." retryLabel="Retry loading accounts" />)
    expect(screen.getByRole('alert').textContent).toBe('Account name is required.')
    expect(screen.queryByRole('button')).toBeNull()
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

// The card cascade on feed-driven pages (2026-09-13 polish §2.5). PageFrame tags its body at
// `ready`, which on Comp/ESPP/Paycheck/Taxes is the MOUNT — before any feed has answered — so the
// only thing it ever tagged was the ghost. The first payload now tags its own cards, once, and
// only inside the page's arrival window.
describe('Feed card cascade (polish §2.5)', () => {
  const props = { busy: false, staleNoun: 'the table', skeleton: { height: 200, label: 'Loading rows…' } }
  const cards = () => (
    <div>
      <section className="card">a</section>
      <section className="card">b</section>
    </div>
  )
  const frame = (feed: ReactNode) => (
    <PageFrame title="Comp" resource={{ status: 'ready' }}>{feed}</PageFrame>
  )
  // `.loading-dim` is the PAYLOAD's half of the cross-fade: the outgoing ghost veil beside it
  // renders a SkeletonCard, which is a `.card` too — and one panels.css already pins to
  // `animation: none`, so whether the cascade tags it is invisible either way.
  const staggers = () =>
    Array.from(document.querySelectorAll<HTMLElement>('.xfade .loading-dim .card')).map(
      (el) => el.dataset.stagger,
    )
  afterEach(() => { vi.restoreAllMocks() })

  it('tags the first payload’s cards when it lands inside the arrival window', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const { rerender } = render(frame(<Feed {...props} data={null} busy>{cards}</Feed>))
    now.mockReturnValue(1000 + CASCADE_WINDOW_MS - 1)
    rerender(frame(<Feed {...props} data={{ n: 1 }}>{cards}</Feed>))
    expect(staggers()).toEqual(['0', '1'])
  })

  it('leaves a late payload untagged — a revisit or a refetch is not an entrance', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
    const { rerender } = render(frame(<Feed {...props} data={null} busy>{cards}</Feed>))
    now.mockReturnValue(1000 + CASCADE_WINDOW_MS)
    rerender(frame(<Feed {...props} data={{ n: 1 }}>{cards}</Feed>))
    expect(staggers()).toEqual([undefined, undefined])
  })

  it('tags once per Feed: a second payload inside the window never re-runs the cascade', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    const { rerender } = render(frame(<Feed {...props} data={null} busy>{cards}</Feed>))
    rerender(frame(<Feed {...props} data={{ n: 1 }}>{cards}</Feed>))
    expect(staggers()).toEqual(['0', '1'])
    rerender(frame(<Feed {...props} data={null} busy>{cards}</Feed>)) // a scope change…
    rerender(frame(<Feed {...props} data={{ n: 2 }}>{cards}</Feed>)) // …and its fresh cards
    expect(staggers()).toEqual([undefined, undefined])
  })

  it('skips cards inside a hidden view, and never tags outside a PageFrame', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    const mixed = () => (
      <div>
        <section className="card">shown</section>
        <div hidden><section className="card">hidden</section></div>
      </div>
    )
    const { rerender } = render(frame(<Feed {...props} data={null} busy>{mixed}</Feed>))
    rerender(frame(<Feed {...props} data={{ n: 1 }}>{mixed}</Feed>))
    expect((document.querySelector('.xfade .card') as HTMLElement).dataset.stagger).toBe('0')
    expect(document.querySelector('.xfade [hidden] .card[data-stagger]')).toBeNull()
    cleanup()
    const bare = render(<Feed {...props} data={null} busy>{cards}</Feed>)
    bare.rerender(<Feed {...props} data={{ n: 1 }}>{cards}</Feed>)
    expect(document.querySelectorAll('.card[data-stagger]').length).toBe(0)
  })
})
