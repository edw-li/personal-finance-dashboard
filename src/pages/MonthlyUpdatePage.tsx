import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ClipboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarPlus } from 'lucide-react'
import { ApiError, describeError } from '../api/client'
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
  SpendingMonthUpsert,
  SpendingUpsertResult,
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
  /** The parents this month keeps HAND-TYPED (2026-09-04 review). A handover — the first
   *  keystroke in a component of such a parent — is typed work like any other: restoring the
   *  cells while putting the parent back as a typed box would drop those very cells from the
   *  next save, and DISCARDING without putting it back leaves a derived row printing a stale
   *  total over $0.00 components. Optional so a draft written before this field still parses;
   *  such a draft simply keeps the month's load-time set. */
  typedParents?: number[]
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
  typedParents: Set<number>,
): string {
  return JSON.stringify({
    balances,
    amounts,
    netPay,
    recordedOn,
    notes,
    // SORTED: a Set iterates in insertion order, so the same month reached two ways would
    // otherwise serialize two different strings and every load would look dirty.
    typedParents: [...typedParents].sort((a, b) => a - b),
  })
}

// ── What this visit's save wrote ─────────────────────────────────────────────────────
// ONE state for two jobs that must never disagree: the receipt the Review step prints
// (spec §4 — "Balances: 26 rows. Spending: skipped — nothing entered.") and the memory of a
// leg that already COMMITTED while its sibling failed (A8's retry). A landed balances leg
// keeps the exact canonical payload it shipped, so a retry whose payload still matches skips
// that PUT, while an edit in between changes the string and honestly re-sends. Only the
// balances leg carries a payload: the order is balances then spending, so it is the only one
// that can commit while the other fails — a signature on the spending leg would be a field
// nothing could ever read.
interface SaveLegs {
  month: string
  balances: { payload: string; result: MonthUpsertResult } | null
  spending:
    | { status: 'saved'; result: SpendingUpsertResult }
    | { status: 'skipped'; reason: string }
    | null
}

// The row COUNT leads and the server's three-way split follows: "did all 26 accounts land?"
// is the question the split alone never answered.
function rowsWord(n: number): string {
  return `${n} row${n === 1 ? '' : 's'}`
}

function balancesSentence(result: MonthUpsertResult): string {
  const total = result.created + result.updated + result.unchanged
  return (
    `Balances: ${rowsWord(total)} (${result.created} added, ` +
    `${result.updated} changed, ${result.unchanged} unchanged).`
  )
}

function spendingSentence(leg: NonNullable<SaveLegs['spending']>): string {
  if (leg.status === 'skipped') return `Spending: skipped — ${leg.reason}`
  const { created, updated, unchanged } = leg.result
  return (
    `Spending: ${rowsWord(created + updated + unchanged)} (${created} added, ` +
    `${updated} changed, ${unchanged} unchanged).` +
    // A DELETION the user asked for by blanking a box: the counts never mention the cashflow
    // row that just went away, so the receipt says it — from the server's own flag, not from
    // what we hoped we sent.
    (leg.result.net_pay_cleared ? ' Household take-home cleared.' : '')
  )
}

// ── Derived parents (2026-09-04 honest-numbers spec §5) ──────────────────────────────
// An account with at least one component has NO balance of its own: its value for the month
// IS the sum of its components' cells.
//
// `is_component && parent_account_id` is the rollup key on BOTH sides of the wire — lane B's
// server and lane E's Accounts card use the same pair — so a link set without the flag is an
// unfinished edit, not a component, and must never drive a preview the server will not write.
// A component whose parent is not on screen derives nothing; it is just a row.
//
// `is_active` is deliberately NOT consulted: the server derives from every flagged component
// that HAS a value for the month, submitted or stored, so a RETIRED component still carrying
// a row for this month is part of the total. The caller decides which rows are on screen (see
// `visibleAccounts`), and this walk sums whatever it is handed.
//
// NOT folded into `nestComponents`: that walk deliberately keys on `parent_account_id` alone
// (it is about where a row RENDERS, and an unflagged link still renders under its parent) and
// returns an order, not a map. Sharing them would make one of the two wrong.
function componentsOf(accounts: AccountOut[]): Map<number, number[]> {
  const byParent = new Map<number, number[]>()
  const present = new Set(accounts.map((a) => a.id))
  for (const account of accounts) {
    if (
      !account.is_component ||
      account.parent_account_id === null ||
      !present.has(account.parent_account_id)
    ) {
      continue
    }
    byParent.set(account.parent_account_id, [
      ...(byParent.get(account.parent_account_id) ?? []),
      account.id,
    ])
  }
  return byParent
}

