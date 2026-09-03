import { describe, expect, it } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import {
  CHIP_PRIORITY,
  DEADLINE_TYPES,
  EVENT_TYPE_LABELS,
  SOURCE_COLORS,
  SOURCE_LABELS,
  SOURCE_ORDER,
  chipText,
  chipTitle,
  eventKey,
  groupByDate,
  hrefLabel,
  personSuffix,
  sortForCell,
  stripPersonSuffix,
  visibleEvents,
} from './calendarView'

describe('SOURCE_COLORS', () => {
  it('is the FIXED source → slot map over --chart-1…7 with custom on --muted', () => {
    expect(SOURCE_COLORS).toEqual({
      rsu: 'var(--chart-1)', espp: 'var(--chart-2)', dividend: 'var(--chart-3)', payroll: 'var(--chart-4)',
      tax: 'var(--chart-5)', card: 'var(--chart-6)', ritual: 'var(--chart-7)', custom: 'var(--muted)',
    })
    expect(new Set(Object.values(SOURCE_COLORS)).size).toBe(8)
    expect(SOURCE_ORDER).toHaveLength(8)
    for (const source of SOURCE_ORDER) expect(SOURCE_LABELS[source].length).toBeGreaterThan(0)
    expect(Object.keys(EVENT_TYPE_LABELS)).toHaveLength(12)
  })
})

describe('chip grammar', () => {
  const vest = calendarEvent({ date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 4 grants', short_label: 'RSU vest · 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated' })
  const q3 = calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Tax deadline — Q3 estimated payment', short_label: 'Q3 est. tax', amount: '2400.00', direction: 'out', basis: 'estimated' })
  const payday = calendarEvent({ date: '2026-09-15', type: 'payday', label: 'Payday', short_label: 'Payday', amount: '6812.44', direction: 'in' })
  const bare = calendarEvent({ date: '2026-09-15', type: 'ex_dividend', label: 'Ex-dividend — NVDA', short_label: 'Ex-div NVDA' })

  it('chipText is the short label plus the compact signed amount, tilde on estimates', () => {
    expect(chipText(vest)).toBe('RSU vest · 4 grants ~+$41.2k')
    expect(chipText(q3)).toBe('Q3 est. tax ~−$2.4k')
    expect(chipText(payday)).toBe('Payday +$6.8k')
    expect(chipText(bare)).toBe('Ex-div NVDA')
  })

  it('chipTitle is the full label · amount · basis', () => {
    expect(chipTitle(vest)).toBe('RSU vest — 4 grants · $41,200.00 · estimated')
    expect(chipTitle(bare)).toBe('Ex-dividend — NVDA · amount unknown · scheduled')
    expect(chipTitle({ ...payday, amount_overridden: true })).toBe('Payday · $6,812.44 · your figure')
  })

  it('sortForCell: hidden removed by visibleEvents, done deadlines last, priority then |amount|', () => {
    const custom = calendarEvent({ date: '2026-09-15', type: 'custom', label: 'Zoo', id: 3 })
    const doneQ3 = { ...q3, done: true }
    const hidden = calendarEvent({ date: '2026-09-15', type: 'card_fee', label: 'Fee', hidden: true })
    const bigDiv = calendarEvent({ date: '2026-09-15', type: 'ex_dividend', label: 'Ex-dividend — SCHD', amount: '900.00', direction: 'in' })
    const ordered = sortForCell(visibleEvents([bare, doneQ3, payday, hidden, custom, bigDiv]))
    expect(ordered.map((e) => e.label)).toEqual(['Zoo', 'Payday', 'Ex-dividend — SCHD', 'Ex-dividend — NVDA', 'Tax deadline — Q3 estimated payment'])
    expect(CHIP_PRIORITY[0]).toBe('custom')
    expect(CHIP_PRIORITY).toHaveLength(12)
    expect(DEADLINE_TYPES).toEqual(['tax_deadline', 'update_due', 'card_fee'])
  })

  it('eventKey is the server key; groupByDate keeps server order within a day', () => {
    expect(eventKey(vest)).toBe('rsu:vest:2026-09-16')
    const grouped = groupByDate([q3, payday, vest])
    expect([...grouped.keys()]).toEqual(['2026-09-15', '2026-09-16'])
    expect(grouped.get('2026-09-15')?.map((e) => e.type)).toEqual(['tax_deadline', 'payday'])
  })
})

describe('hrefLabel and the person suffix', () => {
  it('names the pages including credit cards', () => {
    expect(hrefLabel('/credit-cards')).toBe('Credit cards')
    expect(hrefLabel('/comp')).toBe('Comp')
    expect(hrefLabel('/nowhere')).toBe('page')
  })
  it('is the server grammar verbatim and peels only the trailing occurrence', () => {
    expect(personSuffix('Sam')).toBe(' — Sam')
    expect(stripPersonSuffix('Dentist — Sam', 'Sam')).toBe('Dentist')
    expect(stripPersonSuffix('Dentist — Sam', undefined)).toBe('Dentist — Sam')
    expect(stripPersonSuffix('Sam — Sam', 'Sam')).toBe('Sam')
  })
})
