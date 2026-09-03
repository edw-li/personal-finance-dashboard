import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SCOPE_KEY, useScope, type ScopeUses } from './useScope'

function Probe({ uses }: { uses: ScopeUses }) {
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
    </div>
  )
}

function mount(entry: string, uses: ScopeUses = { owner: true, range: true, month: true }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Probe uses={uses} />
    </MemoryRouter>,
  )
}

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const scope = () => screen.getByTestId('scope').textContent
const url = () => screen.getByTestId('url').textContent

describe('useScope', () => {
  it('reads the URL first', () => {
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

  it('ignores garbage values and falls through to defaults', () => {
    mount('/net-worth?owner=bob&range=5y&month=next')
    expect(scope()).toBe('null|1y|null')
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
})
