import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { AuthProvider } from '../contexts/AuthContext'
import LoginPage from './LoginPage'

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
}))
import { login } from '../api/auth'

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

beforeEach(() => {
  localStorage.clear()
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
})
