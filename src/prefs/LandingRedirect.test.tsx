import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setToken } from '../api/client'
import LandingRedirect, { LANDED_KEY, clearLanded } from './LandingRedirect'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <LandingRedirect>
              <p>overview</p>
            </LandingRedirect>
          }
        />
        <Route path="/net-worth" element={<p>net worth</p>} />
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
    expect(screen.getByText('net worth')).toBeTruthy()
    expect(sessionStorage.getItem(LANDED_KEY)).toBe('1')
    cleanup()
    mount()
    expect(screen.getByText('overview')).toBeTruthy() // Overview stays reachable
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
    expect(screen.getByText('net worth')).toBeTruthy()
  })
})
