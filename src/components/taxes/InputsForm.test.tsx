import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

// A fresh object per call: two tests mutate their copy into the PUT echo. Three of the four
// keys are per-person (the real definitions flag salary, the W-2 family, 401k, HSA and
// pre-tax deductions) and Qualified Dividends is household — so the same fixture exercises
// both column shapes once a married year is rendered. A SINGLE year has exactly one person
// column, so every per-person item still renders once, exactly as it always did.
function inputsFixture(): TaxInputsOut {
  return {
    year: 2024,
    filing_status: 'single',
    people: [{ id: 1, name: 'Alex' }],
    sections: [
      {
        section: 'ordinary_income',
        items: [
          {
            key: 'annual_salary', label: 'Annual Salary', sort_order: 10,
            is_derived: false, value: '200000.0000', suggested: null,
            is_per_person: true, person_id: 1,
          },
          {
            key: 'gross_paycheck', label: 'Gross Paycheck', sort_order: 20,
            is_derived: true, value: '7000.0000', suggested: '8333.3333',
            is_per_person: true, person_id: 1,
          },
        ],
      },
      {
        section: 'deductions',
        items: [
          {
            key: 'hsa_contributions', label: 'HSA Contributions', sort_order: 20,
            is_derived: false, value: '4150.0000', suggested: null,
            is_per_person: true, person_id: 1,
          },
        ],
      },
      {
        section: 'capital_gains',
        items: [
          {
            key: 'qualified_dividends', label: 'Qualified Dividends', sort_order: 40,
            is_derived: false, value: null, suggested: null,
            is_per_person: false, person_id: null,
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
    // A BLURRED box reads AmountInput's formatted echo (spec §3.3), which is display only.
    expect(field('Annual Salary').value).toBe('$200,000.00')
    expect(field('Gross Paycheck').value).toBe('$7,000.00')
    // The STATE underneath is still the server's 4dp string, which a real focus reveals —
    // and blurring it back writes nothing, because canonicalizing a server seed is a no-op
    // (utils/amount's idempotence guarantee) and the Save below is still disabled.
    // act(), not fireEvent.focus: only a real .focus() moves document.activeElement, and
    // only act flushes the state change that swaps the echo for the raw text.
    act(() => field('Annual Salary').focus())
    expect(field('Annual Salary').value).toBe('200000.0000')
    act(() => field('Annual Salary').blur())
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
    // The server's 4dp echo is authoritative — the typed "210000" is replaced by it. Read
    // FOCUSED: both strings blur to the same "$210,000.00", so only the raw state tells the
    // server's value apart from the text that was typed.
    await waitFor(() => expect(field('Annual Salary').value).toBe('$210,000.00'))
    act(() => field('Annual Salary').focus())
    expect(field('Annual Salary').value).toBe('210000.0000')
  })

  it('Apply fills the input locally without saving', async () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply suggestion for Gross Paycheck' }))

    // Blurred, so the applied value shows as its echo; the PUT body below is what pins the
    // full 4dp suggestion reaching the wire intact.
    expect(field('Gross Paycheck').value).toBe('$8,333.33')
    // Advisory, never auto-applied: the save stays explicit (suggestions contract).
    expect(vi.mocked(putTaxInputs)).not.toHaveBeenCalled()

    fireEvent.click(saveButton())
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2024, {
        values: { gross_paycheck: '8333.3333' },
      }),
    )
  })

  it('evaluates an =-expression into the PUT body', async () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.change(field('Annual Salary'), { target: { value: '=1200+400' } })
    fireEvent.click(saveButton())

    // Every tax input is money, so "=" arithmetic stays ON here deliberately — the plan
    // amendment names only the NON-money belts for the opt-out (BracketsEditor's percent
    // rate is one). No blur fired, so canonicalAmount at the wire boundary is what
    // evaluates it; this pin is what breaks if someone "harmonizes" that call to
    // { expressions: false }.
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2024, {
        values: { annual_salary: '1600.00' },
      }),
    )
  })

  it('walks the column on Enter, across the section boundaries', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    act(() => field('Annual Salary').focus())

    // ONE scope for the whole form, so the walk follows cell order rather than section
    // structure: the second Enter steps out of Ordinary income and into Deductions.
    fireEvent.keyDown(field('Annual Salary'), { key: 'Enter' })
    expect(document.activeElement).toBe(field('Gross Paycheck'))
    fireEvent.keyDown(field('Gross Paycheck'), { key: 'Enter' })
    expect(document.activeElement).toBe(field('HSA Contributions'))
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
    expect(field('Gross Paycheck').value).toBe('$8,333.33')
    await waitFor(() => expect(saveButton().disabled).toBe(false))
  })

  it('reports unsaved work to the page, and stops after the echo', async () => {
    const onDirtyChange = vi.fn()
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} onDirtyChange={onDirtyChange} />)
    // The page turns this into the confirm that guards a year switch.
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)

    fireEvent.change(field('Annual Salary'), { target: { value: '210000' } })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(saveButton())
    // The echo becomes the new baseline: there is nothing left to discard.
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
  })

  it('keeps a squeezed label and a suggested amount readable on hover', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    // The label track is wide, but a long key can still ellipsize — the title recovers it.
    expect(field('Gross Paycheck').labels?.[0].getAttribute('title')).toBe('Gross Paycheck')
    // The chip wraps rather than clips, and the amount rides the button's tooltip too, so
    // "Apply" is never a button whose value the user cannot read.
    expect(
      screen
        .getByRole('button', { name: 'Apply suggestion for Gross Paycheck' })
        .getAttribute('title'),
    ).toBe('Apply $8,333.33')
    expect(screen.getByTitle('$8,333.33').textContent).toBe('suggested $8,333.33')
  })

  it('blocks a non-numeric entry before calling the API', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    // Spreadsheet grouping and a stray "$" are ACCEPTED entry now (spec §3.1), so the text
    // this gate is for is exponent notation: Decimal("1e5") is a perfectly legal 100000, so
    // nothing downstream would refuse it — this form is the only thing between the two.
    fireEvent.change(field('Annual Salary'), { target: { value: '1e5' } })
    fireEvent.click(saveButton())
    expect(vi.mocked(putTaxInputs)).not.toHaveBeenCalled()
    // "a number", not "a plain number": "$1,234" is valid entry now, so the old wording
    // named a stricter rule than the form actually enforces. Client-local sentence, no
    // server twin — the one-vocabulary rule has nothing to say about it.
    expect(screen.getByRole('alert').textContent).toContain('Enter a number for: Annual Salary')
  })

  // --- range paste (spec §4.1) ---
  // jsdom has no clipboard: fireEvent.paste's init object is what RTL defines onto the
  // event, and React hands it through as e.clipboardData.

  it('column paste fills down the flattened sections from the pasted-into cell', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.paste(field('Annual Salary'), {
      clipboardData: { getData: () => '200000\n8333.33' },
    })

    // Positional order is the RENDERED one — the fill walks out of Ordinary income into the
    // next section exactly as Enter does. Blurred, so both read as their echo (nothing is
    // focused in jsdom).
    expect(field('Annual Salary').value).toBe('$200,000.00')
    expect(field('Gross Paycheck').value).toBe('$8,333.33')
    expect(screen.getByText(/pasted 2 of 4 values/i)).toBeDefined()
    // Pasted text lands in state exactly like typed text, so it counts into the changed-key
    // diff: the save is armed with no further interaction.
    expect(saveButton().disabled).toBe(false)
  })

  it('reports values that run off the end instead of dropping them silently', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.paste(field('HSA Contributions'), {
      clipboardData: { getData: () => '1\n2\n3' },
    })

    // Started at item 3 of 4: one lands, two have nowhere to go.
    expect(field('HSA Contributions').value).toBe('$1.00')
    expect(field('Qualified Dividends').value).toBe('$2.00')
    expect(screen.getByText(/pasted 2 of 4 values · 1 value didn't fit/i)).toBeDefined()
  })

  it('keyed paste matches item labels regardless of where it was pasted', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.paste(field('Annual Salary'), {
      clipboardData: { getData: () => 'HSA Contributions\t4300\nNot A Line\t1' },
    })

    // The label decides the target, not the focused cell — Annual Salary keeps its value.
    expect(field('HSA Contributions').value).toBe('$4,300.00')
    expect(field('Annual Salary').value).toBe('$200,000.00')
    // A miss is named, never guessed at: "Not A Line" fills nothing.
    expect(screen.getByText(/pasted 1 of 4 values · 1 unmatched: Not A Line/i)).toBeDefined()
  })

  it('skips an empty pasted value rather than blanking the field', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    // A trailing-empty cell is what a sheet's blank month looks like. NOTE the second row:
    // a lone "label<TAB>" is a single row of one non-empty cell, which classifies as a
    // native single-cell paste — the skip only exists inside a real keyed block.
    fireEvent.paste(field('Annual Salary'), {
      clipboardData: { getData: () => 'Annual Salary\t\nHSA Contributions\t4300' },
    })

    // Paste must never BLANK a filled input (blank is the wire's "unset this key"), so the
    // empty cell leaves the stored value alone and says so.
    expect(field('Annual Salary').value).toBe('$200,000.00')
    expect(field('HSA Contributions').value).toBe('$4,300.00')
    expect(screen.getByText(/pasted 1 of 4 values · 1 blank skipped/i)).toBeDefined()
  })

  it('leaves a single-cell paste to the browser', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    const notPrevented = fireEvent.paste(field('Annual Salary'), {
      clipboardData: { getData: () => '1234.56' },
    })

    // Not default-prevented: native insertion plus the tolerant parse already handle one
    // cell, and intercepting would break pasting into the middle of a half-typed number.
    expect(notPrevented).toBe(true)
    expect(field('Annual Salary').value).toBe('$200,000.00')
    expect(saveButton().disabled).toBe(true)
    expect(screen.queryByText(/pasted/i)).toBeNull()
  })
})
