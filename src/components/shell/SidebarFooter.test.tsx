import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../api/system', () => ({ fetchSystemStatus: vi.fn() }))
import { clearSnapshots, getSnapshot } from '../../api/snapshotCache'
import { fetchSystemStatus } from '../../api/system'
import { useAuth } from '../../contexts/AuthContext'
import type { SystemStatus } from '../../types/api'
import ToastProvider from '../ToastProvider'
import ThemeProvider from './ThemeProvider'
import SidebarFooter, { getLastSystemStatus, SYSTEM_SNAPSHOT } from './SidebarFooter'

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

  // Audit item 39: the toggle writes an EXPLICIT choice, which ends "follow my system" —
  // a preference the user set on purpose and nothing on screen said was gone. The toggle
  // stays two-state (a three-state cycle through System is worse to operate); leaving
  // System is announced instead, with the way back one click away.
  it('announces leaving System and undoes back to it', async () => {
    localStorage.setItem('finance.theme', 'system')
    render(
      <ToastProvider>
        <ThemeProvider>
          <SidebarFooter buildHash="abc123" />
        </ThemeProvider>
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /switch to light theme/i }))
    await waitFor(() => expect(localStorage.getItem('finance.theme')).toBe('light'))
    expect(
      screen.getByText('Theme set to light — no longer following your system'),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(localStorage.getItem('finance.theme')).toBe('system'))
    // Back under the OS's answer, which jsdom reports as dark.
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('says nothing when the choice being replaced was already explicit', async () => {
    localStorage.setItem('finance.theme', 'dark')
    render(
      <ToastProvider>
        <ThemeProvider>
          <SidebarFooter buildHash="abc123" />
        </ThemeProvider>
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /switch to light theme/i }))
    await waitFor(() => expect(localStorage.getItem('finance.theme')).toBe('light'))
    // Nothing was abandoned, so nothing is announced — every toggle would otherwise toast.
    expect(screen.queryByText(/no longer following your system/)).toBeNull()
  })

  it('hides the pill until the status answers, and survives a failed status', async () => {
    vi.mocked(fetchSystemStatus).mockRejectedValue(new Error('offline'))
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    await waitFor(() => expect(fetchSystemStatus).toHaveBeenCalled())
    expect(screen.queryByText('prod')).toBeNull()
    expect(screen.getByText('me@example.com')).toBeTruthy()
  })

  it('drops the whole row when there is no email yet', () => {
    vi.mocked(useAuth).mockReturnValue({ email: null, isAuthenticated: true, isLoading: false, login: vi.fn(), logout, authError: null, retry: vi.fn() } as never)
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    // The row, not just the address: an empty one would still spend the footer's gap.
    expect(document.querySelectorAll('.sidebar-footer-row')).toHaveLength(1)
  })

  it('keeps the diagnostics status where a mutation cannot wipe it', async () => {
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    expect(await screen.findByText('prod')).toBeTruthy()
    // api() clears every snapshot after any non-GET. A boundary reading the cache would lose
    // the environment and the alembic head the first time the user saved anything — exactly
    // the session in which they are most likely to need Copy details.
    clearSnapshots()
    expect(getSnapshot(SYSTEM_SNAPSHOT)).toBeUndefined()
    expect(getLastSystemStatus()).toMatchObject({ environment: 'prod' })
  })

  it('publishes a status that lands after unmount without writing into the dead tree', async () => {
    let settle: (value: SystemStatus) => void = () => {}
    vi.mocked(fetchSystemStatus).mockReturnValue(new Promise<SystemStatus>((resolve) => { settle = resolve }))
    const { unmount } = render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    unmount()
    // The `live` flag drops the setState; the module-level publish is tab-wide and stays.
    await act(async () => {
      settle({ environment: 'prod', database: { alembic_head: 'late0head' } } as SystemStatus)
    })
    expect(getLastSystemStatus()?.database.alembic_head).toBe('late0head')
  })
})
