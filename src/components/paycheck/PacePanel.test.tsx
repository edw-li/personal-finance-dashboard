import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import type { PaceItem } from '../../types/api'
import PacePanel from './PacePanel'

const OK: PaceItem = {
  key: 'limit_401k_elective',
  label: '401(k) elective deferral',
  annualized: '10000.00',
  limit: '24500.00',
  ratio: '0.4082',
  tone: 'ok',
}
const WARN: PaceItem = {
  key: 'limit_hsa_self',
  label: 'HSA — self-only',
  annualized: '4200.00',
  limit: '4400.00',
  ratio: '0.9545',
  tone: 'warn',
}
const OVER: PaceItem = {
  key: 'limit_espp_423',
  label: 'ESPP §423 annual',
  annualized: '27000.00',
  limit: '25000.00',
  ratio: '1.0800',
  tone: 'over',
}
const MISSING: PaceItem = {
  key: 'limit_415c_total',
  label: '415(c) total additions (excludes employer match)',
  annualized: '16000.00',
  limit: null,
  ratio: null,
  tone: 'ok',
}
// Production's golden row (spec §1.4): 11 % then 12 % of 188,930 across the two halves.
const ESPP: PaceItem = {
  key: 'limit_espp_423',
  label: 'ESPP §423 annual',
  annualized: '20861.02',
  limit: '25000.00',
  ratio: '0.8344',
  tone: 'warn',
  measure: 'window',
  soft_limit: '21250.00',
  soft_ratio: '0.9817',
  window_label: 'Sep 2025 – Aug 2026 purchases',
  halves: [
    { label: 'Feb 2026', start: '2025-09-01', end: '2026-02-27', amount: '10391.15', source: 'estimated', basis: 'paydays' },
    { label: 'Aug 2026', start: '2026-03-01', end: '2026-08-31', amount: '10469.87', source: 'estimated', basis: 'paydays' },
  ],
  backfilled_from: null,
  projected_full_year: '22671.60',
  projected_excess: '1421.60',
  current_rate: '0.120000000',
}

const renderPanel = (items: PaceItem[]) =>
  render(<PacePanel items={items} />, { wrapper: MemoryRouter })

afterEach(cleanup)

it('draws one meter per item with the figures in its label', () => {
  renderPanel([OK, WARN, OVER])

  const meters = screen.getAllByRole('meter')
  expect(meters).toHaveLength(3)
  expect(meters[0].getAttribute('aria-valuetext')).toBe('$10,000.00 of $24,500.00')
  expect(meters[0].getAttribute('aria-valuenow')).toBe('41')
})

it('carries the tone on the fill and in words', () => {
  renderPanel([OK, WARN, OVER])

  const rows = screen.getAllByRole('meter')
  expect(rows[0].querySelector('.pace-fill')?.className).toBe('pace-fill is-ok')
  expect(rows[1].querySelector('.pace-fill')?.className).toBe('pace-fill is-warn')
  expect(rows[2].querySelector('.pace-fill')?.className).toBe('pace-fill is-over')
  // Over-ness is redundant with colour — a position tick AND a word (CVD-safe).
  expect(rows[2].querySelector('.pace-overflow-tick')).toBeTruthy()
  expect(screen.getByText('over')).toBeTruthy()
})

it('clamps the fill at the track end and still reports the true percentage', () => {
  renderPanel([OVER])

  const meter = screen.getByRole('meter')
  // The component writes "100.00%"; CSSOM canonicalizes the trailing zeros away on
  // read-back. What matters is the CLAMP — 108 % of a track is a layout bug, not data.
  expect((meter.querySelector('.pace-fill') as HTMLElement).style.width).toBe('100%')
  // valuenow is clamped to valuemax for the same reason the fill is: an out-of-range meter
  // is undefined to assistive tech. The true over-ness survives in valuetext and in print.
  expect(meter.getAttribute('aria-valuenow')).toBe('100')
  expect(meter.getAttribute('aria-valuetext')).toBe('$27,000.00 of $25,000.00')
  expect(screen.getByText('108.00%')).toBeTruthy()
})

it('prints a percentage that cannot contradict the tone beside it', () => {
  // 0.9499 is the last ratio the server still calls "ok" — one decimal would print it as
  // "95.0%", a number the warn threshold owns, next to the word "on pace".
  renderPanel([{ ...OK, ratio: '0.9499', annualized: '23264.00', tone: 'ok' }])

  expect(screen.queryByText('95.00%')).toBeNull()
  expect(screen.getByText('94.99%')).toBeTruthy()
  expect(screen.getByText('on pace')).toBeTruthy()
  expect((screen.getByText('94.99%') as HTMLElement).className).toBe('pace-verdict tone-ok')
})

it('renders a call to action instead of a meter when the limit is missing', () => {
  renderPanel([MISSING])

  expect(screen.queryByRole('meter')).toBeNull()
  const link = screen.getByRole('link', { name: "enter this year's limit" })
  expect(link.getAttribute('href')).toBe('/settings')
  // The annualized figure is still real and still shown — only the verdict is withheld.
  expect(screen.getByText('$16,000.00')).toBeTruthy()
})

it('says the figures are a projection, not a year-to-date total', () => {
  renderPanel([OK])
  const card = within(screen.getByRole('region', { name: 'Contribution pace' }))
  expect(card.getByText(/at this rate/i)).toBeTruthy()
})

it('renders nothing at all when there are no items', () => {
  const { container } = renderPanel([])
  expect(container.firstChild).toBeNull()
})

