import { useState } from 'react'
import { undoBatch } from '../../api/lifecycle'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DividendOut, SecurityOut } from '../../types/api'
import DividendsPanel, { GLIDE_ROWS, REVEAL_WINDOW_MS } from './DividendsPanel'
import ToastProvider from '../ToastProvider'

vi.mock('../../api/lifecycle', () => ({ undoBatch: vi.fn().mockResolvedValue({}) }))

vi.mock('../../api/portfolio', () => ({
  createDividend: vi.fn().mockResolvedValue({}),
  updateDividend: vi.fn().mockResolvedValue({}),
  deleteDividend: vi.fn().mockResolvedValue({ batchId: 'dividend-batch' }),
}))
// echarts needs a real canvas and is NEVER rendered in jsdom (house law) — what the bars
// carry is pinned in dividendChartOptions.test.ts; this marker says whether one is up and,
// via the categories, which window fed it.
vi.mock('../EChart', async () => {
  const { createElement } = await import('react')
  return {
    default: ({
      option,
      ariaLabel,
    }: {
      option: { xAxis?: { data?: unknown[] } }
      ariaLabel?: string
    }) =>
      createElement('div', {
        'data-testid': 'echart',
        'aria-label': ariaLabel,
        'data-categories': (option.xAxis?.data ?? []).join(','),
      }),
  }
})
// revealInBox does geometry jsdom cannot lay out (its arithmetic is pinned in tableScrollDom.test.ts);
// here the question is only WHEN the panel asks for it, and with which box and row.
vi.mock('../tableScrollDom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tableScrollDom')>()),
  revealInBox: vi.fn(),
}))
import { revealInBox } from '../tableScrollDom'
import { createDividend, deleteDividend, updateDividend } from '../../api/portfolio'

const securities: SecurityOut[] = [{
  id: 1, ticker: 'NVDA', name: 'NVIDIA', industry: 'Semis', holding_type: 'stock',
  is_manual_priced: false, is_active: true, annual_dividend: '0.0400', ex_div_date: null,
}]

function dividend(over: Partial<DividendOut> = {}): DividendOut {
  return {
    id: 1, security_id: 1, account: 'RH Taxable', pay_date: '2025-12-15',
    amount: '100.00', source: 'manual', ex_date: null, per_share: null,
    shares_held: null, notes: null,
    ...over,
  }
}

// The refresh's own row: pay_date == ex_date, and the per-share × shares that produced it.
const AUTO = dividend({
  id: 2, pay_date: '2026-06-19', amount: '8.20', source: 'auto',
  ex_date: '2026-06-19', per_share: '0.820000', shares_held: '10.000000',
})

// The panel reads its own todayIso(), so the clock is pinned rather than derived —
// LOCAL noon (no trailing Z) so the calendar date is 2026-08-20 in every zone.
function pinToday(): void {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T12:00:00'))
}

// StatTile has no role of its own; read the value that sits beside a known label. From the TILE,
// not the label's parent: the label text and its (i) share a `.stat-label-text` unit now
// (2026-09-13 polish §10), so the label's parent is that span rather than the tile.
function tileValue(label: string): string {
  return screen.getByText(label).closest('.stat-tile')!.querySelector('.stat-value')!.textContent!
}

