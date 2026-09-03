import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { AuthProvider } from '../contexts/AuthContext'
import LoginPage from './LoginPage'

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
}))
import { fetchMe, login } from '../api/auth'

// Where the sign-in actually landed — the only way to see the return-to hand-off.
function LocationProbe() {
  const { pathname, search } = useLocation()
  return <span data-testid="location">{pathname + search}</span>
}

// The real AuthProvider: with no stored token it resolves tokenless synchronously, so
// the form renders at once and login() above is the only wire this file touches.
function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

// The same provider, entered at an arbitrary URL, with every other path answered by the
// probe so a post-login navigation is visible.
function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // Defaults, re-armed every test: vi.clearAllMocks() clears CALLS, not implementations,
  // so the rejection below would otherwise be every later test's login too.
  vi.mocked(login).mockResolvedValue(undefined)
  vi.mocked(fetchMe).mockResolvedValue({ email: 'me@example.com' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LoginPage', () => {
  it('focuses the email box on arrival', () => {
    renderPage()
    expect(document.activeElement).toBe(screen.getByLabelText('Email'))
  })

  it('announces a failed login as an alert, server sentence verbatim', async () => {
    vi.mocked(login).mockRejectedValue(new ApiError('Invalid email or password', 401))
    renderPage()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Invalid email or password')
  })

  it('submits through the shared primary button classes', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Sign in' }).className).toBe(
      'button button-primary',
    )
  })

  // Return-to-page (2026-09-03 shell spec §10). An expiry that dumps the user on the
  // overview costs them the page they were reading; the 401 remembered it, this spends it.
  it('explains an expired session and returns to the remembered page after sign-in', async () => {
    sessionStorage.setItem('finance.returnTo', '/taxes?year=2026')
    renderAt('/login?reason=expired')

    expect(screen.getByRole('status').textContent).toMatch(/session expired/i)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/taxes?year=2026'),
    )
    // Spent, not kept: the next expiry must not resurrect a stale destination.
    expect(sessionStorage.getItem('finance.returnTo')).toBeNull()
    expect(localStorage.getItem('finance.lastEmail')).toBe('me@example.com')
  })

  // Peek at mount, spend at success. Consuming the key on arrival threw the page away the
  // moment the user did the obvious thing after a sign-in that did not take: reload.
  it('keeps the remembered page across a reload, spending it only on success', async () => {
    sessionStorage.setItem('finance.returnTo', '/portfolio')
    const first = renderAt('/login?reason=expired')
    first.unmount() // F5
    expect(sessionStorage.getItem('finance.returnTo')).toBe('/portfolio')

    renderAt('/login?reason=expired')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/portfolio'))
    expect(sessionStorage.getItem('finance.returnTo')).toBeNull()
  })

  it('lands on the overview when nothing was remembered', async () => {
    renderAt('/login')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
  })

  it('says nothing about an expiry on a plain visit', () => {
    renderPage()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('toggles password visibility and warns about Caps Lock', () => {
    renderPage()
    const pw = screen.getByLabelText('Password') as HTMLInputElement
    expect(pw.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(pw.type).toBe('text')
    expect(screen.queryByText('Caps Lock is on.')).toBeNull()
    fireEvent.keyUp(pw, { key: 'a', modifierCapsLock: true })
    expect(screen.getByText('Caps Lock is on.')).toBeTruthy()
  })

  // A remembered email makes the empty box the password one — focusing the email box
  // again would cost a Tab on every single sign-in.
  it('pre-fills the last email and starts in the password box', () => {
    localStorage.setItem('finance.lastEmail', 'me@example.com')
    renderPage()
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('me@example.com')
    expect(document.activeElement).toBe(screen.getByLabelText('Password'))
  })
})
