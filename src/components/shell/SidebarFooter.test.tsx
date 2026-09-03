import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../api/system', () => ({ fetchSystemStatus: vi.fn() }))
import { clearSnapshots } from '../../api/snapshotCache'
import { fetchSystemStatus } from '../../api/system'
import { useAuth } from '../../contexts/AuthContext'
import ThemeProvider from './ThemeProvider'
import SidebarFooter from './SidebarFooter'

const logout = vi.fn()
beforeEach(() => {
  localStorage.clear()
  // The snapshot cache is module state that outlives a render: without this, the third
  // test seeds its footer from the first test's cached status and the pill is never hidden.
  clearSnapshots()
  vi.mocked(useAuth).mockReturnValue({ email: 'me@example.com', isAuthenticated: true, isLoading: false, login: vi.fn(), logout, authError: null, retry: vi.fn() })
  vi.mocked(fetchSystemStatus).mockResolvedValue({ environment: 'prod', database: { alembic_head: 'f7d3b2a91c40', size_bytes: 1 } } as never)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('SidebarFooter', () => {
  it('shows email, environment pill, build hash, and logs out', async () => {
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    expect(screen.getByText('me@example.com')).toBeTruthy()
    expect(screen.getByText('abc123')).toBeTruthy()
    expect(await screen.findByText('prod')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /log out/i }))
    expect(logout).toHaveBeenCalled()
  })

  it('toggles the theme explicitly', async () => {
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    fireEvent.click(screen.getByRole('button', { name: /switch to light theme/i }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    expect(localStorage.getItem('finance.theme')).toBe('light')
    expect(screen.getByRole('button', { name: /switch to dark theme/i })).toBeTruthy()
  })

  it('hides the pill until the status answers, and survives a failed status', async () => {
    vi.mocked(fetchSystemStatus).mockRejectedValue(new Error('offline'))
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    await waitFor(() => expect(fetchSystemStatus).toHaveBeenCalled())
    expect(screen.queryByText('prod')).toBeNull()
    expect(screen.getByText('me@example.com')).toBeTruthy()
  })
})
