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
  // ONE row (2026-09-25 polish spec §2): the four stacked rows cost the sidebar ~90px, which on a
  // 768–864px laptop pushed theme and Log out below its fold.
  it('is one row — the email, then the theme and log-out icon buttons — and logs out', () => {
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    const footer = document.querySelector('.sidebar-footer') as HTMLElement
    expect(Array.from(footer.children).map((child) => child.className)).toEqual([
      'sidebar-footer-email',
      'sidebar-footer-icon',
      'sidebar-footer-icon',
    ])
    expect(screen.getByText('me@example.com')).toBeTruthy()
    // Icons only: the name is for a screen reader, the title for a pointer.
    const theme = screen.getByRole('button', { name: 'Switch to light theme' })
    expect(theme.textContent).toBe('')
    expect(theme.getAttribute('title')).toBe('Switch to light theme')
    const logOut = screen.getByRole('button', { name: 'Log out' })
    expect(logOut.textContent).toBe('')
    expect(logOut.getAttribute('title')).toBe('Log out')
    fireEvent.click(logOut)
    expect(logout).toHaveBeenCalled()
  })

  it("names the environment and the build in the email's tooltip, not on screen", async () => {
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    const email = screen.getByText('me@example.com')
    await waitFor(() => expect(email.getAttribute('title')).toBe('me@example.com · prod · build abc123'))
    expect(screen.queryByText('prod')).toBeNull()
    expect(screen.queryByText('abc123')).toBeNull()
    // Production wears no tint.
    expect(email.classList.contains('is-nonprod')).toBe(false)
  })

  // Dev vs prod at a glance, now that the environment pill is gone: off production the address wears
  // the warn tint — no height spent — and its tooltip says why.
  it('tints the email and says so when the deployment is not production', async () => {
    vi.mocked(fetchSystemStatus).mockResolvedValue({ environment: 'dev', database: { alembic_head: 'f7d3b2a91c40', size_bytes: 1 } } as never)
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    const email = screen.getByText('me@example.com')
    await waitFor(() => expect(email.classList.contains('is-nonprod')).toBe(true))
    expect(email.getAttribute('title')).toBe('me@example.com · dev (not production) · build abc123')
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

  it('leaves the environment out of the tooltip when the status never answers', async () => {
    vi.mocked(fetchSystemStatus).mockRejectedValue(new Error('offline'))
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    await waitFor(() => expect(fetchSystemStatus).toHaveBeenCalled())
    // An unlabeled environment is honest; a stale or guessed one is not — and neither is a tint.
    expect(screen.getByText('me@example.com').getAttribute('title')).toBe('me@example.com · build abc123')
    expect(screen.getByText('me@example.com').classList.contains('is-nonprod')).toBe(false)
  })

  it('keeps both buttons, and only them, while there is no email yet', () => {
    vi.mocked(useAuth).mockReturnValue({ email: null, isAuthenticated: true, isLoading: false, login: vi.fn(), logout, authError: null, retry: vi.fn() } as never)
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    expect(document.querySelector('.sidebar-footer-email')).toBeNull()
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Switch to light theme',
      'Log out',
    ])
  })

  it('keeps the diagnostics status where a mutation cannot wipe it', async () => {
    render(<ThemeProvider><SidebarFooter buildHash="abc123" /></ThemeProvider>)
    await waitFor(() => expect(screen.getByText('me@example.com').getAttribute('title')).toContain('prod'))
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