function renderPanel(dividends: DividendOut[], annualIncome: string | null = '432.10', onChanged = () => {}) {
  return render(
    <DividendsPanel
      securities={securities}
      dividends={dividends}
      annualIncome={annualIncome}
      onChanged={onChanged}
    />,
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('DividendsPanel ownership', () => {
  // TransactionsPanel's twin (2026-09-09 audit item 27): the other free-text door into the
  // account roster, with the same silent get-or-create behind it.
  it('offers the account roster and warns when a typed label would mint a new one', () => {
    render(
      <DividendsPanel
        securities={securities}
        dividends={[]}
        annualIncome={null}
        accounts={['Schwab', 'Joint Taxable']}
        primaryName="Edward"
        onChanged={() => {}}
      />,
    )
    const options = Array.from(document.querySelectorAll('#div-account-labels option'))
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['Schwab', 'Joint Taxable'])
    const box = screen.getByLabelText('Account')
    fireEvent.change(box, { target: { value: 'Schwab' } })
    expect(screen.queryByText(/will be created/)).toBeNull()
    fireEvent.change(box, { target: { value: 'Schwabb' } })
    expect(
      screen.getByText(
        "New account 'Schwabb' will be created and assigned to Edward — re-tag it in Settings → Accounts",
      ),
    ).toBeTruthy()
    expect(box.getAttribute('aria-describedby')).toBe('div-account-note')
  })

  it('warns about nothing while the roster is unknown', () => {
    render(
      <DividendsPanel securities={securities} dividends={[]} annualIncome={null} onChanged={() => {}} />,
    )
    const box = screen.getByLabelText('Account')
    fireEvent.change(box, { target: { value: 'Schwab' } })
    expect(screen.queryByText(/will be created/)).toBeNull()
    // ...and no empty list either: a `list` pointing at an empty datalist is a dropdown
    // arrow that opens on nothing.
    expect(document.getElementById('div-account-labels')).toBeNull()
    expect(box.getAttribute('list')).toBeNull()
  })

  it('badges every row with its owner and spells out the resurrect rule', () => {
    renderPanel([dividend(), AUTO])
    // The two rows sit in different months and only the newest opens by itself (2026-09-24
    // table-scroll spec §4.4) — open them all, as a reader looking for both would.
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    // Scoped to the table: the hint's legend badge carries the same word, so an unscoped
    // getByText('auto') matches two nodes and throws.
    const table = within(screen.getByRole('table'))
    expect(table.getByText('auto')).toBeTruthy()
    expect(table.getByText('manual')).toBeTruthy()
    expect(screen.getByText(/deleting one brings it back next run/)).toBeTruthy()
    expect(screen.getByText(/recorded on the ex-date/)).toBeTruthy()
  })

  it("shows an auto row's per-share × shares and dashes a manual one", () => {
    renderPanel([dividend(), AUTO])
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    // Addressed by id: month lines now sit between the entry rows, so positions no longer name them.
    const manual = document.querySelector<HTMLElement>('tr[data-dividend-id="1"]')!
    const auto = document.querySelector<HTMLElement>('tr[data-dividend-id="2"]')!
    expect(within(manual).getByText('—')).toBeTruthy() // manual: no event provenance
    expect(within(auto).getByText('$0.82')).toBeTruthy()
    expect(within(auto).getByText('× 10')).toBeTruthy()
  })
})

describe('DividendsPanel income analytics', () => {
  it('sums the trailing year and the calendar year, and takes the projection verbatim', () => {
    pinToday()
    renderPanel([dividend(), AUTO])
    // Dec 2025 (100.00) is inside the trailing 12 but outside 2026; June's 8.20 is in both.
    expect(tileValue('Trailing 12-mo income')).toBe('$108.20')
    expect(tileValue('YTD income')).toBe('$8.20')
    // The server's totals.annual_income, untouched.
    expect(tileValue('Projected annual income')).toBe('$432.10')
  })

  it('charts the trailing 24 months ending on the current one, in a ChartCard', () => {
    pinToday()
    renderPanel([AUTO])
    const categories = screen.getByTestId('echart').getAttribute('data-categories')!.split(',')
    expect(categories).toHaveLength(24)
    expect(categories[0]).toBe('Sep 2024')
    expect(categories[23]).toBe('Aug 2026')
    // The card's own chrome: the house sentence on the canvas, the export row above it (F11, F12).
    expect(screen.getByLabelText(/Bar chart of dividend income per month/)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Export dividends' })).toBeTruthy()
  })

  it('dashes the projection tile when nothing is priced yet', () => {
    pinToday()
    renderPanel([AUTO], null)
    expect(tileValue('Projected annual income')).toBe('—')
  })

  it('draws no tiles and no chart on an empty log', () => {
    pinToday()
    renderPanel([])
    expect(screen.queryByText('Trailing 12-mo income')).toBeNull()
    expect(screen.queryByTestId('echart')).toBeNull()
    expect(screen.getByText('No dividends recorded.')).toBeTruthy()
  })
})

describe('DividendsPanel manual entry', () => {
  it('still posts a hand-entered dividend with the typed values', async () => {
    const onChanged = vi.fn()
    renderPanel([], '432.10', onChanged)
    // fireEvent, not user-event: @testing-library/user-event is not a devDependency here
    // (TransactionsPanel.test.tsx's sanctioned substitution).
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/account/i), { target: { value: 'Fidelity' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    // Exact label, not /amount/i: the panel title's ⓘ carries an aria-label ending
    // "…the per-share amount;…", and getByLabelText reads aria-label too, so the loose
    // regex now matches the hint button as well as this field. Same input, named exactly.
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(vi.mocked(createDividend).mock.calls[0][0]).toMatchObject({
      security_id: 1, account: 'Fidelity', pay_date: '2026-08-03', amount: '4.10',
    })
  })

  it('canonicalizes a grouped amount at the wire boundary with no blur', async () => {
    const onChanged = vi.fn()
    renderPanel([], '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1,050' } })
    // Typed and clicked, never blurred — the belt in submit() is what strips the grouping
    // comma a Decimal column would reject.
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(vi.mocked(createDividend).mock.calls[0][0]).toMatchObject({ amount: '1050' })
  })

  it('refuses a whitespace-only amount client-side', () => {
    renderPanel([])
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '   ' } })
    // Spaces are not a number: the guard trims, matching TransactionsPanel's. Untrimmed it
    // would reach the API as "" and 422 as an opaque pydantic decimal-parse error.
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    expect(screen.getByText('Security, pay date and amount are required')).toBeTruthy()
    expect(createDividend).not.toHaveBeenCalled()
  })
})

