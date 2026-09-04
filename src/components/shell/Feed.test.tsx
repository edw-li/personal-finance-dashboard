import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
