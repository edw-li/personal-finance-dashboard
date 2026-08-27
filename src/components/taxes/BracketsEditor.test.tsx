import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { FilingStatus, TaxBracketsOut } from '../../types/api'
import BracketsEditor from './BracketsEditor'

// JURISDICTIONS, the labels and the status vocabulary stay real (they drive render order and
// wording); only the two writers and the tab reader are stubbed.
vi.mock('../../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/taxes')>()),
  fetchTaxBrackets: vi.fn(),
  putTaxBrackets: vi.fn(),
  cloneBrackets: vi.fn(),
}))
import { fetchTaxBrackets, putTaxBrackets } from '../../api/taxes'

function bracketsFixture(): TaxBracketsOut {
  return {
    year: 2024,
    filing_status: 'single',
    statuses_with_rows: ['single'],
    jurisdictions: {
      federal: [
        { bracket_index: 1, rate: '0.1000', threshold: '0.00' },
        { bracket_index: 2, rate: '0.3700', threshold: '100000.00' },
      ],
      state: [{ bracket_index: 1, rate: '0.0930', threshold: '0.00' }],
      medicare: [{ bracket_index: 1, rate: '0.0145', threshold: '0.00' }],
      social_security: [],
      disability: [],
      capital_gains: [],
    },
  }
}

// The same year seen through another status' tab: the status is on the payload, and
// statuses_with_rows is year-global, so it names every tab that already has tables.
function statusFixture(
  status: FilingStatus,
  withRows: FilingStatus[] = ['single'],
): TaxBracketsOut {
  return { ...bracketsFixture(), filing_status: status, statuses_with_rows: withRows }
}

const EMPTY_TABLES = {
  federal: [], state: [], medicare: [], social_security: [], disability: [], capital_gains: [],
}

const rate = (jurisdiction: string, index: number) =>
  screen.getByLabelText(`${jurisdiction} bracket ${index} rate (%)`) as HTMLInputElement
const threshold = (jurisdiction: string, index: number) =>
  screen.getByLabelText(`${jurisdiction} bracket ${index} threshold`) as HTMLInputElement
const save = (jurisdiction: string) =>
  screen.getByRole('button', { name: `Save ${jurisdiction} brackets` })

// Installed once for the file: only the delete-all test actually reaches a confirm, and
// leaving it at "yes" keeps jsdom's unimplemented window.confirm out of the others.
const confirmSpy = vi.spyOn(window, 'confirm')

