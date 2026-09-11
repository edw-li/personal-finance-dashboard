import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { DerivedPreviewOut, TaxInputsOut } from '../../types/api'
import InputsForm from './InputsForm'

// Only the two writes are stubbed — JURISDICTIONS and the readers stay real so a rename in
// src/api/taxes.ts breaks this file rather than silently passing against a hand-written mock.
// The preview is a POST that writes nothing, but it is still a call this form makes.
vi.mock('../../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/taxes')>()),
  putTaxInputs: vi.fn(),
  previewTaxInputs: vi.fn(),
}))
import { previewTaxInputs, putTaxInputs } from '../../api/taxes'

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
            // The salary chip is the paycheck profile's offer (2026-09-11 spec §1.7 keeps
            // it): an ENTERED key may still be suggested, which is what separates a chip
            // from the computed line below it.
            key: 'annual_salary', label: 'Annual Salary', sort_order: 10,
            is_derived: false, value: '200000.0000', suggested: '210000.0000',
            unit: 'money', suggestion_source: null, formula: null,
            is_per_person: true, person_id: 1,
          },
          {
            // A COMPUTED line (spec §1.6): the server sends the figure it derived from THIS
            // column's components plus the caption for the formula, and never a suggestion —
            // there is nothing to apply, because there is nothing to type.
            key: 'gross_paycheck', label: 'Gross Paycheck', sort_order: 20,
            is_derived: true, value: '8333.3333', suggested: null,
            unit: 'money', suggestion_source: null, formula: 'Annual Salary ÷ 24',
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
            unit: 'money', suggestion_source: null, formula: null,
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
            unit: 'money', suggestion_source: null, formula: null,
            is_per_person: false, person_id: null,
          },
        ],
      },
    ],
  }
}

// What the partner's rows hold once the year is filed jointly. Deliberately sparse: a person
// with no row yet must render BLANK, never "0" — blank is what unsets an input.
const PARTNER_ROWS: Record<string, { value: string | null; suggested: string | null }> = {
  annual_salary: { value: '90000.0000', suggested: null },
  // A per-person total is computed from THAT person's components (spec §1.3), so a
  // partner with nothing entered gets a NULL figure rather than a zero nobody typed.
  gross_paycheck: { value: null, suggested: null },
  hsa_contributions: { value: null, suggested: null },
}

// The same year, as the API answers it once the year is filed jointly: every PER-PERSON
// definition comes back once per person COLUMN, each carrying its own person_id, value and
// suggestion, while a household key still comes back exactly once with person_id null.
// Non-contiguous ids on purpose: nothing here may work by array position.
function marriedInputs(): TaxInputsOut {
  const single = inputsFixture()
  return {
    ...single,
    filing_status: 'married_joint',
    people: [
      { id: 1, name: 'Alex' },
      { id: 4, name: 'Sam' },
    ],
    sections: single.sections.map((section) => ({
      ...section,
      items: section.items.flatMap((item) =>
        item.is_per_person
          ? [
              { ...item, person_id: 1 },
              { ...item, person_id: 4, ...PARTNER_ROWS[item.key] },
            ]
          : [item],
      ),
    })),
  }
}

// A married year on a database with fewer than two people: the server falls back to ONE
// column (a null one when the roster is empty), which is the pre-household payload exactly.
function marriedNoRoster(): TaxInputsOut {
  const single = inputsFixture()
  return {
    ...single,
    filing_status: 'married_joint',
    people: [],
    sections: single.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({ ...item, person_id: null })),
    })),
  }
}

// The two non-money rows (2026-09-09 spec §2), on a fixture of their own so the positional
// paste tests keep the exact cell order they assert against.
function unitInputs(): TaxInputsOut {
  return {
    year: 2025,
    filing_status: 'single',
    people: [{ id: 1, name: 'Alex' }],
    sections: [
      {
        section: 'ordinary_income',
        items: [
          {
            key: 'pay_periods', label: 'Pay periods (checks received so far this year)',
            sort_order: 30, is_derived: false, unit: 'count', suggestion_source: null, formula: null,
            value: '20.0000', suggested: null, is_per_person: true, person_id: 1,
          },
          {
            key: 'unq_div_state_exempt_pct',
            label: 'Treasury-fund dividends — state-exempt share (%)',
            sort_order: 170, is_derived: false, unit: 'percent', suggestion_source: null, formula: null,
            value: '0.9753', suggested: null, is_per_person: false, person_id: null,
          },
        ],
      },
    ],
  }
}

