import { afterEach, describe, expect, it } from 'vitest'
import {
  bracketsDraftKey,
  clearTaxDraft,
  clearYearDrafts,
  inputsDraftKey,
  isStringRecord,
  readTaxDraft,
  resumeDraft,
  sameRecord,
  writeTaxDraft,
} from './taxDrafts'

afterEach(() => sessionStorage.clear())

describe('tax drafts (2026-09-23 spec §W9)', () => {
  it('files a year’s inputs and each status’ tables under their own keys', () => {
    expect(inputsDraftKey(2026)).toBe('finance-tax-inputs-draft:2026')
    expect(bracketsDraftKey(2026, 'married_joint')).toBe('finance-tax-brackets-draft:2026:married_joint')
  })

  it('round-trips a draft with the values it was typed over', () => {
    const draft = { loaded: { salary: '200000' }, edited: { salary: '210000' } }
    writeTaxDraft(inputsDraftKey(2024), draft)
    expect(JSON.parse(sessionStorage.getItem('finance-tax-inputs-draft:2024') ?? 'null')).toEqual(draft)
    expect(readTaxDraft(inputsDraftKey(2024), isStringRecord)).toEqual(draft)
    clearTaxDraft(inputsDraftKey(2024))
    expect(sessionStorage.getItem('finance-tax-inputs-draft:2024')).toBeNull()
  })

  it('treats a corrupt or misshapen entry as no draft, never a throw', () => {
    sessionStorage.setItem('finance-tax-inputs-draft:2024', '{not json')
    expect(readTaxDraft(inputsDraftKey(2024), isStringRecord)).toBeNull()
    sessionStorage.setItem('finance-tax-inputs-draft:2024', JSON.stringify({ loaded: { a: 1 }, edited: {} }))
    expect(readTaxDraft(inputsDraftKey(2024), isStringRecord)).toBeNull()
    sessionStorage.setItem('finance-tax-inputs-draft:2024', JSON.stringify({ edited: {} }))
    expect(readTaxDraft(inputsDraftKey(2024), isStringRecord)).toBeNull()
  })

  it('restores only while the server still returns what the draft was typed over', () => {
    const key = inputsDraftKey(2024)
    writeTaxDraft(key, { loaded: { salary: '200000' }, edited: { salary: '210000' } })
    expect(resumeDraft(key, { salary: '200000' }, isStringRecord, sameRecord)).toEqual({
      kind: 'restored',
      edited: { salary: '210000' },
    })
    // Another device saved, or an Apply wrote: restoring would revert that on the next Save.
    expect(resumeDraft(key, { salary: '205000' }, isStringRecord, sameRecord)).toEqual({ kind: 'dropped' })
    // Nothing stored at all.
    expect(resumeDraft(inputsDraftKey(2023), { salary: '1' }, isStringRecord, sameRecord)).toEqual({
      kind: 'none',
    })
  })

  it('says nothing about a draft that equals its own loaded values', () => {
    const key = inputsDraftKey(2024)
    writeTaxDraft(key, { loaded: { salary: '200000' }, edited: { salary: '200000' } })
    expect(resumeDraft(key, { salary: '999' }, isStringRecord, sameRecord)).toEqual({ kind: 'none' })
  })

  it('compares records by content, never by key order', () => {
    expect(sameRecord({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true)
    expect(sameRecord({ a: '1' }, { a: '1', b: '' })).toBe(false)
    expect(sameRecord({ a: [{ r: '1' }] }, { a: [{ r: '1' }] })).toBe(true)
  })

  it('clears a year’s inputs and every status’ tables, and nothing of another year', () => {
    writeTaxDraft(inputsDraftKey(2024), { loaded: {}, edited: { a: '1' } })
    writeTaxDraft(bracketsDraftKey(2024, 'single'), { loaded: {}, edited: { a: '1' } })
    writeTaxDraft(bracketsDraftKey(2024, 'married_joint'), { loaded: {}, edited: { a: '1' } })
    writeTaxDraft(inputsDraftKey(2025), { loaded: {}, edited: { a: '1' } })
    clearYearDrafts(2024)
    expect(sessionStorage.getItem('finance-tax-inputs-draft:2024')).toBeNull()
    expect(sessionStorage.getItem('finance-tax-brackets-draft:2024:single')).toBeNull()
    expect(sessionStorage.getItem('finance-tax-brackets-draft:2024:married_joint')).toBeNull()
    expect(sessionStorage.getItem('finance-tax-inputs-draft:2025')).not.toBeNull()
  })
})
