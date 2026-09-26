import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/household', () => ({ fetchHousehold: vi.fn() }))
vi.mock('../../api/coverage', () => ({ fetchCoverage: vi.fn() }))
import { fetchCoverage } from '../../api/coverage'
import { fetchHousehold } from '../../api/household'
import { clearSnapshots, getSnapshot, setSnapshot } from '../../api/snapshotCache'
import { hintLabel } from '../InfoHint'
import type { HouseholdOut } from '../../types/api'
import ScopeBar, { HOUSEHOLD_SIZE_KEY, HOUSEHOLD_SNAPSHOT, type ScopeBarProps } from './ScopeBar'
import { copyOnSep23 } from '../../testing/timeFixtures'
import { setServerToday } from '../../utils/productToday'

function Url() {
  const l = useLocation()
  return <span data-testid="url">{l.pathname + l.search}</span>
}

function tree(props: Parameters<typeof ScopeBar>[0], entry: string) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="*" element={<><ScopeBar {...props} /><Url /></>} />
      </Routes>
    </MemoryRouter>
  )
}

function mount(props: Parameters<typeof ScopeBar>[0], entry = '/net-worth') {
  const result = render(tree(props, entry))
  return {
    ...result,
    /** Re-render the same page with new ScopeBar props (the wizard bumping `revalidate`). */
    rescope: (next: Parameters<typeof ScopeBar>[0]) => result.rerender(tree(next, entry)),
  }
}

// The primary is deliberately the HIGHER id, so a household that comes back in id order still
// has to be re-sorted primary-first for the chips to read Edward, Grace.
const HOUSEHOLD = {
  people: [{ id: 1, name: 'Grace', is_primary: false }, { id: 2, name: 'Edward', is_primary: true }],
  marriage_date: null,
}

const ALONE = { people: [{ id: 2, name: 'Edward', is_primary: true }], marriage_date: null }

// A page's override, in miniature (Portfolio's real one adds that performance is household-wide).
const OWNER_HINT = "A person's view is their own accounts plus the joint ones."
// The shell's own two sentences, spelled out again here on purpose: these tests pin the WORDS
// every owner page shows, not whatever the module happens to export.
const DEFAULT_JOINT =
  "A person's view is their own accounts plus the joint ones — that is what a joint account is. Joint shows only the shared accounts."
const DEFAULT_SOLO = 'Each person has their own view; nothing here is shared.'

