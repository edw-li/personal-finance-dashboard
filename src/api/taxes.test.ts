import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cloneBrackets,
  fetchTaxBrackets,
  FILING_STATUSES,
  FILING_STATUS_LABELS,
  jurisdictionLabel,
  patchTaxYear,
  putTaxBrackets,
  putTaxInputs,
} from './taxes'

// ApiError and the token helpers stay real; only the transport is stubbed (importer.test.ts's
// pattern). These pins are the ONE place the filing-status wire contract is written down —
// each was checked against backend/app/api/taxes.py before being pinned here.
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
}))
import { api } from './client'

beforeEach(() => vi.clearAllMocks())

describe('filing-status vocabulary', () => {
  it('orders the statuses with single first', () => {
    // 'single' leads because it is the column default, the only status the importer writes,
    // and the source every clone copies FROM.
    expect(FILING_STATUSES).toEqual(['single', 'married_joint', 'married_separate'])
    expect(FILING_STATUS_LABELS.single).toBe('Single')
    expect(FILING_STATUS_LABELS.married_joint).toBe('Married filing jointly')
    expect(FILING_STATUS_LABELS.married_separate).toBe('Married filing separately')
  })

  it('labels the six jurisdictions, and hands an importer-written one back verbatim', () => {
    expect(jurisdictionLabel('social_security')).toBe('Social Security')
    expect(jurisdictionLabel('capital_gains')).toBe('Capital gains')
    // The API only writes six; a GET can still return an importer's extra one.
    expect(jurisdictionLabel('local_city')).toBe('local_city')
  })
})

describe('taxes client', () => {
  it('PATCHes a year filing status and asks for the row back', async () => {
    // PATCH, not PUT: the year row has exactly one mutable field and no auto-create
    // (app/api/taxes.py update_year) — a status is a statement about a year that exists.
    await patchTaxYear(2026, { filing_status: 'married_joint' })
    const [path, options] = vi.mocked(api).mock.calls[0]
    expect(path).toBe('/taxes/years/2026')
    expect(options?.method).toBe('PATCH')
    expect(options?.body).toBe('{"filing_status":"married_joint"}')
  })

  it('always names the status on a brackets GET, single included', async () => {
    // The server's default is 'single', NOT the year's own status (get_brackets' docstring),
    // so an omitted param would silently read single's tables under a married year. The
    // argument is required for exactly that reason.
    await fetchTaxBrackets(2026, 'single')
    expect(vi.mocked(api).mock.calls[0][0]).toBe('/taxes/years/2026/brackets?filing_status=single')
  })

  it('names the status when the editor opens another tab', async () => {
    await fetchTaxBrackets(2026, 'married_separate')
    expect(vi.mocked(api).mock.calls[0][0]).toBe(
      '/taxes/years/2026/brackets?filing_status=married_separate',
    )
  })

  it('sends no query and no body at all for a plain clone', async () => {
    // The new-year path clones with no status: the server defaults to 'single', which IS
    // today's behaviour, so its wire must stay byte-identical.
    await cloneBrackets(2026, 2025)
    const [path, options] = vi.mocked(api).mock.calls[0]
    expect(path).toBe('/taxes/years/2026/clone-brackets-from/2025')
    expect(options?.method).toBe('POST')
    expect(options?.body).toBeUndefined()
  })

  it('names the target status in the QUERY when seeding a status tab from the same year', async () => {
    // Same year both sides: the source is always that year's SINGLE tables (design §5.5).
    // A query param, not a body — clone_brackets takes FilingStatusQuery.
    await cloneBrackets(2026, 2026, 'married_joint')
    const [path, options] = vi.mocked(api).mock.calls[0]
    expect(path).toBe('/taxes/years/2026/clone-brackets-from/2026?target_status=married_joint')
    expect(options?.body).toBeUndefined()
  })

  it('carries the status in the brackets PUT body', async () => {
    await putTaxBrackets(2026, {
      filing_status: 'married_joint',
      jurisdictions: { federal: [{ rate: '0.10', threshold: '0.00' }] },
    })
    expect(vi.mocked(api).mock.calls[0][1]?.body).toBe(
      '{"filing_status":"married_joint","jurisdictions":{"federal":[{"rate":"0.10","threshold":"0.00"}]}}',
    )
  })

  it('carries person-qualified rows in the inputs PUT body', async () => {
    await putTaxInputs(2026, {
      values: { qualified_dividends: '100' },
      rows: [{ key: 'annual_salary', person_id: 4, value: '90000' }],
    })
    expect(vi.mocked(api).mock.calls[0][1]?.body).toBe(
      '{"values":{"qualified_dividends":"100"},' +
        '"rows":[{"key":"annual_salary","person_id":4,"value":"90000"}]}',
    )
  })
})