// The parents that actually render as a live sum, given the ones this month keeps as
// HAND-TYPED rows (see `typedParents` below).
function derivationFor(
  byParent: Map<number, number[]>,
  typed: Set<number>,
): Map<number, number[]> {
  if (typed.size === 0) return byParent
  return new Map([...byParent].filter(([parentId]) => !typed.has(parentId)))
}

// Writing into a component hands its hand-typed parent over to the sum. Returns the SAME set
// when nothing changed, so a caller can skip a pointless state write.
function handOver(accounts: AccountOut[], typed: Set<number>, written: number[]): Set<number> {
  if (typed.size === 0) return typed
  const parentOf = new Map(accounts.map((a) => [a.id, a.parent_account_id]))
  const handed = written
    .map((id) => parentOf.get(id))
    .filter((parentId): parentId is number => parentId != null && typed.has(parentId))
  if (handed.length === 0) return typed
  const next = new Set(typed)
  for (const parentId of handed) next.delete(parentId)
  return next
}

// Rewrites every derived parent's entry INSIDE the balances record, rather than overlaying it
// at render time. That is what lets the live subtotals, the live net worth, the preview memo
// and the draft snapshot stay byte-identical: they all read this one record, and it is now
// always right.
function deriveParents(
  byParent: Map<number, number[]>,
  record: Record<number, string>,
): Record<number, string> {
  if (byParent.size === 0) return record
  const next = { ...record }
  for (const [parentId, childIds] of byParent) {
    // CENTS, summed as integers: every cell is a 2dp decimal, so rounding each child before
    // adding keeps the parent exact. A float sum drifts a hundredth over a long list, and the
    // server's drift check would then report a mismatch nobody typed.
    const cents = childIds.reduce(
      (acc, id) => acc + Math.round((Number(canonicalAmount(next[id] ?? '')) || 0) * 100),
      0,
    )
    next[parentId] = (cents / 100).toFixed(2)
  }
  return next
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
  // Separate from `error`, which carries SAVE failures: a failed load leaves no seed, so it
  // is a lifecycle the frame owns, not a banner over a form (2026-09-05 motion spec §9).
  const [loadError, setLoadError] = useState<string | null>(null)
  // Bumped whenever THIS page changes what /coverage would say — a save fills a month, a
  // delete empties one — and handed to the scope row as `revalidate`, so the ribbon re-reads
  // coverage and the chip follows without leaving the page. (The legacy wizard got this for
  // free by reloading coverage on every month change; the shared ribbon fetches once, so the
  // page has to say when its coverage moved.)
  const [coverageNonce, setCoverageNonce] = useState(0)
  // What this visit's save wrote, per leg (spec §4) — and, while the spending half is still
  // outstanding, the memory the retry needs. Cleared on month load, on a month delete, and at
  // the start of any attempt that is not a retry of a partial failure.
  const [legs, setLegs] = useState<SaveLegs | null>(null)
  // Did the LOADED month carry ENTERED spending — any non-zero amount, or a net pay row (the
  // spec §3 definition)? An entered month is one the user is EDITING, so its save always
  // writes: a correction that zeroes a category must land rather than be skipped as "nothing
  // entered". Server-derived like `matrix` — deliberately NOT part of the draft snapshot.
  const [hadSpending, setHadSpending] = useState(false)
  // Spec §4: the deliberate empty month. Unchecked by default and NOT part of the draft
  // snapshot — a draft is typed work, this is consent about the save in front of you, and a
  // week-old "yes" resurrecting over fresh data is exactly the failure the drafts avoid.
  const [recordZero, setRecordZero] = useState(false)
  // The LOADED month is an empty one (spec §3): rows exist, every amount is $0.00 and there
  // is no take-home. Read from the month payload rather than from /coverage — the wizard
  // already holds the answer, and a second source could disagree with the boxes on screen.
  // The parents this month renders as HAND-TYPED rows instead of derived ones (2026-09-04
  // review). A month that ALREADY EXISTS and stores no row for any of a parent's components
  // had its total typed by hand before the components existed: deriving it would print $0.00
  // over a real figure and the save would then overwrite the stored total with zeros. Empty
  // for a month being entered fresh — there is no history to protect and the Δ column tells
  // the story. The first write into one of its components hands the row over to the sum.
  const [typedParents, setTypedParents] = useState<Set<number>>(new Set())
  const [emptyMonth, setEmptyMonth] = useState(false)
  const [repairing, setRepairing] = useState(false)
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
        setLoadError(null)
        setLegs(null)
        // Nested order: component inputs sit right after their aggregate's input
        // (the group filter below preserves it — components share the parent's group).
        //
        // The rows on screen are the ACTIVE accounts plus one deliberate extra: a RETIRED
        // component that still carries a row for this month. The server derives a parent from
        // every flagged component that has a value for the month — submitted or stored — so
        // such a row is part of its parent's total, and leaving it off screen would make that
        // total unexplainable. It renders read-only and is never sent back (the server falls
        // back to the stored value); its parent must be on screen or it explains nothing.
        const storedIds = new Set(thisMonth.balances.map((b) => b.account_id))
        const activeIds = new Set(accountList.filter((a) => a.is_active).map((a) => a.id))
        const visibleAccounts = nestComponents(
          accountList.filter(
            (a) =>
              a.is_active ||
              (a.is_component &&
                a.parent_account_id !== null &&
                activeIds.has(a.parent_account_id) &&
                storedIds.has(a.id)),
          ),
        )
        setAccounts(visibleAccounts)
        setCategories(categoryList.filter((c) => c.is_active))
        setMonthExisted(thisMonth.exists)
        setCoveredMonths(new Set(timeseries.months))
        setMatrix(matrixData)
        setPeople(householdData?.people ?? [])
        setHadNetPay(spendMonth.net_pay !== null)
        setHadSpending(
          spendMonth.net_pay !== null || spendMonth.amounts.some((a) => Number(a.amount) !== 0),
        )
        setRecordZero(false)
        setEmptyMonth(
          spendMonth.exists &&
            spendMonth.net_pay === null &&
            // At least one row: a month with NO rows at all is missing, not empty, and the
            // repair delete would 404 on it.
            spendMonth.amounts.length > 0 &&
            spendMonth.amounts.every((a) => Number(a.amount) === 0),
        )
        setMonthBudgets(
          Object.fromEntries(spendMonth.budgets.map((b) => [b.category_id, b.amount])),
        )

        // Pre-fill: the month's own values win; otherwise the prior month's (the sheet
        // ritual starts from last month's numbers); otherwise 0.00.
        const source = thisMonth.exists ? thisMonth.balances : priorMonth.balances
        const byId = new Map(source.map((b) => [b.account_id, b.balance]))
        const byParent = componentsOf(visibleAccounts)
        // THIS month's own rows decide, never the prior month's: a parent none of whose
        // components has a stored row here keeps the total someone typed by hand.
        const handTyped = !thisMonth.exists
          ? new Set<number>()
          : new Set(
              [...byParent]
                .filter(([, childIds]) => !childIds.some((id) => storedIds.has(id)))
                .map(([parentId]) => parentId),
            )
        const seedDerivation = derivationFor(byParent, handTyped)
        // The parent's SEED is its components' sum, not the stored figure: a snapshot that
        // drifted must show the truth the save will write. Taken BEFORE the baseline below,
        // or the draft machinery would file a phantom draft for work nobody typed.
        const seededBalances = deriveParents(
          seedDerivation,
          Object.fromEntries(visibleAccounts.map((a) => [a.id, byId.get(a.id) ?? '0.00'])),
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
          handTyped,
        )
        const stored = readDraft(month)
        const draft = stored !== null && stored.raw !== seedSnapshot ? stored.draft : null
        if (stored !== null && draft === null) sessionStorage.removeItem(draftKey(month))
        // A draft may only REMOVE parents from the load-time set — that is all a handover
        // does. The SERVER decides which parents still have no component rows, so an older
        // draft can never resurrect a hand-typed row for a month that has since gained them.
        const draftTyped =
          draft?.typedParents === undefined
            ? handTyped
            : new Set([...handTyped].filter((id) => draft.typedParents?.includes(id)))
        setTypedParents(draftTyped)
        const draftDerivation = derivationFor(byParent, draftTyped)
        setBalances(
          draft
            ? deriveParents(
                draftDerivation,
                Object.fromEntries(
                  visibleAccounts.map((a) => [
                    a.id,
                    draft.balances?.[String(a.id)] ?? seededBalances[a.id],
                  ]),
                ),
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
        setLoadError(describeError(err, 'this month'))
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
    const current = snapshotOf(balances, amounts, netPay, recordedOn, notes, typedParents)
    if (current === baseline.data) {
      sessionStorage.removeItem(draftKey(baseline.month))
    } else {
      sessionStorage.setItem(draftKey(baseline.month), current)
    }
  }, [balances, amounts, netPay, recordedOn, notes, typedParents, baseline, month, loading])

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
    // The hand-typed parents come back WITH the figures (2026-09-04 review): a component
    // typed during the visit handed its parent over, and restoring the seed while leaving
    // that handover standing would render the row derived over a stale total whose cells
    // read $0.00 — and then save the zeros over the stored figure.
    writeBalances(
      () => seed.balances as Record<number, string>,
      new Set(seed.typedParents ?? []),
    )
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
  // Which parents are derived, and from which cells — ONE map, spent by the row renderer, the
  // paste target list, the autofocus pick, the validity check and the PUT payload. Deriving
  // it in five places is how those five drift apart.
  const componentsByParent = useMemo(() => componentsOf(accounts), [accounts])
  // …minus the ones this month keeps hand-typed. Everything downstream — the row renderer,
  // the paste targets, the autofocus pick, the validity check and the PUT payload — reads
  // THIS map, so a hand-typed row behaves like an ordinary cell everywhere at once.
  const derivedByParent = useMemo(
    () => derivationFor(componentsByParent, typedParents),
    [componentsByParent, typedParents],
  )
  // The rows with no box: a derived parent (its cells own the figure) and a retired component
  // that only rides along to explain its parent's total. Neither is typed, pasted, focused,
  // validated or sent.
  const isReadOnlyRow = (a: AccountOut) => derivedByParent.has(a.id) || !a.is_active

  // A derived row has no box, so it has nothing to validate — and its value is always
  // canonical by construction.
  const balancesValid = accounts.every(
    (a) => isReadOnlyRow(a) || isAmount(balances[a.id] ?? ''),
  )
  const amountsValid =
    categories.every((c) => isAmount(amounts[c.id] ?? '')) &&
    (netPay.trim() === '' || isAmount(netPay))

  // Spec §4's gate, derived ONCE so the Review step's pre-save note and save() itself can
  // never disagree about whether the spending leg will run. Committed values, like every
  // other live figure on this page — a cell still holding "$250" (no blur yet) is entered.
  const anyAmountEntered = categories.some(
    (c) => (Number(canonicalAmount(amounts[c.id] ?? '')) || 0) !== 0,
  )
  // A month nobody entered must stay un-entered: 19 rows of $0.00 read as a real month of
  // spending nothing in every chart, average and projection window (spec §0).
  const willWriteSpending =
    hadSpending || anyAmountEntered || netPay.trim() !== '' || recordZero

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
  // sequence and its sentence is shown. `after` (reload, or return to the month) runs on
  // success AND after a partial failure, because a half-reversed month is still a changed one.
  const undoBatches = async (batchIds: (string | null)[], done: string, after: () => void) => {
    let reversed = 0
    try {
      for (const id of batchIds) {
        if (id === null) continue
        await undoBatch(id)
        reversed += 1
      }
      toast.success(done)
      after()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Undo failed')
      // A PARTIAL undo still moved the data (leg 1 reversed, leg 2 was refused — a 409 from
      // a later change touching the same rows). The boxes and the banner now describe rows
      // that no longer exist, so `after` runs anyway: only a sequence that reversed NOTHING
      // may leave the screen as it is.
      if (reversed > 0) after()
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    // Keep ONLY a retry memory — a balances leg that landed while its spending sibling did
    // not. Any other receipt belongs to a FINISHED attempt, and leaving it up would put two
    // verdicts for one month on screen (a stale "Month saved" beside a split-save alert).
    const retryOf =
      legs !== null && legs.month === month && legs.spending === null ? legs.balances : null
    setLegs(retryOf === null ? null : { month, balances: retryOf, spending: null })
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
    // Everything the balances PUT would ship, serialized — the "is this a PURE retry?"
    // comparison. Numeric keys serialize in ascending order (snapshotOf's law), so equal
    // values always compare equal.
    const balancesPayload = JSON.stringify({ balances: canonBalances, recordedOn, notes })
    // Which PUT is in flight — the catch words the banner by the leg that actually failed.
    let leg: 'balances' | 'spending' = 'balances'
    try {
      let balanceResult: MonthUpsertResult
      if (retryOf !== null && retryOf.payload === balancesPayload) {
        // The balances PUT already landed for exactly this payload — skip it and reuse its
        // counts (they describe the request that actually ran).
        balanceResult = retryOf.result
      } else {
        balanceResult = await putMonthBalances(month, {
          recorded_on: recordedOn === '' ? undefined : recordedOn,
          // null (not undefined): blanking the field must CLEAR a previously saved note.
          notes: notes.trim() === '' ? null : notes,
          // Spec §5: a parent with components is derived server-side from the components in
          // this very payload. Sending one would at best be noise and at worst a 422.
          balances: accounts
            // A boxless row is never sent: a derived parent is the server's own sum, and a
            // retired component is already stored — the server falls back to that value, so
            // echoing it back would be the client re-asserting a figure it cannot edit.
            .filter((a) => !isReadOnlyRow(a))
            // …nor a HAND-TYPED parent's components, which this month has never entered:
            // shipping their seeded $0.00 would create exactly the rows that flip the row to
            // a derived $0.00 on the next visit, silently zeroing the stored total.
            .filter((a) => a.parent_account_id === null || !typedParents.has(a.parent_account_id))
            .map((a) => ({ account_id: a.id, balance: canonBalances[a.id] })),
        })
      }
      // Deliberately NOT reusing the retired A8 state's name here: it would read as the old
      // standalone field rather than as THIS attempt's landed half.
      const landedBalances = { payload: balancesPayload, result: balanceResult }
      // From here on any failure must leave this leg REMEMBERED, so the retry re-attempts
      // only what failed.
      setLegs({ month, balances: landedBalances, spending: null })
      leg = 'spending'
      let spendingLeg: NonNullable<SaveLegs['spending']>
      if (willWriteSpending) {
        const body: SpendingMonthUpsert = {
          amounts: categories.map((c) => ({ category_id: c.id, amount: canonAmounts[c.id] })),
        }
        if (canonNetPay !== '') {
          body.net_pay = canonNetPay
        } else if (hadNetPay) {
          // Tri-state rider (spec §4.2): blanking a previously saved net pay must CLEAR it —
          // omitting would silently keep the stale figure in every savings-rate denominator.
          body.net_pay = null
        }
        if (recordZero) {
          // Only the checkbox may confirm an empty month — the key is ABSENT otherwise, so a
          // body the user did not consent to is refused by the server rather than waved
          // through by a client-side default.
          body.confirm_zero = true
        }
        spendingLeg = { status: 'saved', result: await putSpendingMonth(month, body) }
      } else {
        spendingLeg = { status: 'skipped', reason: 'nothing entered.' }
      }
      setLegs({ month, balances: landedBalances, spending: spendingLeg })
      const saveBatches = [
        spendingLeg.status === 'saved' ? (spendingLeg.result.batch_id ?? null) : null,
        balanceResult.batch_id ?? null,
      ]
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
      // Coverage moved: this month now has balances, and spending too when that leg ran. Tell
      // the scope row to re-read it.
      setCoverageNonce((n) => n + 1)
      // What the wire received IS what the boxes now hold. Adopting the canonical values into
      // the STATE as well as the baseline is load-bearing: a cell advanced past by clicks
      // still held raw text ("9,000"), and a baseline taken from that raw state would differ
      // from the "9000" the next focus+blur commits — filing a draft for fully saved work.
      // Safe for a SKIPPED spending leg too: a skip means the amounts are the seed's zeros
      // (anything else would have run the leg), so canonicalizing them changes nothing.
      setBalances(canonBalances)
      setAmounts(canonAmounts)
      setNetPay(canonNetPay)
      if (spendingLeg.status === 'saved') {
        // Only a leg that RAN may teach us the server's state: a skipped one changed nothing,
        // so a month that had a take-home still has it, and an empty month is still empty.
        setHadNetPay(canonNetPay !== '')
        setHadSpending(canonNetPay !== '' || anyAmountEntered)
        // A leg that wrote all zeros with no take-home leaves the month empty — but NOT when
        // the user just ticked the box to say so: the receipt is the answer to a deliberate
        // empty month, and repeating the repair prompt in the same breath would argue with
        // the choice they made one click ago. The next VISIT flags it, receipt gone.
        setEmptyMonth(canonNetPay === '' && !anyAmountEntered && !recordZero)
      }
      setBaseline({
        month,
        data: snapshotOf(canonBalances, canonAmounts, canonNetPay, recordedOn, notes, typedParents),
      })
      setRestored(false)
    } catch (err) {
      if (leg === 'spending') {
        // Truth-telling (A8), plus the server's own words when it had any: a 422 from the
        // empty-month guard is an instruction ("set confirm_zero"), not noise to swallow.
        const why = err instanceof ApiError ? ` ${err.message}` : ''
        setError(`Balances saved. Spending failed — Retry saves only spending.${why}`)
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
      // Named *Delete, not *Leg: `legs.balances` is already this component's remembered
      // half-landed SAVE (the A8 retry), and shadowing that word here would read as the
      // same thing.
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
      // A remembered half-landed save describes rows that no longer exist — leaving it would
      // keep the primary reading "Retry spending" for a deleted month, and the receipt would
      // narrate a month that is gone.
      setLegs(null)
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

  // Spec §4 repair: the empty month's one-click fix — the SAME call the Data-health card's
  // zero-month repair makes (`source: 'repair'`, so the change log labels it a repair and the
  // Activity card can still undo it). Balances are untouched by design: the snapshot is the
  // ritual's anchor, and the month keeps its net worth.
  const deleteEmptySpending = async () => {
    setRepairing(true)
    setError(null)
    try {
      const { batchId } = await deleteSpendingMonth(month, { source: 'repair' })
      const repaired = month
      toast.success(
        `Deleted ${formatMonth(repaired)}'s empty spending rows — balances untouched.`,
        batchId === null
          ? undefined
          : {
              action: {
                label: 'Undo',
                onAction: () =>
                  void undoBatches([batchId], `Undone — ${formatMonth(repaired)}'s rows are back.`, () => {
                    setLoading(true)
                    setLoadNonce((n) => n + 1)
                  }),
              },
            },
      )
      setEmptyMonth(false)
      // The spending feed is gone: the ribbon must re-read coverage, and the form must
      // re-seed (the zeros it is showing no longer exist). The re-seed is also what re-homes
      // the caret: the button just clicked unmounts with the banner it sat in, and remounting
      // the step body runs the first typable cell's autoFocus — so focus lands on a cell
      // rather than falling back to <body>, where the next Tab would restart at the top.
      setCoverageNonce((n) => n + 1)
      setLoading(true)
      setLoadNonce((n) => n + 1)
    } catch (err) {
      setError(
        err instanceof ApiError ? `Delete failed: ${err.message} — retry` : 'Delete failed — retry',
      )
    } finally {
      setRepairing(false)
    }
  }

  // A failed load leaves NO seed, so the form would be empty boxes offering to save themselves
  // over a real month (PortfolioPage rule); the nonce re-runs the [month, loadNonce] effect.
  const retryLoad = () => {
    setLoadError(null)
    setLoading(true)
    setLoadNonce((n) => n + 1)
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
    setLegs(null)
    // The banner describes the month being LEFT; the new load re-derives it. The typed
    // work itself needs no goodbye — the draft effect has been persisting it all along.
    setRestored(false)
    // Same reason the step change clears them: the note counts the OLD month's rows.
    setPasteNote(null)
    setDeleteArm('')
    setRecordZero(false)
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
  // The first TYPABLE row: focus() on a derived row's cell would find nothing, and the step
  // would open with the caret nowhere.
  const firstBalanceId = orderedBalanceRows.find((a) => !isReadOnlyRow(a))?.id

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
    // The fills themselves, not an updater: the balances step needs to know WHICH cells the
    // paste wrote (a pasted component hands its hand-typed parent over, exactly like a
    // keystroke does), and an opaque updater hides that.
    setRecord: (fills: Record<number, string>) => void,
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
    if (Object.keys(fills).length > 0) setRecord(fills)
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

  // Every balance write lands here, and it stores the record and the hand-typed parent set
  // TOGETHER: deriving with a set other than the one that ends up on screen is exactly how
  // the row and the payload come to disagree. The map is built from the set being stored,
  // because the memo above still holds the pre-write one.
  const writeBalances = (
    update: (cur: Record<number, string>) => Record<number, string>,
    typed: Set<number>,
  ) => {
    if (typed !== typedParents) setTypedParents(typed)
    setBalances((cur) => deriveParents(derivationFor(componentsByParent, typed), update(cur)))
  }

  // A cell write — a keystroke, a paste, a sign flip — so the handover can never be forgotten
  // by one of them. Writing into a component of a HAND-TYPED parent hands that row over to
  // its cells on this very write: from here the parent IS the sum, and the save sends the
  // components instead of the total (sending both is the server's 422).
  const fillBalances = (fills: Record<number, string>) =>
    writeBalances(
      (cur) => ({ ...cur, ...fills }),
      handOver(accounts, typedParents, Object.keys(fills).map(Number)),
    )

  // Committed value of one cell for the live columns — the preview memo's rule.
  const committed = (raw: string | undefined) => Number(canonicalAmount(raw ?? '')) || 0

  // A1: negate a liability cell in place — a STRING flip on the canonical form, never
  // float round-tripping (a re-serialized double could alter digits). Only reachable
  // while the committed value is > 0, so the result is always the negative twin; the
  // setBalances write marks the draft dirty exactly like typing would.
  const flipSign = (accountId: number) => {
    const canon = canonicalAmount(balances[accountId] ?? '')
    fillBalances({ [accountId]: canon.startsWith('-') ? canon.slice(1) : `-${canon}` })
  }

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
        // The wizard is a FORM, not a feed — its SAVE failures are banners inside it. Its
        // LOAD is a lifecycle like any other page's, so it goes through the frame.
        resource={
          loadError !== null
            ? { status: 'error', error: loadError, retry: retryLoad }
            : { status: 'ready' }
        }
      >
        <FeedBanner error={error} />
        {emptyMonth && (
          // Spec §4: the repair prompt for a month that was saved with no spending — the
          // wizard is where the fix lives, so the banner carries both routes out of it.
          <FeedBanner
            error="This month was saved with no spending. Enter it below, or delete the empty month."
            action={{
              label: 'Delete the empty month',
              onAction: () => void deleteEmptySpending(),
              disabled: repairing,
            }}
          />
        )}
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
        {legs !== null && legs.month === month && legs.spending !== null && (
          // The receipt (spec §4): one line per leg, so a SKIP is as visible as a write. It
          // renders above the step body, which is the review step whenever a save lands —
          // the only step the primary is reachable from.
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h2 className="eyebrow">Month saved</h2>
            {legs.balances !== null && <p>{balancesSentence(legs.balances.result)}</p>}
            <p>{spendingSentence(legs.spending)}</p>
            <p>
              <Link to="/net-worth">See net worth</Link> · <Link to="/spending">See spending</Link>
            </p>
          </div>
        )}

        {!loading && step === 'balances' && (
          <div
            className="card"
            data-entry-scope=""
            onPaste={(e) =>
              handlePaste(
                e,
                // Spec §5: a derived row is not a paste target. Filtering here (not inside
                // handlePaste) keeps the positional walk's slot count honest — "3 of 3", not
                // "3 of 4 with one silently shifted".
                orderedBalanceRows.filter((a) => !isReadOnlyRow(a)),
                (id) => `bal-${id}`,
                fillBalances,
              )
            }
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
                              const derived = derivedByParent.has(account.id)
                              const readOnly = isReadOnlyRow(account)
                              return (
                                <tr
                                  key={account.id}
                                  className={derived ? 'entry-derived' : undefined}
                                >
                                  <td
                                    className={account.is_component ? 'entry-component' : undefined}
                                  >
                                    {readOnly ? (
                                      // No <label>: there is no control to point at. The badge
                                      // is the row's whole explanation (spec §5) — "derived"
                                      // for a parent its cells add up to, "inactive" for a
                                      // retired component the server still counts this month.
                                      <span>
                                        {account.name}
                                        <span className="badge">
                                          {derived ? 'derived' : 'inactive'}
                                        </span>
                                      </span>
                                    ) : (
                                      <label htmlFor={`bal-${account.id}`}>
                                        {account.name}
                                        {account.is_component && (
                                          <span className="badge">component</span>
                                        )}
                                      </label>
                                    )}
                                  </td>
                                  <td className="num entry-ref">
                                    {prior === undefined ? '—' : formatCurrency(prior)}
                                  </td>
                                  <td className="num entry-cell-col">
                                    {readOnly ? (
                                      // A derived parent shows the live sum of the cells below
                                      // it, written by the same state update that fills any of
                                      // them; a retired component shows the figure already
                                      // stored for the month, which nobody may edit here.
                                      <span className="entry-derived-value">
                                        {formatCurrency(committed(value))}
                                      </span>
                                    ) : (
                                      <>
                                        <AmountInput
                                          id={`bal-${account.id}`}
                                          className={
                                            `${isAmount(value) ? '' : 'invalid'}${
                                              flashIds.has(`bal-${account.id}`)
                                                ? ' pasted-flash'
                                                : ''
                                            }`.trim() || undefined
                                          }
                                          autoFocus={account.id === firstBalanceId}
                                          value={value}
                                          onValueChange={(next) =>
                                            // Spec §5: a component's keystroke IS its
                                            // parent's value — ONE write, so the row, the
                                            // subtotals and the live net worth can never
                                            // show three different answers.
                                            fillBalances({ [account.id]: next })
                                          }
                                        />
                                        {/* A1 (2026-08-31 tier-1): advisory amber, NEVER a gate —
                                            a card can legitimately go positive after a refund, so
                                            Next/Save stay enabled and the table hint below keeps
                                            stating the sign convention. */}
                                        {account.group === 'liability' &&
                                          committed(value) > 0 && (
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
                                      </>
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
            onPaste={(e) =>
              handlePaste(e, categories, (id) => `amt-${id}`, (fills) =>
                setAmounts((cur) => ({ ...cur, ...fills })),
              )
            }
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
            {/* Spec §4: the ONLY way a month of $0.00 rows gets written on purpose. The
                sentence under it is the whole explanation — this control has no other cue. */}
            <label className="entry-zero-confirm">
              <input
                type="checkbox"
                checked={recordZero}
                aria-describedby="record-zero-hint"
                onChange={(e) => setRecordZero(e.target.checked)}
              />
              Record this month as $0
            </label>
            <p className="drill-hint" id="record-zero-hint">
              Writes $0.00 for every category — use it for a month you truly spent nothing.
            </p>
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
            {!willWriteSpending && (
              // Said BEFORE the click, not only in the receipt after it: "Save month" on an
              // untouched spending step now writes balances only, and a user who expected a
              // month of zeros deserves to learn that while they can still act on it.
              <p className="drill-hint" role="status">
                Spending: nothing entered — this save writes balances only.
              </p>
            )}
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
                {/* A8: while a committed balances leg is remembered with its spending sibling
                    still outstanding, the primary IS the retry the banner promised. (After an
                    in-between balance edit the click re-sends balances too — save() compares
                    the payload, not the label.) */}
                {saving
                  ? 'Saving…'
                  : legs !== null && legs.month === month && legs.spending === null
                    ? 'Retry spending'
                    : 'Save month'}
              </button>
            </div>
          </div>
        )}
      </PageFrame>
    </div>
  )
}
