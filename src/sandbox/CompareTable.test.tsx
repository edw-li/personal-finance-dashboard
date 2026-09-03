import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CompareTable, { type CompareRow } from './CompareTable'

afterEach(cleanup)

type R = Record<string, string | null>
const ROWS: CompareRow[] = [
  { key: 'total_tax', label: 'Total tax', kind: 'money', invert: true },
  { key: 'take_home', label: 'Take-home', kind: 'money' },
  { key: 'effective_rate', label: 'Effective rate', kind: 'percent' },
  { key: 'fi_month', label: 'FI date', kind: 'month' },
]
const baseline: R = { total_tax: '72824.61', take_home: '376543.22', effective_rate: '0.246914', fi_month: '2041-03-01' }
const scenario: R = { total_tax: '77145.61', take_home: '372222.22', effective_rate: '0.281234', fi_month: null }
const delta: R = { total_tax: '4321.00', take_home: '-4321.00', effective_rate: '0.034320' }

// `valueOf` is omitted from the override type on purpose: an OPTIONAL member of that name is
// compared against Object.prototype.valueOf, so any literal lacking it — `{ delta: undefined }`
// — would be rejected. No case here overrides the reader anyway.
type Overrides = Partial<Omit<Parameters<typeof CompareTable<R>>[0], 'valueOf'>>

function mount(over: Overrides = {}) {
  const onUnpin = vi.fn()
  render(
    <CompareTable<R>
      rows={ROWS}
      baseline={baseline}
      scenario={scenario}
      valueOf={(r, key) => r[key] ?? null}
      delta={(key) => delta[key] ?? null}
      pins={[]}
      onUnpin={onUnpin}
      {...over}
    />,
  )
  return onUnpin
}

const row = (label: string) => screen.getByText(label).closest('tr') as HTMLElement
const cells = (label: string) => within(row(label)).getAllByRole('cell').map((c) => c.textContent)

describe('CompareTable', () => {
  it('lays out Baseline · Scenario · Δ with formatted values and inverted tones on cost lines', () => {
    mount()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Baseline', 'Scenario', 'Δ'])
    expect(cells('Total tax')).toEqual(['Total tax', '$72,824.61', '$77,145.61', '+$4,321.00'])
    expect(within(row('Total tax')).getByText('+$4,321.00').className).toContain('delta-chip-negative') // more tax reads red
    expect(within(row('Take-home')).getByText('-$4,321.00').className).toContain('delta-chip-negative')
    expect(cells('Effective rate')).toEqual(['Effective rate', '24.7%', '28.1%', '+3.4 pp'])
    expect(cells('FI date')).toEqual(['FI date', 'Mar 2041', '—', '—']) // null value and no month arithmetic
  })

  it('omits the Δ column when no delta reader is given', () => {
    mount({ delta: undefined })
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Baseline', 'Scenario'])
  })

  it('adds one column per pin headed by its label and an Unpin button; pending and error columns', () => {
    const onUnpin = mount({
      pins: [
        { id: 'p1', label: 'Sell 40 VTI', result: { ...scenario, total_tax: '70000.00' } },
        { id: 'p2', label: 'Waiting', result: 'pending' },
        { id: 'p3', label: 'Gone', result: { error: 'lot 4 already sold' } },
      ],
    })
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads.slice(4)).toEqual(['Sell 40 VTIUnpin', 'WaitingUnpin', 'GoneUnpin'])
    expect(cells('Total tax').slice(4)).toEqual(['$70,000.00', '…', 'lot 4 already sold'])
    expect(cells('Take-home')).toHaveLength(5) // the pending and error cells span the rows below
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Sell 40 VTI' }))
    expect(onUnpin).toHaveBeenCalledWith('p1')
  })
})
