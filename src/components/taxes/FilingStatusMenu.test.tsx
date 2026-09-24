import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { FilingStatus, TaxStatusOptions } from '../../types/api'
import FilingStatusMenu from './FilingStatusMenu'

// The labels and the status list stay real; the one request this menu makes is stubbed.
vi.mock('../../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/taxes')>()),
  fetchStatusOptions: vi.fn(),
}))
import { fetchStatusOptions } from '../../api/taxes'

/** The server's rules for 2024 on a household of two (2026-09-23 spec §W8). */
function optionsFor(current: FilingStatus, missingMfs = true): TaxStatusOptions {
  return {
    year: 2024,
    current,
    options: [
      {
        status: 'single',
        label: 'Single',
        people: [{ id: 1, name: 'Alex' }],
        tables_missing: [],
        computable: true,
      },
      {
        status: 'married_joint',
        label: 'Married filing jointly',
        people: [
          { id: 1, name: 'Alex' },
          { id: 2, name: 'Sam' },
        ],
        tables_missing: [],
        computable: true,
      },
      {
        status: 'married_separate',
        label: 'Married filing separately',
        people: [{ id: 1, name: 'Alex' }],
        tables_missing: missingMfs ? ['federal', 'state', 'capital_gains'] : [],
        computable: !missingMfs,
      },
    ],
  }
}

function mount(
  status: FilingStatus,
  props: Partial<Parameters<typeof FilingStatusMenu>[0]> = {},
) {
  const onChange = vi.fn()
  const view = render(
    <FilingStatusMenu
      year={2024}
      status={status}
      withholdingYear
      disabled={false}
      onChange={onChange}
      {...props}
    />,
  )
  return { ...view, onChange }
}

const trigger = () => screen.getByRole('button', { name: 'Change…' }) as HTMLButtonElement
const dialog = () => screen.getByRole('dialog', { name: 'Filing status for 2024' })
const radio = (name: RegExp) => within(dialog()).getByRole('radio', { name }) as HTMLInputElement
const consequences = () =>
  Array.from(dialog().querySelectorAll('.filing-status-consequences li')).map((li) => li.textContent)

beforeEach(() => {
  vi.mocked(fetchStatusOptions).mockResolvedValue(optionsFor('married_joint'))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FilingStatusMenu (2026-09-23 spec §W8)', () => {
  it('reads as plain text with a Change… door, and spends no request until opened', () => {
    const { container } = mount('married_joint')
    expect(container.querySelector('.filing-status-menu')?.textContent).toBe(
      'Filing status: Married filing jointly · Change…',
    )
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(vi.mocked(fetchStatusOptions)).not.toHaveBeenCalled()
  })

  it('opens on the year’s own status and says nothing until another one is chosen', async () => {
    mount('married_joint')
    fireEvent.click(trigger())
    expect(vi.mocked(fetchStatusOptions)).toHaveBeenCalledWith(2024)
    expect(radio(/^Married filing jointly/).checked).toBe(true)
    expect(radio(/^Married filing jointly/).labels?.[0]?.textContent).toBe(
      'Married filing jointly (current)',
    )
    await waitFor(() => expect(dialog().textContent).not.toMatch(/Reading what/))
    expect(consequences()).toEqual([])
    const change = within(dialog()).getByRole('button', { name: 'Change to…' }) as HTMLButtonElement
    expect(change.disabled).toBe(true)
  })

  it('names what MFS would mean — whose inputs count, the missing tables, the partner leaving the card, next year’s safe harbor — and sends nothing until confirmed', async () => {
    const { onChange } = mount('married_joint')
    fireEvent.click(trigger())
    await waitFor(() => expect(dialog().textContent).not.toMatch(/Reading what/))
    fireEvent.click(radio(/^Married filing separately/))
    expect(consequences()).toEqual([
      'Alex’s inputs count on the return.',
      '2024 has no Married-filing-separately tables yet — the estimate, What-if and Will I owe? stay unavailable until you add or clone them in Tax tables.',
      'Sam’s withholding leaves the Will I owe? card.',
      '2025’s prior-year safe harbor uses this year’s total tax.',
    ])
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Change to Married filing separately' }))
    expect(onChange).toHaveBeenCalledWith('married_separate')
    // Handed to the page, which asks about unsaved work and PATCHes; the dialog is done.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('says the partner joins the card when a single year becomes joint', async () => {
    vi.mocked(fetchStatusOptions).mockResolvedValue(optionsFor('single'))
    mount('single')
    fireEvent.click(trigger())
    await waitFor(() => expect(dialog().textContent).not.toMatch(/Reading what/))
    fireEvent.click(radio(/^Married filing jointly/))
    expect(consequences()).toEqual([
      'Alex’s and Sam’s inputs count on the return.',
      'Sam’s withholding joins the Will I owe? card.',
      '2025’s prior-year safe harbor uses this year’s total tax.',
    ])
  })

  it('leaves the withholding card out of a year it does not answer for', async () => {
    vi.mocked(fetchStatusOptions).mockResolvedValue(optionsFor('married_joint', false))
    mount('married_joint', { withholdingYear: false })
    fireEvent.click(trigger())
    await waitFor(() => expect(dialog().textContent).not.toMatch(/Reading what/))
    fireEvent.click(radio(/^Single/))
    expect(consequences()).toEqual([
      'Alex’s inputs count on the return.',
      '2025’s prior-year safe harbor uses this year’s total tax.',
    ])
  })

  it('single ↔ MFS moves nobody on or off the card', async () => {
    vi.mocked(fetchStatusOptions).mockResolvedValue(optionsFor('single', false))
    mount('single')
    fireEvent.click(trigger())
    await waitFor(() => expect(dialog().textContent).not.toMatch(/Reading what/))
    fireEvent.click(radio(/^Married filing separately/))
    expect(consequences()).toEqual([
      'Alex’s inputs count on the return.',
      '2025’s prior-year safe harbor uses this year’s total tax.',
    ])
  })

  it('Keep and Escape close without sending anything', async () => {
    const { onChange } = mount('married_joint')
    fireEvent.click(trigger())
    fireEvent.click(radio(/^Single/))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Keep Married filing jointly' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger())
    // A reopened dialog starts on the year's own status again, not on the abandoned choice.
    expect(radio(/^Married filing jointly/).checked).toBe(true)
    fireEvent.keyDown(radio(/^Married filing jointly/), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a failed read still lets the change through, with the reason and a retry', async () => {
    vi.mocked(fetchStatusOptions).mockRejectedValueOnce(new ApiError('tax year 2024 not found', 404))
    const { onChange } = mount('married_joint')
    fireEvent.click(trigger())
    expect(await within(dialog()).findByText(/tax year 2024 not found/)).toBeTruthy()
    fireEvent.click(radio(/^Single/))
    // The consequences are the server's; without them the dialog says less, never something else.
    expect(consequences()).toEqual([])
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Change to Single' }))
    expect(onChange).toHaveBeenCalledWith('single')
  })

  it('holds the change while the page is busy with the year', async () => {
    mount('married_joint', { disabled: true })
    fireEvent.click(trigger())
    await waitFor(() => expect(dialog().textContent).not.toMatch(/Reading what/))
    fireEvent.click(radio(/^Single/))
    const change = within(dialog()).getByRole('button', { name: 'Change to Single' }) as HTMLButtonElement
    expect(change.disabled).toBe(true)
  })
})
