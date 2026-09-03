import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ClipboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarPlus } from 'lucide-react'
import { ApiError } from '../api/client'
import {
  deleteMonthBalances,
  fetchAccounts,
  fetchMonthBalances,
  fetchTimeseries,
  putMonthBalances,
} from '../api/netWorth'
import { fetchHousehold } from '../api/household'
import { undoBatch } from '../api/lifecycle'
import {
  deleteSpendingMonth,
  fetchCategories,
  fetchMatrix,
  fetchSpendingMonth,
  putSpendingMonth,
} from '../api/spending'
import AmountInput from '../components/AmountInput'
import InfoHint from '../components/InfoHint'
import { useToast } from '../components/ToastProvider'
import { FeedBanner } from '../components/shell/Feed'
import PageFrame from '../components/shell/PageFrame'
import ScopeBar from '../components/shell/ScopeBar'
import { GROUP_LABELS, GROUP_ORDER } from '../charts/theme'
import type {
  AccountOut,
  CategoryOut,
  HouseholdOut,
  MonthUpsertResult,
  SpendingMatrix,
} from '../types/api'
import { nestComponents } from '../utils/accounts'
import { canonicalAmount, isAmount } from '../utils/amount'
import { formatCurrency, formatMonth, formatPct } from '../utils/format'
import { addMonths, currentMonthIso } from '../utils/months'
import { classifyPaste, matchLabel } from '../utils/paste'
import { typicalSpend } from '../utils/spending'
import '../components/panels.css'
import './MonthlyUpdatePage.css'

const STEPS = ['balances', 'spending', 'review'] as const
type Step = (typeof STEPS)[number]

// Terse chip labels — each step's card heading carries the full title ("Spending & net
// pay", "Review & save — Aug 2026"). The chips must NOT repeat a heading verbatim: the
// stepper renders on every step, so a duplicate makes "am I on the review step?" queries
// ambiguous (two matching nodes) and any assertion written against the chip vacuous.
const STEP_LABELS: Record<Step, string> = {
  balances: 'Balances',
  spending: 'Spending',
  review: 'Review',
}

function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}

// ── Unsaved-work drafts ──────────────────────────────────────────────────────────────
// The wizard's two losses were (a) any navigation away mid-entry — no route guard exists
// under a plain <BrowserRouter> — and (b) the mid-save 401, whose redirect destroyed the
// spending half after the balances PUT had landed. A continuously written sessionStorage
// draft closes both: it survives the SPA route change AND the full-page login redirect,
// and is restored (with a visible note) the next time this month is opened. sessionStorage,
// not localStorage, on purpose: a draft is "this sitting", and a week-old one silently
// resurrecting over fresh server data would be worse than the loss it prevents.

interface WizardDraft {
  balances: Record<string, string>
  amounts: Record<string, string>
  netPay: string
  recordedOn: string
  notes: string
}

const DRAFT_PREFIX = 'finance-update-draft:'

function draftKey(month: string): string {
  return `${DRAFT_PREFIX}${month}`
}

// One serialized shape for three jobs — the dirty comparison, the stored draft, the
// restore. Numeric keys serialize in ascending order (the JS integer-key law), so the
// same values always yield the same string regardless of setState spread order.
function snapshotOf(
  balances: Record<number, string>,
  amounts: Record<number, string>,
  netPay: string,
  recordedOn: string,
  notes: string,
): string {
  return JSON.stringify({ balances, amounts, netPay, recordedOn, notes })
}

function readDraft(month: string): { raw: string; draft: WizardDraft } | null {
  const raw = sessionStorage.getItem(draftKey(month))
  if (raw === null) return null
  try {
    const draft = JSON.parse(raw) as WizardDraft
    // A shape check, not a validator: a corrupt entry is discarded, never restored.
    if (typeof draft !== 'object' || draft === null) return null
    return { raw, draft }
  } catch {
    return null
  }
}

