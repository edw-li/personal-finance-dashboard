import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GuidePage from '../pages/GuidePage'
import { fetchSetupStatus } from '../api/guide'
import { getLocal, resetPrefsStoreForTests } from '../prefs/prefsStore'
import GuideCompanion from './GuideCompanion'
import GuideSessionProvider from './GuideSessionProvider'

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ email: 'guide-test@example.test' }) }))
vi.mock('../api/guide', () => ({ fetchSetupStatus: vi.fn() }))
vi.mock('../api/prefs', () => ({ patchPrefs: vi.fn().mockResolvedValue({ prefs: {} }) }))

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="location">{location.pathname}{location.search}{location.hash}</output><button onClick={() => void navigate(-1)}>Browser Back</button></>
}
function Destination() {
  return <><main id="main" tabIndex={-1}><label>Working field<input /></label><Link to="/spending?section=budgets">Another page</Link></main><GuideCompanion /></>
}
function mount(entry: string) {
  return render(<MemoryRouter initialEntries={[entry]}><GuideSessionProvider><LocationProbe /><Routes>
    <Route path="/guide" element={<GuidePage />} /><Route path="*" element={<Destination />} />
  </Routes></GuideSessionProvider></MemoryRouter>)
}
const locationText = () => screen.getByTestId('location').textContent!
const companion = () => screen.getByRole('complementary', { name: 'Guide instructions' })

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); resetPrefsStoreForTests()
  localStorage.setItem('finance_token', 'test-token')
  vi.mocked(fetchSetupStatus).mockResolvedValue({ checked_at: '2026-09-27T09:00:00Z', year: 2026,
    steps: { 'setup-accounts': { complete: true, evidence: '30 active accounts saved.' } },
  })
})
afterEach(() => { cleanup(); resetPrefsStoreForTests(); vi.restoreAllMocks() })

describe('Guide continuity', () => {
  it('keeps the selected task in the URL, carries instructions to the destination, and restores selection on Back', async () => {
    mount('/guide?section=start#start-setup')
    fireEvent.click(document.getElementById('setup-accounts')!)
    expect(locationText()).toBe('/guide?section=start#setup-accounts')
    fireEvent.click(within(document.querySelector('#start-setup .guide-detail') as HTMLElement).getByRole('link', { name: 'Open Settings →' }))
    expect(locationText()).toBe('/settings?section=household&guideTask=setup-accounts#accounts')
    expect(within(companion()).getByRole('heading', { name: 'Add the accounts' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }))
    await waitFor(() => expect(document.getElementById('setup-accounts')?.getAttribute('aria-selected')).toBe('true'))
    expect(locationText()).toBe('/guide?section=start#setup-accounts')
  })
  it('reloads from a destination link, preserves form edits during Next/Previous, and closes without losing the destination', () => {
    mount('/settings?section=household&guideTask=setup-accounts#accounts')
    const field = screen.getByRole('textbox', { name: 'Working field' }) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'Unsaved draft' } })
    fireEvent.click(within(companion()).getByRole('button', { name: /^Next:/ }))
    expect(within(companion()).getByRole('heading', { name: 'Add spending categories and their kinds' })).toBeTruthy()
    expect(field.value).toBe('Unsaved draft')
    fireEvent.click(within(companion()).getByRole('button', { name: /^Previous:/ }))
    fireEvent.click(within(companion()).getByRole('button', { name: 'Close guide instructions' }))
    expect(screen.queryByRole('complementary', { name: 'Guide instructions' })).toBeNull()
    expect(locationText()).toBe('/settings?section=household#accounts')
    expect(field.value).toBe('Unsaved draft')
  })
  it('keeps instructions while navigating and restores the session after a reload', async () => {
    const view = mount('/settings?section=household&guideTask=setup-accounts#accounts')
    fireEvent.click(screen.getByRole('link', { name: 'Another page' }))
    expect(within(companion()).getByRole('heading', { name: 'Add the accounts' })).toBeTruthy()
    view.unmount()
    mount('/spending?section=budgets')
    await waitFor(() => expect(within(companion()).getByRole('heading', { name: 'Add the accounts' })).toBeTruthy())
  })
  it('copies an exact task link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    mount('/guide?section=start#setup-accounts')
    fireEvent.click(screen.getByRole('button', { name: 'Copy link to Add the accounts' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/guide?section=start#setup-accounts`))
    expect(screen.getByText('Task link copied')).toBeTruthy()
  })
})

describe('Setup evidence and personal progress', () => {
  it('renders saved evidence and persists manual marks without marking a step just for viewing it', async () => {
    const view = mount('/guide?section=start#setup-accounts')
    await waitFor(() => expect(screen.getByText('30 active accounts saved.')).toBeTruthy())
    expect(screen.getByText('1 of 18 steps ready')).toBeTruthy()
    expect(getLocal('guide_progress')?.tasks ?? {}).toEqual({})
    fireEvent.click(document.getElementById('setup-appearance')!)
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(screen.getByText('2 of 18 steps ready')).toBeTruthy()
    expect(getLocal('guide_progress')?.tasks['setup-appearance']).toBe('done')
    view.unmount()
    mount('/guide?section=start#setup-appearance')
    expect(screen.getByRole('button', { name: 'Mark done' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Clear my mark' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not needed' }))
    expect(getLocal('guide_progress')?.tasks['setup-appearance']).toBe('skipped')
  })
  it('keeps manual controls and instructions available when the evidence request fails', async () => {
    vi.mocked(fetchSetupStatus).mockRejectedValue(new Error('offline'))
    mount('/guide?section=start#setup-appearance')
    await waitFor(() => expect(screen.getAllByText(/Couldn't load setup status/).length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(screen.getByText('1 of 18 steps ready')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Settings →' })).toBeTruthy()
  })
})
