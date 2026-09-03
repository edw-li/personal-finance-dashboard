import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SCOPE_KEY, useScope, type Scope, type ScopeUses } from './useScope'

/** A Plan 2/3-shaped consumer: a CHILD that picks a month from its own effect on arrival.
 *  Child effects run before the parent's, so this write is parked before useScope's own
 *  effects have run at all — the exact commit ordering that used to lose it. */
function MonthOnMount({ setScope }: { setScope: (partial: Partial<Scope>) => void }) {
  // Held in a ref so the mount-only effect keeps the arrival-render setter instead of
  // re-firing every time setScope's identity follows the URL.
  const ref = useRef(setScope)
  useEffect(() => {
    ref.current({ month: '2026-02-01' })
  }, [])
  return null
}

function Probe({ uses, childWritesMonth = false }: { uses: ScopeUses; childWritesMonth?: boolean }) {
  const { scope, setScope } = useScope(uses)
  const location = useLocation()
  return (
    <div>
      <span data-testid="scope">{`${String(scope.owner)}|${scope.range}|${String(scope.month)}`}</span>
      <span data-testid="url">{location.pathname + location.search}</span>
      <button onClick={() => setScope({ owner: 2 })}>owner 2</button>
      <button onClick={() => setScope({ owner: 'joint' })}>joint</button>
      <button onClick={() => setScope({ range: 'ytd' })}>ytd</button>
      <button onClick={() => setScope({ month: '2026-02-01' })}>feb</button>
      <button onClick={() => setScope({ month: null })}>latest</button>
      <button
        onClick={() => {
          setScope({ owner: 2 })
          setScope({ range: 'ytd' })
        }}
      >
        owner 2 then ytd
      </button>
      <button
        onClick={() => {
          setScope({ owner: 2 })
          setScope({ owner: 2 })
        }}
      >
        owner 2 twice
      </button>
      <button
        onClick={() => {
          setScope({ owner: 2 })
          setScope({ owner: null })
        }}
      >
        owner 2 then back
      </button>
      {childWritesMonth ? <MonthOnMount setScope={setScope} /> : null}
    </div>
  )
}

function mount(
  entry: string,
  uses: ScopeUses = { owner: true, range: true, month: true },
  childWritesMonth = false,
) {
  const tree = (u: ScopeUses) => (
    <MemoryRouter initialEntries={[entry]}>
      <Probe uses={u} childWritesMonth={childWritesMonth} />
    </MemoryRouter>
  )
  const view = render(tree(uses))
  // Re-render the SAME hook instance with a different `uses` — a page declaring another key,
  // which is the only way to ask for normalization again without moving the URL.
  return { ...view, setUses: (u: ScopeUses) => view.rerender(tree(u)) }
}

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const scope = () => screen.getByTestId('scope').textContent
const url = () => screen.getByTestId('url').textContent