// Spec §5.1: the log was append-and-delete only — a typo'd amount cost a delete and a
// retype. The form-swap edit is TransactionsPanel's, mirrored.
describe('DividendsPanel editing', () => {
  it('round-trips a row through PATCH with the exact body', async () => {
    const onChanged = vi.fn()
    renderPanel([dividend()], '432.10', onChanged)
    fireEvent.click(screen.getByRole('button', { name: 'Edit this dividend' }))
    // Seeded from the SERVER strings, verbatim (the plain text boxes show them as stored).
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('RH Taxable')
    expect((screen.getByLabelText(/pay date/i) as HTMLInputElement).value).toBe('2025-12-15')
    // The security is frozen: DividendUpdate carries no security_id, so a row cannot be
    // moved between tickers by an edit (TransactionsPanel's rule).
    expect((screen.getByLabelText(/security/i) as HTMLSelectElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '125.50' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // Exact, not toMatchObject — and NOT because the server would refuse a leaked
    // security_id: DividendUpdate is a plain BaseModel, so pydantic's default config
    // IGNORES extra keys and one would travel entirely unnoticed. That silence is the
    // reason the body is pinned whole: a stray key costs nothing today and quietly starts
    // being honoured the day the schema grows a field by that name.
    expect(updateDividend).toHaveBeenCalledWith(1, {
      account: 'RH Taxable', pay_date: '2025-12-15', amount: '125.50', notes: null,
    })
    expect(createDividend).not.toHaveBeenCalled()
    // An edit is a one-off correction: the form resets whole, and the security is free again.
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: /add dividend/i })).toBeTruthy()
  })

  it('Cancel abandons the edit and re-arms the create form', () => {
    renderPanel([dividend()])
    fireEvent.click(screen.getByRole('button', { name: 'Edit this dividend' }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
    expect((screen.getByLabelText(/security/i) as HTMLSelectElement).disabled).toBe(false)
  })

  it('deleting the row being edited resets the form — on success only', async () => {
    const onChanged = vi.fn()
    render(<ToastProvider><DividendsPanel securities={securities} dividends={[dividend()]} annualIncome="432.10" onChanged={onChanged} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Edit this dividend' }))
    // A FAILED delete leaves the row standing, so the edit session must survive it.
    vi.mocked(deleteDividend).mockRejectedValueOnce(new Error('network'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete this dividend' }))
    await waitFor(() => expect(screen.getByText('network')).toBeTruthy())
    expect(screen.getByRole('button', { name: /save changes/i })).toBeTruthy()
    expect(onChanged).not.toHaveBeenCalled()
    // The successful one takes the row away — a stale editingId would PATCH a 404 next save.
    fireEvent.click(screen.getByRole('button', { name: 'Delete this dividend' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /add dividend/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
  })

  it.each(['manual', 'auto'] as const)('restores the exact %s dividend through its batch', async (source) => {
    const original = source === 'auto' ? AUTO : dividend()
    let restored = false
    vi.mocked(undoBatch).mockImplementationOnce(async () => { restored = true; return {} as Awaited<ReturnType<typeof undoBatch>> })
    function Host() {
      const [rows, setRows] = useState([original])
      return <ToastProvider><DividendsPanel securities={securities} dividends={rows} annualIncome="432.10"
        onChanged={async () => { await Promise.resolve(); setRows(restored ? [original] : []) }} /></ToastProvider>
    }
    render(<Host />)
    const remove = screen.getByRole('button', { name: 'Delete this dividend' })
    remove.focus()
    fireEvent.click(remove)
    await screen.findByRole('button', { name: 'Undo' })
    expect(screen.queryByRole('button', { name: 'Edit this dividend' })).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    const edit = await screen.findByRole('button', { name: 'Edit this dividend' })
    await waitFor(() => expect(edit.closest('tr')?.hasAttribute('data-flash')).toBe(true))
    expect(undoBatch).toHaveBeenCalledWith('dividend-batch')
    expect(createDividend).not.toHaveBeenCalled()
    expect(edit.closest('tr')?.getAttribute('data-dividend-id')).toBe(String(original.id))
    expect(edit.closest('tr')?.contains(document.activeElement)).toBe(true)
  })

})

describe('DividendsPanel entry session', () => {
  it('keeps security/account/pay date after an add, clears the payment, focuses amount', async () => {
    const onChanged = vi.fn()
    renderPanel([], '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/account/i), { target: { value: 'Fidelity' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: 'Q3' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect((screen.getByLabelText(/security/i) as HTMLSelectElement).value).toBe('1')
    expect((screen.getByLabelText(/account/i) as HTMLInputElement).value).toBe('Fidelity')
    expect((screen.getByLabelText(/pay date/i) as HTMLInputElement).value).toBe('2026-08-03')
    const amount = screen.getByLabelText('Amount') as HTMLInputElement
    expect(amount.value).toBe('')
    expect((screen.getByLabelText(/notes/i) as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(amount)
    expect(screen.getByRole('button', { name: /add another/i })).toBeTruthy()
    expect(screen.getByText(/security, account and date kept/i)).toBeTruthy()
  })

  it('never resurrects the pre-reset amount when the caret was still in the money box', async () => {
    const onChanged = vi.fn()
    renderPanel([], '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    // A REAL focus, not fireEvent.focus: only this moves jsdom's activeElement. The form
    // carries no data-entry-scope, so Enter is the browser's implicit submit and leaves the
    // caret in this box — and jsdom's click does not move focus either, so the click below
    // models that Enter faithfully.
    const amount = screen.getByLabelText('Amount') as HTMLInputElement
    act(() => amount.focus())
    fireEvent.change(amount, { target: { value: '$1,050' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // Here the focus target IS the box the caret is in, so today's transfer fires no blur
    // at all and there is nothing to resurrect. The pin is the guard on that coincidence:
    // it holds the panel to 998f05c's ordering the day this form grows a second committing
    // box (a per-share entry, say) or moves the focus target off the amount.
    expect(amount.value).toBe('')
    expect(document.activeElement).toBe(amount)
  })

  it('gates the row actions while a save is in flight', () => {
    // A create that never settles: busy stays true for the rest of the test.
    vi.mocked(createDividend).mockReturnValueOnce(new Promise<never>(() => {}))
    renderPanel([dividend()])
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    // The in-flight save's .then closes over editingId as it was at SUBMIT time, so a
    // mid-flight Edit would have its seed wiped by the reset that lands afterwards — the
    // row buttons are simply shut for the duration (TransactionsPanel's rule).
    fireEvent.click(screen.getByRole('button', { name: 'Edit this dividend' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete this dividend' }))
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
    // Still the typed row, not the ledger row's 2025-12-15 seed.
    expect((screen.getByLabelText(/pay date/i) as HTMLInputElement).value).toBe('2026-08-03')
    expect(
      screen.getByRole('button', { name: 'Edit this dividend' }).getAttribute('aria-disabled') === 'true',
    ).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Delete this dividend' }).getAttribute('aria-disabled') === 'true',
    ).toBe(true)
  })

  it('drops the kept cue when the security changes', async () => {
    const onChanged = vi.fn()
    renderPanel([], '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(screen.getByText(/security, account and date kept/i)).toBeTruthy()
    // The cue names the security as kept; the moment it is changed the sentence is a lie.
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '' } })
    expect(screen.queryByText(/kept/i)).toBeNull()
    expect(screen.getByRole('button', { name: /add dividend/i })).toBeTruthy()
  })
})

// Three months, newest first as the API sends them: June 2026 (two entries), March 2026, December 2025.
const JUNE_A = dividend({ id: 11, pay_date: '2026-06-19', amount: '0.10' })
const JUNE_B = dividend({ id: 12, pay_date: '2026-06-02', amount: '0.20' })
const MARCH = dividend({ id: 13, pay_date: '2026-03-10', amount: '5.00' })
const DECEMBER = dividend({ id: 14, pay_date: '2025-12-15', amount: '100.00' })
const LEDGER = [JUNE_A, JUNE_B, MARCH, DECEMBER]

// A month toggle by its name as it is heard, "Jun 2026, 2 entries". The comma is a visually-hidden span,
// and both jsdom and Edge compute the name with a space BEFORE it ("Jun 2026 , 2 entries" — Edge's
// accessibility tree, 2026-09-24): the span is out of flow, so the name computation pads it like a
// block. Speech reads the two alike, so the space is folded away here; a lost comma still fails.
const monthButton = (name: string) =>
  screen.getByRole('button', { name: (accessible) => accessible.replace(/\s+,/g, ',') === name })
const shownIds = () =>
  [...document.querySelectorAll('tr[data-dividend-id]')].map((row) => Number(row.getAttribute('data-dividend-id')))
const rectAt = (top: number, height: number) =>
  ({ top, bottom: top + height, height, left: 0, right: 800, width: 800, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

// jsdom lays nothing out, so the focus tests draw the ledger by hand: a 400px box at y=100 under a 30px
// header — the band where a line pins starts at 130 — scrolled deep into the ledger. March's group
// spans `group`; its line's cell pins at the band once the group has begun above it, and December's
// line (the next) has its cell at `nextLineTop` — at the band, it is stuck over March's.
function drawMarch(group: { top: number; height: number }, nextLineTop: number) {
  const box = screen.getByRole('region', { name: 'Dividends by month' })
  box.style.setProperty('--table-head-h', '30px')
  box.getBoundingClientRect = () => rectAt(100, 400)
  const march = monthButton('Mar 2026, 1 entry')
  march.closest('tbody')!.getBoundingClientRect = () => rectAt(group.top, group.height)
  march.closest('th')!.getBoundingClientRect = () => rectAt(Math.max(group.top, 130), 33)
  monthButton('Dec 2025, 1 entry').closest('th')!.getBoundingClientRect = () => rectAt(nextLineTop, 33)
  box.scrollTop = 900
  return { box, march }
}

describe('DividendsPanel months (2026-09-24 table-scroll spec §4)', () => {
  it('lists one line per recorded month, newest first, with only the newest open', () => {
    renderPanel(LEDGER)
    const lines = [...document.querySelectorAll('.dividend-month-toggle')].map((b) => [
      b.textContent,
      b.getAttribute('aria-expanded'),
    ])
    expect(lines).toEqual([
      ['Jun 2026, 2 entries', 'true'],
      ['Mar 2026, 1 entry', 'false'],
      ['Dec 2025, 1 entry', 'false'],
    ])
    expect(shownIds()).toEqual([11, 12])
    expect(screen.getByText('3 months · 4 entries')).toBeTruthy()
  })

  it('opens the current month by itself even when a future-dated entry is listed above it', () => {
    // 2099: after any real clock this suite runs on — no need to pin the date.
    renderPanel([dividend({ id: 20, pay_date: '2099-01-10', amount: '1.00' }), ...LEDGER])
    expect(monthButton('Jan 2099, 1 entry').getAttribute('aria-expanded')).toBe('false')
    expect(monthButton('Jun 2026, 2 entries').getAttribute('aria-expanded')).toBe('true')
    expect(shownIds()).toEqual([11, 12])
  })

  it("totals each month's entries to the cent on its line, under the Amount column", () => {
    renderPanel(LEDGER)
    const totals = [...document.querySelectorAll('.dividend-month-row')].map(
      (row) => row.querySelector('td.num')!.textContent,
    )
    // 0.10 + 0.20 is 0.30000000000000004 in floats; the line says $0.30.
    expect(totals).toEqual(['$0.30', '$5.00', '$100.00'])
  })

  it('names each line for a screen reader — "Jun 2026, 2 entries" — and describes it by its total', () => {
    renderPanel(LEDGER)
    // The name: a comma the eye never sees keeps "2026" and "2" apart (monthButton matches it whole).
    expect(monthButton('Jun 2026, 2 entries')).toBeTruthy()
    const described = [...document.querySelectorAll('.dividend-month-toggle')].map(
      (toggle) => document.getElementById(toggle.getAttribute('aria-describedby')!)!.textContent,
    )
    expect(described).toEqual(['$0.30', '$5.00', '$100.00'])
  })

  it('opens and closes a month from its button or anywhere on its line — one toggle per press', () => {
    renderPanel(LEDGER)
    fireEvent.click(monthButton('Mar 2026, 1 entry'))
    expect(monthButton('Mar 2026, 1 entry').getAttribute('aria-expanded')).toBe('true')
    expect(shownIds()).toEqual([11, 12, 13])
    // The line's total cell is part of the target too.
    fireEvent.click(monthButton('Jun 2026, 2 entries').closest('tr')!.querySelector('td.num')!)
    expect(monthButton('Jun 2026, 2 entries').getAttribute('aria-expanded')).toBe('false')
    expect(shownIds()).toEqual([13])
  })

  it('Expand all opens every month and turns into Collapse all, which folds them all', () => {
    renderPanel(LEDGER)
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(shownIds()).toEqual([11, 12, 13, 14])
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(shownIds()).toEqual([])
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeTruthy()
  })

  it('offers no Expand all for a single month', () => {
    renderPanel([JUNE_A, JUNE_B])
    expect(screen.getByText('1 month · 2 entries')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /expand all|collapse all/i })).toBeNull()
  })

  it('opens the newest month when a cold ledger lands after the first render', () => {
    const view = renderPanel([])
    view.rerender(
      <DividendsPanel securities={securities} dividends={LEDGER} annualIncome="432.10" onChanged={() => {}} />,
    )
    expect(monthButton('Jun 2026, 2 entries').getAttribute('aria-expanded')).toBe('true')
    expect(shownIds()).toEqual([11, 12])
  })

  it('keeps the months the reader opened when the ledger refreshes', () => {
    const view = renderPanel(LEDGER)
    fireEvent.click(monthButton('Dec 2025, 1 entry'))
    view.rerender(
      <DividendsPanel securities={securities} dividends={[JUNE_A, MARCH, DECEMBER]} annualIncome="432.10" onChanged={() => {}} />,
    )
    expect(monthButton('Jun 2026, 1 entry').getAttribute('aria-expanded')).toBe('true')
    expect(monthButton('Dec 2025, 1 entry').getAttribute('aria-expanded')).toBe('true')
    expect(shownIds()).toEqual([11, 14])
  })

  it('scrolls inside a capped, named box', () => {
    renderPanel(LEDGER)
    const box = screen.getByRole('region', { name: 'Dividends by month' })
    // dividend-scroll: the box keeps its scrollbar's lane (dividends.css), so a fold never rescales it.
    expect(box.className).toBe('table-scroll dividend-scroll')
    expect(box.querySelector(':scope > table')).toBe(screen.getByRole('table'))
  })

  it("scrolls the box to a month's start when a Tab lands on its covered line, or a click on the line (spec §4.3)", () => {
    renderPanel(LEDGER)
    // March folded, its group begun 70px above the band and ended there: December's line is stuck
    // over March's.
    const { box, march } = drawMarch({ top: 60, height: 44 }, 130)
    // A Tab moves focus here FROM another element: jsdom hands the focus event the element it left as
    // its relatedTarget.
    act(() => screen.getByRole('button', { name: 'Expand all' }).focus())
    fireEvent.keyDown(document, { key: 'Tab' })
    act(() => march.focus())
    expect(box.scrollTop).toBe(830) // the band starts at 100 + 30 = 130; the group began at 60
    // …and a click on the line does the same before it toggles.
    box.scrollTop = 900
    fireEvent.click(march.closest('tr')!.querySelector('td.num')!)
    expect(box.scrollTop).toBe(830)
    expect(march.getAttribute('aria-expanded')).toBe('true')
  })

  it('leaves the box alone when a month line already shows at its own place', () => {
    renderPanel(LEDGER)
    // March's group begins below the band: its line sits at its own place, December's after it.
    const { box, march } = drawMarch({ top: 250, height: 44 }, 294)
    act(() => screen.getByRole('button', { name: 'Expand all' }).focus())
    fireEvent.keyDown(document, { key: 'Tab' })
    act(() => march.focus())
    expect(box.scrollTop).toBe(900)
  })

  it('leaves the box alone when a Tab lands on the line on top of the stack — in plain view, nothing covers it', () => {
    renderPanel(LEDGER)
    // March open, its group begun above the band and running on below it: its line is pinned and on
    // top, December's still further down.
    const { box, march } = drawMarch({ top: 60, height: 340 }, 400)
    act(() => screen.getByRole('button', { name: 'Expand all' }).focus())
    fireEvent.keyDown(document, { key: 'Tab' })
    act(() => march.focus())
    expect(box.scrollTop).toBe(900)
  })

  it('leaves the box alone when an overlay hands focus back to a covered line (the review repro: Ctrl+K, Esc)', () => {
    renderPanel(LEDGER)
    const { box, march } = drawMarch({ top: 60, height: 44 }, 130)
    // The palette's input held focus; Esc closed it, and it hands focus back to the line — from an
    // element, but not by a Tab.
    act(() => screen.getByRole('button', { name: 'Expand all' }).focus())
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => march.focus())
    expect(box.scrollTop).toBe(900)
  })

  it('leaves the box alone when focus comes back after a pointer press, the last KEY a Tab all the same', () => {
    renderPanel(LEDGER)
    const { box, march } = drawMarch({ top: 60, height: 44 }, 130)
    // A Tab, then a press on a chart or a panel: focus handed back to the line afterwards (a detail
    // panel closing) is not the keyboard's walk.
    act(() => screen.getByRole('button', { name: 'Expand all' }).focus())
    fireEvent.keyDown(document, { key: 'Tab' })
    fireEvent.pointerDown(document.body)
    act(() => march.focus())
    expect(box.scrollTop).toBe(900)
  })

  it('leaves the box where the reader scrolled it when a window switch hands focus back to a line (Edge, 2026-09-24)', () => {
    renderPanel(LEDGER)
    const { box, march } = drawMarch({ top: 60, height: 44 }, 130)
    // The reader Tabbed onto the line (it uncovered) and scrolled on through the ledger…
    act(() => screen.getByRole('button', { name: 'Expand all' }).focus())
    fireEvent.keyDown(document, { key: 'Tab' })
    act(() => march.focus())
    box.scrollTop = 900
    // …then another window took focus and gave it back, no key pressed between. The browser re-fires
    // focus on the line with no relatedTarget; jsdom's blur() then focus() is that event.
    act(() => march.blur())
    act(() => march.focus())
    expect(box.scrollTop).toBe(900)
  })

  it('opens the month an added entry lands in, keeping the caret in the amount box', async () => {
    const onChanged = vi.fn()
    renderPanel(LEDGER, '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2025-12-20' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(monthButton('Dec 2025, 1 entry').getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(screen.getByLabelText('Amount'))
  })

  it('opens the month an edit moves an entry into', async () => {
    const onChanged = vi.fn()
    renderPanel(LEDGER, '432.10', onChanged)
    const june = document.querySelector<HTMLElement>('tr[data-dividend-id="11"]')!
    fireEvent.click(within(june).getByRole('button', { name: 'Edit this dividend' }))
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2026-03-31' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(monthButton('Mar 2026, 1 entry').getAttribute('aria-expanded')).toBe('true')
  })

  it('brings a saved entry into view in the BOX once the refreshed ledger renders — not before, and once', async () => {
    const saved = dividend({ id: 15, pay_date: '2025-12-20', amount: '4.10' })
    vi.mocked(createDividend).mockResolvedValueOnce(saved)
    const onChanged = vi.fn()
    const view = renderPanel(LEDGER, '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2025-12-20' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // Its month is open, but the refetch has not landed: nothing to bring into view yet.
    expect(revealInBox).not.toHaveBeenCalled()
    // jsdom lays nothing out: the saved row's month line measures 33px and another month's 21px — the
    // row must land below its OWN month's pinned line. (Both lines are the same nodes after the
    // refetch: each month's row group is keyed by its month.)
    monthButton('Dec 2025, 1 entry').closest('tr')!.getBoundingClientRect = () => rectAt(0, 33)
    monthButton('Jun 2026, 2 entries').closest('tr')!.getBoundingClientRect = () => rectAt(0, 21)
    view.rerender(
      <DividendsPanel securities={securities} dividends={[JUNE_A, JUNE_B, MARCH, saved, DECEMBER]} annualIncome="432.10" onChanged={onChanged} />,
    )
    const box = screen.getByRole('region', { name: 'Dividends by month' })
    expect(revealInBox).toHaveBeenCalledTimes(1)
    expect(vi.mocked(revealInBox).mock.calls[0][0]).toBe(box)
    expect(vi.mocked(revealInBox).mock.calls[0][1]).toBe(box.querySelector('tr[data-dividend-id="15"]'))
    expect(vi.mocked(revealInBox).mock.calls[0][2]).toBe(33)
    // A later refresh does not scroll the box again.
    view.rerender(
      <DividendsPanel securities={securities} dividends={[...LEDGER]} annualIncome="432.10" onChanged={onChanged} />,
    )
    expect(revealInBox).toHaveBeenCalledTimes(1)
  })

  // The guard on the save-time ledger: the page switched owner and back while the save was in flight,
  // and its snapshot cache handed this owner's ledger back — the very array the save was made against
  // — before the refetch landed. That ledger cannot hold the new row, so the reveal waits for the
  // refetch instead of being spent on it.
  it('keeps a pending reveal waiting when the save-time ledger comes back before the refetch', async () => {
    const saved = dividend({ id: 15, pay_date: '2025-12-20', amount: '4.10' })
    let resolve!: (row: DividendOut) => void
    vi.mocked(createDividend).mockReturnValueOnce(new Promise<DividendOut>((r) => { resolve = r }))
    const onChanged = vi.fn()
    const view = renderPanel(LEDGER, '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2025-12-20' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    // Mid-flight, the page shows another owner's ledger…
    view.rerender(<DividendsPanel securities={securities} dividends={[MARCH]} annualIncome="432.10" onChanged={onChanged} />)
    await act(async () => resolve(saved))
    expect(onChanged).toHaveBeenCalled()
    // …then this owner's again, from its cache: the save-time array.
    view.rerender(<DividendsPanel securities={securities} dividends={LEDGER} annualIncome="432.10" onChanged={onChanged} />)
    expect(revealInBox).not.toHaveBeenCalled()
    // The refetch lands, and the reveal was kept for it.
    view.rerender(
      <DividendsPanel securities={securities} dividends={[JUNE_A, JUNE_B, MARCH, saved, DECEMBER]} annualIncome="432.10" onChanged={onChanged} />,
    )
    expect(revealInBox).toHaveBeenCalledTimes(1)
  })

  // A delete or a new edit moves the reader on: an earlier save's reveal must not ride THAT action's
  // refetch to a row they have left.
  it('drops a pending reveal when the reader deletes another entry before the refetch lands', async () => {
    const saved = dividend({ id: 15, pay_date: '2025-12-20', amount: '4.10' })
    vi.mocked(createDividend).mockResolvedValueOnce(saved)
    const onChanged = vi.fn()
    const view = renderPanel(LEDGER, '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2025-12-20' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    const june = document.querySelector<HTMLElement>('tr[data-dividend-id="11"]')!
    const deleteButton = within(june).getByRole('button', { name: 'Delete this dividend' }) as HTMLButtonElement
    await waitFor(() => expect(deleteButton.getAttribute('aria-disabled')).not.toBe('true')) // the save's busy gate lifts
    fireEvent.click(deleteButton)
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
    // One refetch brings both: the saved row in, the deleted one out. The box stays put.
    view.rerender(
      <DividendsPanel securities={securities} dividends={[JUNE_B, MARCH, saved, DECEMBER]} annualIncome="432.10" onChanged={onChanged} />,
    )
    expect(revealInBox).not.toHaveBeenCalled()
  })

  it('drops a pending reveal when the reader starts another edit before the refetch lands', async () => {
    const saved = dividend({ id: 15, pay_date: '2025-12-20', amount: '4.10' })
    vi.mocked(createDividend).mockResolvedValueOnce(saved)
    const onChanged = vi.fn()
    const view = renderPanel(LEDGER, '432.10', onChanged)
    fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2025-12-20' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
    fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    const june = document.querySelector<HTMLElement>('tr[data-dividend-id="11"]')!
    const editButton = within(june).getByRole('button', { name: 'Edit this dividend' }) as HTMLButtonElement
    await waitFor(() => expect(editButton.getAttribute('aria-disabled')).not.toBe('true'))
    fireEvent.click(editButton)
    view.rerender(
      <DividendsPanel securities={securities} dividends={[JUNE_A, JUNE_B, MARCH, saved, DECEMBER]} annualIncome="432.10" onChanged={onChanged} />,
    )
    expect(revealInBox).not.toHaveBeenCalled()
  })

  // The refetch came back identical, so PortfolioPage kept the ledger it had and the reveal stayed
  // armed; the next ledger the page applies — a price refresh, a scope switch — lands past the window,
  // where scrolling the box to the old row would only be a jolt.
  it('lets a pending reveal lapse when the next ledger lands after REVEAL_WINDOW_MS', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    try {
      const saved = dividend({ id: 15, pay_date: '2025-12-20', amount: '4.10' })
      vi.mocked(createDividend).mockResolvedValueOnce(saved)
      const onChanged = vi.fn()
      const view = renderPanel(LEDGER, '432.10', onChanged)
      fireEvent.change(screen.getByLabelText(/security/i), { target: { value: '1' } })
      fireEvent.change(screen.getByLabelText(/pay date/i), { target: { value: '2025-12-20' } })
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.10' } })
      fireEvent.click(screen.getByRole('button', { name: /add dividend/i }))
      await waitFor(() => expect(onChanged).toHaveBeenCalled())
      now.mockReturnValue(1_000 + REVEAL_WINDOW_MS + 1)
      view.rerender(
        <DividendsPanel securities={securities} dividends={[JUNE_A, JUNE_B, MARCH, saved, DECEMBER]} annualIncome="432.10" onChanged={onChanged} />,
      )
      expect(revealInBox).not.toHaveBeenCalled()
    } finally {
      now.mockRestore()
    }
  })
})

// jsdom has no Web Animations, so everywhere above the panel folds at once (canGlide). These lend it a
// getAnimations: one running glide under every element, which the test ends when it chooses.
function stubGlide() {
  let finish!: () => void
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })
  const running = { finished, effect: { getComputedTiming: () => ({ endTime: 240 }) } } as unknown as Animation
  Element.prototype.getAnimations = () => [running]
  return { end: () => act(async () => finish()) }
}

describe('DividendsPanel month glide (2026-09-24 follow-up)', () => {
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).getAnimations
  })

  it('folds a month in a glide: its rows stay, marked and out of reach, until the glide ends', async () => {
    const glide = stubGlide()
    renderPanel(LEDGER)
    fireEvent.click(monthButton('Jun 2026, 2 entries'))
    // The line says folded at once; the rows fold after it.
    expect(monthButton('Jun 2026, 2 entries').getAttribute('aria-expanded')).toBe('false')
    const rows = [...document.querySelectorAll('tr[data-dividend-id]')]
    expect(rows.map((row) => row.className)).toEqual(['dividend-entry is-leaving', 'dividend-entry is-leaving'])
    expect(rows.every((row) => row.hasAttribute('inert'))).toBe(true)
    await glide.end()
    expect(shownIds()).toEqual([])
  })

  it('opens a month in a glide of its first GLIDE_ROWS rows, the rest following once it ends', async () => {
    const glide = stubGlide()
    const march = Array.from({ length: GLIDE_ROWS + 6 }, (_, i) =>
      dividend({ id: 100 + i, pay_date: '2026-03-10', amount: '1.00' }),
    )
    renderPanel([JUNE_A, JUNE_B, ...march])
    const name = `Mar 2026, ${GLIDE_ROWS + 6} entries`
    fireEvent.click(monthButton(name))
    const rows = () => [...monthButton(name).closest('tbody')!.querySelectorAll('tr[data-dividend-id]')]
    expect(rows()).toHaveLength(GLIDE_ROWS)
    expect(rows().every((row) => row.classList.contains('is-entering'))).toBe(true)
    await glide.end()
    expect(rows()).toHaveLength(GLIDE_ROWS + 6)
    expect(document.querySelector('tr.is-entering')).toBeNull()
  })

  it('changes at once for Expand all and Collapse all — the whole ledger never glides', () => {
    stubGlide()
    renderPanel(LEDGER)
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(shownIds()).toEqual([11, 12, 13, 14])
    expect(document.querySelector('tr.is-entering')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(shownIds()).toEqual([])
  })
})
