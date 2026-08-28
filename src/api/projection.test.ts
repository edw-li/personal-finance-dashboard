import { beforeEach, expect, it, vi } from 'vitest'
import { fetchProjection } from './projection'

// Only the transport is stubbed — the query string this module builds IS the test.
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: vi.fn(),
}))
import { api } from './client'

beforeEach(() => vi.clearAllMocks())

const path = () => vi.mocked(api).mock.calls[0][0]

it('omits every blank knob, so a bare call is the derived projection', async () => {
  await fetchProjection({
    annualReturn: '',
    monthlyContribution: '',
    annualSpend: '',
    swr: '',
    years: '',
    volatility: '',
    inflation: '',
    contributionGrowth: '',
  })
  // Not `?volatility=` — an empty Decimal is a 422, and a blank volatility means
  // "run no simulation at all", which is exactly the parameter being absent.
  expect(path()).toBe('/projection')
})

it('names the Monte Carlo knobs the way the wire does', async () => {
  await fetchProjection({ volatility: '0.15', inflation: '0.03', contributionGrowth: '0.02' })
  expect(path()).toBe('/projection?volatility=0.15&inflation=0.03&contribution_growth=0.02')
})

it('sends an explicit zero through — it is the fan off, not a blank', async () => {
  // "0" is a non-empty string and therefore truthy: the blank-omit filter must not eat it,
  // because absent means the 15% DEFAULT while 0 means "run no simulation".
  await fetchProjection({ volatility: '0', inflation: '0', contributionGrowth: '0' })
  expect(path()).toBe('/projection?volatility=0&inflation=0&contribution_growth=0')
})

it('keeps the older knobs ahead of the new ones in the query', async () => {
  await fetchProjection({ annualReturn: '0.07', years: '30', volatility: '0.15' })
  expect(path()).toBe('/projection?annual_return=0.07&years=30&volatility=0.15')
})

it('appends one retire param per filled month and omits the blanks', async () => {
  await fetchProjection({
    retirements: [
      { personId: 1, month: '2035-06' },
      { personId: 2, month: '' }, // blank = that person works for the whole horizon
      { personId: 3, month: '2040-01' },
    ],
  })
  // Repeated, not comma-joined: FastAPI reads `retire` as a list, and a comma would be
  // one malformed value rather than two good ones.
  expect(path()).toBe('/projection?retire=1%3A2035-06&retire=3%3A2040-01')
})

it('keeps the knobs ahead of the retirements in the query', async () => {
  await fetchProjection({
    annualReturn: '0.07',
    years: '30',
    retirements: [{ personId: 2, month: '2035-06' }],
  })
  expect(path()).toBe('/projection?annual_return=0.07&years=30&retire=2%3A2035-06')
})

it('is still the bare projection when every retirement is blank', async () => {
  await fetchProjection({ retirements: [{ personId: 1, month: '' }] })
  expect(path()).toBe('/projection')
})