beforeEach(() => {
  vi.mocked(putTaxBrackets).mockResolvedValue(bracketsFixture())
  vi.mocked(fetchTaxBrackets).mockImplementation(async (_year: number, status: FilingStatus) => ({
    ...bracketsFixture(),
    filing_status: status,
    // A tab the user has not filled in yet is six EMPTY tables, not a 404.
    jurisdictions: status === 'single' ? bracketsFixture().jurisdictions : EMPTY_TABLES,
  }))
  confirmSpy.mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('BracketsEditor', () => {
  it('renders the six jurisdictions in JURISDICTIONS order with rates as percents', () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual([
      'Federal brackets',
      'State brackets',
      'Medicare brackets',
      'Social Security brackets',
      'Disability brackets',
      'Capital gains brackets',
    ])
    // rate * 100, trimmed — the stored fraction is never shown to the user. A blurred cell
    // adds AmountInput's echo on top of that (spec §3.3): a percent-kind box speaks "%",
    // the threshold speaks money, and neither reaches state or the wire.
    expect(rate('Federal', 1).value).toBe('10%')
    expect(rate('Federal', 2).value).toBe('37%')
    expect(rate('State', 1).value).toBe('9.3%')
    expect(rate('Medicare', 1).value).toBe('1.45%')
    expect(threshold('Federal', 2).value).toBe('$100,000.00')
    // The hint states the precision the columns keep, because it decides what a typed
    // percent becomes (37.005 -> 37.01) and therefore which saves are refused.
    expect(screen.getByText(/stored as fractions with 4 decimal places/)).toBeTruthy()
  })

  it('saves ONE jurisdiction, converting percents back to fractions', async () => {
    const onSaved = vi.fn()
    const echo = bracketsFixture()
    vi.mocked(putTaxBrackets).mockResolvedValue(echo)
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={onSaved} />)

    fireEvent.click(save('Federal'))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(echo))
    // The body carries federal ONLY: a jurisdiction absent from the body is untouched,
    // so shipping all six would replace tables the user never opened. And the percent
    // conversion is pinned here — "37" MUST become "0.37", never 0.37000000000000005.
    expect(vi.mocked(putTaxBrackets)).toHaveBeenCalledWith(2024, {
      filing_status: 'single',
      jurisdictions: {
        federal: [
          { rate: '0.1', threshold: '0.00' },
          { rate: '0.37', threshold: '100000.00' },
        ],
      },
    })
  })

  it('pins the percent->fraction conversion for repeating-binary rates', async () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    fireEvent.click(save('State'))
    await waitFor(() => expect(vi.mocked(putTaxBrackets)).toHaveBeenCalled())
    // 9.3 / 100 in floats is 0.09299999999999999; string math keeps it exact.
    expect(vi.mocked(putTaxBrackets)).toHaveBeenCalledWith(2024, {
      filing_status: 'single',
      jurisdictions: { state: [{ rate: '0.093', threshold: '0.00' }] },
    })

    // Single-flight: every Save is disabled until the in-flight one settles.
    await waitFor(() => expect((save('Medicare') as HTMLButtonElement).disabled).toBe(false))
    vi.mocked(putTaxBrackets).mockClear()
    fireEvent.click(save('Medicare'))
    await waitFor(() => expect(vi.mocked(putTaxBrackets)).toHaveBeenCalled())
    expect(vi.mocked(putTaxBrackets)).toHaveBeenCalledWith(2024, {
      filing_status: 'single',
      jurisdictions: { medicare: [{ rate: '0.0145', threshold: '0.00' }] },
    })
  })

  it('blocks a save that violates the ascending rule, before calling the API', () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    fireEvent.change(threshold('Federal', 2), { target: { value: '0' } })
    fireEvent.click(save('Federal'))

    // Same sentence the API would answer with — one vocabulary, no round trip.
    expect(screen.getByRole('alert').textContent).toContain(
      'federal: thresholds must be strictly ascending',
    )
    expect(vi.mocked(putTaxBrackets)).not.toHaveBeenCalled()
  })

  it('blocks a first threshold that is not 0 and an out-of-range percent', () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    fireEvent.change(threshold('Federal', 1), { target: { value: '5000' } })
    fireEvent.click(save('Federal'))
    expect(screen.getByRole('alert').textContent).toContain(
      'federal: the first bracket threshold must be 0',
    )

    fireEvent.change(threshold('Federal', 1), { target: { value: '0' } })
    // A rate typed as a FRACTION-sized number is the Plan 1 mis-scale bug in reverse:
    // 370% never reaches a walk.
    fireEvent.change(rate('Federal', 2), { target: { value: '370' } })
    fireEvent.click(save('Federal'))
    expect(screen.getByRole('alert').textContent).toContain('rate must be between 0% and 100%')
    expect(vi.mocked(putTaxBrackets)).not.toHaveBeenCalled()
  })

  it('refuses exponent notation in a rate, which the server would have accepted', () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    fireEvent.change(rate('Federal', 2), { target: { value: '1e-3' } })
    fireEvent.click(save('Federal'))

    // 0.001 as a percent is in range and Decimal("1e-3") is a legal 0.001, so nothing
    // downstream would have complained: the rate would simply have been stored as 0.1%.
    // This gate is the only thing between that text and the column.
    expect(screen.getByRole('alert').textContent).toContain('federal[2]: rate must be a number')
    expect(vi.mocked(putTaxBrackets)).not.toHaveBeenCalled()
  })

  it('refuses an =-expression in a rate, which the percent cell already marked invalid', () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    fireEvent.change(rate('Federal', 2), { target: { value: '=1/8' } })
    fireEvent.click(save('Federal'))

    // The rate box is kind="percent", whose component refuses "=" outright — so the save
    // must not evaluate behind its back. Left to the money default, "=1/8" would quantize
    // to 0.13 and ship a 0.13% rate the user never saw.
    expect(screen.getByRole('alert').textContent).toContain('federal[2]: rate must be a number')
    expect(vi.mocked(putTaxBrackets)).not.toHaveBeenCalled()
  })

  it('evaluates an =-expression in a threshold, which IS a money cell', async () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    fireEvent.change(threshold('Federal', 2), { target: { value: '=100000+68600' } })
    fireEvent.click(save('Federal'))

    // The other half of the asymmetry above, and the reason it is an asymmetry rather than
    // an oversight: the threshold is money, so expressions stay ON there deliberately (the
    // plan amendment names only the NON-money belts for the opt-out). This pin is what
    // breaks if someone "harmonizes" the two legs to { expressions: false }; the rate
    // beside it rides through as a plain percent either way.
    await waitFor(() =>
      expect(vi.mocked(putTaxBrackets)).toHaveBeenCalledWith(2024, {
        filing_status: 'single',
        jurisdictions: {
          federal: [
            { rate: '0.1', threshold: '0.00' },
            { rate: '0.37', threshold: '168600.00' },
          ],
        },
      }),
    )
  })

  it('echoes a threshold in money WHILE it is typed, in every accepted form', () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    // No blur here: this span is the only echo visible mid-keystroke, so it has to read the
    // same tolerant forms the box accepts — not just the plain decimals it used to gate on.
    fireEvent.change(threshold('Federal', 2), { target: { value: '$1,234' } })
    expect(screen.getByText('$1,234.00').className).toContain('drill-hint')
  })

  it('adds rows, saves them, and removes one', async () => {
    const echo = bracketsFixture()
    echo.jurisdictions.social_security = [
      { bracket_index: 1, rate: '0.0620', threshold: '0.00' },
      { bracket_index: 2, rate: '0.0000', threshold: '168600.00' },
    ]
    vi.mocked(putTaxBrackets).mockResolvedValue(echo)
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Social Security bracket' }))
    // The first row of an empty table is seeded with the threshold the API demands (the
    // seed is the literal "0" the PUT body below carries; "$0.00" is its blurred echo).
    expect(threshold('Social Security', 1).value).toBe('$0.00')
    fireEvent.change(rate('Social Security', 1), { target: { value: '6.2' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add Social Security bracket' }))
    fireEvent.change(rate('Social Security', 2), { target: { value: '0' } })
    fireEvent.change(threshold('Social Security', 2), { target: { value: '168600.00' } })
    fireEvent.click(save('Social Security'))

    await waitFor(() =>
      expect(vi.mocked(putTaxBrackets)).toHaveBeenCalledWith(2024, {
        filing_status: 'single',
        jurisdictions: {
          social_security: [
            { rate: '0.062', threshold: '0' },
            { rate: '0', threshold: '168600.00' },
          ],
        },
      }),
    )
    // The server echo is authoritative: the typed "0" comes back as the stored "0.00". Read
    // FOCUSED — both strings display as "$0.00", so only the raw state tells them apart.
    // act(), not fireEvent.focus: only a real .focus() moves document.activeElement, and
    // only act flushes the state change that swaps the echo for the raw text.
    await waitFor(() => expect(threshold('Social Security', 1).value).toBe('$0.00'))
    act(() => threshold('Social Security', 1).focus())
    expect(threshold('Social Security', 1).value).toBe('0.00')
    act(() => threshold('Social Security', 1).blur())

    fireEvent.click(screen.getByRole('button', { name: 'Remove Social Security bracket 2' }))
    expect(screen.queryByLabelText('Social Security bracket 2 rate (%)')).toBeNull()
  })

  it('compares thresholds AFTER quantizing them the way the server will', async () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Federal bracket' }))
    fireEvent.change(rate('Federal', 3), { target: { value: '40' } })
    // Two different strings that both store as 100.00. The API quantizes before it checks
    // the rules, so raw-text validation would wave this through into a 422 the user never
    // asked for.
    fireEvent.change(threshold('Federal', 2), { target: { value: '100.001' } })
    fireEvent.change(threshold('Federal', 3), { target: { value: '100.002' } })
    fireEvent.click(save('Federal'))
    expect(screen.getByRole('alert').textContent).toContain(
      'federal: thresholds must be strictly ascending',
    )
    expect(vi.mocked(putTaxBrackets)).not.toHaveBeenCalled()

    // And the mirror image: 0.001 IS a legal first threshold, because it stores as 0.00.
    fireEvent.change(threshold('Federal', 1), { target: { value: '0.001' } })
    fireEvent.change(threshold('Federal', 3), { target: { value: '200000' } })
    fireEvent.click(save('Federal'))
    await waitFor(() =>
      // The typed text is what ships — the server does the rounding, never the client.
      expect(vi.mocked(putTaxBrackets)).toHaveBeenCalledWith(2024, {
        filing_status: 'single',
        jurisdictions: {
          federal: [
            { rate: '0.1', threshold: '0.001' },
            { rate: '0.37', threshold: '100.001' },
            { rate: '0.4', threshold: '200000' },
          ],
        },
      }),
    )
  })

  it('range-checks a rate at the precision the column keeps', async () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    // 100.006% stores as the fraction 1.0001 — over the ceiling, and the API says so.
    fireEvent.change(rate('Federal', 1), { target: { value: '100.006' } })
    fireEvent.click(save('Federal'))
    expect(screen.getByRole('alert').textContent).toContain('rate must be between 0% and 100%')
    expect(vi.mocked(putTaxBrackets)).not.toHaveBeenCalled()

    // 100.004% stores as exactly 1.0000, which is the ceiling and legal.
    fireEvent.change(rate('Federal', 1), { target: { value: '100.004' } })
    fireEvent.click(save('Federal'))
    await waitFor(() => expect(vi.mocked(putTaxBrackets)).toHaveBeenCalled())
    expect(vi.mocked(putTaxBrackets).mock.calls[0][1]).toEqual({
      filing_status: 'single',
      jurisdictions: {
        federal: [
          { rate: '1.00004', threshold: '0.00' },
          { rate: '0.37', threshold: '100000.00' },
        ],
      },
    })
  })

  it('confirms before a save that would delete a jurisdiction, and drops the PUT on no', async () => {
    confirmSpy.mockReturnValue(false)
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Federal bracket 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Federal bracket 1' }))

    fireEvent.click(save('Federal'))
    // The status is named: the same table exists per (jurisdiction, status), and "Delete all
    // Federal brackets" would be an ambiguous question once there is more than one tab.
    expect(confirmSpy).toHaveBeenCalledWith('Delete all Federal brackets for 2024 (Single)?')
    expect(vi.mocked(putTaxBrackets)).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(save('Federal'))
    await waitFor(() =>
      expect(vi.mocked(putTaxBrackets)).toHaveBeenCalledWith(2024, {
        filing_status: 'single',
        jurisdictions: { federal: [] },
      }),
    )
  })

  it('retires a jurisdiction error as soon as one of its cells changes', () => {
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    fireEvent.change(threshold('Federal', 1), { target: { value: '5000' } })
    fireEvent.click(save('Federal'))
    expect(screen.getByRole('alert').textContent).toContain(
      'federal: the first bracket threshold must be 0',
    )

    // The sentence described the table as it was; the keystroke that fixes it also ends it.
    fireEvent.change(threshold('Federal', 1), { target: { value: '0' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports unsaved work to the page, and stops once the echo lands', async () => {
    const onDirtyChange = vi.fn()
    render(
      <BracketsEditor
        brackets={bracketsFixture()}
        onSaved={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    )
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)

    fireEvent.change(rate('Federal', 2), { target: { value: '12' } })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(save('Federal'))
    // The echo re-syncs the table, so there is nothing left to discard.
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
  })

  it('renders a server 422 verbatim', async () => {
    vi.mocked(putTaxBrackets).mockRejectedValue(
      new ApiError('federal: at most 12 brackets per jurisdiction', 422),
    )
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)
    fireEvent.click(save('Federal'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('federal: at most 12 brackets per jurisdiction')
  })
})

describe('BracketsEditor — filing-status tabs', () => {
  const tab = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

  it('offers Single alone when nothing else has tables and the year is filed single', () => {
    render(<BracketsEditor brackets={bracketsFixture()} yearStatus="single" onSaved={vi.fn()} />)
    expect(tab('Single').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Married filing jointly' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Married filing separately' })).toBeNull()
  })

  it('always keeps Single, adds the year’s own status, and adds any status with rows', () => {
    render(
      <BracketsEditor
        brackets={statusFixture('married_joint', ['single', 'married_separate'])}
        yearStatus="married_joint"
        onSaved={vi.fn()}
      />,
    )
    // Single is the clone source and the importer's only status, so it is never hidden; the
    // year's own status is the one the engine walks; and an MFS table entered early stays
    // reachable from a year filed jointly.
    expect(tab('Single').getAttribute('aria-pressed')).toBe('false')
    expect(tab('Married filing jointly').getAttribute('aria-pressed')).toBe('true')
    expect(tab('Married filing separately')).toBeTruthy()
  })

  it('loads the pressed tab’s tables and edits THAT status', async () => {
    vi.mocked(fetchTaxBrackets).mockResolvedValue({
      ...statusFixture('married_joint'),
      jurisdictions: {
        ...EMPTY_TABLES,
        federal: [{ bracket_index: 1, rate: '0.1200', threshold: '0.00' }],
      },
    })
    render(
      <BracketsEditor
        brackets={statusFixture('single', ['single', 'married_joint'])}
        yearStatus="single"
        onSaved={vi.fn()}
      />,
    )

    fireEvent.click(tab('Married filing jointly'))
    await waitFor(() =>
      expect(vi.mocked(fetchTaxBrackets)).toHaveBeenCalledWith(2024, 'married_joint'),
    )
    await waitFor(() => expect(rate('Federal', 1).value).toBe('12%'))
    // The single table it replaced had two rows; nothing of it is left on screen.
    expect(screen.queryByLabelText('Federal bracket 2 rate (%)')).toBeNull()

    fireEvent.click(save('Federal'))
    await waitFor(() =>
      expect(vi.mocked(putTaxBrackets)).toHaveBeenCalledWith(2024, {
        filing_status: 'married_joint',
        jurisdictions: { federal: [{ rate: '0.12', threshold: '0.00' }] },
      }),
    )
  })

  it('asks before a tab switch that would discard typed rows', () => {
    confirmSpy.mockReturnValue(false)
    render(
      <BracketsEditor
        brackets={statusFixture('single', ['single', 'married_joint'])}
        yearStatus="single"
        onSaved={vi.fn()}
      />,
    )
    fireEvent.change(rate('Federal', 2), { target: { value: '12' } })

    fireEvent.click(tab('Married filing jointly'))
    expect(confirmSpy).toHaveBeenCalledWith('Discard unsaved Single bracket changes for 2024?')
    expect(vi.mocked(fetchTaxBrackets)).not.toHaveBeenCalled()
    expect(rate('Federal', 2).value).toBe('12%')
  })

  it('surfaces a tab load failure and stays on the tab that is loaded', async () => {
    vi.mocked(fetchTaxBrackets).mockRejectedValue(new ApiError('brackets unavailable', 503))
    render(
      <BracketsEditor
        brackets={statusFixture('single', ['single', 'married_joint'])}
        yearStatus="single"
        onSaved={vi.fn()}
      />,
    )

    fireEvent.click(tab('Married filing jointly'))
    expect(await screen.findByText('brackets unavailable')).toBeTruthy()
    // Nothing swapped: the single tables are still the ones being edited.
    expect(tab('Single').getAttribute('aria-pressed')).toBe('true')
    expect(rate('Federal', 2).value).toBe('37%')
  })
})