it('grades the ESPP row against the PRACTICAL cap, not the §423 one', () => {
  renderPanel([ESPP])
  const meter = screen.getByRole('meter')
  // Both caps out loud: the one the verdict used, and the statutory one it derives from —
  // a reader who only heard "21,250" would think the law said so.
  expect(meter.getAttribute('aria-valuetext')).toBe(
    '$20,861.02 of $21,250.00 practical cap; §423 cap $25,000.00',
  )
  expect(screen.getByText('$20,861.02 / $21,250.00 practical')).toBeTruthy()
  // The printed percentage is soft_ratio's, so it cannot contradict the tone beside it.
  expect(screen.getByText('98.17%')).toBeTruthy()
  expect(screen.getByText('near the cap')).toBeTruthy()
  expect(screen.getByText('Sep 2025 – Aug 2026 purchases')).toBeTruthy()
})

it('marks the practical cap on the §423 track', () => {
  renderPanel([ESPP])
  const meter = screen.getByRole('meter')
  // 21,250 / 25,000 — a POSITION, which is what the client may compute. CSSOM canonicalizes
  // the written "85.00%" on read-back, as it does the fill's width.
  expect((meter.querySelector('.pace-soft-tick') as HTMLElement).style.left).toBe('85%')
  // The fill still runs on the §423 ratio: the track is the statutory cap, end to end.
  expect((meter.querySelector('.pace-fill') as HTMLElement).style.width).toBe('83.44%')
})

it('draws the overflow tick for a clamped FILL, never for a soft-capped verdict', () => {
  // Over the practical cap, nowhere near the §423 one: nothing overflowed the track, so a
  // tick past its end would describe something that did not happen.
  renderPanel([{ ...ESPP, soft_ratio: '1.0400', tone: 'over', annualized: '22100.00' }])
  expect(screen.getByRole('meter').querySelector('.pace-overflow-tick')).toBeNull()
  expect(screen.getByText('over')).toBeTruthy()
  cleanup()
  renderPanel([OVER])
  expect(screen.getByRole('meter').querySelector('.pace-overflow-tick')).toBeTruthy()
})

// The card's hint is a disclosure: click the ⓘ, read the bubble, Escape (OverviewPage's helper).
function hintText(name: RegExp): string {
  fireEvent.click(screen.getByRole('button', { name }))
  const text = screen.getByRole('tooltip').textContent ?? ''
  fireEvent.keyDown(window, { key: 'Escape' })
  return text
}

it('says where each half of the window came from, and what a full purchase year costs', () => {
  renderPanel([ESPP])
  expect(
    screen.getByText(
      'Feb 2026 estimated · Aug 2026 estimated. At your current 12%, a full purchase year is $22,671.60, which is $1,421.60 over the practical cap; the plan refunds the excess after the purchase.',
    ),
  ).toBeTruthy()
})

it('names the backfill and the per-month approximation, and stops projecting at a zero rate', () => {
  renderPanel([
    {
      ...ESPP,
      halves: [{ ...ESPP.halves![0], source: 'entered', basis: null }, { ...ESPP.halves![1], basis: 'months' }],
      backfilled_from: '2026-01-01',
      projected_full_year: '18000.00',
      projected_excess: '0.00',
    },
  ])
  expect(
    screen.getByText(
      'Feb 2026 entered · Aug 2026 estimated · before Jan 1, 2026 assumes your earliest profile · estimated by month. At your current 12%, a full purchase year is $18,000.00.',
    ),
  ).toBeTruthy()
  cleanup()
  // A pre-batch snapshot has no current_rate: the sentence still reads, without the number.
  renderPanel([{ ...ESPP, current_rate: undefined }])
  expect(screen.getByText(/At your current rate, a full purchase year is \$22,671\.60/)).toBeTruthy()
  cleanup()
  renderPanel([{ ...ESPP, projected_full_year: '0.00', projected_excess: '0.00' }])
  expect(
    screen.getByText('Feb 2026 estimated · Aug 2026 estimated. You are not contributing now.'),
  ).toBeTruthy()
})

it('prints the employer match inside the 415(c) figure, under whichever label the server sent', () => {
  renderPanel([{ ...MISSING, label: '415(c) total additions (incl. employer match)', employer_match: '11500.00' }])
  expect(screen.getByText(/incl\. \$11,500\.00 match/)).toBeTruthy()
  expect(screen.getByText(/incl\. employer match/)).toBeTruthy()
  cleanup()
  // No policy, no suffix — never "incl. $0.00" — and the server's other label prints too.
  renderPanel([MISSING])
  expect(screen.queryByText(/incl\./)).toBeNull()
  expect(screen.getByText(/excludes employer match/)).toBeTruthy()
})

it('hangs the match suffix off the METER row too, not just the call-to-action one', () => {
  renderPanel([{ ...OK, employer_match: '11500.00' }])
  // Beside the figures, inside the same cell: a component of the number, not a second
  // verdict — and the figures themselves still read as they always did.
  expect(screen.getByText('incl. $11,500.00 match')).toBeTruthy()
  expect(screen.getByText('$10,000.00 / $24,500.00')).toBeTruthy()
})

it('sends the reader to the profile for the match, and to the ESPP page for the chained figures', () => {
  renderPanel([OK])
  const text = hintText(/^About Each contribution line/)
  expect(text).toContain('set your 401(k) match on your paycheck profile')
  expect(text).not.toContain('Employer 401(k) match and employer HSA contributions')
  expect(text).toContain('autumn checks count toward next year')
})