beforeEach(() => {
  localStorage.clear()
  // The remembered household size lives here and jsdom keeps sessionStorage alive across
  // the tests in a file: one test's one-person book would silence the next one's ghost.
  sessionStorage.clear()
  clearSnapshots()
  vi.mocked(fetchHousehold).mockResolvedValue(HOUSEHOLD)
  vi.mocked(fetchCoverage).mockResolvedValue({
    balances: ['2026-07-01', '2026-08-01', '2026-09-01'],
    spending: ['2026-07-01'],
    net_pay: ['2026-07-01'],
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ScopeBar', () => {
  it('renders the owner chips only for a multi-person household, with Joint', async () => {
    mount({ owner: true })
    expect(await screen.findByRole('button', { name: 'Grace' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Joint' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Grace' }))
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/net-worth?owner=1'))
  })

  it('hides Joint when asked', async () => {
    mount({ owner: { joint: false } })
    await screen.findByRole('button', { name: 'Grace' })
    expect(screen.queryByRole('button', { name: 'Joint' })).toBeNull()
  })

  it('paints the seeded household, then swaps in the revalidated one and writes it back', async () => {
    setSnapshot(HOUSEHOLD_SNAPSHOT, HOUSEHOLD)
    const alone = { people: [{ id: 2, name: 'Edward', is_primary: true }], marriage_date: null }
    vi.mocked(fetchHousehold).mockResolvedValue(alone)
    mount({ owner: true })
    // Seeded: the chips are there in the first paint, before any fetch resolves.
    expect(screen.getByRole('group', { name: 'Whose' })).toBeTruthy()
    // Revalidated: one person is no choice at all, so the whole control goes away...
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Whose' })).toBeNull())
    // ...and the fresh payload is written back, so the next page seeds from the truth.
    expect(getSnapshot(HOUSEHOLD_SNAPSHOT)).toEqual(alone)
  })

  it('keeps the seeded chips when the household fetch fails', async () => {
    setSnapshot(HOUSEHOLD_SNAPSHOT, HOUSEHOLD)
    vi.mocked(fetchHousehold).mockRejectedValue(new Error('offline'))
    mount({ owner: true })
    await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
    expect(screen.getByRole('group', { name: 'Whose' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Grace' })).toBeTruthy()
  })

  it('re-runs both fetches when the revalidate key changes', async () => {
    const props = (revalidate: number) => ({
      owner: true,
      month: { mode: 'view' as const, anchor: '2026-09-01' },
      revalidate,
    })
    const view = mount(props(0))
    await waitFor(() => expect(fetchHousehold).toHaveBeenCalledTimes(1))
    expect(fetchCoverage).toHaveBeenCalledTimes(1)
    view.rescope(props(1))
    await waitFor(() => expect(fetchCoverage).toHaveBeenCalledTimes(2))
    expect(fetchHousehold).toHaveBeenCalledTimes(2)
  })

  it('hides All when asked and shows a null scope as the primary person', async () => {
    mount({ owner: { joint: false, all: false } })
    await screen.findByRole('button', { name: 'Grace' })
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Joint' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edward' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Grace' }))
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/net-worth?owner=1'))
  })

  it('presses the first chip for an owner this page offers no chip for', async () => {
    // ?owner=joint on a page whose owner set has no Joint chip: without the fallback the group
    // would render with nothing pressed at all.
    mount({ owner: { joint: false } }, '/net-worth?owner=joint')
    await screen.findByRole('button', { name: 'Grace' })
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('answers "Whose" itself when the page sends no sentence of its own', async () => {
    const { container } = mount({ owner: true })
    await screen.findByRole('button', { name: 'Grace' })
    // Beside the chips, not loose in the bar: the sentence explains THAT control.
    const hint = container.querySelector('.scope-bar-group button.info-hint')
    expect(hint?.getAttribute('aria-label')).toBe(hintLabel(DEFAULT_JOINT))
  })

  it('drops the Joint half of the default on a page with no Joint chip', async () => {
    const { container } = mount({ owner: { joint: false } })
    await screen.findByRole('button', { name: 'Grace' })
    expect(screen.queryByRole('button', { name: 'Joint' })).toBeNull()
    const hint = container.querySelector('.scope-bar-group button.info-hint')
    expect(hint?.getAttribute('aria-label')).toBe(hintLabel(DEFAULT_SOLO))
  })

  it("prints the page's own sentence in place of the default when it sends one", async () => {
    const { container, rescope } = mount({ owner: true, ownerHint: OWNER_HINT })
    await screen.findByRole('button', { name: 'Grace' })
    // One glyph, not two: the page's sentence REPLACES the shell's, it does not join it.
    expect(container.querySelectorAll('.scope-bar-group button.info-hint').length).toBe(1)
    // The button is named by its first four words now (motion spec §8) and the shell's default
    // answer opens with the very same four — so only the BUBBLE can tell them apart. Escape
    // after reading: a pinned bubble would make the next `getByRole('tooltip')` ambiguous.
    const sentence = () => {
      fireEvent.click(container.querySelector('button.info-hint') as HTMLElement)
      const text = screen.getByRole('tooltip').textContent
      fireEvent.keyDown(window, { key: 'Escape' })
      return text
    }
    expect(sentence()).toBe(OWNER_HINT)
    // Drop the prop and the shell's own sentence is back.
    rescope({ owner: true })
    expect(screen.getByRole('group', { name: 'Whose' })).toBeTruthy()
    expect(sentence()).toBe(DEFAULT_JOINT)
  })

  it('drops the owner hint with the chips for a one-person household', async () => {
    setSnapshot(HOUSEHOLD_SNAPSHOT, ALONE)
    vi.mocked(fetchHousehold).mockResolvedValue(ALONE)
    const { container } = mount({ owner: true, ownerHint: OWNER_HINT })
    await waitFor(() => expect(fetchHousehold).toHaveBeenCalled())
    // Nobody is asked whose view this is, so nobody is told what the answer would mean.
    expect(container.querySelector('.scope-bar')).toBeNull()
    expect(container.querySelector('button.info-hint')).toBeNull()
  })

  it('range chips write the URL and default to 1Y', () => {
    mount({ range: true })
    expect(screen.getByRole('button', { name: '1Y' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'YTD' }))
    expect(screen.getByTestId('url').textContent).toBe('/net-worth?range=ytd')
    expect(fetchHousehold).not.toHaveBeenCalled()
    expect(fetchCoverage).not.toHaveBeenCalled()
  })

  it('month (view): the ribbon selects into ?month= and Back to latest clears it', async () => {
    mount({ month: { mode: 'view', anchor: '2026-09-01', editHref: (m) => `/update?month=${m}` } })
    const july = await screen.findByRole('button', { name: /^Jul 2026 — balances and spending entered/ })
    fireEvent.click(july)
    expect(screen.getByTestId('url').textContent).toBe('/net-worth?month=2026-07')
    fireEvent.click(await screen.findByRole('button', { name: 'Back to latest' }))
    expect(screen.getByTestId('url').textContent).toBe('/net-worth')
  })

  it('month (view): no Back to latest without a month, nor on the latest covered one', async () => {
    mount({ month: { mode: 'view', anchor: '2026-09-01' } })
    // Sep has balances but no spending in the fixture; waiting on that label proves coverage landed.
    const sep = await screen.findByRole('button', { name: /^Sep 2026 — balances entered, spending missing/ })
    expect(screen.queryByRole('button', { name: 'Back to latest' })).toBeNull()
    fireEvent.click(sep)
    expect(screen.getByTestId('url').textContent).toBe('/net-worth?month=2026-09')
    expect(screen.queryByRole('button', { name: 'Back to latest' })).toBeNull()
  })

  it('month (view): the spending dot follows ENTERED months only — an empty month stays hollow', async () => {
    // Lane A's /coverage lists entered months in `spending` (honest-numbers spec §3): August
    // has no spending rows at all, September was saved as nineteen rows of $0.00. Neither
    // may light the dot, and nothing here may union the two gap lists back into the set —
    // that would put the old lie ("September has spending") straight back on the ribbon.
    vi.mocked(fetchCoverage).mockResolvedValue({
      balances: ['2026-07-01', '2026-08-01', '2026-09-01'],
      spending: ['2026-07-01'],
      net_pay: ['2026-07-01'],
      spending_empty: ['2026-09-01'],
      spending_missing: ['2026-08-01'],
      net_pay_missing: ['2026-08-01', '2026-09-01'],
      latest: { balances: '2026-09-01', spending: '2026-07-01', net_pay: '2026-07-01' },
    })
    mount({ month: { mode: 'view', anchor: '2026-09-01' } })

    const july = await screen.findByRole('button', {
      name: /^Jul 2026 — balances and spending entered/,
    })
    expect(july.classList.contains('has-spending')).toBe(true)
    for (const month of ['Aug 2026', 'Sep 2026']) {
      const chip = screen.getByRole('button', {
        name: new RegExp(`^${month} — balances entered, spending missing`),
      })
      expect(chip.classList.contains('has-balances')).toBe(true)
      expect(chip.classList.contains('has-spending')).toBe(false)
    }
  })

  it('month (view): the page\'s figures and Edit link reach the ribbon', async () => {
    mount(
      {
        month: {
          mode: 'view',
          anchor: '2026-09-01',
          editHref: (m) => `/update?month=${m}`,
          figures: { '2026-07-01': '$1.2M' },
        },
      },
      '/net-worth?month=2026-07',
    )
    const edit = await screen.findByRole('link', { name: /Edit Jul 2026/ })
    expect(edit.getAttribute('href')).toBe('/update?month=2026-07-01')
    expect(screen.getByRole('button', { name: /^Jul 2026 — \$1\.2M — / })).toBeTruthy()
  })

  it('month (edit): the ribbon navigates to the wizard', async () => {
    mount({ month: { mode: 'edit', anchor: '2026-09-01' } }, '/spending')
    fireEvent.click(await screen.findByRole('button', { name: /^Aug 2026/ }))
    expect(screen.getByTestId('url').textContent).toBe('/update?month=2026-08-01')
  })

  it('month (edit) with a page-owned handler: the wizard keeps the click and the selection', async () => {
    const onSelect = vi.fn()
    mount(
      { month: { mode: 'edit', anchor: '2026-09-01', selected: '2026-09-01', onSelect } },
      '/update?month=2026-09-01',
    )
    const aug = await screen.findByRole('button', { name: /^Aug 2026/ })
    expect(screen.getByRole('button', { name: /^Sep 2026/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(aug)
    expect(onSelect).toHaveBeenCalledWith('2026-08-01')
    expect(screen.getByTestId('url').textContent).toBe('/update?month=2026-09-01')
  })

  it('renders nothing at all when no control is declared', () => {
    const { container } = mount({})
    expect(container.querySelector('.scope-bar')).toBeNull()
  })
})

// A page whose ONLY scope control is the owner chips (Paycheck, Overview) has a 0px sticky row
// until the household answers and a ~50px one after: 66px of body travel, CLS 0.39 on the load
// that lost the race (motion lane V, 2026-09-05). These pin the reservation and what it costs.
describe('ScopeBar — the row reserves its height while the household loads', () => {
  /** The unknown state, held still: a household fetch that never answers. */
  const inFlight = () =>
    vi.mocked(fetchHousehold).mockReturnValue(new Promise<HouseholdOut>(() => {}))

  it('stands a ghost of the row while the household is unknown', () => {
    inFlight()
    const { container } = mount({ owner: { joint: false, all: false } })
    const ghost = container.querySelector('.scope-bar-ghost')
    expect(ghost).toBeTruthy()
    // A reserved box, not a control: nothing in it is announced, named or focusable.
    expect(ghost?.getAttribute('aria-hidden')).toBe('true')
    expect(ghost?.querySelector('button, [role]')).toBeNull()
    expect(container.querySelector('.scope-bar')).toBeNull()
  })

  it('stands no ghost for a page that declares no owner control', () => {
    inFlight()
    const { container } = mount({})
    expect(container.querySelector('.scope-bar-ghost')).toBeNull()
    expect(fetchHousehold).not.toHaveBeenCalled()
  })

  it('swaps the ghost for the real chips once the household lands', async () => {
    const { container } = mount({ owner: true })
    expect(container.querySelector('.scope-bar-ghost')).toBeTruthy()
    await screen.findByRole('group', { name: 'Whose' })
    // Replaced in place. jsdom lays nothing out, so the two HEIGHTS are pinned where they are
    // declared — one panels.css rule both selectors read (skeletonMetrics.test.ts).
    expect(container.querySelector('.scope-bar-ghost')).toBeNull()
    expect(container.querySelector('.scope-bar')).toBeTruthy()
  })

  it('skips the ghost when this tab already knows the household is one person', () => {
    sessionStorage.setItem(HOUSEHOLD_SIZE_KEY, '1')
    inFlight()
    const { container } = mount({ owner: true })
    // No chips are coming, so reserving room for them IS the shift — the other way up.
    expect(container.querySelector('.scope-bar-ghost')).toBeNull()
  })

  it('remembers the size it last saw, so a one-person book pays the ghost once per tab', async () => {
    vi.mocked(fetchHousehold).mockResolvedValue(ALONE)
    mount({ owner: true })
    await waitFor(() => expect(sessionStorage.getItem(HOUSEHOLD_SIZE_KEY)).toBe('1'))
  })

  it('leaves the row TRULY empty for a one-person household — what `:empty` hides', async () => {
    vi.mocked(fetchHousehold).mockResolvedValue(ALONE)
    const { container } = mount({ owner: true })
    await waitFor(() => expect(container.querySelector('.scope-bar-ghost')).toBeNull())
    // Not a 0-height node — NO node, which is what shell.css's `:empty` rule matches to keep
    // the sticky row from taking space and drawing its hairline over nothing.
    expect(container.querySelector('.scope-bar, .scope-bar-ghost')).toBeNull()
  })

  it('drops the ghost when the household fetch fails — a reserved box is not forever', async () => {
    vi.mocked(fetchHousehold).mockRejectedValue(new Error('offline'))
    const { container } = mount({ owner: true })
    expect(container.querySelector('.scope-bar-ghost')).toBeTruthy()
    await waitFor(() => expect(container.querySelector('.scope-bar-ghost')).toBeNull())
  })
})

// A late household must not push a visible range/ribbon onto another flex row. The owner
// placeholder uses the same width class as the real group, while the other controls stay usable.
describe('ScopeBar — reserves the owner slot in a combined bar', () => {
  const companions: { name: string; props: ScopeBarProps }[] = [
    { name: 'range', props: { range: true } },
    { name: 'month', props: { month: { mode: 'view', anchor: '2026-09-01' } } },
    { name: 'range and month', props: { range: true, month: { mode: 'view', anchor: '2026-09-01' } } },
  ]

  it.each(companions)('keeps $name controls in place when the delayed owner chips arrive', async ({ props }) => {
    let resolveHousehold!: (household: HouseholdOut) => void
    const pending = new Promise<HouseholdOut>((resolve) => { resolveHousehold = resolve })
    vi.mocked(fetchHousehold).mockReturnValue(pending)
    const { container } = mount({ owner: true, ...props })
    const bar = container.querySelector('.scope-bar')
    const ghost = bar?.querySelector('.scope-bar-owner.scope-bar-ghost')
    expect(ghost).toBeTruthy()
    expect(bar?.firstElementChild).toBe(ghost)
    expect(ghost?.getAttribute('aria-hidden')).toBe('true')
    expect(ghost?.querySelector('button, [role], [tabindex]')).toBeNull()
    const range = props.range ? screen.getByRole('group', { name: 'Time range' }) : null
    const month = props.month ? screen.getByRole('button', { name: /^Sep 2026/ }) : null
    if (range) fireEvent.click(screen.getByRole('button', { name: 'YTD' }))

    await act(async () => { resolveHousehold(HOUSEHOLD); await pending })

    const owners = screen.getByRole('group', { name: 'Whose' })
    expect(bar?.firstElementChild).toBe(owners.closest('.scope-bar-owner'))
    expect(container.querySelector('.scope-bar-ghost')).toBeNull()
    if (range) {
      expect(screen.getByRole('group', { name: 'Time range' })).toBe(range)
      expect(screen.getByRole('button', { name: 'YTD' }).getAttribute('aria-pressed')).toBe('true')
    }
    if (month) expect(screen.getByRole('button', { name: /^Sep 2026/ })).toBe(month)
  })

  it.each([
    { name: 'multi-person', household: HOUSEHOLD, showOwner: true },
    { name: 'one-person', household: ALONE, showOwner: false },
  ])('uses the cached $name household without a ghost during revalidation', ({ household, showOwner }) => {
    setSnapshot(HOUSEHOLD_SNAPSHOT, household)
    vi.mocked(fetchHousehold).mockReturnValue(new Promise<HouseholdOut>(() => {}))
    const { container } = mount({ owner: true, range: true })
    expect(container.querySelector('.scope-bar-ghost')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Whose' }) !== null).toBe(showOwner)
    expect(container.querySelector('.scope-bar-owner') !== null).toBe(showOwner)
  })

  it('reserves no owner width when this tab already knows the household is one person', () => {
    sessionStorage.setItem(HOUSEHOLD_SIZE_KEY, '1')
    vi.mocked(fetchHousehold).mockReturnValue(new Promise<HouseholdOut>(() => {}))
    const { container } = mount({ owner: true, range: true })
    expect(container.querySelector('.scope-bar-owner, .scope-bar-ghost')).toBeNull()
    expect(screen.getByRole('group', { name: 'Time range' })).toBeTruthy()
  })

  it.each(['one person', 'a failure'])('retires the owner slot when the first answer is %s', async (answer) => {
    vi.mocked(fetchHousehold).mockImplementation(() => answer === 'one person'
      ? Promise.resolve(ALONE)
      : Promise.reject(new Error('offline')))
    const { container } = mount({ owner: true, range: true })
    expect(container.querySelector('.scope-bar-owner.scope-bar-ghost')).toBeTruthy()
    await waitFor(() => expect(container.querySelector('.scope-bar-owner, .scope-bar-ghost')).toBeNull())
    expect(screen.queryByRole('group', { name: 'Whose' })).toBeNull()
    expect(screen.getByRole('group', { name: 'Time range' })).toBeTruthy()
  })
})

// 2026-09-23 spec §T12: Spending draws partly entered months from `time.flows_due`, and its only
// coverage read is this row's — the row hands each answer up rather than the page fetching twice.
describe('ScopeBar — hands the coverage it fetched to the page', () => {
  it('calls onCoverage with every answer it lands, from its one fetch', async () => {
    const onCoverage = vi.fn()
    const { rescope } = mount({ month: { mode: 'view', anchor: '2026-09-01' }, onCoverage })
    await waitFor(() => expect(onCoverage).toHaveBeenCalledTimes(1))
    expect(onCoverage.mock.calls[0][0].balances).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
    expect(fetchCoverage).toHaveBeenCalledTimes(1)
    // A revalidation lands a second answer, and the page hears it.
    rescope({ month: { mode: 'view', anchor: '2026-09-01' }, onCoverage, revalidate: 1 })
    await waitFor(() => expect(onCoverage).toHaveBeenCalledTimes(2))
  })

  it('fetches nothing for it without a month control', async () => {
    const onCoverage = vi.fn()
    mount({ range: true, onCoverage })
    await screen.findByRole('button', { name: '1Y' })
    expect(fetchCoverage).not.toHaveBeenCalled()
    expect(onCoverage).not.toHaveBeenCalled()
  })
})

// 2026-09-23 spec §T8: the ribbon ends at the current snapshot's month when it is ahead of today
// (an early next-month snapshot is a chip you can select) — never at balances filed further
// ahead; "Back to …" compares with the month the PAGE shows by default, and Edit opens the month
// on screen.
describe('ScopeBar — the view ribbon’s anchor, default month, Back and Edit (2026-09-23 spec §T8)', () => {
  const withTime = (balances: string[]) => {
    setServerToday('2026-09-23')
    vi.mocked(fetchCoverage).mockResolvedValue({
      balances,
      spending: ['2026-08-01', '2026-09-01'],
      net_pay: ['2026-08-01'],
      time: copyOnSep23(),
    })
  }
  const lastChip = () => {
    const chips = screen.getAllByRole('button', { name: /^[A-Z][a-z]{2} \d{4} — / })
    return chips[chips.length - 1].getAttribute('aria-label') ?? ''
  }

  it('ends the ribbon at the current snapshot’s month — an early Oct 1 is a chip to select', async () => {
    withTime(['2026-08-01', '2026-09-01', '2026-10-01'])
    mount({ month: { mode: 'view', editHref: (m) => `/update?month=${m}&step=balances` } })
    await waitFor(() => expect(lastChip()).toMatch(/^Oct 2026 — Oct 1 balances recorded early/))
    fireEvent.click(screen.getByRole('button', { name: /^Oct 2026/ }))
    expect(screen.getByTestId('url').textContent).toBe('/net-worth?month=2026-10')
  })

  it('never stretches to balances filed further ahead', async () => {
    withTime(['2026-08-01', '2026-09-01', '2026-10-01', '2026-12-01'])
    mount({ month: { mode: 'view' } })
    await waitFor(() => expect(lastChip()).toMatch(/^Oct 2026 — /))
  })

  it('hides "Back to …" on the page’s own default month and names it otherwise', async () => {
    withTime(['2026-08-01', '2026-09-01', '2026-10-01'])
    const month = { mode: 'view' as const, defaultMonth: '2026-10-01', backLabel: 'Back to latest balances' }
    const onDefault = mount({ month }, '/net-worth?month=2026-10')
    await screen.findByRole('button', { name: /^Oct 2026/ })
    expect(screen.queryByRole('button', { name: 'Back to latest balances' })).toBeNull()
    onDefault.unmount()
    mount({ month }, '/net-worth?month=2026-08')
    fireEvent.click(await screen.findByRole('button', { name: 'Back to latest balances' }))
    expect(screen.getByTestId('url').textContent).toBe('/net-worth')
  })

  // Review minor 12: null is the page saying it HAS no default month (a book with nothing current)
  // — so any selection offers the way back; only undefined (not said yet) falls back to the
  // newest covered month.
  it('reads an explicit null default month as "no default" — Back shows on any selection', async () => {
    withTime(['2026-08-01', '2026-09-01', '2026-10-01'])
    const none = mount({ month: { mode: 'view', defaultMonth: null } }, '/net-worth?month=2026-10')
    await screen.findByRole('button', { name: /^Oct 2026/ })
    expect(await screen.findByRole('button', { name: 'Back to latest' })).toBeTruthy()
    none.unmount()
    mount({ month: { mode: 'view' } }, '/net-worth?month=2026-10')
    await screen.findByRole('button', { name: /^Oct 2026/ })
    expect(screen.queryByRole('button', { name: 'Back to latest' })).toBeNull()
  })

  it('edits the month on screen: the selection, else the page’s default, at the page’s step', async () => {
    withTime(['2026-08-01', '2026-09-01', '2026-10-01'])
    const editHref = (m: string) => `/update?month=${m}&step=spending`
    mount({ month: { mode: 'view', defaultMonth: '2026-08-01', editHref } })
    const edit = await screen.findByRole('link', { name: 'Edit Aug 2026 in the wizard' })
    expect(edit.getAttribute('href')).toBe('/update?month=2026-08-01&step=spending')
  })
})
