import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveClassification } from '../../api/allocation'
import type { SecurityClassification } from '../../api/allocation'
import { formatDate } from '../../utils/format'
import ToastProvider from '../ToastProvider'
import ClassificationEditor from './ClassificationEditor'
import type { ClassificationEditorHandle } from './ClassificationEditor'

vi.mock('../../api/allocation', async (original) => ({
  ...await original<typeof import('../../api/allocation')>(),
  saveClassification: vi.fn(),
}))

const fund: SecurityClassification = { security_id: 2, ticker: 'FUND', name: 'A fund', holding_type: 'etf',
  asset_class: null, industry: null, geography: null, source: 'Existing security records', note: null,
  reviewed_at: null, industry_available: false }
const stock: SecurityClassification = { security_id: 3, ticker: 'NVDA', name: 'NVIDIA', holding_type: 'stock',
  asset_class: 'equity', industry: 'Semis', geography: 'us', source: 'Reviewed by you', note: null,
  reviewed_at: '2026-09-01T00:00:00Z', industry_available: true }

// Block bodies: vitest treats a function RETURNED from a hook as that hook's teardown, and the
// mock helpers return the mock itself — which would then be called after every test.
beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

describe('Security classifications card', () => {
  it('opens on the unclassified rows, states coverage, and saves an inline pick with Undo', async () => {
    vi.mocked(saveClassification).mockResolvedValue({ data: fund, headers: new Headers({ 'X-Change-Batch': 'batch-9' }) })
    const onChanged = vi.fn()
    render(<ToastProvider><ClassificationEditor classifications={[fund, stock]} onChanged={onChanged} /></ToastProvider>)
    expect(screen.getByRole('region', { name: 'Security classifications' })).toBeTruthy()
    expect(screen.getByText('1 of 2 securities has no asset class · 1 not yet reviewed')).toBeTruthy()
    // Chips carry their counts; Unclassified is the default while there is work.
    expect(screen.getByRole('button', { name: /^Unclassified/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('FUND asset class')).toBeTruthy()
    expect(screen.queryByLabelText('NVDA asset class')).toBeNull()
    // A fund's industry is a sentence, not a box; its source is the import, not yet reviewed.
    expect(screen.queryByLabelText('FUND industry')).toBeNull()
    expect(screen.getByText('Fund holdings not loaded')).toBeTruthy()
    expect(screen.getByText('Import · not reviewed')).toBeTruthy()
    // The old per-row Review form is gone.
    expect(screen.queryByRole('button', { name: /Review/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('FUND asset class'), { target: { value: 'bonds' } })
    // Optimistic: the pick shows at once…
    expect((screen.getByLabelText('FUND asset class') as HTMLSelectElement).value).toBe('bonds')
    // …and the PATCH carries the whole row with the change applied.
    await waitFor(() => expect(saveClassification).toHaveBeenCalledWith(2, { asset_class: 'bonds', industry: null, geography: null, note: null }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(screen.getByText('FUND classification saved')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('reveals the whole list behind All and names a reviewed source by its date', () => {
    render(<ClassificationEditor classifications={[fund, stock]} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect((screen.getByLabelText('NVDA asset class') as HTMLSelectElement).value).toBe('equity')
    expect((screen.getByLabelText('NVDA geography') as HTMLSelectElement).value).toBe('us')
    expect(screen.getByText(`Reviewed ${formatDate(stock.reviewed_at)}`)).toBeTruthy()
    // A stock's industry is editable in place.
    expect((screen.getByLabelText('NVDA industry') as HTMLInputElement).value).toBe('Semis')
    // The search box shares the chips' row and narrows the list.
    fireEvent.change(screen.getByLabelText('Find a security'), { target: { value: 'fund' } })
    expect(screen.queryByLabelText('NVDA asset class')).toBeNull()
    expect(screen.getByLabelText('FUND asset class')).toBeTruthy()
  })

  it('says the work is done when nothing is unclassified, and opens on All', () => {
    render(<ClassificationEditor classifications={[stock]} onChanged={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /^Unclassified/ }))
    expect(screen.getByText('All securities have an asset class.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show all securities' }))
    expect(screen.getByLabelText('NVDA asset class')).toBeTruthy()
  })

  it('keeps a failed pick inline on its row and reverts the select', async () => {
    vi.mocked(saveClassification).mockRejectedValue(new Error('Connection interrupted'))
    render(<ClassificationEditor classifications={[fund]} onChanged={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('FUND asset class'), { target: { value: 'bonds' } })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Connection interrupted')
    expect(alert.closest('tr')).toBe(screen.getByLabelText('FUND asset class').closest('tr'))
    expect((screen.getByLabelText('FUND asset class') as HTMLSelectElement).value).toBe('')
  })

  it('saves a note on blur and an industry on Enter, each carrying the row as typed', async () => {
    vi.mocked(saveClassification).mockResolvedValue({ data: stock, headers: new Headers() })
    render(<ClassificationEditor classifications={[stock]} onChanged={vi.fn()} />)
    const note = screen.getByLabelText('NVDA note')
    fireEvent.change(note, { target: { value: 'fact sheet' } })
    fireEvent.blur(note)
    await waitFor(() => expect(saveClassification).toHaveBeenCalledWith(3, { asset_class: 'equity', industry: 'Semis', geography: 'us', note: 'fact sheet' }))
    const industry = screen.getByLabelText('NVDA industry')
    fireEvent.change(industry, { target: { value: 'Semiconductors' } })
    fireEvent.keyDown(industry, { key: 'Enter' })
    await waitFor(() => expect(saveClassification).toHaveBeenLastCalledWith(3, { asset_class: 'equity', industry: 'Semiconductors', geography: 'us', note: 'fact sheet' }))
    // An unchanged blur is not a request.
    fireEvent.blur(industry)
    expect(saveClassification).toHaveBeenCalledTimes(2)
  })

  // A round-trip is not a lock (P2 review round 2). Dropping the second edit was invisible: the
  // controlled select snapped back to the draft and the landing save re-based over it.
  it('serializes two picks made inside one round-trip instead of dropping the second', async () => {
    const resolvers: ((value: { data: SecurityClassification; headers: Headers }) => void)[] = []
    vi.mocked(saveClassification).mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve) }))
    render(<ClassificationEditor classifications={[fund]} onChanged={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('FUND asset class'), { target: { value: 'bonds' } })
    await waitFor(() => expect(saveClassification).toHaveBeenCalledTimes(1))
    // A second pick while the first PATCH is still in flight: it shows at once …
    fireEvent.change(screen.getByLabelText('FUND geography'), { target: { value: 'us' } })
    expect((screen.getByLabelText('FUND geography') as HTMLSelectElement).value).toBe('us')
    // … and waits its turn rather than racing the first.
    expect(saveClassification).toHaveBeenCalledTimes(1)
    await act(async () => { resolvers[0]({ data: fund, headers: new Headers() }) })
    await waitFor(() => expect(saveClassification).toHaveBeenCalledTimes(2))
    expect(vi.mocked(saveClassification).mock.calls[0][1]).toEqual({ asset_class: 'bonds', geography: null, industry: null, note: null })
    expect(vi.mocked(saveClassification).mock.calls[1][1]).toEqual({ asset_class: 'bonds', geography: 'us', industry: null, note: null })
    expect((screen.getByLabelText('FUND asset class') as HTMLSelectElement).value).toBe('bonds')
    expect((screen.getByLabelText('FUND geography') as HTMLSelectElement).value).toBe('us')
  })

  it('keeps half-typed text when a refetch of the same row lands under it', () => {
    const { rerender } = render(<ClassificationEditor classifications={[stock]} onChanged={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('NVDA note'), { target: { value: 'half typed' } })
    // The parent refetched (another row saved) and this security came back with a new industry.
    rerender(<ClassificationEditor classifications={[{ ...stock, industry: 'Semiconductors' }]} onChanged={vi.fn()} />)
    // The field nobody was editing takes the server's word; the unsent local edit survives.
    expect((screen.getByLabelText('NVDA industry') as HTMLInputElement).value).toBe('Semiconductors')
    expect((screen.getByLabelText('NVDA note') as HTMLInputElement).value).toBe('half typed')
  })

  it('focusUnclassified() pins the Unclassified chip, scrolls the card in and focuses the first select', () => {
    // jsdom implements no scrollIntoView (PortfolioPage.test.tsx's idiom).
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
    try {
      const handle = createRef<ClassificationEditorHandle>()
      render(<ClassificationEditor ref={handle} classifications={[fund, stock]} onChanged={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /^All/ }))
      fireEvent.change(screen.getByLabelText('Find a security'), { target: { value: 'nvda' } })
      act(() => handle.current?.focusUnclassified())
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
      expect(screen.getByRole('button', { name: /^Unclassified/ }).getAttribute('aria-pressed')).toBe('true')
      expect((screen.getByLabelText('Find a security') as HTMLInputElement).value).toBe('')
      expect(document.activeElement).toBe(screen.getByLabelText('FUND asset class'))
      expect(document.getElementById('security-classifications')).toBe(screen.getByRole('region', { name: 'Security classifications' }))
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('focusUnclassified() brings the capped box back to its first row (2026-09-24 table-scroll spec §3.5)', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
    try {
      const handle = createRef<ClassificationEditorHandle>()
      render(<ClassificationEditor ref={handle} classifications={[fund, stock]} onChanged={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /^All/ }))
      const box = screen.getByRole('region', { name: 'Security classifications table' })
      box.scrollTop = 240 // the reader had scrolled the box down the All list
      act(() => handle.current?.focusUnclassified())
      // Same node after: the filter change re-renders the rows inside the box rather than remounting
      // it, which is why its scroll survives to be reset (a fresh box would open at its top anyway).
      expect(screen.getByRole('region', { name: 'Security classifications table' })).toBe(box)
      // preventScroll keeps the page still, so the box has to bring the first row back itself.
      expect(box.scrollTop).toBe(0)
      expect(document.activeElement).toBe(screen.getByLabelText('FUND asset class'))
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })
})
