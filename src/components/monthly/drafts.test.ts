import { afterEach, describe, expect, it } from 'vitest'
import { draftKey, readDraft, removeDraft, splitLegacyDraft, writeDraft } from './drafts'

afterEach(() => sessionStorage.clear())
const M = '2026-09-01'

describe('drafts per part (2026-09-23 spec §M6)', () => {
  it('keeps each part under its own key', () => {
    writeDraft('balances', M, { balances: { 1: '9.00' }, notes: '', typedParents: [] })
    writeDraft('flows', M, { amounts: { 7: '5.00' }, netPay: '' })
    expect(draftKey('balances', M)).toBe('finance-update-draft:balances:2026-09-01')
    expect(draftKey('flows', M)).toBe('finance-update-draft:flows:2026-09-01')
    expect(readDraft('balances', M)).toEqual({ balances: { 1: '9.00' }, notes: '', typedParents: [] })
    removeDraft('balances', M)
    expect(readDraft('balances', M)).toBeNull()
    expect(readDraft('flows', M)).toEqual({ amounts: { 7: '5.00' }, netPay: '' })
  })

  it('splits a legacy whole-month draft in two, drops recordedOn and removes the legacy key', () => {
    sessionStorage.setItem(
      `finance-update-draft:${M}`,
      JSON.stringify({
        balances: { 1: '9.00' },
        amounts: { 7: '5.00' },
        netPay: '100',
        recordedOn: '2026-09-02',
        notes: 'n',
        typedParents: [8],
      }),
    )
    splitLegacyDraft(M)
    expect(sessionStorage.getItem(`finance-update-draft:${M}`)).toBeNull()
    expect(readDraft('balances', M)).toEqual({ balances: { 1: '9.00' }, notes: 'n', typedParents: [8] })
    expect(readDraft('flows', M)).toEqual({ amounts: { 7: '5.00' }, netPay: '100' })
  })

  it('writes only the parts the legacy draft had, and never over a newer part draft', () => {
    writeDraft('balances', M, { balances: { 1: '1.00' }, notes: '', typedParents: [] })
    sessionStorage.setItem(`finance-update-draft:${M}`, JSON.stringify({ balances: { 1: '9.00' } }))
    splitLegacyDraft(M)
    expect(readDraft('balances', M)).toEqual({ balances: { 1: '1.00' }, notes: '', typedParents: [] })
    expect(readDraft('flows', M)).toBeNull()
  })

  it('drops a corrupt entry rather than restoring it', () => {
    sessionStorage.setItem(`finance-update-draft:${M}`, '{not json')
    sessionStorage.setItem(draftKey('flows', M), '[1,2]')
    splitLegacyDraft(M)
    expect(sessionStorage.length).toBe(1)
    expect(readDraft('flows', M)).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })

  it('leaves other months alone', () => {
    sessionStorage.setItem('finance-update-draft:2026-08-01', JSON.stringify({ balances: { 1: '9.00' } }))
    splitLegacyDraft(M)
    expect(sessionStorage.getItem('finance-update-draft:2026-08-01')).not.toBeNull()
  })
})
