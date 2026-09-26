import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteCustomEvent, putCalendarOverride, putCalendarOverrideLogged } from './calendar'
import { deleteEvent, deleteRsuGrant } from './comp'
import {
  deleteCardCredit,
  deleteCreditCard,
  deleteLimitEvent,
  deleteRewardCategory,
  updateCreditCard,
  updateCreditCardLogged,
  updateRewardCategory,
  updateRewardCategoryLogged,
} from './creditCards'
import { deleteLot, deleteOffering, deletePeriod } from './espp'
import { deleteAccount, updateAccount, updateAccountLogged } from './netWorth'
import { deleteProfile } from './paycheck'
import { deleteDividend, deleteSecurity, deleteTransaction } from './portfolio'
import { deleteCategory, deleteCategoryBudget, updateCategory, updateCategoryLogged } from './spending'
import { putTaxInputs, putTaxInputsLogged } from './taxes'
import type { CreditCardIn } from '../types/api'

// The logged clients (2026-09-25 polish spec §6.2, contract C2) through the REAL transport: only fetch
// is stubbed (client.test.ts's posture), so each case pins the request its client builds AND the
// change batch read back off the response — the id a wave-2 Undo toast hands to
// POST /activity/batches/{id}/undo. The two tables ARE the contract's lists: a client that joins C2
// joins its table.

const fetchMock = vi.fn()

/** Every call answers `status` with `body`, naming `batch` in X-Change-Batch when one is given. A
 *  fresh Response per call: a body can be read only once. */
function answer(status: number, body: unknown, batch?: string): void {
  fetchMock.mockImplementation(
    async () =>
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: batch === undefined ? {} : { 'X-Change-Batch': batch },
      }),
  )
}

/** The first request the stub saw: its URL, verb and parsed body. */
function sent(): { url: string; method: string | undefined; body: unknown } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return {
    url,
    method: init.method,
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
  }
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

const DELETES: [string, () => Promise<{ batchId: string | null }>, string][] = [
  ['deleteSecurity', () => deleteSecurity(3), '/portfolio/securities/3'],
  ['deleteTransaction', () => deleteTransaction(4), '/portfolio/transactions/4'],
  ['deleteDividend', () => deleteDividend(5), '/portfolio/dividends/5'],
  ['deleteCreditCard', () => deleteCreditCard(6), '/credit-cards/6'],
  ['deleteCardCredit', () => deleteCardCredit(7), '/credit-cards/credits/7'],
  ['deleteLimitEvent', () => deleteLimitEvent(6, 8), '/credit-cards/6/limits/8'],
  ['deleteRewardCategory', () => deleteRewardCategory(9), '/credit-cards/categories/9'],
  ['deleteLot', () => deleteLot(10), '/espp/lots/10'],
  ['deleteOffering', () => deleteOffering(11), '/espp/offerings/11'],
  ['deletePeriod', () => deletePeriod(12), '/espp/periods/12'],
  ['deleteProfile', () => deleteProfile(13), '/paycheck/profiles/13'],
  ['deleteEvent', () => deleteEvent(14), '/comp/events/14'],
  ['deleteRsuGrant', () => deleteRsuGrant(15), '/comp/rsu-grants/15'],
  ['deleteCustomEvent', () => deleteCustomEvent(16), '/calendar/events/16'],
  ['deleteAccount', () => deleteAccount(17), '/net-worth/accounts/17'],
  ['deleteCategory', () => deleteCategory(18), '/spending/categories/18'],
  [
    'deleteCategoryBudget',
    () => deleteCategoryBudget(18, '2026-03-01'),
    '/spending/categories/18/budget/2026-03-01',
  ],
]

describe.each(DELETES)('%s', (_name, run, path) => {
  it('DELETEs its path and answers the batch the 204 names', async () => {
    answer(204, null, 'b-7')
    expect(await run()).toEqual({ batchId: 'b-7' })
    expect(sent()).toEqual({ url: `/api/v1${path}`, method: 'DELETE', body: undefined })
  })

  it('answers null when nothing was recorded — no Undo to offer', async () => {
    answer(204, null)
    expect(await run()).toEqual({ batchId: null })
  })
})

const CARD: CreditCardIn = {
  name: 'Venture X',
  annual_fee: '395.00',
  rewards_currency: 'miles',
  point_value_cents: '1.00',
  person_id: null,
  primary_holder: null,
  authorized_users: null,
  opened_on: null,
  is_active: false,
  account_id: null,
  notes: null,
}
const OVERRIDE = { done: true, hidden: false, note: null, amount: null }
const INPUTS = { values: { qualified_dividends: '100' } }

/** [name, the logged sibling, its unlogged original, verb, path, body] */
const SIBLINGS: [string, () => Promise<unknown>, () => Promise<unknown>, string, string, unknown][] = [
  [
    'updateCategoryLogged',
    () => updateCategoryLogged(4, { kind: 'transfer' }),
    () => updateCategory(4, { kind: 'transfer' }),
    'PATCH',
    '/spending/categories/4',
    { kind: 'transfer' },
  ],
  [
    'updateAccountLogged',
    () => updateAccountLogged(5, { is_active: false }),
    () => updateAccount(5, { is_active: false }),
    'PATCH',
    '/net-worth/accounts/5',
    { is_active: false },
  ],
  [
    'updateCreditCardLogged',
    () => updateCreditCardLogged(6, CARD),
    () => updateCreditCard(6, CARD),
    'PATCH',
    '/credit-cards/6',
    CARD,
  ],
  [
    'updateRewardCategoryLogged',
    () => updateRewardCategoryLogged(7, { is_active: false }),
    () => updateRewardCategory(7, { is_active: false }),
    'PATCH',
    '/credit-cards/categories/7',
    { is_active: false },
  ],
  [
    'putCalendarOverrideLogged',
    () => putCalendarOverrideLogged('payday:2026-09-15', OVERRIDE),
    () => putCalendarOverride('payday:2026-09-15', OVERRIDE),
    'PUT',
    '/calendar/overrides/payday%3A2026-09-15',
    OVERRIDE,
  ],
  [
    'putTaxInputsLogged',
    () => putTaxInputsLogged(2026, INPUTS),
    () => putTaxInputs(2026, INPUTS),
    'PUT',
    '/taxes/years/2026/inputs',
    INPUTS,
  ],
]

describe.each(SIBLINGS)('%s', (_name, logged, original, method, path, body) => {
  it('sends exactly what its unlogged original sends', async () => {
    answer(200, { echoed: true }, 'b-9')
    await original()
    const theirs = sent()
    fetchMock.mockClear()
    await logged()
    expect(sent()).toEqual(theirs)
    expect(theirs).toEqual({ url: `/api/v1${path}`, method, body })
  })

  it('answers the body with the batch the header names — null when the write changed nothing', async () => {
    answer(200, { echoed: true }, 'b-9')
    expect(await logged()).toEqual({ data: { echoed: true }, batchId: 'b-9' })
    answer(200, { echoed: true })
    expect(await logged()).toEqual({ data: { echoed: true }, batchId: null })
  })
})