const saveButton = () => screen.getByRole('button', { name: /save inputs/i }) as HTMLButtonElement
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
// A computed line is an <output>, not an input, and names itself "(computed)" so that
// getByLabelText('Gross Paycheck') finds NOTHING - there is no box by that name any more.
const computed = (label: string) => screen.getByLabelText(label + ' (computed)')

// What the server answers a preview with: the nine derived totals and nothing else, because
// every other cell on the payload is what the caller just sent it.
function previewOut(grossPaycheck: string | null): DerivedPreviewOut {
  return {
    year: 2024,
    filing_status: 'single',
    derived: [{ key: 'gross_paycheck', person_id: 1, value: grossPaycheck }],
  }
}

// A promise this test resolves by hand, so a response can be made to land AFTER a later one.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// RTL's waitFor only knows how to drive JEST's fake clock, so it would hang on vitest's:
// these tests step the timers themselves. advanceTimersByTimeAsync drains the microtask
// queue between timers, which is what lets a stubbed response land inside the same act().
const settle = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

beforeEach(() => {
  vi.mocked(putTaxInputs).mockResolvedValue(inputsFixture())
  vi.mocked(previewTaxInputs).mockResolvedValue(previewOut('8333.3333'))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('InputsForm', () => {
  it('renders the server sections in order with every item labelled', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    // Server order, not alphabetical: the sections arrive ordered by tax_keys.SECTIONS.
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Ordinary income', 'Deductions', 'Capital gains'])
    // A BLURRED box reads AmountInput's formatted echo (spec §3.3), which is display only.
    expect(field('Annual Salary').value).toBe('$200,000.00')
    // The derived line is the server's own total, shown rather than typed.
    expect(computed('Gross Paycheck').textContent).toBe('$8,333.33')
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
    fireEvent.click(screen.getByRole('button', { name: 'Apply suggestion for Annual Salary' }))

    // Blurred, so the applied value shows as its echo; the PUT body below is what pins the
    // full 4dp suggestion reaching the wire intact.
    expect(field('Annual Salary').value).toBe('$210,000.00')
    // Advisory, never auto-applied: the save stays explicit (suggestions contract).
    expect(vi.mocked(putTaxInputs)).not.toHaveBeenCalled()

    fireEvent.click(saveButton())
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2024, {
        values: { annual_salary: '210000.0000' },
      }),
    )
  })

  it('renders a count as an integer and a percent as a percent', () => {
    render(<InputsForm inputs={unitInputs()} onSaved={vi.fn()} />)
    const count = field('Pay periods (checks received so far this year)')
    const percent = field('Treasury-fund dividends — state-exempt share (%)')

    // Both columns are Numeric(14,4), so both arrive with four decimals; neither box is a
    // money box, so neither wears a "$". The count drops the trailing zeros it can never
    // use, and the percent shows the stored FRACTION times a hundred.
    expect(count.value).toBe('20')
    expect(percent.value).toBe('97.53%')
    // Focused, the raw state is the box's own units - not the wire's 0.9753.
    act(() => percent.focus())
    expect(percent.value).toBe('97.53')
    act(() => percent.blur())
    // A focus and a blur of an untouched row must not dirty the form: the conversion is
    // exact in both directions (string math), so the diff is still empty.
    expect(saveButton().disabled).toBe(true)
  })

  it('saves a count verbatim and a percent as the fraction the engine multiplies', async () => {
    render(<InputsForm inputs={unitInputs()} onSaved={vi.fn()} />)
    fireEvent.change(field('Pay periods (checks received so far this year)'), {
      target: { value: '21' },
    })
    fireEvent.change(field('Treasury-fund dividends — state-exempt share (%)'), {
      target: { value: '98' },
    })
    fireEvent.click(saveButton())

    // 98 in the box, 0.98 on the wire - the engine multiplies treasury dividends by it, so
    // a stored 98 would have exempted ninety-eight times the dividend.
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2025, {
        values: { pay_periods: '21', unq_div_state_exempt_pct: '0.98' },
      }),
    )
  })

  it("labels a carried-forward suggestion as last year's", async () => {
    // 4e (2026-09-09): the three published deduction rows are suggested from the prior
    // year, and a chip that just said "suggested $14,600" would look like a sheet formula.
    const carried = inputsFixture()
    carried.sections[1].items.push({
      key: 'standard_deduction', label: 'Standard Deduction', sort_order: 80,
      is_derived: false, unit: 'money', value: null, formula: null,
      suggested: '14600.0000', suggestion_source: "last year's",
      is_per_person: false, person_id: null,
    })
    render(<InputsForm inputs={carried} onSaved={vi.fn()} />)

    expect(screen.getByText("last year's $14,600.00")).toBeTruthy()
    // A profile offer keeps the default word.
    expect(screen.getByText('suggested $210,000.00')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Apply suggestion for Standard Deduction' }))
    fireEvent.click(saveButton())
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2024, {
        values: { standard_deduction: '14600.0000' },
      }),
    )
  })

  it('refuses a fractional count in the form, not at the server', async () => {
    // isAmount alone accepts "20.5": it is the MONEY rule. A count of paychecks is whole,
    // and a shape the form can see must not travel to the server to come back as a raw 422.
    render(<InputsForm inputs={unitInputs()} onSaved={vi.fn()} />)
    const count = field('Pay periods (checks received so far this year)')
    fireEvent.change(count, { target: { value: '20.5' } })

    expect(count.className).toContain('invalid')
    fireEvent.click(saveButton())
    expect(vi.mocked(putTaxInputs)).not.toHaveBeenCalled()
    // Its own sentence: "Enter a number" would be nonsense advice to someone who has.
    expect(screen.getByRole('alert').textContent).toContain(
      'Enter a whole number of checks for: Pay periods (checks received so far this year)',
    )

    // A whole one clears both the style and the guard — RANGE stays the server's.
    fireEvent.change(count, { target: { value: '21' } })
    expect(field('Pay periods (checks received so far this year)').className).not.toContain(
      'invalid',
    )
    fireEvent.click(saveButton())
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2025, {
        values: { pay_periods: '21' },
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

  it('walks the column on Enter, across the sections and past the computed rows', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    act(() => field('Annual Salary').focus())

    // ONE scope for the whole form, so the walk follows cell order rather than section
    // structure: this Enter steps out of Ordinary income and into Deductions. Gross Paycheck
    // sits BETWEEN the two in render order and is COMPUTED - nothing to type there, so the
    // walk lands on the next editable cell rather than stalling on a figure.
    fireEvent.keyDown(field('Annual Salary'), { key: 'Enter' })
    expect(document.activeElement).toBe(field('HSA Contributions'))
    fireEvent.keyDown(field('HSA Contributions'), { key: 'Enter' })
    expect(document.activeElement).toBe(field('Qualified Dividends'))
  })

  // --- computed totals (2026-09-11 spec §1.7) ---

  it('renders a derived row as a read-only figure with its formula and no chip', () => {
    const { container } = render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)

    // An <output>, not an input: the house rule is that the browser never recomputes an
    // engine figure, so the only thing a derived row can do is SHOW what the server sent.
    const figure = container.querySelector('output[data-computed="gross_paycheck"]')
    expect(figure?.textContent).toBe('$8,333.33')
    expect(computed('Gross Paycheck')).toBe(figure)
    // The formula is the row's whole explanation, so it rides both the third track and the
    // tooltip - the cell says where its number came from and where to go to change it.
    expect(screen.getByText('Annual Salary ÷ 24')).toBeTruthy()
    expect(figure?.getAttribute('title')).toBe('Annual Salary ÷ 24 — edit the components')
    // No chip (nothing to apply) and no box by that name (nothing to type).
    expect(
      screen.queryByRole('button', { name: 'Apply suggestion for Gross Paycheck' }),
    ).toBeNull()
    expect(screen.queryByLabelText('Gross Paycheck')).toBeNull()
    // The badge stays: it is what names the row's kind in the label track.
    expect(screen.getByText('derived')).toBeTruthy()
  })

  it('renders a muted dash for a computed line with no components entered', () => {
    const blank = inputsFixture()
    blank.sections[0].items[1].value = null
    render(<InputsForm inputs={blank} onSaved={vi.fn()} />)

    // Absent is not zero. With no component stored the server sends null, and a "$0.00"
    // here would be the form asserting a total nobody's numbers add up to.
    expect(computed('Gross Paycheck').textContent).toBe('—')
  })

  it('never puts a computed cell in the PUT body', async () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.change(field('Annual Salary'), { target: { value: '240000' } })

    // ONE change to save: the total that follows from it is the server's to rebuild, so it
    // is not a cell the user changed and not a key this form may write (the PUT 422s it).
    expect(screen.getByText('1 change to save')).toBeTruthy()
    fireEvent.click(saveButton())
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2024, {
        values: { annual_salary: '240000' },
      }),
    )
  })

  // --- live preview (2026-09-11 spec §1.7) ---

  it('previews computed totals 300 ms after the last keystroke, with the whole form as the body', async () => {
    vi.useFakeTimers()
    vi.mocked(previewTaxInputs).mockResolvedValue(previewOut('9000.0000'))
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)

    // Two keystrokes inside the window are ONE question: the answer to a half-typed number
    // is noise, and a request per character would be noise on the wire too.
    fireEvent.change(field('Annual Salary'), { target: { value: '216' } })
    await settle(200)
    fireEvent.change(field('Annual Salary'), { target: { value: '216000' } })
    await settle(300)

    expect(vi.mocked(previewTaxInputs)).toHaveBeenCalledTimes(1)
    // The WHOLE form, not the save's diff: the server overlays this body on the stored rows,
    // so a cell left out would be read at its stored value rather than the one on screen.
    // A blank cell rides as null, exactly as it would in a save.
    expect(vi.mocked(previewTaxInputs)).toHaveBeenCalledWith(2024, {
      values: {
        annual_salary: '216000',
        hsa_contributions: '4150.0000',
        qualified_dividends: null,
      },
    })
    // The figure is the SERVER's answer. The browser owns no formula, so nothing here could
    // have produced 9,000 on its own.
    expect(computed('Gross Paycheck').textContent).toBe('$9,000.00')
  })

  it('drops a stale preview response', async () => {
    vi.useFakeTimers()
    const first = deferred<DerivedPreviewOut>()
    const second = deferred<DerivedPreviewOut>()
    vi.mocked(previewTaxInputs)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)

    fireEvent.change(field('Annual Salary'), { target: { value: '216000' } })
    await settle(400)
    fireEvent.change(field('Annual Salary'), { target: { value: '240000' } })
    await settle(400)
    expect(vi.mocked(previewTaxInputs)).toHaveBeenCalledTimes(2)

    // The answers come back out of order, which a slow first request makes ordinary. The
    // NEWEST question owns the screen: an older answer describes a form that no longer
    // exists, and showing it would flip the total back under the cursor.
    second.resolve(previewOut('10000.0000'))
    await settle()
    first.resolve(previewOut('9000.0000'))
    await settle()

    expect(computed('Gross Paycheck').textContent).toBe('$10,000.00')
  })

  it('keeps the last figure when a preview fails', async () => {
    vi.useFakeTimers()
    vi.mocked(previewTaxInputs).mockRejectedValue(new ApiError('upstream is down', 500))
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)

    fireEvent.change(field('Annual Salary'), { target: { value: '216000' } })
    await settle(300)

    // A preview is a courtesy: the figure keeps the last thing the server said, and nothing
    // is announced. The SAVE path is what reports a real failure — a banner on every dropped
    // keystroke of a flaky connection would say nothing the user can act on.
    expect(computed('Gross Paycheck').textContent).toBe('$8,333.33')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the save echo wins over a pending preview', async () => {
    vi.useFakeTimers()
    const pending = deferred<DerivedPreviewOut>()
    vi.mocked(previewTaxInputs).mockReturnValue(pending.promise)
    const echo = inputsFixture()
    echo.sections[0].items[0].value = '264000.0000'
    echo.sections[0].items[1].value = '11000.0000'
    vi.mocked(putTaxInputs).mockResolvedValue(echo)
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)

    fireEvent.change(field('Annual Salary'), { target: { value: '264000' } })
    await settle(300)
    expect(vi.mocked(previewTaxInputs)).toHaveBeenCalledTimes(1)

    fireEvent.click(saveButton())
    await settle()
    // The echo is the stored truth, not a what-if: it outranks any preview, in flight or not.
    expect(computed('Gross Paycheck').textContent).toBe('$11,000.00')

    pending.resolve(previewOut('9000.0000'))
    await settle()
    expect(computed('Gross Paycheck').textContent).toBe('$11,000.00')
    // And the echo does not ask the same question again: its figures ARE the server's.
    expect(vi.mocked(previewTaxInputs)).toHaveBeenCalledTimes(1)
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
      new ApiError('values.annual_salary must be at most 10000000000', 422),
    )
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply suggestion for Annual Salary' }))
    fireEvent.click(saveButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('values.annual_salary must be at most 10000000000')
    // The edit survives the rejection: re-enabled, still holding the applied value.
    expect(field('Annual Salary').value).toBe('$210,000.00')
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
    expect(field('Annual Salary').labels?.[0].getAttribute('title')).toBe('Annual Salary')
    // The chip wraps rather than clips, and the amount rides the button's tooltip too, so
    // "Apply" is never a button whose value the user cannot read.
    expect(
      screen
        .getByRole('button', { name: 'Apply suggestion for Annual Salary' })
        .getAttribute('title'),
    ).toBe('Apply $210,000.00')
    expect(screen.getByTitle('$210,000.00').textContent).toBe('suggested $210,000.00')
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
      clipboardData: { getData: () => '200000\n8333.33\n4300' },
    })

    // Positional order is the RENDERED one — the fill walks out of Ordinary income into the
    // next section exactly as Enter does, past the computed line between them. Blurred, so
    // both read as their echo (nothing is focused in jsdom).
    expect(field('Annual Salary').value).toBe('$200,000.00')
    expect(field('HSA Contributions').value).toBe('$4,300.00')
    expect(screen.getByText(/pasted 2 of 3 values/i)).toBeDefined()
    // Pasted text lands in state exactly like typed text, so it counts into the changed-key
    // diff: the save is armed with no further interaction.
    expect(saveButton().disabled).toBe(false)
  })

  it('column paste skips computed slots and keeps alignment', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.paste(field('Annual Salary'), {
      clipboardData: { getData: () => '200000\n99999\n4300' },
    })

    // A copied sheet column carries the grey cells too. The computed slot CONSUMES its value
    // and throws it away: shifting the rest up instead would silently move every number
    // below it onto the wrong row, which is the one paste bug nobody would notice.
    expect(field('Annual Salary').value).toBe('$200,000.00')
    expect(field('HSA Contributions').value).toBe('$4,300.00')
    // Untouched: the figure is still the server's, not the 99,999 that landed on it.
    expect(computed('Gross Paycheck').textContent).toBe('$8,333.33')
    // Named rather than dropped silently — two of three editable cells were filled, and
    // the third value went somewhere the note can account for.
    expect(
      screen.getByText(/pasted 2 of 3 values · 1 computed cell skipped/i),
    ).toBeDefined()
  })

  it('keyed paste ignores a computed label', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.paste(field('Annual Salary'), {
      clipboardData: { getData: () => 'Gross Paycheck\t9999\nHSA Contributions\t4300' },
    })

    // Named or positioned, a computed line is never filled. It is counted as SKIPPED rather
    // than unmatched: the label was perfectly good, it just names a cell nobody may write.
    expect(computed('Gross Paycheck').textContent).toBe('$8,333.33')
    expect(field('HSA Contributions').value).toBe('$4,300.00')
    expect(
      screen.getByText(/pasted 1 of 3 values · 1 computed cell skipped/i),
    ).toBeDefined()
  })

  it('reports values that run off the end instead of dropping them silently', () => {
    render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)
    fireEvent.paste(field('HSA Contributions'), {
      clipboardData: { getData: () => '1\n2\n3' },
    })

    // Started at item 3 of 4: one lands, two have nowhere to go.
    expect(field('HSA Contributions').value).toBe('$1.00')
    expect(field('Qualified Dividends').value).toBe('$2.00')
    expect(screen.getByText(/pasted 2 of 3 values · 1 value didn't fit/i)).toBeDefined()
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
    expect(screen.getByText(/pasted 1 of 3 values · 1 unmatched: Not A Line/i)).toBeDefined()
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
    expect(screen.getByText(/pasted 1 of 3 values · 1 blank skipped/i)).toBeDefined()
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

  // --- filing status: per-person columns (2026-08-26 design §6) ---

  it('renders a single-status year with one box per key and the ids it always had', () => {
    const { container } = render(<InputsForm inputs={inputsFixture()} onSaved={vi.fn()} />)

    // The zero-diff pin. Every other test in this file is the rest of it: a single-status
    // year must render, request and PUT exactly what it did before columns existed.
    expect(container.querySelectorAll('.tax-input-row .field-input')).toHaveLength(3)
    // The fourth line is the computed one. It keeps its slot in the input track, so the grid
    // does not jump a pixel between an editable row and a derived one.
    expect(container.querySelectorAll('.tax-input-row .tax-computed')).toHaveLength(1)
    expect(document.getElementById('tax-input-gross_paycheck')?.tagName).toBe('OUTPUT')
    expect(document.getElementById('tax-input-annual_salary')).not.toBeNull()
    expect(document.getElementById('tax-input-qualified_dividends')).not.toBeNull()
    expect(container.querySelector('.tax-input-grid.is-split')).toBeNull()
    expect(container.querySelector('.tax-input-head')).toBeNull()
    expect(container.querySelector('.field-input.tax-input-wide')).toBeNull()
    // Still a real <label htmlFor>, not an aria-label: one box means one control to point at.
    expect(field('Annual Salary').labels?.[0]?.tagName).toBe('LABEL')
  })

  it('splits the per-person keys into named columns on a married year', () => {
    const { container } = render(<InputsForm inputs={marriedInputs()} onSaved={vi.fn()} />)

    expect(field('Annual Salary — Alex').value).toBe('$200,000.00')
    expect(field('Annual Salary — Sam').value).toBe('$90,000.00')
    // A person with no row yet is BLANK, never "0" — blank is what unsets an input.
    expect(field('HSA Contributions — Sam').value).toBe('')
    // A household key keeps ONE box, spanning both person tracks rather than leaving a hole.
    expect(screen.getByLabelText('Qualified Dividends').className).toContain('tax-input-wide')
    expect(screen.queryByLabelText('Qualified Dividends — Alex')).toBeNull()
    // Ids are person-qualified, and nothing looks them up as a CSS selector.
    expect(document.getElementById('tax-input-annual_salary:4')).not.toBeNull()
    expect(document.getElementById('tax-input-qualified_dividends')).not.toBeNull()
    // Headers only over the sections that HAVE per-person lines: capital gains is purely
    // household here, so it keeps its single full-width column and no names.
    expect(container.querySelectorAll('.tax-input-head')).toHaveLength(2)
    expect(screen.getAllByText('Alex')).toHaveLength(2)
    expect(screen.getAllByText('Sam')).toHaveLength(2)
  })

  it('splits the PUT body by column: household keys unqualified, person rows named', async () => {
    render(<InputsForm inputs={marriedInputs()} onSaved={vi.fn()} />)
    fireEvent.change(field('Annual Salary — Sam'), { target: { value: '95000' } })
    fireEvent.change(field('Qualified Dividends'), { target: { value: '100' } })
    fireEvent.click(saveButton())

    // Untouched cells are absent from both halves — sending one blank would DELETE a stored
    // input the user never looked at.
    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2024, {
        values: { qualified_dividends: '100' },
        rows: [{ key: 'annual_salary', person_id: 4, value: '95000' }],
      }),
    )
  })

  it('omits the row list entirely when only household lines moved', async () => {
    render(<InputsForm inputs={marriedInputs()} onSaved={vi.fn()} />)
    fireEvent.change(field('Qualified Dividends'), { target: { value: '100' } })
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(vi.mocked(putTaxInputs)).toHaveBeenCalledWith(2024, {
        values: { qualified_dividends: '100' },
      }),
    )
  })

  it('renders one computed figure per person column on a married year', () => {
    render(<InputsForm inputs={marriedInputs()} onSaved={vi.fn()} />)

    // A per-person total is computed from THAT person's components (spec §1.3), so each
    // column carries its own figure rather than one shared number over the primary's box.
    expect(computed('Gross Paycheck — Alex').textContent).toBe('$8,333.33')
    // Sam has no components entered, so Sam's total is a dash, not a zero.
    expect(computed('Gross Paycheck — Sam').textContent).toBe('—')
    // One caption for the row, not one per column: the formula is the same either side.
    expect(screen.getAllByText('Annual Salary ÷ 24')).toHaveLength(1)
    expect(
      screen.queryByRole('button', { name: 'Apply suggestion for Gross Paycheck' }),
    ).toBeNull()
  })

  it('keeps one column when the roster has fewer than two people, and says where to fix it', () => {
    render(<InputsForm inputs={marriedNoRoster()} onSaved={vi.fn()} />)
    // The server answered with one (null) column, so the honest degrade is today's layout —
    // whose unqualified per-person keys it resolves onto the primary person.
    expect(field('Annual Salary').value).toBe('$200,000.00')
    expect(screen.queryByLabelText('Annual Salary — Alex')).toBeNull()
    expect(screen.getByText(/Settings → Household/)).toBeTruthy()
  })

  it('heads a blank-named person Me and Partner rather than an empty column', () => {
    const inputs = marriedInputs()
    inputs.people = [
      { id: 1, name: '  ' },
      { id: 4, name: '' },
    ]
    render(<InputsForm inputs={inputs} onSaved={vi.fn()} />)
    expect(field('Annual Salary — Me').value).toBe('$200,000.00')
    expect(field('Annual Salary — Partner').value).toBe('$90,000.00')
  })

  it('column paste walks ONE person’s column and skips the other', () => {
    render(<InputsForm inputs={marriedInputs()} onSaved={vi.fn()} />)
    fireEvent.paste(field('Annual Salary — Sam'), {
      clipboardData: { getData: () => '95000\n4000\n2000' },
    })

    // A sheet column is ONE person's numbers, so the fill walks Sam's per-person lines in
    // render order — across the section boundary — and stops there.
    expect(field('Annual Salary — Sam').value).toBe('$95,000.00')
    expect(field('HSA Contributions — Sam').value).toBe('$2,000.00')
    // Alex's column and the shared line are untouched.
    expect(field('Annual Salary — Alex').value).toBe('$200,000.00')
    expect(field('Qualified Dividends').value).toBe('')
    // The denominator is the COLUMN, not the whole form: two editable cells were reachable,
    // and the third pasted value landed on Sam's computed line and stopped there.
    expect(
      screen.getByText(/pasted 2 of 2 values · 1 computed cell skipped/i),
    ).toBeDefined()
  })

  it('keyed paste fills the pasted-into column and the shared lines, never the other person', () => {
    render(<InputsForm inputs={marriedInputs()} onSaved={vi.fn()} />)
    fireEvent.paste(field('Annual Salary — Sam'), {
      clipboardData: {
        getData: () => 'HSA Contributions\t2000\nQualified Dividends\t150\nNot A Line\t1',
      },
    })

    expect(field('HSA Contributions — Sam').value).toBe('$2,000.00')
    // Household rows are unambiguous — one cell per key — so a mixed block reaches them too.
    expect(field('Qualified Dividends').value).toBe('$150.00')
    // And never the other person's.
    expect(field('HSA Contributions — Alex').value).toBe('$4,150.00')
    // Sam's two editable lines plus the one shared line: three cells a keyed block may reach.
    expect(screen.getByText(/pasted 2 of 3 values · 1 unmatched: Not A Line/i)).toBeDefined()
  })
})
