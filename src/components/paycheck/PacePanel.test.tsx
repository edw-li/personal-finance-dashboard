import { cleanup, render, screen, within } from '@testing-library/react'
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
  expect(screen.getByText('108.0%')).toBeTruthy()
})

it('renders a call to action instead of a meter when the limit is missing', () => {
  renderPanel([MISSING])

  expect(screen.queryByRole('meter')).toBeNull()
  const link = screen.getByRole('link', { name: "enter this year's limit" })
  expect(link.getAttribute('href')).toBe('/settings')
  // The annualized figure is still real and still shown — only the verdict is withheld.
  expect(screen.getByText('$16,000.00')).toBeTruthy()
})

it('names the employer-match caveat the server put in the label', () => {
  renderPanel([MISSING])
  expect(screen.getByText(/excludes employer match/)).toBeTruthy()
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
