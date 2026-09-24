import { describe, expect, it } from 'vitest'
import { COMPLETENESS_LABELS, formatCompleteness, formatComponentLabel, formatEvidenceValue } from './metricReceipt'

// Reader-facing words for machine keys (2026-09-13 spec §5). The panel printed "Basis  complete"
// and "pre tax / post tax / liability" — the enum and the account-group keys leaking through.
describe('receipt labels', () => {
  it('maps every completeness value to a sentence', () => {
    expect(COMPLETENESS_LABELS).toEqual({
      complete: 'Complete',
      unreviewed_history: 'Includes months not yet reviewed',
      incomplete: 'Incomplete — some months missing',
      unavailable: 'Unavailable',
      mixed: 'Mixed sources',
      partial: 'Partial — some holdings unpriced',
      estimate: 'Estimate',
    })
    expect(formatCompleteness('mixed')).toBe('Mixed sources')
    expect(formatCompleteness('unreviewed_history')).toBe('Includes months not yet reviewed')
  })

  it('falls back to sentence case without underscores for a value the map has no words for', () => {
    // CashflowStrip and projectionDisplay pass their own vocabulary today.
    expect(formatCompleteness('partial_estimate')).toBe('Partial estimate')
    expect(formatCompleteness('scheduled_events')).toBe('Scheduled events')
    expect(formatCompleteness('estimated')).toBe('Estimated')
    // Exclusion reasons ride the same fallback and are already prose.
    expect(formatCompleteness('Take-home missing')).toBe('Take-home missing')
  })

  it('sentence-cases component labels, never prints an underscore, and leaves acronyms alone', () => {
    expect(formatComponentLabel('pre_tax')).toBe('Pre tax')
    expect(formatComponentLabel('post tax')).toBe('Post tax')
    expect(formatComponentLabel('liability')).toBe('Liability')
    expect(formatComponentLabel('HSA employer')).toBe('HSA employer')
    expect(formatComponentLabel('  living   spending ')).toBe('Living spending')
    expect(formatComponentLabel('')).toBe('')
  })

  it('formats values from here so the prompt and the panel agree on one notation', () => {
    expect(formatEvidenceValue('123.45', 'USD')).toBe('$123.45')
    expect(formatEvidenceValue('0.123456789', 'ratio', 7)).toBe('12.3456789%')
    expect(formatEvidenceValue(3, 'count')).toBe('3')
    expect(formatEvidenceValue(null)).toBe('Unavailable')
  })
})

describe('provisional balances (2026-09-23 spec §0.4(e))', () => {
  it('have their own words — never the sentence-case fallback', () => {
    expect(COMPLETENESS_LABELS.provisional).toBe('Provisional — recorded before its date')
    expect(formatCompleteness('provisional')).toBe('Provisional — recorded before its date')
  })
})