export default function MonthlyUpdatePage() {
  const [params, setParams] = useSearchParams()
  const month = params.get('month') ?? currentMonthIso()
  const stepParam = params.get('step')
  const step: Step = STEPS.includes(stepParam as Step) ? (stepParam as Step) : 'balances'

  const [accounts, setAccounts] = useState<AccountOut[]>([])
  const [categories, setCategories] = useState<CategoryOut[]>([])
  // Who lives in this household — the balance grid's outer grouping. Server-derived like
  // `matrix`, and deliberately NOT part of the draft snapshot.
  const [people, setPeople] = useState<HouseholdOut['people']>([])
  const [balances, setBalances] = useState<Record<number, string>>({})
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [netPay, setNetPay] = useState('')
  const [recordedOn, setRecordedOn] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [prevNetWorth, setPrevNetWorth] = useState<number | null>(null)
  // The prior month's per-account balances — the table's "Last month" column and the
  // reference every live Δ is measured against. The prior fetch already ran for the seed
  // and prevNetWorth; this keeps its per-account detail instead of discarding it.
  const [priorBalances, setPriorBalances] = useState<Record<number, string>>({})
  // The spending history behind the "Typical" column. Spending is a flow, so its cells
  // seed at 0.00 — this is the context a prefill would have to fake (spec §4.2).
  const [matrix, setMatrix] = useState<SpendingMatrix | null>(null)
  // Did the LOADED month carry a net pay? The tri-state rider's whole question: only a
  // value that existed on the server can be cleared, and only then is `null` sent.
  // Server-derived like `matrix` — deliberately NOT part of the draft snapshot.
  const [hadNetPay, setHadNetPay] = useState(false)
  // Resolved budgets for the month being entered (GET /spending/months payload) —
  // the "of {budget}" subtext's source; advice, never a gate (spec §4.1).
  const [monthBudgets, setMonthBudgets] = useState<Record<number, string>>({})
  const [monthExisted, setMonthExisted] = useState(false)
  const [coveredMonths, setCoveredMonths] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  // Bumped whenever THIS page changes what /coverage would say — a save fills a month, a
  // delete empties one — and handed to the scope row as `revalidate`, so the ribbon re-reads
  // coverage and the chip follows without leaving the page. (The legacy wizard got this for
  // free by reloading coverage on every month change; the shared ribbon fetches once, so the
  // page has to say when its coverage moved.)
  const [coverageNonce, setCoverageNonce] = useState(0)
  // A8 (2026-08-31 tier-1): the balances leg that already COMMITTED while its spending
  // sibling failed — the month, the exact canonical payload it shipped, and the server's
  // counts. A retry whose payload still matches skips the balances PUT (retry-only-the-
  // failed-leg, no new endpoint); an edit in between changes the payload string and
  // honestly re-sends balances instead of dropping the edit under a "saved" banner.
  // Cleared on month load and on a full save.
  const [balancesLeg, setBalancesLeg] = useState<{
    month: string
    payload: string
    result: MonthUpsertResult
  } | null>(null)
  // What the server seeded for the month on screen, serialized — the draft machinery's
  // reference point. Carries its OWN month so a mid-switch render can never write the old
  // month's values under the new month's key.
  const [baseline, setBaseline] = useState<{ month: string; data: string } | null>(null)
  // A draft was restored over the seed this load — the banner's flag.
  const [restored, setRestored] = useState(false)
  // Delete-month arm-and-confirm (2026-08-31 spec §B2): the typed YYYY-MM arms the red
  // button. loadNonce forces the load effect when the deleted month IS the month on
  // screen — the [month] dep alone would never re-run.
  const [deleteArm, setDeleteArm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [loadNonce, setLoadNonce] = useState(0)
  const toast = useToast()
  // What the last paste did, narrated for everyone (spec §4.1) — one line, replaced by the
  // next paste and dropped on any step or month change. The flashed ids are the cells it
  // wrote (input ids, e.g. 'bal-3'), so one Set serves both tables.
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set())

  // Both keys are always written together, so the step never loses the month (and any
  // unrelated query param a deep link carried survives the copy).
  const setStep = (next: Step) => {
    // The note narrates a fill on the step being LEFT, and the flash is a 700 ms beat on
    // cells that are about to unmount — neither may follow the user to the next step.
    setPasteNote(null)
    setFlashIds(new Set())
    setParams((current) => {
      const copy = new URLSearchParams(current)
      copy.set('month', month)
      copy.set('step', next)
      return copy
    })
  }

  // Promise callbacks, no setState in the effect's synchronous body
  // (react-hooks/set-state-in-effect) — same discipline as the module pages. Those
  // pages park this chain in a useCallback because their Retry button is a second
  // caller; here the effect is the only caller, so the chain lives inline: a
  // useCallback with 13 setters in its body is manual memoization React Compiler
  // cannot preserve (react-hooks/preserve-manual-memoization errors, and the whole
  // component drops out of compilation). The loading/saved/error flips for a MONTH
  // CHANGE live in the ribbon's onSelect handler; the mount fetch is covered by the
  // initial state values.
  useEffect(() => {
    // loadNonce has no data role: the wizard delete bumps it to force this chain when
    // the deleted month is the month already on screen.
    void loadNonce
    Promise.all([
      fetchAccounts(),
      fetchCategories(),
      fetchMonthBalances(month),
      fetchMonthBalances(addMonths(month, -1)),
      fetchSpendingMonth(month),
      fetchTimeseries(),
      // The Typical column is an entry AID, and '—' is its designed degraded state: a
      // matrix that fails must never take the whole wizard down with it, because the
      // month still has to be enterable without any history to compare against.
      fetchMatrix().catch((): SpendingMatrix | null => null),
      // The owner grouping is an entry AID like the Typical column: if the household
      // endpoint is down, the grid falls back to today's flat group walk rather than
      // refusing to render the month.
      fetchHousehold().catch((): HouseholdOut | null => null),
    ])
      .then(([
        accountList,
        categoryList,
        thisMonth,
        priorMonth,
        spendMonth,
        timeseries,
        matrixData,
        householdData,
      ]) => {
        setError(null)
        setSaved(null)
        setBalancesLeg(null)
        // Nested order: component inputs sit right after their aggregate's input
        // (the group filter below preserves it — components share the parent's group).
        const activeAccounts = nestComponents(accountList.filter((a) => a.is_active))
        setAccounts(activeAccounts)
        setCategories(categoryList.filter((c) => c.is_active))
        setMonthExisted(thisMonth.exists)
        setCoveredMonths(new Set(timeseries.months))
        setMatrix(matrixData)
        setPeople(householdData?.people ?? [])
        setHadNetPay(spendMonth.net_pay !== null)
        setMonthBudgets(
          Object.fromEntries(spendMonth.budgets.map((b) => [b.category_id, b.amount])),
        )

        // Pre-fill: the month's own values win; otherwise the prior month's (the sheet
        // ritual starts from last month's numbers); otherwise 0.00.
        const source = thisMonth.exists ? thisMonth.balances : priorMonth.balances
        const byId = new Map(source.map((b) => [b.account_id, b.balance]))
        const seededBalances = Object.fromEntries(
          activeAccounts.map((a) => [a.id, byId.get(a.id) ?? '0.00']),
        )
        // Reset on EVERY month load — stale notes/date must never leak into another
        // month's save (the next PUT would silently write them there).
        const seededRecordedOn =
          thisMonth.exists && thisMonth.recorded_on ? thisMonth.recorded_on : todayIso()
        const seededNotes = thisMonth.exists && thisMonth.notes ? thisMonth.notes : ''

        const prevSum = priorMonth.exists
          ? priorMonth.balances.reduce((acc, b) => {
              const account = accountList.find((a) => a.id === b.account_id)
              return account && !account.is_component ? acc + Number(b.balance) : acc
            }, 0)
          : null
        setPrevNetWorth(prevSum)
        setPriorBalances(
          priorMonth.exists
            ? Object.fromEntries(priorMonth.balances.map((b) => [b.account_id, b.balance]))
            : {},
        )

        const activeCategories = categoryList.filter((c) => c.is_active)
        const spendById = new Map(spendMonth.amounts.map((a) => [a.category_id, a.amount]))
        const seededAmounts = Object.fromEntries(
          activeCategories.map((c) => [c.id, spendById.get(c.id) ?? '0.00']),
        )
        const seededNetPay = spendMonth.net_pay ?? ''

        // A stored draft that differs from the seed is unsaved work — restore it over the
        // seed (per field, keyed by id, so an account added since the draft still seeds).
        // One that MATCHES the seed is a leftover with nothing to say and is dropped.
        const seedSnapshot = snapshotOf(
          seededBalances,
          seededAmounts,
          seededNetPay,
          seededRecordedOn,
          seededNotes,
        )
        const stored = readDraft(month)
        const draft = stored !== null && stored.raw !== seedSnapshot ? stored.draft : null
        if (stored !== null && draft === null) sessionStorage.removeItem(draftKey(month))
        setBalances(
          draft
            ? Object.fromEntries(
                activeAccounts.map((a) => [
                  a.id,
                  draft.balances?.[String(a.id)] ?? seededBalances[a.id],
                ]),
              )
            : seededBalances,
        )
        setAmounts(
          draft
            ? Object.fromEntries(
                activeCategories.map((c) => [
                  c.id,
                  draft.amounts?.[String(c.id)] ?? seededAmounts[c.id],
                ]),
              )
            : seededAmounts,
        )
        setNetPay(draft ? (draft.netPay ?? seededNetPay) : seededNetPay)
        setRecordedOn(draft ? (draft.recordedOn ?? seededRecordedOn) : seededRecordedOn)
        setNotes(draft ? (draft.notes ?? seededNotes) : seededNotes)
        setBaseline({ month, data: seedSnapshot })
        setRestored(draft !== null)
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load month data')
      })
      .finally(() => setLoading(false))
  }, [month, loadNonce])

  // Persist typed-but-unsaved work continuously: the draft is written on every edit and
  // deleted the moment the boxes match the seed again, so storage always mirrors "what
  // would be lost". Gated on the BASELINE's month (never the URL's) and on loading — a
  // mid-switch render still holds the old month's values under the new month's URL, and
  // this is what keeps them from being filed under the wrong key. No setState here, so
  // the effect-body rule has nothing to say.
  useEffect(() => {
    if (loading || baseline === null || baseline.month !== month) return
    const current = snapshotOf(balances, amounts, netPay, recordedOn, notes)
    if (current === baseline.data) {
      sessionStorage.removeItem(draftKey(baseline.month))
    } else {
      sessionStorage.setItem(draftKey(baseline.month), current)
    }
  }, [balances, amounts, netPay, recordedOn, notes, baseline, month, loading])

  // The flash is a one-shot: the timer callback clears it, so the effect body itself never
  // sets state (a set here would re-run the effect on its own write).
  useEffect(() => {
    if (flashIds.size === 0) return
    const timer = setTimeout(() => setFlashIds(new Set()), 700)
    return () => clearTimeout(timer)
  }, [flashIds])

  // Back to the server's seed, forgetting the draft — the restore banner's exit.
  const discardDraft = () => {
    if (baseline === null || baseline.month !== month) return
    const seed = JSON.parse(baseline.data) as WizardDraft
    setBalances(seed.balances as Record<number, string>)
    setAmounts(seed.amounts as Record<number, string>)
    setNetPay(seed.netPay)
    setRecordedOn(seed.recordedOn)
    setNotes(seed.notes)
    setRestored(false)
    sessionStorage.removeItem(draftKey(month))
  }

  // Every wizard cell is an AmountInput of the default kind="money", so the page's
  // option-less isAmount/canonicalAmount (expressions ON) agree with what the component
  // accepts and commits. A non-money cell added here must switch BOTH sides to
  // { expressions: false }, or the page would green-light an "=" the box never evaluates.
  const balancesValid = accounts.every((a) => isAmount(balances[a.id] ?? ''))
  const amountsValid =
    categories.every((c) => isAmount(amounts[c.id] ?? '')) &&
    (netPay.trim() === '' || isAmount(netPay))

  // Sums the COMMITTED values, not the raw ones: a cell still holding "$1,600" or "=200+50"
  // (no blur yet — jsdom clicks and Ctrl+Enter never fire one) would read as NaN → 0 and
  // preview a wrong net worth for the number that is about to be saved.
  const preview = useMemo(() => {
    const netWorth = accounts.reduce(
      (acc, a) =>
        a.is_component ? acc : acc + (Number(canonicalAmount(balances[a.id] ?? '')) || 0),
      0,
    )
    const totalSpend = categories.reduce(
      (acc, c) => acc + (Number(canonicalAmount(amounts[c.id] ?? '')) || 0),
      0,
    )
    const pay = netPay.trim() === '' ? null : Number(canonicalAmount(netPay))
    // CENTS decide this delta, and it is load-bearing twice over: it feeds the sticky
    // footer AND the review step, where the ▲/▼ glyph is picked from `delta >= 0`. Both
    // sides are sums of ~26 doubles, so a CONSERVING transfer between two accounts lands a
    // few ulp off zero rather than on it. The rounded zero is forced POSITIVE, because -0
    // formats as "-$0.00" while `-0 >= 0` still picks ▲ — glyph and text must agree.
    const deltaCents = prevNetWorth === null ? null : Math.round((netWorth - prevNetWorth) * 100)
    return {
      netWorth,
      delta: deltaCents === null ? null : deltaCents === 0 ? 0 : deltaCents / 100,
      totalSpend,
      savings: pay === null || pay === 0 ? null : (pay - totalSpend) / pay,
    }
  }, [accounts, balances, categories, amounts, netPay, prevNetWorth])

  // Undo (2026-09-03 data-lifecycle spec §9): the spending batch, then the balances batch —
  // the reverse of the save's order — each its own request; the first failure stops the
  // sequence and its sentence is shown. `after` runs on success (reload, or return to the month).
  const undoBatches = async (batchIds: (string | null)[], done: string, after: () => void) => {
    try {
      for (const id of batchIds) if (id !== null) await undoBatch(id)
      toast.success(done)
      after()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Undo failed')
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    // The green card carries the PREVIOUS attempt's counts. Leaving it up while this attempt
    // runs would let a failure render two contradicting verdicts for one month — a stale
    // "Month saved" beside the split-save alert. One attempt, one banner.
    setSaved(null)
    // canonicalAmount, not .trim(): a cell committed by blur is already canonical, but a save
    // reached without one (Ctrl+Enter, or a click in jsdom) must not ship "$1,600.00" or
    // "=200+50" to a Decimal column. Computed ONCE, then spent three ways — the wire, the
    // boxes and the baseline — which is what keeps those three from drifting apart below.
    // `?? ''` so a key missing from the record can never throw inside the payload builder.
    const canonBalances: Record<number, string> = Object.fromEntries(
      accounts.map((a) => [a.id, canonicalAmount(balances[a.id] ?? '')]),
    )
    const canonAmounts: Record<number, string> = Object.fromEntries(
      categories.map((c) => [c.id, canonicalAmount(amounts[c.id] ?? '')]),
    )
    const canonNetPay = netPay.trim() === '' ? '' : canonicalAmount(netPay)
    // A8: everything the balances PUT would ship, serialized — the "is this a PURE retry?"
    // comparison. Numeric keys serialize in ascending order (snapshotOf's law), so equal
    // values always compare equal.
    const balancesPayload = JSON.stringify({ balances: canonBalances, recordedOn, notes })
    // Which PUT is in flight — the catch words the banner by the leg that actually failed.
    let leg: 'balances' | 'spending' = 'balances'
    try {
      let balanceResult: MonthUpsertResult
      if (
        balancesLeg !== null &&
        balancesLeg.month === month &&
        balancesLeg.payload === balancesPayload
      ) {
        // The balances PUT already landed for exactly this payload — skip it and reuse
        // its counts (they describe the PUT that actually ran).
        balanceResult = balancesLeg.result
      } else {
        balanceResult = await putMonthBalances(month, {
          recorded_on: recordedOn === '' ? undefined : recordedOn,
          // null (not undefined): blanking the field must CLEAR a previously saved note.
          notes: notes.trim() === '' ? null : notes,
          balances: accounts.map((a) => ({ account_id: a.id, balance: canonBalances[a.id] })),
        })
        setBalancesLeg({ month, payload: balancesPayload, result: balanceResult })
      }
      leg = 'spending'
      const body: {
        net_pay?: string | null
        amounts: { category_id: number; amount: string }[]
      } = {
        amounts: categories.map((c) => ({ category_id: c.id, amount: canonAmounts[c.id] })),
      }
      if (netPay.trim() !== '') {
        body.net_pay = canonNetPay
      } else if (hadNetPay) {
        // Tri-state rider (spec §4.2): blanking a previously saved net pay must CLEAR it —
        // omitting would silently keep the stale figure in every savings-rate denominator.
        body.net_pay = null
      }
      const spendResult = await putSpendingMonth(month, body)
      setBalancesLeg(null)
      setSaved(
        `Balances: ${balanceResult.created} added, ${balanceResult.updated} changed, ` +
          `${balanceResult.unchanged} unchanged. Spending: ${spendResult.created} added, ` +
          `${spendResult.updated} changed, ${spendResult.unchanged} unchanged.` +
          // A DELETION the user asked for by blanking a box: the counts sentence above
          // never mentions the cashflow row that just went away, so the confirmation says
          // it — and says it from the server's own flag, not from what we hoped we sent.
          (spendResult.net_pay_cleared ? ' Household take-home cleared.' : ''),
      )
      const saveBatches = [spendResult.batch_id ?? null, balanceResult.batch_id ?? null]
      if (saveBatches.some((id) => id !== null)) {
        toast.success(
          `Saved ${formatMonth(month)} — ${balanceResult.created + balanceResult.updated} balances updated`,
          {
            action: {
              label: 'Undo',
              onAction: () =>
                void undoBatches(saveBatches, `Undone — ${formatMonth(month)} is back to how it was.`, () => {
                  setLoading(true)
                  setLoadNonce((n) => n + 1)
                }),
            },
          },
        )
      }
      // Coverage moved: this month now has both feeds. Tell the scope row to re-read it.
      setCoverageNonce((n) => n + 1)
      // What the wire received IS what the boxes now hold. Adopting the canonical values
      // into the STATE as well as the baseline is load-bearing: a cell advanced past by
      // clicks still held raw text ("9,000"), and a baseline taken from that raw state
      // would differ from the "9000" the next focus+blur commits — filing a draft for
      // fully saved work, so the following visit announced "Restored unsaved entries —
      // they are not saved yet" about nothing. Canonical on both sides makes that blur a
      // no-op, and the draft effect deletes the stored copy on the same render.
      setBalances(canonBalances)
      setAmounts(canonAmounts)
      setNetPay(canonNetPay)
      // The server's state is now what we just sent: a cleared month has no net pay to
      // clear twice, and a freshly typed one becomes clearable without a reload.
      setHadNetPay(canonNetPay !== '')
      setBaseline({
        month,
        data: snapshotOf(canonBalances, canonAmounts, canonNetPay, recordedOn, notes),
      })
      setRestored(false)
    } catch (err) {
      if (leg === 'spending') {
        // Truth-telling (A8): the balances PUT COMMITTED before this failure — the old
        // "nothing was lost" banner lied in both directions. State remembers the landed
        // leg, so the primary (now "Retry spending") re-attempts only what failed.
        setError('Balances saved. Spending failed — Retry saves only spending.')
      } else {
        setError(err instanceof ApiError ? err.message : 'Saving failed — nothing was lost, retry')
      }
    } finally {
      setSaving(false)
    }
  }

  // Each leg tolerates ITS OWN 404 — a balances-only month must still fully clear, and
  // the mirror case too — but any other failure surfaces and stops the sequence (a retry
  // re-runs both; the leg that already succeeded then 404s and is tolerated).
  const tolerate404 = async <T,>(call: Promise<T>): Promise<T | null> => {
    try {
      return await call
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  }

  const deleteMonth = async () => {
    setDeleting(true)
    setError(null)
    try {
      // Named *Delete, not *Leg: `balancesLeg` is already this component's remembered
      // half-landed SAVE (the A8 retry), and shadowing it here would read as the same thing.
      const balancesDelete = await tolerate404(deleteMonthBalances(month))
      const spendingDelete = await tolerate404(deleteSpendingMonth(month))
      sessionStorage.removeItem(draftKey(month))
      const deleted = month
      const deleteBatches = [spendingDelete?.batchId ?? null, balancesDelete?.batchId ?? null]
      toast.success(
        `Deleted ${formatMonth(month)} — balances and spending removed.`,
        deleteBatches.some((id) => id !== null)
          ? {
              action: {
                label: 'Undo',
                onAction: () =>
                  void undoBatches(deleteBatches, `Undone — ${formatMonth(deleted)} is back.`, () => {
                    // Back to the undone month's wizard; the nonce covers the same-month case.
                    setLoading(true)
                    setLoadNonce((n) => n + 1)
                    setParams(() => new URLSearchParams({ month: deleted, step: 'balances' }))
                  }),
              },
            }
          : undefined,
      )
      setDeleteArm('')
      setSaved(null)
      // A8 adaptation: a remembered half-landed save describes rows that no longer exist —
      // leaving it would keep the primary reading "Retry spending" for a deleted month.
      setBalancesLeg(null)
      setRestored(false)
      setLoading(true)
      // Land on the CURRENT month's wizard; the nonce covers the deleted-month ===
      // current-month case, where the month param does not change.
      setLoadNonce((n) => n + 1)
      // Coverage moved the other way: the deleted month has no feeds left, so its chip has to
      // empty. loadNonce only re-seeds the FORM — the shared ribbon needs its own word.
      setCoverageNonce((n) => n + 1)
      setParams(() => new URLSearchParams({ month: currentMonthIso(), step: 'balances' }))
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Delete failed: ${err.message} — retry`
          : 'Delete failed — retry',
      )
    } finally {
      setDeleting(false)
    }
  }

  const stepIndex = STEPS.indexOf(step)

  // Month change refetches via the [month] dep — flip the fetch state here, in the
  // event handler, never in the effect (react-hooks/set-state-in-effect). Same-month
  // click: the [month] effect would never re-run, so an unconditional setLoading(true)
  // would blank the wizard forever.
  const selectMonth = (m: string) => {
    if (m === month) return
    setLoading(true)
    setError(null)
    setSaved(null)
    // The banner describes the month being LEFT; the new load re-derives it. The typed
    // work itself needs no goodbye — the draft effect has been persisting it all along.
    setRestored(false)
    // Same reason the step change clears them: the note counts the OLD month's rows.
    setPasteNote(null)
    setDeleteArm('')
    setFlashIds(new Set())
    setParams(() => new URLSearchParams({ month: m, step: 'balances' }))
  }

  // The ribbon anchors one month PAST the latest covered month once the current month
  // is filled: chips end at the anchor, so otherwise "add next month" is impossible
  // until the calendar rolls over (the sheet's next-empty-row affordance, ported).
  const current = currentMonthIso()
  const latestCovered = [...coveredMonths].sort().at(-1)
  const nextEntryMonth = latestCovered === undefined ? current : addMonths(latestCovered, 1)
  const anchor = nextEntryMonth > current ? nextEntryMonth : current

  // The balance grid's outer grouping. ONE person (or a household endpoint that failed)
  // means one unlabelled section holding every account — byte-identical to the pre-owner
  // rendering, which is what keeps this page's whole existing test suite honest.
  const ownerSections = useMemo<{ key: string; label: string | null; rows: AccountOut[] }[]>(() => {
    if (people.length < 2) return [{ key: 'all', label: null, rows: accounts }]
    const ordered = [...people].sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id,
    )
    // nestComponents is re-run PER SECTION on purpose: a component whose parent sits in
    // another owner's bucket keeps its own position, which is exactly that helper's
    // documented contract for an absent parent.
    const sections = ordered.map((person) => ({
      key: `p${person.id}`,
      label: person.name,
      rows: nestComponents(accounts.filter((a) => a.person_id === person.id)),
    }))
    sections.push({
      key: 'joint',
      label: 'Joint',
      rows: nestComponents(accounts.filter((a) => a.person_id === null)),
    })
    // An owner with nothing to enter gets no header and no subtotal row.
    return sections.filter((section) => section.rows.length > 0)
  }, [accounts, people])

  // The balances rows in RENDERED order — the same walk the table below performs. Hoisted
  // because three things must agree on it: the autofocus target, the Enter/arrow protocol's
  // DOM order, and where a positional paste puts its first value. Deriving it twice is how
  // those three drift apart.
  const orderedBalanceRows = ownerSections.flatMap((section) =>
    GROUP_ORDER.flatMap((g) => section.rows.filter((a) => a.group === g)),
  )
  const firstBalanceId = orderedBalanceRows[0]?.id

  // Range paste (spec §4.1): the PARENT owns the entry state, so the scope container does
  // the filling — an AmountInput cannot write its siblings. A single-cell clipboard
  // classifies as null and falls through to native insertion, which the tolerant parse
  // already handles. Pasted text lands RAW, exactly as if typed: garbage shows the standard
  // .invalid, and canonicalAmount at the wire boundary is still what the server sees. The
  // draft effect watches the same state, so pasted work is persisted the moment it lands —
  // and the draft-discard affordance is therefore also paste's undo (no new undo system).
  const handlePaste = (
    e: ClipboardEvent<HTMLDivElement>,
    rows: { id: number; name: string }[],
    idOf: (rowId: number) => string,
    setRecord: (updater: (cur: Record<number, string>) => Record<number, string>) => void,
  ) => {
    const cell = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-entry-cell]')
    // A paste that lands in a NON-cell field is that field's own: the Notes box legitimately
    // takes multi-line text, and hijacking it would swallow the note AND scatter its lines
    // across the balance cells. A paste with no input under it at all still fills from the
    // top — that is a click on the table itself, which has nowhere better to start.
    if (cell === null && (e.target as HTMLElement).closest('input, textarea') !== null) return
    const plan = classifyPaste(e.clipboardData.getData('text/plain'))
    if (plan === null) return
    e.preventDefault()
    const fills: Record<number, string> = {}
    const flashed = new Set<string>()
    const unmatched: string[] = []
    let overflow = 0
    // An empty pasted cell SKIPS its target instead of blanking it: a stray trailing tab
    // must never wipe a figure that is already entered.
    let blank = 0
    if (plan.mode === 'positional') {
      // Fill from the pasted-into cell onward, down the rendered column — the way Enter
      // walks it. The net-pay box is outside the table and so is never a fill target (a
      // keyed paste cannot reach it either: accounts/categories only, spec §4.1).
      const ids = rows.map((row) => idOf(row.id))
      const startAt = cell === null ? 0 : Math.max(0, ids.indexOf(cell.id))
      plan.values.forEach((value, i) => {
        const slot = startAt + i
        if (slot >= rows.length) {
          overflow += 1
          return
        }
        // The slot is consumed either way — a skipped blank must not shift the rest up.
        // (classifyPaste drops empty cells from a positional plan today; this keeps the
        // rule true of the array itself rather than of one caller's luck.)
        if (value === '') {
          blank += 1
          return
        }
        fills[rows[slot].id] = value
        flashed.add(ids[slot])
      })
    } else {
      for (const { label, value } of plan.rows) {
        const id = matchLabel(rows, label)
        if (id === null) {
          unmatched.push(label)
        } else if (value === '') {
          blank += 1
        } else {
          fills[id] = value
          flashed.add(idOf(id))
        }
      }
      overflow = plan.skipped
    }
    if (Object.keys(fills).length > 0) setRecord((cur) => ({ ...cur, ...fills }))
    setFlashIds(flashed)
    const parts = [`Pasted ${Object.keys(fills).length} of ${rows.length} values`]
    if (unmatched.length > 0) {
      const shown = unmatched.slice(0, 4).join(', ')
      const more = unmatched.length > 4 ? `, +${unmatched.length - 4} more` : ''
      parts.push(`${unmatched.length} unmatched: ${shown}${more}`)
    }
    if (overflow > 0) parts.push(`${overflow} value${overflow === 1 ? '' : 's'} didn't fit`)
    if (blank > 0) parts.push(`${blank} blank${blank === 1 ? '' : 's'} skipped`)
    setPasteNote(parts.join(' · '))
  }

  // Committed value of one cell for the live columns — the preview memo's rule.
  const committed = (raw: string | undefined) => Number(canonicalAmount(raw ?? '')) || 0

  // A1: negate a liability cell in place — a STRING flip on the canonical form, never
  // float round-tripping (a re-serialized double could alter digits). Only reachable
  // while the committed value is > 0, so the result is always the negative twin; the
  // setBalances write marks the draft dirty exactly like typing would.
  const flipSign = (accountId: number) =>
    setBalances((cur) => {
      const canon = canonicalAmount(cur[accountId] ?? '')
      return { ...cur, [accountId]: canon.startsWith('-') ? canon.slice(1) : `-${canon}` }
    })

  // Live subtotal + its prior twin for ANY row set (components excluded, exactly like net
  // worth) — one helper now serves the per-group rows and the per-owner section above them.
  // DELIBERATE scope divergence, not an oversight: prevNetWorth (and so the footer's "vs
  // prior month") reduces over the RAW accountList — inactive accounts included — because
  // that is the true net-worth delta; these subtotals and the Last-month column cover the
  // ACTIVE rows on screen only, because they are an entry aid. "Fixing" the footer to
  // match active-only would falsify the delta the month is actually judged by.
  const subtotalOf = (rows: AccountOut[]) => {
    const counted = rows.filter((a) => !a.is_component)
    const now = counted.reduce((acc, a) => acc + committed(balances[a.id]), 0)
    const prior = counted.reduce(
      (acc, a) => acc + (priorBalances[a.id] === undefined ? 0 : Number(priorBalances[a.id])),
      0,
    )
    return { now, prior }
  }

  return (
    <div className="page">
      <PageFrame
        title={`Monthly update — ${formatMonth(month)}`}
        subheader={
          <div className="wizard-steps">
            {STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                className={`wizard-step${s === step ? ' active' : ''}`}
                onClick={() => setStep(s)}
              >
                <span className="step-index">{i + 1}</span>
                {STEP_LABELS[s]}
              </button>
            ))}
          </div>
        }
        scopeRow={
          <>
            {/* Edit mode: the wizard owns the click, because only it knows about the draft
                being typed into the month the user is leaving. */}
            <ScopeBar
              month={{ mode: 'edit', anchor, selected: month, onSelect: selectMonth }}
              revalidate={coverageNonce}
            />
            {!coveredMonths.has(anchor) && month !== anchor && (
              <button className="button" onClick={() => selectMonth(anchor)}>
                <CalendarPlus size={15} /> Start {formatMonth(anchor)}
              </button>
            )}
          </>
        }
        // The wizard is a FORM, not a feed: its own `loading` gates the step bodies below and
        // its errors are save failures, not a lifecycle the frame could retry.
        resource={{ status: 'ready' }}
      >
        <FeedBanner error={error} />
        {restored && (
          // Advisory, not an error: nothing failed — work was preserved. The discard button
          // is the only way to decline it; saving is the way to accept it.
          <div className="draft-note" role="status">
            <span>
              Restored unsaved entries for {formatMonth(month)} — they are not saved yet.
            </span>
            <button type="button" className="button" onClick={discardDraft}>
              Discard restored entries
            </button>
          </div>
        )}
        {saved && (
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h2 className="eyebrow">Month saved</h2>
            <p>{saved}</p>
            <p>
              <Link to="/net-worth">See net worth</Link> · <Link to="/spending">See spending</Link>
            </p>
          </div>
        )}

        {!loading && step === 'balances' && (
          <div
            className="card"
            data-entry-scope=""
            onPaste={(e) => handlePaste(e, orderedBalanceRows, (id) => `bal-${id}`, setBalances)}
          >
            <h2 className="eyebrow">
              {monthExisted ? 'Edit balances' : 'Enter balances (pre-filled from last month)'}
              <InfoHint text="Every account&apos;s balance for the month, pre-filled from the prior month; components are tracked inside their parent." />
            </h2>
            <div className="meta-row">
              <label>
                Recorded on
                <input
                  type="date"
                  className="field-input"
                  value={recordedOn}
                  onChange={(e) => setRecordedOn(e.target.value)}
                />
              </label>
              <label>
                Notes
                <input
                  type="text"
                  className="field-input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="optional"
                />
              </label>
            </div>
            {/* One table, not a card per group: cells sit in a single visual column so the
                Phase 1 Enter/arrow protocol (DOM order = this GROUP_ORDER walk) goes straight
                down, the way the sheet's muscle memory expects (spec §4.2). */}
            <table className="data-table entry-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="num entry-ref">Last month</th>
                  <th className="num">This month</th>
                  <th className="num entry-delta">Δ</th>
                </tr>
              </thead>
              <tbody>
                {ownerSections.map((section) => {
                  const ownerTotals = subtotalOf(section.rows)
                  // Same cents rule as every other subtotal here.
                  const ownerCents = Math.round((ownerTotals.now - ownerTotals.prior) * 100)
                  return (
                    <Fragment key={section.key}>
                      {section.label !== null && (
                        <tr className="entry-owner-row">
                          <th colSpan={4}>{section.label}</th>
                        </tr>
                      )}
                      {GROUP_ORDER.map((group) => {
                        const groupAccounts = section.rows.filter((a) => a.group === group)
                        if (groupAccounts.length === 0) return null
                        const totals = subtotalOf(groupAccounts)
                        // Same cents rule as the footer's delta above (and the spending Δ
                        // below): two sums of doubles that ought to cancel can miss by a few
                        // ulp, and this row is exactly where a conserving transfer shows up.
                        // Text only — the subtotal Δ carries no tone class, so rounding here
                        // fixes the "-$0.00".
                        const subCents = Math.round((totals.now - totals.prior) * 100)
                        return (
                          <Fragment key={group}>
                            <tr className="entry-group-row">
                              <th colSpan={4}>{GROUP_LABELS[group]}</th>
                            </tr>
                            {groupAccounts.map((account) => {
                              const value = balances[account.id] ?? ''
                              const prior = priorBalances[account.id]
                              const delta =
                                prior === undefined ? null : committed(value) - Number(prior)
                              return (
                                <tr key={account.id}>
                                  <td
                                    className={account.is_component ? 'entry-component' : undefined}
                                  >
                                    <label htmlFor={`bal-${account.id}`}>
                                      {account.name}
                                      {account.is_component && (
                                        <span className="badge">component</span>
                                      )}
                                    </label>
                                  </td>
                                  <td className="num entry-ref">
                                    {prior === undefined ? '—' : formatCurrency(prior)}
                                  </td>
                                  <td className="num entry-cell-col">
                                    <AmountInput
                                      id={`bal-${account.id}`}
                                      className={
                                        `${isAmount(value) ? '' : 'invalid'}${
                                          flashIds.has(`bal-${account.id}`) ? ' pasted-flash' : ''
                                        }`.trim() || undefined
                                      }
                                      autoFocus={account.id === firstBalanceId}
                                      value={value}
                                      onValueChange={(next) =>
                                        setBalances((cur) => ({ ...cur, [account.id]: next }))
                                      }
                                    />
                                    {/* A1 (2026-08-31 tier-1): advisory amber, NEVER a gate —
                                        a card can legitimately go positive after a refund, so
                                        Next/Save stay enabled and the table hint below keeps
                                        stating the sign convention. */}
                                    {account.group === 'liability' && committed(value) > 0 && (
                                      <span className="entry-liability-cue" role="status">
                                        liabilities are entered negative
                                        <button
                                          type="button"
                                          className="button"
                                          aria-label={`Flip sign on ${account.name}`}
                                          onClick={() => flipSign(account.id)}
                                        >
                                          Flip sign
                                        </button>
                                      </span>
                                    )}
                                  </td>
                                  <td
                                    className={`num entry-delta${
                                      delta === null || delta === 0
                                        ? ''
                                        : delta > 0
                                          ? ' delta-positive'
                                          : ' delta-negative'
                                    }`}
                                  >
                                    {/* Typo tripwire: a fat-fingered digit shows a huge Δ instantly. */}
                                    {delta === null ? '—' : formatCurrency(delta)}
                                  </td>
                                </tr>
                              )
                            })}
                            <tr className="entry-subtotal-row">
                              <td>Subtotal</td>
                              {/* No prior month at all (the first-ever entry) means there is
                                  no prior subtotal — '—', never a fabricated $0.00 that would
                                  read as "you had nothing" and make every Δ look like pure
                                  growth. Per-row cells already say '—' via the missing
                                  priorBalances. */}
                              <td className="num entry-ref">
                                {prevNetWorth === null ? '—' : formatCurrency(totals.prior)}
                              </td>
                              <td className="num">{formatCurrency(totals.now)}</td>
                              <td className="num entry-delta">
                                {prevNetWorth === null
                                  ? '—'
                                  : formatCurrency(subCents === 0 ? 0 : subCents / 100)}
                              </td>
                            </tr>
                          </Fragment>
                        )
                      })}
                      {/* The owner total sits a LEVEL ABOVE the group subtotals — coarser,
                          not a replacement — and closes its section the way every subtotal in
                          this table follows the rows it sums. */}
                      {section.label !== null && (
                        <tr className="entry-owner-subtotal-row">
                          <td>{section.label} total</td>
                          <td className="num entry-ref">
                            {prevNetWorth === null ? '—' : formatCurrency(ownerTotals.prior)}
                          </td>
                          <td className="num">{formatCurrency(ownerTotals.now)}</td>
                          <td className="num entry-delta">
                            {prevNetWorth === null
                              ? '—'
                              : formatCurrency(ownerCents === 0 ? 0 : ownerCents / 100)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            <p className="drill-hint">
              Liabilities are stored signed — enter card balances as negative numbers.
            </p>
            {pasteNote && (
              <p className="drill-hint" role="status" aria-live="polite">
                {pasteNote}
              </p>
            )}
            {/* Named, not just role="status": the draft banner (and Phase 2's paste note)
                are status nodes too, so screen readers — and every selector — need this one
                to say WHAT it is announcing. */}
            <div className="entry-footer" role="status" aria-label="Live totals">
              <span>
                Net worth (live): <strong>{formatCurrency(preview.netWorth)}</strong>
              </span>
              {preview.delta !== null && (
                <span className={preview.delta >= 0 ? 'delta-positive' : 'delta-negative'}>
                  {/* Glyph + color, never color alone (Global visual rule; StatTile's pattern). */}
                  <span aria-hidden="true">{preview.delta >= 0 ? '▲ ' : '▼ '}</span>
                  {formatCurrency(preview.delta)} vs prior month
                </span>
              )}
            </div>
            <div className="wizard-footer">
              <span />
              <button
                className="button button-primary"
                data-entry-primary=""
                disabled={loading || accounts.length === 0 || !balancesValid}
                onClick={() => setStep('spending')}
              >
                Next: spending
              </button>
            </div>
          </div>
        )}

        {!loading && step === 'spending' && (
          <div
            className="card"
            data-entry-scope=""
            onPaste={(e) => handlePaste(e, categories, (id) => `amt-${id}`, setAmounts)}
          >
            <h2 className="eyebrow">
              Spending & take-home
              <InfoHint text="The month&apos;s spend per category plus the household&apos;s take-home pay — a blank take-home skips the cashflow row." />
            </h2>
            <div className="meta-row">
              <label>
                Household take-home
                <AmountInput
                  className={netPay.trim() === '' || isAmount(netPay) ? undefined : 'invalid'}
                  autoFocus
                  value={netPay}
                  onValueChange={setNetPay}
                  placeholder="leave blank to skip"
                />
              </label>
            </div>
            {/* Same single visual column as the balances step — DOM order is the categories'
                render order, so the Phase 1 Enter/arrow protocol walks straight down. */}
            <table className="data-table entry-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num entry-ref">Typical (3-mo median)</th>
                  <th className="num">This month</th>
                  <th className="num entry-delta">Δ vs typical</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => {
                  const value = amounts[category.id] ?? ''
                  const typical = matrix === null ? null : typicalSpend(matrix, month, category.id)
                  const delta =
                    typical === null ? null : (Number(canonicalAmount(value)) || 0) - typical
                  // CENTS decide both the tone and the text. A two-sample median averages
                  // inexact doubles ((0.10 + 0.20) / 2 is 0.15000000000000002), so a month
                  // that matches typical exactly lands at ±1e-14 — enough to tone a formatted
                  // $0.00 in whichever delta colour the residue's sign picks. Rounding first
                  // also fixes the text, since Intl prints "-$0.00" for a negative zero; the
                  // === 0 branch is what hands formatCurrency a positive one.
                  const deltaCents = delta === null ? null : Math.round(delta * 100)
                  const budget = monthBudgets[category.id]
                  const overBudget =
                    budget !== undefined && (Number(canonicalAmount(value)) || 0) > Number(budget)
                  return (
                    <tr key={category.id}>
                      <td>
                        <label htmlFor={`amt-${category.id}`}>{category.name}</label>
                      </td>
                      <td className="num entry-ref">
                        {typical === null ? '—' : formatCurrency(typical)}
                      </td>
                      <td className="num entry-cell-col">
                        <AmountInput
                          id={`amt-${category.id}`}
                          className={
                            `${isAmount(value) ? '' : 'invalid'}${
                              flashIds.has(`amt-${category.id}`) ? ' pasted-flash' : ''
                            }`.trim() || undefined
                          }
                          value={value}
                          onValueChange={(next) =>
                            setAmounts((cur) => ({ ...cur, [category.id]: next }))
                          }
                        />
                        {budget !== undefined && (
                          <span className={`entry-budget${overBudget ? ' delta-negative' : ''}`}>
                            {/* Glyph + colour, never colour alone (StatTile's grammar):
                                the amount went UP past the budget — the bad direction. */}
                            {overBudget && <span aria-hidden="true">▲ </span>}
                            {`of ${formatCurrency(budget)}`}
                          </span>
                        )}
                      </td>
                      {/* TONE INVERSION vs the balances Δ, deliberately: a POSITIVE delta
                          here is overspending against the typical month — the BAD direction
                          — so the sign→color mapping is the mirror of a rising balance's. */}
                      <td
                        className={`num entry-delta${
                          deltaCents === null || deltaCents === 0
                            ? ''
                            : deltaCents > 0
                              ? ' delta-negative' /* overspend vs typical reads as the bad direction */
                              : ' delta-positive'
                        }`}
                      >
                        {deltaCents === null
                          ? '—'
                          : formatCurrency(deltaCents === 0 ? 0 : deltaCents / 100)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {pasteNote && (
              <p className="drill-hint" role="status" aria-live="polite">
                {pasteNote}
              </p>
            )}
            <div className="entry-footer" role="status" aria-label="Live totals">
              <span>
                Total spend (live): <strong>{formatCurrency(preview.totalSpend)}</strong>
              </span>
              <span>
                Savings rate:{' '}
                {preview.savings === null ? '—' : formatPct(preview.savings, { signed: false })}
              </span>
            </div>
            <div className="wizard-footer">
              <button className="button" onClick={() => setStep('balances')}>
                Back
              </button>
              <button
                className="button button-primary"
                data-entry-primary=""
                disabled={!amountsValid}
                onClick={() => setStep('review')}
              >
                Next: review
              </button>
            </div>
          </div>
        )}

        {!loading && step === 'review' && (
          <div className="card">
            <h2 className="eyebrow">
              Review & save — {formatMonth(month)}
              <InfoHint text="A client-side preview; the server&apos;s rounding is authoritative once saved." />
            </h2>
            <div className="review-grid">
              <div>
                <div className="stat-label">Net worth (preview)</div>
                <div className="stat-value">{formatCurrency(preview.netWorth)}</div>
                {preview.delta !== null && (
                  <div
                    className={`stat-delta ${preview.delta >= 0 ? 'stat-delta-positive' : 'stat-delta-negative'}`}
                  >
                    {/* Glyph + color, never color alone (Global visual rule; StatTile's pattern). */}
                    <span aria-hidden="true">{preview.delta >= 0 ? '▲ ' : '▼ '}</span>
                    {formatCurrency(preview.delta)} vs prior month
                  </div>
                )}
              </div>
              <div>
                <div className="stat-label">Total spend</div>
                <div className="stat-value">{formatCurrency(preview.totalSpend)}</div>
              </div>
              <div>
                <div className="stat-label">Savings rate</div>
                <div className="stat-value">
                  {preview.savings === null ? '—' : formatPct(preview.savings, { signed: false })}
                </div>
              </div>
            </div>
            <p className="drill-hint" style={{ marginTop: '0.75rem' }}>
              Server-side rounding (2 decimals, half-up) is authoritative; the preview is
              client math. {stepIndex === 2 && !balancesValid ? 'Fix balance entries first.' : ''}
            </p>
            {monthExisted && (
              <div className="danger-zone">
                <h3 className="eyebrow">Danger</h3>
                <p className="drill-hint">
                  Delete this month everywhere: its balances snapshot, spending rows and
                  take-home. Undo is offered for six seconds afterwards, and the Activity card
                  can undo it later.
                </p>
                <div className="danger-row">
                  <label htmlFor="delete-arm">Type {month.slice(0, 7)} to confirm</label>
                  <input
                    id="delete-arm"
                    type="text"
                    className="field-input"
                    value={deleteArm}
                    onChange={(e) => setDeleteArm(e.target.value)}
                    placeholder={month.slice(0, 7)}
                  />
                  <button
                    type="button"
                    className="button danger-button"
                    disabled={deleting || deleteArm.trim() !== month.slice(0, 7)}
                    onClick={() => void deleteMonth()}
                  >
                    {deleting ? 'Deleting…' : 'Delete this month'}
                  </button>
                </div>
              </div>
            )}
            <div className="wizard-footer">
              <button className="button" onClick={() => setStep('spending')}>
                Back
              </button>
              {/* accounts.length === 0 doubles as the "load succeeded" sentinel: after a
                  failed load both validity flags are vacuously true, and a meta-only PUT
                  to an existing month would clear its saved note. */}
              <button
                className="button button-primary"
                disabled={
                  saving || loading || accounts.length === 0 || !balancesValid || !amountsValid
                }
                onClick={() => void save()}
              >
                {/* A8: while a committed balances leg is remembered, the primary IS the
                    retry the banner promised. (After an in-between balance edit the click
                    re-sends balances too — save() compares the payload, not the label.) */}
                {saving ? 'Saving…' : balancesLeg !== null ? 'Retry spending' : 'Save month'}
              </button>
            </div>
          </div>
        )}
      </PageFrame>
    </div>
  )
}