describe('useScope', () => {
  it('reads the URL first', () => {
    // Memory says something else entirely — the URL must win, key by key.
    localStorage.setItem(SCOPE_KEY, JSON.stringify({ owner: 'joint', range: 'all' }))
    mount('/net-worth?owner=2&range=ytd&month=2026-02')
    expect(scope()).toBe('2|ytd|2026-02-01')
  })

  it('falls back to memory, then defaults, and rewrites the URL on arrival (replace)', () => {
    localStorage.setItem(SCOPE_KEY, JSON.stringify({ owner: 'joint', range: 'all' }))
    mount('/net-worth')
    expect(scope()).toBe('joint|all|null')
    expect(url()).toBe('/net-worth?owner=joint&range=all')
  })

  it('defaults to the household and one year', () => {
    mount('/portfolio', { owner: true, range: true })
    expect(scope()).toBe('null|1y|null')
    expect(url()).toBe('/portfolio?owner=all&range=1y')
  })

  it('normalizes only the keys the page uses', () => {
    localStorage.setItem(SCOPE_KEY, JSON.stringify({ owner: 2, range: 'ytd' }))
    mount('/credit-cards', { owner: true })
    expect(url()).toBe('/credit-cards?owner=2')
    expect(scope()).toBe('2|ytd|null') // range is still readable, just not written
  })

  it('leaves a month param alone on a page that does not use month', () => {
    mount('/portfolio?month=2026-07-01', { owner: true, range: true })
    expect(url()).toBe('/portfolio?month=2026-07-01&owner=all&range=1y')
    expect(scope()).toBe('null|1y|2026-07-01') // readable, but neither rewritten nor dropped
  })

  it('setScope writes the URL and remembers owner and range, never month', () => {
    mount('/net-worth')
    act(() => screen.getByText('owner 2').click())
    act(() => screen.getByText('ytd').click())
    act(() => screen.getByText('feb').click())
    expect(scope()).toBe('2|ytd|2026-02-01')
    expect(url()).toBe('/net-worth?owner=2&range=ytd&month=2026-02')
    expect(JSON.parse(localStorage.getItem(SCOPE_KEY) ?? '{}')).toEqual({ owner: 2, range: 'ytd' })
    act(() => screen.getByText('latest').click())
    expect(url()).toBe('/net-worth?owner=2&range=ytd')
  })

  it('coalesces two setScope calls made in the same tick', () => {
    mount('/net-worth')
    act(() => screen.getByText('owner 2 then ytd').click())
    expect(url()).toBe('/net-worth?owner=2&range=ytd')
    expect(scope()).toBe('2|ytd|null')
  })

  it('ignores garbage values and falls through to defaults', () => {
    mount('/net-worth?owner=bob&range=5y&month=next')
    expect(scope()).toBe('null|1y|null')
    expect(url()).toBe('/net-worth?owner=all&range=1y')
  })

  it('accepts a legacy YYYY-MM-DD month link and rewrites it to YYYY-MM', () => {
    mount('/spending?month=2026-07-01', { month: true })
    expect(scope()).toBe('null|1y|2026-07-01')
    expect(url()).toBe('/spending?month=2026-07')
  })

  it('joint and all round-trip through the URL', () => {
    mount('/net-worth')
    act(() => screen.getByText('joint').click())
    expect(url()).toContain('owner=joint')
    expect(scope().startsWith('joint|')).toBe(true)
  })

  it('a child effect writing month on arrival is not clobbered by normalization', () => {
    mount('/net-worth', { owner: true, range: true, month: true }, true)
    // The child's month survives AND arrival normalization still fills owner and range.
    expect(url()).toBe('/net-worth?month=2026-02&owner=all&range=1y')
    expect(scope()).toBe('null|1y|2026-02-01')
  })

  it('a same-tick no-op re-pick writes once and does not wedge later normalization', () => {
    const view = mount('/net-worth?owner=all', { owner: true })
    act(() => screen.getByText('owner 2 twice').click())
    expect(url()).toBe('/net-worth?owner=2') // the identical second pick adds nothing

    localStorage.clear()
    act(() => screen.getByText('owner 2 twice').click()) // now BOTH picks are no-ops
    expect(url()).toBe('/net-worth?owner=2')
    // A deliberate re-pick is still remembered even though nothing was written to the URL.
    expect(JSON.parse(localStorage.getItem(SCOPE_KEY) ?? '{}')).toEqual({ owner: 2 })

    // No phantom pending write is left behind, so the next declared key still normalizes.
    view.setUses({ owner: true, range: true })
    expect(url()).toBe('/net-worth?owner=2&range=1y')
  })

  it('a same-tick revert to the current URL does not wedge later normalization', () => {
    const view = mount('/net-worth?owner=all', { owner: true })
    // Two real writes that cancel out: the second still has to go out to override the first,
    // but it lands the URL back on the string it arrived with.
    act(() => screen.getByText('owner 2 then back').click())
    expect(url()).toBe('/net-worth?owner=all')
    expect(scope()).toBe('null|1y|null')

    // The URL never moved, so a pending write based on it could never clear itself.
    view.setUses({ owner: true, range: true })
    expect(url()).toBe('/net-worth?owner=all&range=1y')
  })
})
