import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { Link, MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setToken } from '../api/client'
import LandingRedirect, { LANDED_KEY, clearLanded, landingTarget, markLanded } from './LandingRedirect'

// Stands in for Layout, which is what marks the arrival in the real app — a parent route whose
// mount effect calls markLanded(). Rendering it here is what makes these tests exercise the
// real ordering: the child route's render (and so LandingRedirect's decision) comes first.
function Shell() {
  useEffect(() => {
    markLanded()
  }, [])
  return <Outlet />
}

function mount(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<Shell />}>
          <Route
            path="/"
            element={
              <LandingRedirect>
                <p>overview</p>
              </LandingRedirect>
            }
          />
          <Route
            path="/net-worth"
            element={
              <p>
                net worth <Link to="/">to overview</Link>
              </p>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setToken('tok')
})
afterEach(cleanup)

describe('LandingRedirect', () => {
  it('sends the first arrival of a session to the landing page, once', () => {
    localStorage.setItem('finance.landingPage', '/net-worth')
    mount()
    expect(screen.getByText(/net worth/)).toBeTruthy()
    expect(sessionStorage.getItem(LANDED_KEY)).toBe('1')
    cleanup()
    mount()
    expect(screen.getByText('overview')).toBeTruthy() // Overview stays reachable
  })

  // The bug this covers: "first `/` in this tab" is not "first arrival". A bookmark at
  // /net-worth, or a returnTo after a session expiry, never touched the flag, so the next
  // click on Overview contradicted the click and bounced back to the landing page.
  it('leaves Overview alone when the tab arrived on another page first', () => {
    localStorage.setItem('finance.landingPage', '/net-worth')
    mount('/net-worth')
    expect(sessionStorage.getItem(LANDED_KEY)).toBe('1')
    fireEvent.click(screen.getByRole('link', { name: 'to overview' }))
    expect(screen.getByText('overview')).toBeTruthy()
  })

  // The decision is a useState INITIALIZER, and React calls those more than once for one
  // mount (StrictMode does it deliberately; a suspended initial mount re-runs it when the
  // chunk lands). A flag set in here made the second call disagree with the first, and only
  // React keeping the first answer hid it — so `landingTarget` must not write.
  it('decides without writing the flag, and gives the same answer twice', () => {
    localStorage.setItem('finance.landingPage', '/net-worth')
    expect(landingTarget()).toBe('/net-worth')
    expect(sessionStorage.getItem(LANDED_KEY)).toBeNull()
    expect(landingTarget()).toBe('/net-worth')
  })

  it('does nothing for the default landing page or without a session', () => {
    mount()
    expect(screen.getByText('overview')).toBeTruthy()
    cleanup()
    localStorage.setItem('finance.landingPage', '/')
    sessionStorage.clear()
    mount()
    expect(screen.getByText('overview')).toBeTruthy()
    cleanup()
    localStorage.setItem('finance.landingPage', '/net-worth')
    sessionStorage.clear()
    localStorage.removeItem('finance_token')
    mount()
    expect(screen.getByText('overview')).toBeTruthy()
  })

  it('redirects again after clearLanded (a fresh login)', () => {
    localStorage.setItem('finance.landingPage', '/net-worth')
    sessionStorage.setItem(LANDED_KEY, '1')
    mount()
    expect(screen.getByText('overview')).toBeTruthy()
    cleanup()
    clearLanded()
    mount()
    expect(screen.getByText(/net worth/)).toBeTruthy()
  })
})
