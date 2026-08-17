import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { TaxInputsOut } from '../../types/api'
import InputsForm from './InputsForm'

// Only the writer is stubbed — JURISDICTIONS and the readers stay real so a rename in
// src/api/taxes.ts breaks this file rather than silently passing against a hand-written mock.
vi.mock('../../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/taxes')>()),
  putTaxInputs: vi.fn(),
}))
import { putTaxInputs } from '../../api/taxes'

// A fresh object per call: two tests mutate their copy into the PUT echo.
function inputsFixture(): TaxInputsOut {
  return {
    year: 2024,
    sections: [
      {
        section: 'ordinary_income',
        items: [
          {
            key: 'annual_salary', label: 'Annual Salary', sort_order: 10,
            is_derived: false, value: '200000.0000', suggested: null,
          },
          {
            key: 'gross_paycheck', label: 'Gross Paycheck', sort_order: 20,
            is_derived: true, value: '7000.0000', suggested: '8333.3333',
          },
        ],
      },
      {
        section: 'deductions',
        items: [
          {
            key: 'hsa_contributions', label: 'HSA Contributions', sort_order: 20,
            is_derived: false, value: '4150.0000', suggested: null,
          },
        ],
      },
      {
        section: 'capital_gains',
        items: [
          {
            key: 'qualified_dividends', label: 'Qualified Dividends', sort_order: 40,
            is_derived: false, value: null, suggested: null,
          },
        ],
      },
    ],
  }
}

const saveButton = () => screen.getByRole('button', { name: /save inputs/i }) as HTMLButtonElement
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement

beforeEach(() => {
  vi.mocked(putTaxInputs).mockResolvedValue(inputsFixture())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('InputsForm', () => {
  it('renders the server sections in order with every item labelled', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    // Server order, not alphabetical: the sections arrive ordered by tax_keys.SECTIONS.
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Ordinary income', 'Deductions', 'Capital gains'])
    expect(field('Annual Salary').value).toBe('200000.0000')
    expect(field('Gross Paycheck').value).toBe('7000.0000')
    // A null stored value is a BLANK input, never "null"/"0" — blank is what unsets it.
    expect(field('Qualified Dividends').value).toBe('')
    // Nothing edited yet: the diff is empty, so there is nothing to PUT.
    expect(saveButton().disabled).toBe(true)
  })

  it('PUTs only the changed keys and re-syncs from the echo', async () => {
    const echo = inputsFixture()
    echo.sections[0].items[0].value = '210000.0000'
    vi.mocked(putTaxInputs).mockResolvedValue(echo)
    const onSaved = vi.fn()
    render(<InputsForm inputs={inputsFixture()} onSaved={onSaved} />)

    fireEvent.change(field('Annual Salary'), { target: { value: '210000' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(echo))
    // The other three keys are untouched: a PUT carrying them would rewrite (or, blank,
    // DELETE) values the user never edited.
    expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2024, {
      values: { annual_salary: '210000' },
    })
    // The server's 4dp echo is authoritative — the typed "210000" is replaced by it.
    await waitFor(() => expect(field('Annual Salary').value).toBe('210000.0000'))
  })

  it('Apply fills the input locally without saving', async () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply suggestion for Gross Paycheck' }))

    expect(field('Gross Paycheck').value).toBe('8333.3333')
    // Advisory, never auto-applied: the save stays explicit (suggestions contract).
    expect(vi.mocked(putTaxInputs)).not.toHaveBeenCalled()

    fireEvent.click(saveButton())
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2024, {
        values: { gross_paycheck: '8333.3333' },
      }),
    )
  })

  it('sends null for a blanked value', async () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.change(field('HSA Contributions'), { target: { value: '' } })
    fireEvent.click(saveButton())
    // null unsets the stored input; "" or "0" would store a zero instead.
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2024, {
        values: { hsa_contributions: null },
      }),
    )
  })

  it('renders a 422 detail inline (the Apply-then-save path)', async () => {
    // A suggestion is an unbounded engine output, so applying one can exceed the input
    // bound — the inline note is the only thing standing between that and a silent failure.
    vi.mocked(putTaxInputs).mockRejectedValue(
      new ApiError('values.gross_paycheck must be at most 10000000000', 422),
    )
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply suggestion for Gross Paycheck' }))
    fireEvent.click(saveButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('values.gross_paycheck must be at most 10000000000')
    // The edit survives the rejection: re-enabled, still holding the applied value.
    expect(field('Gross Paycheck').value).toBe('8333.3333')
    await waitFor(() => expect(saveButton().disabled).toBe(false))
  })

  it('blocks a non-numeric entry before calling the API', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.change(field('Annual Salary'), { target: { value: '200,000' } })
    fireEvent.click(saveButton())
    expect(vi.mocked(putTaxInputs)).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Annual Salary')
  })
})
