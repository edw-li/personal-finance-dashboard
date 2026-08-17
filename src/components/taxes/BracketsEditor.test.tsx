import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { TaxBracketsOut } from '../../types/api'
import BracketsEditor from './BracketsEditor'

// JURISDICTIONS stays real (it drives render order); only the writer is stubbed.
vi.mock('../../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/taxes')>()),
  putTaxBrackets: vi.fn(),
}))
import { putTaxBrackets } from '../../api/taxes'

function bracketsFixture(): TaxBracketsOut {
  return {
    year: 2024,
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

const rate = (jurisdiction: string, index: number) =>
  screen.getByLabelText(`${jurisdiction} bracket ${index} rate (%)`) as HTMLInputElement
const threshold = (jurisdiction: string, index: number) =>
  screen.getByLabelText(`${jurisdiction} bracket ${index} threshold`) as HTMLInputElement
const save = (jurisdiction: string) =>
  screen.getByRole('button', { name: `Save ${jurisdiction} brackets` })

beforeEach(() => {
  vi.mocked(putTaxBrackets).mockResolvedValue(bracketsFixture())
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
    // rate * 100, trimmed — the stored fraction is never shown to the user.
    expect(rate('Federal', 1).value).toBe('10')
    expect(rate('Federal', 2).value).toBe('37')
    expect(rate('State', 1).value).toBe('9.3')
    expect(rate('Medicare', 1).value).toBe('1.45')
    expect(threshold('Federal', 2).value).toBe('100000.00')
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
      jurisdictions: { state: [{ rate: '0.093', threshold: '0.00' }] },
    })

    // Single-flight: every Save is disabled until the in-flight one settles.
    await waitFor(() => expect((save('Medicare') as HTMLButtonElement).disabled).toBe(false))
    vi.mocked(putTaxBrackets).mockClear()
    fireEvent.click(save('Medicare'))
    await waitFor(() => expect(vi.mocked(putTaxBrackets)).toHaveBeenCalled())
    expect(vi.mocked(putTaxBrackets)).toHaveBeenCalledWith(2024, {
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

  it('adds rows, saves them, and removes one', async () => {
    const echo = bracketsFixture()
    echo.jurisdictions.social_security = [
      { bracket_index: 1, rate: '0.0620', threshold: '0.00' },
      { bracket_index: 2, rate: '0.0000', threshold: '168600.00' },
    ]
    vi.mocked(putTaxBrackets).mockResolvedValue(echo)
    render(<BracketsEditor brackets={bracketsFixture()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Social Security bracket' }))
    // The first row of an empty table is seeded with the threshold the API demands.
    expect(threshold('Social Security', 1).value).toBe('0')
    fireEvent.change(rate('Social Security', 1), { target: { value: '6.2' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add Social Security bracket' }))
    fireEvent.change(rate('Social Security', 2), { target: { value: '0' } })
    fireEvent.change(threshold('Social Security', 2), { target: { value: '168600.00' } })
    fireEvent.click(save('Social Security'))

    await waitFor(() =>
      expect(vi.mocked(putTaxBrackets)).toHaveBeenCalledWith(2024, {
        jurisdictions: {
          social_security: [
            { rate: '0.062', threshold: '0' },
            { rate: '0', threshold: '168600.00' },
          ],
        },
      }),
    )
    // The echo is authoritative: the typed "0" comes back as the stored "0.00".
    await waitFor(() => expect(threshold('Social Security', 1).value).toBe('0.00'))

    fireEvent.click(screen.getByRole('button', { name: 'Remove Social Security bracket 2' }))
    expect(screen.queryByLabelText('Social Security bracket 2 rate (%)')).toBeNull()
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
