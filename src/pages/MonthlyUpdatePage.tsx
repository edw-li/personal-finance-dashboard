import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarPlus, Ellipsis } from 'lucide-react'
import { ApiError, describeError } from '../api/client'
import {
  deleteMonthBalances,
  fetchAccounts,
  fetchMonthBalances,
  fetchSummary,
} from '../api/netWorth'
import { fetchCoverage } from '../api/coverage'
import { fetchHousehold } from '../api/household'
import { undoBatch } from '../api/lifecycle'
import {
  deleteSpendingMonth,
  fetchCategories,
  fetchMatrix,
  fetchSpendingMonth,
} from '../api/spending'
import AmountInput from '../components/AmountInput'
import StatTile from '../components/StatTile'
import { usePopoverDismiss } from '../components/usePopoverDismiss'
import { fetchMonthReview, saveMonthReview, REVIEW_LABELS } from '../api/monthReview'
import type { MonthReview, ReviewedFeeds } from '../api/monthReview'
import ReviewChanges from '../components/monthly/ReviewChanges'
import HistoricalReview from '../components/monthly/HistoricalReview'
import WhatsDue from '../components/monthly/WhatsDue'
import { landingFor, nextDueAfter, type DuePart, type DueStep } from '../components/monthly/dueParts'
import {
  readDraft,
  removeDraft,
  splitLegacyDraft,
  writeDraft,
  type BalancesDraft,
  type DraftPart,
  type FlowsDraft,
} from '../components/monthly/drafts'
import {
  balancesLine,
  balancesPartName,
  beyondBanner,
  confirmBanner,
  dayOf,
  earlyBalancesBlocker,
  earlyBanner,
  flowsPartName,
  inProgressSentence,
  metaOf,
  monthNameOf,
  monthPhase,
  noBalancesBlocker,
  notBegunSentence,
  partialBanner,
  recordedEarly,
  reviewSaveNote,
  type BalancesMeta,
} from '../components/monthly/monthlyCopy'
import { buildMonthSave, type SaveKind } from '../components/monthly/monthSave'
import { balancesKey, flowsKey, sortedIds, type BalancesPart, type FlowsPart } from '../components/monthly/parts'
import { monthStory, type NextSnapshot } from '../components/monthly/story'
import InfoHint from '../components/InfoHint'
import { useToast } from '../components/ToastProvider'
import { FeedBanner } from '../components/shell/Feed'
import PageFrame from '../components/shell/PageFrame'
import ScopeBar from '../components/shell/ScopeBar'
import { GROUP_LABELS, GROUP_ORDER } from '../charts/theme'
import type {
  AccountOut,
  CategoryOut,
  CoverageOut,
  HouseholdOut,
  MonthBalances,
  MonthUpsertResult,
  SpendingMatrix,
  SpendingUpsertResult,
} from '../types/api'
import { nestComponents } from '../utils/accounts'
import { canonicalAmount, isAmount } from '../utils/amount'
import { formatCurrency, formatMonth, formatPct } from '../utils/format'
import { addMonths, currentMonthIso } from '../utils/months'
import { useProductToday } from '../utils/productToday'
import { classifyPaste, matchLabel } from '../utils/paste'
import { MOTION_MS } from '../theme/motion'
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

// ── Unsaved-work drafts ──────────────────────────────────────────────────────────────
// The wizard's two losses were (a) any navigation away mid-entry — no route guard exists
// under a plain <BrowserRouter> — and (b) the mid-save 401, whose redirect destroyed typed
// work. A continuously written sessionStorage draft closes both: it survives the SPA route
// change AND the full-page login redirect, and is restored (with a visible note) the next time
// this month is opened. Since 2026-09-23 (spec §M6) there is one draft per PART — the balances
// and the month's spending & take-home are saved apart, so they are drafted apart too
// (components/monthly/drafts.ts). A hand-typed-parent handover is typed work like any other and
// rides in the balances draft (2026-09-04 review).

interface LoadedMonth {
  month: string
  generation: number
}

// ── What a save sends, and what it wrote ────────────────────────────────────────────
// The month's two parts save on their own (2026-09-23 spec §M1): each part step's primary saves
// that part, the Confirm confirms a partly entered month's spending with no part at all, and the
// Review's "Save progress" / "Save and close" send only the parts that changed — the body is
// components/monthly/monthSave.ts's buildMonthSave.

// The receipt printed after a save (spec §4 of 2026-09-04: "so a SKIP is as visible as a write"):
// one line per part the save sent — and, for a Review save, the part it left alone as unchanged.
interface LastSave {
  month: string
  kind: SaveKind
  /** A balances save of early balances with nothing changed — the "Confirm {Oct 1} balances". */
  confirmedBalances: boolean
  balances: MonthUpsertResult | null
  spending: { result: SpendingUpsertResult; blank: number } | null
  sentBalances: boolean
  sentSpending: boolean
  /** The part due next once the server has answered (spec §M2) — the receipt links to it. */
  nextDue: DuePart | null
}

/** The parts a save of this kind covers — the one "Next due" must not point back at. */
function stepsSaved(kind: SaveKind): DueStep[] {
  if (kind === 'balances') return ['balances']
  if (kind === 'spending' || kind === 'confirm-spending') return ['spending']
  return ['balances', 'spending']
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

function spendingSentence(leg: NonNullable<LastSave['spending']>): string {
  const { created, updated, unchanged } = leg.result
  return (
    `Spending: ${rowsWord(created + updated + unchanged)} (${created} added, ` +
    `${updated} changed, ${unchanged} unchanged)` +
    // The categories that got NO row (2026-09-09 audit item 1). Without this clause the
    // receipt reads as a full account of the month while nineteen boxes went unrecorded,
    // and a user who meant to enter them has nothing on screen that says so.
    (leg.blank > 0 ? ` · ${leg.blank} categor${leg.blank === 1 ? 'y' : 'ies'} left blank` : '') +
    '.' +
    // A DELETION the user asked for by blanking a box: the counts never mention the cashflow
    // row that just went away, so the receipt says it — from the server's own flag, not from
    // what we hoped we sent.
    (leg.result.net_pay_cleared ? ' Household take-home cleared.' : '')
  )
}

/** The receipt's heading: the part a part save wrote, or the Review's word for the month. */
function receiptTitle(save: LastSave, closed: boolean): string {
  if (save.kind === 'balances') {
    return `${balancesPartName(save.month)} ${save.confirmedBalances ? 'confirmed' : 'saved'}`
  }
  if (save.kind === 'spending') return `${monthNameOf(save.month)} spending saved`
  if (save.kind === 'confirm-spending') return `${monthNameOf(save.month)} spending confirmed complete`
  return closed ? 'Month closed' : 'Progress saved'
}

/** The toast's sentence for a save (its Undo reverses exactly this batch). */
function saveMessage(save: LastSave, closed: boolean): string {
  if (save.kind === 'balances') {
    return `${save.confirmedBalances ? 'Confirmed' : 'Saved'} ${balancesPartName(save.month)}`
  }
  if (save.kind === 'spending') return `Saved ${monthNameOf(save.month)} spending`
  if (save.kind === 'confirm-spending') return `Confirmed ${monthNameOf(save.month)} spending is complete`
  if (closed) return `Closed ${formatMonth(save.month)}`
  const what =
    save.sentBalances && save.sentSpending
      ? 'balances and spending'
      : save.sentBalances
        ? 'balances only'
        : save.sentSpending
          ? 'spending only'
          : 'confirmations only'
  return `Saved progress for ${formatMonth(save.month)} — ${what}`
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

const byAccount = (rows: { account_id: number; balance: string }[]): Record<number, string> =>
  Object.fromEntries(rows.map((row) => [row.account_id, row.balance]))

/** The next 1st as a month's story needs it (2026-09-23 spec §M5): M+1's summary — its delta is the
 *  change FROM this month's snapshot — and its per-account balances. A month with no snapshot is
 *  "missing" (the summary answers 404), never a failure. */
async function fetchNextSnapshot(month: string): Promise<NextSnapshot> {
  const nextMonth = addMonths(month, 1)
  try {
    const [summary, balances] = await Promise.all([fetchSummary(null, nextMonth), fetchMonthBalances(nextMonth)])
    return balances.exists ? { status: 'ready', summary, balances: byAccount(balances.balances) } : { status: 'missing' }
  } catch (err) {
    return err instanceof ApiError && err.status === 404 ? { status: 'missing' } : { status: 'failed' }
  }
}

export default function MonthlyUpdatePage() {
  const [params] = useSearchParams()
  // No month in the URL: decide where to land first (2026-09-23 spec §M2), then mount the wizard
  // on that month — it never loads a month only to switch away from it.
  return params.get('month') === null ? <UpdateLanding /> : <MonthlyUpdateWizard />
}

/** `/update` with no month lands on the first due part, balances first — else the current month's
 *  Balances step (spec §M2). A step already in the URL picks the due part of its kind, so the
 *  Guide's step links open what is due (lane M plan, decision 8). ONE /coverage read decides; a
 *  failed read falls back to the current month. */
function UpdateLanding() {
  const [params, setParams] = useSearchParams()
  const stepParam = params.get('step')
  const requested = STEPS.includes(stepParam as Step) ? (stepParam as Step) : null
  useEffect(() => {
    let cancelled = false
    fetchCoverage()
      .catch((): CoverageOut | null => null)
      .then((coverage) => {
        if (cancelled) return
        const target = landingFor(coverage?.time, currentMonthIso(), requested)
        setParams(
          (current) => {
            // Month first, then step — the shape of every other wizard URL — and any unrelated
            // parameter a deep link carried rides along after them.
            const next = new URLSearchParams({ month: target.month, step: target.step })
            for (const [key, value] of current) if (key !== 'month' && key !== 'step') next.append(key, value)
            return next
          },
          { replace: true },
        )
      })
    return () => {
      cancelled = true
    }
  }, [requested, setParams])
  return (
    <div className="page">
      <PageFrame
        title="Monthly update"
        resource={{ status: 'loading' }}
        skeleton={{ tiles: 0, cards: [{ span: 12, height: 640 }] }}
      >
        {null}
      </PageFrame>
    </div>
  )
}

function MonthlyUpdateWizard() {
  const [params, setParams] = useSearchParams()
  // Never null here — MonthlyUpdatePage renders the landing until the URL names a month.
  const month = params.get('month') ?? currentMonthIso()
  const stepParam = params.get('step')
  const step: Step = STEPS.includes(stepParam as Step) ? (stepParam as Step) : 'balances'
  // Re-render when the server's day moves (a tab left open across midnight): every phase, due and
  // banner rule here reads the day through utils/months.ts (2026-09-23 spec §K1).
  useProductToday()

  const [accounts, setAccounts] = useState<AccountOut[]>([])
  const [categories, setCategories] = useState<CategoryOut[]>([])
  // Who lives in this household — the balance grid's outer grouping. Server-derived like
  // `matrix`, and deliberately NOT part of the draft snapshot.
  const [people, setPeople] = useState<HouseholdOut['people']>([])
  const [balances, setBalances] = useState<Record<number, string>>({})
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [netPay, setNetPay] = useState('')
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
  // Does the month hold any spending row or a take-home (GET /spending/months `exists`)? The
  // Spending step offers its part's delete only then (2026-09-23 spec §M6).
  const [spendingExisted, setSpendingExisted] = useState(false)
  // The month's snapshot as the server dates it (2026-09-23 spec §K2, §M4): read at load and again
  // after each save, it drives the "Balances as of …" line, the early-balances Confirm and banner,
  // and the close gate's provisional check. Server-derived — never part of a draft.
  const [balancesMeta, setBalancesMeta] = useState<BalancesMeta>({
    exists: false,
    recorded_on: null,
    as_of: null,
    provisional: false,
  })
  // The month's story (spec §M5) reads SAVED figures only: this 1st's balances as stored, and the
  // next 1st (summary + balances). An aid, loaded after the month's first paint and re-read after
  // a balances save — never part of a draft.
  const [savedBalances, setSavedBalances] = useState<Record<number, string>>({})
  const [next, setNext] = useState<NextSnapshot>({ status: 'loading' })
  // /coverage — the shared "which months exist" feed (the scope row reads the same one and the
  // api client dedupes the in-flight GET). It replaces the full monthly timeseries the wizard
  // used to download only to learn which months have balances (2026-09-13 polish spec §9).
  const [coverage, setCoverage] = useState<CoverageOut | null>(null)
  const coveredMonths = useMemo(() => new Set(coverage?.balances ?? []), [coverage])
  /**
   * Does this month have a balances snapshot? /coverage answers it, and the month whose seed is
   * ON SCREEN answers for itself when that month exists — the wizard is holding its payload, so
   * a coverage feed that has not caught up (a just-saved month, a failed GET) cannot un-cover it.
   * "Record {Nov 1} balances early" asks it about next month (2026-09-23 spec §M3).
   */
  const hasBalances = (m: string) =>
    coveredMonths.has(m) || (monthExisted && seeded !== null && seeded.month === m)
  // The load whose SEED is on screen — null until the first month lands. `loading` says a load
  // is in flight; this says whether there is anything to show under it. A month switch keeps
  // the previous seed mounted and dimmed until the new one arrives (spec §9), so the body is
  // never blank and never jumps 900 → 2,400px.
  const [seeded, setSeeded] = useState<LoadedMonth | null>(null)
  // The seed on screen belongs to a month the user has LEFT (P1 review round): a failed switch
  // must not leave the previous month's form standing, undimmed and interactive, under the new
  // month's title — a save there is a no-op and the typing is filed under neither month.
  const staleSeed = seeded !== null && seeded.month !== month
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
  // What this visit's last save wrote, part by part (the receipt). Cleared on month load, on a
  // delete, and at the start of every save attempt.
  const [lastSave, setLastSave] = useState<LastSave | null>(null)
  const [review, setReview] = useState<MonthReview | null>(null)
  const [reviewConfirmations, setReviewConfirmations] = useState<Partial<Record<keyof ReviewedFeeds, string>>>({})
  const [finalCurrentMonth, setFinalCurrentMonth] = useState(false)
  const [reviewConflict, setReviewConflict] = useState(false)
  const saveRequest = useRef<{ payload: string; requestId: string } | null>(null)
  const loadGeneration = useRef(0)
  const loadedMonth = useRef<LoadedMonth | null>(null)
  const savingMonth = useRef<LoadedMonth | null>(null)
  // Each part as last RENDERED, serialized — a save compares against it to learn whether the user
  // typed while the request was in flight (their typing must survive the canonicalization).
  const currentRaw = useRef<{ balances: string | null; flows: string | null }>({ balances: null, flows: null })
  // Did the LOADED month carry ENTERED spending — any non-zero amount, or a net pay row (the
  // spec §3 definition)? An entered month is one the user is EDITING, so its save always
  // writes: a correction that zeroes a category must land rather than be skipped as "nothing
  // entered". Server-derived like `matrix` — deliberately NOT part of the draft snapshot.
  const [hadSpending, setHadSpending] = useState(false)
  // The categories that ALREADY have a stored row for this month (2026-09-09 audit item 1).
  // The save body carries these whatever they hold — a correction down to $0.00 is an edit
  // and has to land — while a blank box for a category with no row is left off the wire
  // entirely, because a zero nobody typed is what fabricated production's phantom rows.
  // Server-derived like `matrix`, and deliberately NOT part of the draft snapshot.
  const [storedCategories, setStoredCategories] = useState<Set<number>>(new Set())
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
  // What the server holds for each PART of the month on screen (2026-09-23 spec §M1) — the dirty
  // reference, the draft reference and the discard seed. Each carries its OWN month so a
  // mid-switch render can never compare (or file) the old month's values under the new key.
  const [balancesBase, setBalancesBase] = useState<{ month: string; part: BalancesPart } | null>(null)
  const [flowsBase, setFlowsBase] = useState<{ month: string; part: FlowsPart } | null>(null)
  // A draft was restored over each part's seed this load — the banners' flags (spec §M6).
  const [restoredParts, setRestoredParts] = useState({ balances: false, flows: false })
  // Delete-month arm-and-confirm (2026-08-31 spec §B2): the typed YYYY-MM arms the red
  // button. loadNonce forces the load effect when the deleted month IS the month on
  // screen — the [month] dep alone would never re-run.
  const [deleteArm, setDeleteArm] = useState('')
  // The Review head's kebab (2026-09-13 polish spec §11): the delete arm-and-confirm lives in a
  // popover, so opening it never pushes the footer down the page.
  const [actionsOpen, setActionsOpen] = useState(false)
  const actionsTriggerRef = useRef<HTMLButtonElement>(null)
  const actionsSurfaceRef = useRef<HTMLDivElement>(null)
  // Stable (useCallback): the dismissal hook re-subscribes its document listeners whenever this
  // identity changes, and a fresh closure on every keystroke of the arm box meant re-subscribing
  // on every keystroke. Closing also disarms — a typed "2026-07" must never wait behind a shut
  // popover for the next open to find a live Delete (P1 review round).
  const closeActions = useCallback(() => {
    setActionsOpen(false)
    setDeleteArm('')
  }, [setActionsOpen, setDeleteArm])
  usePopoverDismiss(actionsOpen, closeActions, actionsTriggerRef, actionsSurfaceRef)
  // role="dialog" contract: opening moves focus INTO the surface (its first control, the arm
  // box); the hook hands it back to the trigger on Escape or an outside pointer.
  useEffect(() => {
    if (!actionsOpen) return
    actionsSurfaceRef.current?.querySelector<HTMLElement>('input, button')?.focus()
  }, [actionsOpen])
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
    closeActions()
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
    let cancelled = false
    const loaded = { month, generation: ++loadGeneration.current }
    loadedMonth.current = loaded
    // Two tiers (2026-09-13 polish spec §9). The FIRST PAINT waits for the six per-month feeds
    // the seed and the save are built from. The three household-wide AIDS below land on their
    // own and each already tolerates absence — '—' in the Typical column, a flat group walk, an
    // empty covered set. Every callback checks the same `cancelled` flag, so a late answer for
    // a month the user has left can never land over the month they moved to.
    const matrixPromise = fetchMatrix().catch((): SpendingMatrix | null => null)
    void matrixPromise.then((matrixData) => { if (!cancelled) setMatrix(matrixData) })
    Promise.all([
      fetchAccounts(),
      fetchCategories(),
      fetchMonthBalances(month),
      fetchMonthBalances(addMonths(month, -1)),
      fetchSpendingMonth(month),
      fetchMonthReview(month),
      // The household is part of the SEED, not an aid (P1 review round): it decides whether the
      // grid walks owner → group → row or flat, so a late answer would re-form every section
      // under the caret on a two-person book. Still absence-tolerant — a failure falls back to
      // the flat walk rather than refusing the month.
      fetchHousehold().catch((): HouseholdOut | null => null),
      // …and so is /coverage: it says what is due (the strip, the partial banner, the Confirm,
      // "Next" — 2026-09-23 spec §M1, §M2), whether next month may be recorded early (§M3) and
      // whether the story's next 1st exists (§M5), so a late answer would move all of them under
      // the reader. Gating it costs nothing — the GET is deduped with the scope row's — and a
      // failure still degrades to "nothing known to be due".
      fetchCoverage().catch((): CoverageOut | null => null),
    ])
      .then(([accountList, categoryList, thisMonth, priorMonth, spendMonth, monthReview, householdData, coverageData]) => {
        if (cancelled) return
        setPeople(householdData?.people ?? [])
        if (coverageData !== null) setCoverage(coverageData)
        setError(null)
        setLoadError(null)
        setLastSave(null)
        setReview(monthReview)
        setReviewConfirmations({})
        setFinalCurrentMonth(false)
        setReviewConflict(false)
        setSaving(false)
        saveRequest.current = null
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
        setBalancesMeta(metaOf(thisMonth))
        setSavedBalances(byAccount(thisMonth.balances))
        // The next 1st for the story: skipped when /coverage says it has no balances, read
        // otherwise (a failed /coverage asks anyway — a 404 then reads as "missing").
        if (coverageData !== null && !coverageData.balances.includes(addMonths(month, 1))) {
          setNext({ status: 'missing' })
        } else {
          setNext({ status: 'loading' })
          void fetchNextSnapshot(month).then((answer) => {
            if (!cancelled) setNext(answer)
          })
        }
        setHadNetPay(spendMonth.net_pay !== null)
        setSpendingExisted(spendMonth.exists)
        setStoredCategories(new Set(spendMonth.amounts.map((a) => a.category_id)))
        setHadSpending(
          spendMonth.net_pay !== null || spendMonth.amounts.some((a) => Number(a.amount) !== 0),
        )
        setRecordZero(false)
        setEmptyMonth(
          spendMonth.exists &&
            !monthReview.reviewed.spending &&
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
        // Reset on EVERY month load — stale notes must never leak into another month's save
        // (the next PUT would silently write them there). The recorded date is not the wizard's
        // any more: the server stamps it (2026-09-23 spec §M4, §K4).
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

        const balancesSeed: BalancesPart = {
          balances: seededBalances,
          notes: seededNotes,
          typedParents: sortedIds(handTyped),
        }
        const flowsSeed: FlowsPart = { amounts: seededAmounts, netPay: seededNetPay, recordZero: false }
        // A whole-month draft from before the parts were split becomes two part drafts on first
        // read (spec §M6); then each part is restored — or dropped — on its own.
        splitLegacyDraft(month)
        const balancesDraft = readDraft<BalancesDraft>('balances', month)
        const flowsDraft = readDraft<FlowsDraft>('flows', month)
        // A draft may only REMOVE parents from the load-time set — that is all a handover
        // does. The SERVER decides which parents still have no component rows, so an older
        // draft can never resurrect a hand-typed row for a month that has since gained them.
        const draftTyped =
          balancesDraft?.typedParents === undefined
            ? handTyped
            : new Set([...handTyped].filter((id) => balancesDraft.typedParents?.includes(id)))
        // Restored per field, keyed by id, so an account or category added since still seeds.
        const draftBalances =
          balancesDraft === null
            ? null
            : deriveParents(
                derivationFor(byParent, draftTyped),
                Object.fromEntries(
                  visibleAccounts.map((a) => [a.id, balancesDraft.balances?.[String(a.id)] ?? seededBalances[a.id]]),
                ),
              )
        const draftNotes = balancesDraft?.notes ?? seededNotes
        const draftAmounts =
          flowsDraft === null
            ? null
            : Object.fromEntries(
                activeCategories.map((c) => [c.id, flowsDraft.amounts?.[String(c.id)] ?? seededAmounts[c.id]]),
              )
        const draftNetPay = flowsDraft?.netPay ?? seededNetPay
        // A stored draft that differs from its part's seed is unsaved work and is restored over
        // it; one that MATCHES is a leftover with nothing to say and is dropped.
        const restoreBalances =
          draftBalances !== null &&
          balancesKey({ balances: draftBalances, notes: draftNotes, typedParents: draftTyped }) !==
            balancesKey(balancesSeed)
        const restoreFlows =
          draftAmounts !== null &&
          flowsKey({ amounts: draftAmounts, netPay: draftNetPay }) !== flowsKey(flowsSeed)
        if (balancesDraft !== null && !restoreBalances) removeDraft('balances', month)
        if (flowsDraft !== null && !restoreFlows) removeDraft('flows', month)
        setTypedParents(restoreBalances ? draftTyped : handTyped)
        setBalances(restoreBalances && draftBalances !== null ? draftBalances : seededBalances)
        setNotes(restoreBalances ? draftNotes : seededNotes)
        setAmounts(restoreFlows && draftAmounts !== null ? draftAmounts : seededAmounts)
        setNetPay(restoreFlows ? draftNetPay : seededNetPay)
        setBalancesBase({ month, part: balancesSeed })
        setFlowsBase({ month, part: flowsSeed })
        setRestoredParts({ balances: restoreBalances, flows: restoreFlows })
        // The seed is on screen from this render: the frame's skeleton or the previous month's
        // dimmed card gives way to this month's. Same batch as the setters above.
        setSeeded(loaded)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(describeError(err, 'this month'))
        setLoading(false)
      })
    return () => {
      cancelled = true
      if (loadedMonth.current === loaded) loadedMonth.current = null
    }
  }, [month, loadNonce])

  // Persist typed-but-unsaved work continuously, PER PART (spec §M6): a part's draft is written
  // while it differs from its baseline and deleted the moment it matches again, so storage always
  // mirrors "what would be lost". Gated on the BASELINE's month (never the URL's) and on loading —
  // a mid-switch render still holds the old month's values under the new month's URL, and this is
  // what keeps them from being filed under the wrong key. No setState here, so the effect-body
  // rule has nothing to say.
  useEffect(() => {
    if (loading || balancesBase === null || balancesBase.month !== month) return
    const now: BalancesPart = { balances, notes, typedParents: sortedIds(typedParents) }
    currentRaw.current.balances = JSON.stringify(now)
    if (balancesKey(now) === balancesKey(balancesBase.part)) removeDraft('balances', month)
    else writeDraft('balances', month, now)
  }, [balances, notes, typedParents, balancesBase, month, loading])

  useEffect(() => {
    if (loading || flowsBase === null || flowsBase.month !== month) return
    const now = { amounts, netPay }
    currentRaw.current.flows = JSON.stringify(now)
    if (flowsKey(now) === flowsKey(flowsBase.part)) removeDraft('flows', month)
    else writeDraft('flows', month, now)
  }, [amounts, netPay, flowsBase, month, loading])

  // The flash is a one-shot: the timer callback clears it, so the effect body itself never
  // sets state (a set here would re-run the effect on its own write).
  useEffect(() => {
    if (flashIds.size === 0) return
    const timer = setTimeout(() => setFlashIds(new Set()), MOTION_MS.flash)
    return () => clearTimeout(timer)
  }, [flashIds])

  // Back to the server's seed for ONE part, forgetting its draft — a restore banner's exit. The
  // other part's restored work stays (spec §M6).
  const discardDraft = (part: DraftPart) => {
    if (part === 'balances') {
      if (balancesBase === null || balancesBase.month !== month) return
      const seed = balancesBase.part
      // The hand-typed parents come back WITH the figures (2026-09-04 review): a component
      // typed during the visit handed its parent over, and restoring the seed while leaving
      // that handover standing would render the row derived over a stale total whose cells
      // read $0.00 — and then save the zeros over the stored figure.
      writeBalances(() => seed.balances, new Set(seed.typedParents))
      setNotes(seed.notes)
    } else {
      if (flowsBase === null || flowsBase.month !== month) return
      setAmounts(flowsBase.part.amounts)
      setNetPay(flowsBase.part.netPay)
    }
    setRestoredParts((current) => ({ ...current, [part]: false }))
    removeDraft(part, month)
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

  // Committed values, like every other live figure on this page — a cell still holding "$250"
  // (no blur yet) is entered.
  const anyAmountEntered = categories.some(
    (c) => (Number(canonicalAmount(amounts[c.id] ?? '')) || 0) !== 0,
  )
  // Does the month HOLD spending — saved, or on screen to be saved? A month nobody entered must
  // stay un-entered: 19 rows of $0.00 read as a real month of spending nothing in every chart,
  // average and projection window (2026-09-04 spec §0). The close gate and the Review's
  // differences read it; whether a save SENDS the spending part is its dirtiness (spec §M1).
  const spendingPresent =
    hadSpending || anyAmountEntered || netPay.trim() !== '' || recordZero

  // The categories the spending leg LISTS (2026-09-09 item 1): every one with a stored row (a
  // correction to $0.00 must land), every one carrying a figure, and all of them under the $0
  // consent. Derived ONCE, here, for save()'s body AND the Review step's difference table
  // (bug F2, 2026-09-13): a seed nobody touched is in neither.
  const sentCategories = useMemo(
    () =>
      categories.filter(
        (c) =>
          recordZero ||
          storedCategories.has(c.id) ||
          (Number(canonicalAmount(amounts[c.id] ?? '')) || 0) !== 0,
      ),
    [categories, recordZero, storedCategories, amounts],
  )
  // …and as a set, only while the month holds spending at all: an untouched month records nothing.
  const recordedCategoryIds = useMemo(
    () => new Set(spendingPresent ? sentCategories.map((c) => c.id) : []),
    [spendingPresent, sentCategories],
  )

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
    // The CASH spend — living + tax, transfers excluded (2026-09-04 honest-numbers spec
    // §2, and 2026-09-09 audit item 20). A brokerage deposit is money that STAYED yours, so
    // counting it as spend made the wizard's rate disagree with the Spending page's
    // `savings_rate` for the very month being typed. `kind` rides on every CategoryOut, so
    // this reads the wire rather than guessing.
    const cashSpend = categories.reduce(
      (acc, c) =>
        c.kind === 'transfer' ? acc : acc + (Number(canonicalAmount(amounts[c.id] ?? '')) || 0),
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
      livingSpend: categories.filter(c => c.kind === 'living').reduce((sum, c) => sum + (Number(canonicalAmount(amounts[c.id] ?? '')) || 0), 0),
      taxSpend: categories.filter(c => c.kind === 'tax').reduce((sum, c) => sum + (Number(canonicalAmount(amounts[c.id] ?? '')) || 0), 0),
      transfers: totalSpend - cashSpend,
      cashSpend,
      // The Cash saved tile's second line: what was left of take-home after cash went out.
      netPay: pay,
      cashSaved: pay === null ? null : pay - cashSpend,
      // (net pay − living − tax) ÷ net pay — the server's own cash rate, to the cent.
      savings: pay === null || pay === 0 ? null : (pay - cashSpend) / pay,
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

  // Each part is dirty when it differs from what the server holds (2026-09-23 spec §M1): amounts
  // as the numbers a save writes, notes and hand-typed parents exactly, the $0 consent by value.
  // The Save buttons, the Review's "only the dirty parts" and the receipt all read these two.
  const balancesDirty =
    balancesBase !== null &&
    balancesBase.month === month &&
    balancesKey({ balances, notes, typedParents }) !== balancesKey(balancesBase.part)
  const flowsDirty =
    flowsBase !== null &&
    flowsBase.month === month &&
    (flowsKey({ amounts, netPay }) !== flowsKey(flowsBase.part) || recordZero !== flowsBase.part.recordZero)

  const confirmationInputs = {
    balances: JSON.stringify({ balances, notes, typedParents: sortedIds(typedParents) }),
    spending: JSON.stringify({ amounts, recordZero }),
    take_home: netPay,
  }
  const reviewed: ReviewedFeeds = {
    balances: reviewConfirmations.balances === confirmationInputs.balances,
    spending: reviewConfirmations.spending === confirmationInputs.spending,
    take_home: reviewConfirmations.take_home === confirmationInputs.take_home,
  }
  const canRequestClose = reviewed.balances && reviewed.spending && reviewed.take_home
    && spendingPresent && netPay.trim() !== '' && month <= currentMonthIso()
    && (month !== currentMonthIso() || finalCurrentMonth)

  // Back to the month as the server now holds it — an Undo's `after`. The ribbon re-reads too.
  const reloadMonth = () => {
    setLoading(true)
    setLoadNonce((n) => n + 1)
    setCoverageNonce((n) => n + 1)
  }

  // After a save the wizard re-reads what the server now says (spec §M1, §M4): /coverage, so what is
  // due — the partial banner, the Confirm, "Next" — follows the server's word; and, when balances
  // went out, the month's snapshot dates, which the server stamped (a Confirm turns "recorded early,
  // on Sep 22" into "recorded Oct 1"). The /coverage read runs beside the scope row's own, and the
  // api client joins the two GETs.
  const refreshAfterSave = async (loaded: LoadedMonth, sentBalances: boolean): Promise<CoverageOut | null> => {
    // New balances also move the month's story (spec §M5): the next 1st's delta compares with them.
    // Saving this 1st never records the next one, so a next 1st /coverage lacks stays unasked-for,
    // as at load — its 404 would be a console error in the browser.
    const askNext = sentBalances && (coverage === null || coverage.balances.includes(addMonths(loaded.month, 1)))
    const [fresh, thisMonth, story] = await Promise.all([
      fetchCoverage().catch((): CoverageOut | null => null),
      sentBalances ? fetchMonthBalances(loaded.month).catch((): MonthBalances | null => null) : null,
      askNext ? fetchNextSnapshot(loaded.month) : null,
    ])
    if (loadedMonth.current === loaded) {
      if (fresh !== null) setCoverage(fresh)
      if (thisMonth !== null) {
        setBalancesMeta(metaOf(thisMonth))
        setSavedBalances(byAccount(thisMonth.balances))
      }
      if (story !== null) setNext(story)
    }
    return fresh
  }

  const save = async (kind: SaveKind) => {
    const loaded = loadedMonth.current
    if (loading || saving || deleting || repairing || loaded === null || loaded.month !== month
      || savingMonth.current === loaded || review === null || review.month !== month
      || balancesBase?.month !== month || flowsBase?.month !== month) return
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
    // Each part saves only itself (2026-09-23 spec §M1) — buildMonthSave holds the rule. A month's
    // first snapshot is only ever the Balances step's own Save: the Review never records untouched
    // pre-filled balances.
    const { body, sendBalances, sendSpending } = buildMonthSave({
      kind,
      revision: review.input_revision,
      reviewed,
      dirty: { balances: balancesDirty, flows: flowsDirty },
      balances: {
        notes,
        rows: accounts
          .filter((a) => !isReadOnlyRow(a))
          .filter((a) => a.parent_account_id === null || !typedParents.has(a.parent_account_id))
          .map((a) => ({ account_id: a.id, balance: canonBalances[a.id] })),
      },
      spending: {
        // `sentCategories` is the component-level memo above — one rule for the wire and the review.
        amounts: sentCategories.map((c) => ({ category_id: c.id, amount: canonAmounts[c.id] })),
        netPay: canonNetPay,
        hadNetPay,
        recordZero,
      },
    })
    // A balances save with nothing changed on a month that has balances can only be the Confirm of
    // early balances (spec §M4): the Save is enabled clean for nothing else.
    const confirmedBalances = kind === 'balances' && !balancesDirty && monthExisted
    savingMonth.current = loaded
    // Each part as submitted — the response keeps any typing done while it was in flight.
    const submitted = { ...currentRaw.current }
    setSaving(true)
    setError(null)
    setLastSave(null)
    try {
      const payload = JSON.stringify({ month, ...body })
      if (saveRequest.current?.payload !== payload) saveRequest.current = { payload, requestId: crypto.randomUUID() }
      const result = await saveMonthReview(month, { ...body, request_id: saveRequest.current.requestId })
      // A save belongs to this particular load, not merely its month. Leaving and returning
      // can load a newer revision or restore a newer draft while this response is in flight.
      if (loadedMonth.current !== loaded) return
      const unchangedSinceSubmit = {
        balances: currentRaw.current.balances === submitted.balances,
        flows: currentRaw.current.flows === submitted.flows,
      }
      // The revision every later save of this month must quote (spec §M1: refreshed per save).
      setReview(result.review)
      saveRequest.current = null
      const receipt: LastSave = {
        month,
        kind,
        confirmedBalances,
        balances: sendBalances ? result.balances : null,
        spending:
          sendSpending && result.spending
            ? { result: result.spending, blank: categories.length - sentCategories.length + result.spending.skipped_blank }
            : null,
        sentBalances: sendBalances,
        sentSpending: sendSpending,
        nextDue: null,
      }
      setLastSave(receipt)
      // Coverage moved: the scope row re-reads it, and so does the wizard — whose answer names the
      // part due next (spec §M2), which the toast and the receipt then point at. The toast keeps its
      // Undo for exactly this save's batch; it waits the one GET for the "Next due" words.
      setCoverageNonce((n) => n + 1)
      const closed = result.review.state === 'closed'
      const batchId = result.batch_id
      void refreshAfterSave(loaded, sendBalances).then((fresh) => {
        const nextDue = nextDueAfter(fresh?.time, { month, steps: stepsSaved(kind) })
        if (nextDue !== null && loadedMonth.current === loaded) {
          setLastSave((current) => (current === receipt ? { ...receipt, nextDue } : current))
        }
        if (batchId !== null) {
          toast.success(`${saveMessage(receipt, closed)}${nextDue === null ? '' : ` · Next due: ${nextDue.name} →`}`, {
            action: {
              label: 'Undo',
              onAction: () => void undoBatches([batchId], `Undone — ${formatMonth(month)} is back to how it was.`, reloadMonth),
            },
          })
        }
      })
      // The Confirm IS the spending tick (the same stored flag): the Review's box shows it.
      if (kind === 'confirm-spending') {
        setReviewConfirmations((current) => ({ ...current, spending: confirmationInputs.spending }))
      }
      // Canonicalize fully saved entries, but keep any typing done after submission. A sent part's
      // baseline advances to the saved values, so newer edits remain a draft.
      if (sendBalances) {
        if (unchangedSinceSubmit.balances) {
          setBalances(canonBalances)
          setRestoredParts((current) => ({ ...current, balances: false }))
        }
        setBalancesBase({ month, part: { balances: canonBalances, notes, typedParents: sortedIds(typedParents) } })
        setMonthExisted(true)
      }
      if (sendSpending && result.spending) {
        if (unchangedSinceSubmit.flows) {
          setAmounts(canonAmounts)
          setNetPay(canonNetPay)
          setRestoredParts((current) => ({ ...current, flows: false }))
        }
        setFlowsBase({ month, part: { amounts: canonAmounts, netPay: canonNetPay, recordZero } })
        // Only a leg that RAN may teach us the server's state: an unsent part changed nothing,
        // so a month that had a take-home still has it, and an empty month is still empty.
        setHadNetPay(canonNetPay !== '')
        setHadSpending(canonNetPay !== '' || anyAmountEntered)
        // Every category the body listed now has a row (the server skips a listed zero only
        // for a category it had none for, which is exactly the set we did not list). A second
        // save in the same visit must therefore still carry them, or blanking one would
        // silently leave the stored figure standing.
        setStoredCategories(new Set(sentCategories.map((c) => c.id)))
        // A leg that wrote all zeros with no take-home leaves the month empty — but NOT when
        // the user just ticked the box to say so: the receipt is the answer to a deliberate
        // empty month, and repeating the repair prompt in the same breath would argue with
        // the choice they made one click ago. The next VISIT flags it, receipt gone.
        setEmptyMonth(canonNetPay === '' && !anyAmountEntered && !recordZero)
        // The server skipped only listed zeros it had no row for; anything else is a row now.
        const { created, updated, unchanged } = result.spending
        setSpendingExisted(created + updated + unchanged > 0 || canonNetPay !== '')
      }
    } catch (err) {
      if (loadedMonth.current !== loaded) return
      setError(err instanceof ApiError ? err.message : 'The save could not be confirmed. Your entries are preserved; retry to check the same save.')
      setReviewConflict(err instanceof ApiError && err.status === 409)
    } finally {
      if (savingMonth.current === loaded) savingMonth.current = null
      if (loadedMonth.current === loaded) setSaving(false)
    }
  }

  // Delete ONE part of the month (2026-09-23 spec §M6): the 1st's balances
  // (DELETE /net-worth/months/{m}) or the month's spending & take-home (DELETE /spending/months/
  // {m}) — the other part stays, so the wizard stays on the month and step and re-reads it. A 404
  // means the part is already gone (another tab): the result is the same, with nothing to undo.
  const deletePart = async (part: DraftPart) => {
    if (saving) return
    setDeleting(true)
    setError(null)
    const deleted = month
    const name = part === 'balances' ? balancesPartName(month) : flowsPartName(month)
    try {
      let batchId: string | null = null
      try {
        batchId = (part === 'balances' ? await deleteMonthBalances(month) : await deleteSpendingMonth(month)).batchId
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err
      }
      removeDraft(part, month)
      toast.success(
        `Deleted ${name} — ${part === 'balances' ? 'spending' : 'balances'} untouched.`,
        batchId === null
          ? undefined
          : {
              action: {
                label: 'Undo',
                onAction: () =>
                  void undoBatches([batchId], `Undone — ${name} are back.`, () => {
                    // Back to the part's own step on that month; the nonce covers the same month.
                    reloadMonth()
                    setParams(() => new URLSearchParams({ month: deleted, step: part === 'balances' ? 'balances' : 'spending' }))
                  }),
              },
            },
      )
      closeActions()
      // The receipt and the restored banner describe rows that no longer exist.
      setLastSave(null)
      setRestoredParts((current) => ({ ...current, [part]: false }))
      // The form re-seeds from what is left; the ribbon and the strip re-read coverage.
      reloadMonth()
    } catch (err) {
      setError(err instanceof ApiError ? `Delete failed: ${err.message} — retry` : 'Delete failed — retry')
    } finally {
      setDeleting(false)
    }
  }

  // Spec §4 repair: the empty month's one-click fix — the SAME call the Data-health card's
  // zero-month repair makes (`source: 'repair'`, so the change log labels it a repair and the
  // Activity card can still undo it). Balances are untouched by design: the snapshot is the
  // ritual's anchor, and the month keeps its net worth.
  const deleteEmptySpending = async () => {
    if (saving) return
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


  // Every way into another month — a ribbon chip, a due chip, "Next" to a due month, "Record
  // {Nov 1} balances early" — goes through here. Month change refetches via the [month] dep, so
  // the fetch state flips here, in the event handler, never in the effect
  // (react-hooks/set-state-in-effect). Same-month: the [month] effect would never re-run, so an
  // unconditional setLoading(true) would blank the wizard forever — only the step moves.
  const goTo = (m: string, nextStep: Step) => {
    if (m === month) {
      if (nextStep !== step) setStep(nextStep)
      return
    }
    // Invalidate before navigation commits, closing the gap before the load effect runs.
    loadedMonth.current = null
    setSaving(false)
    setLoading(true)
    setError(null)
    setLastSave(null)
    // The banners describe the month being LEFT; the new load re-derives them. The typed
    // work itself needs no goodbye — the draft effects have been persisting it all along.
    setRestoredParts({ balances: false, flows: false })
    // Same reason the step change clears them: the note counts the OLD month's rows.
    setPasteNote(null)
    setDeleteArm('')
    setActionsOpen(false)
    setRecordZero(false)
    setFlashIds(new Set())
    setParams(() => new URLSearchParams({ month: m, step: nextStep }))
  }

  // Item 18 (2026-09-09 audit): the step SURVIVES a ribbon month change — entering the same step
  // across several months in a row is the sheet ritual. Since the two parts became independent
  // (2026-09-23 spec §M1) that holds for a month with no balances too: its spending can be
  // entered without them, and nothing copies a snapshot to make room.
  const selectMonth = (m: string) => goTo(m, step)

  // What the server says is due (GET /coverage `time`, 2026-09-23 spec §0.4(c)) — null on an empty
  // book or while /coverage is unknown, when nothing below claims anything is due.
  const time = coverage?.time ?? null
  // This month's entry in flows_due — only an ended month is ever listed there.
  const monthFlows = time?.flows_due.find((part) => part.month === month) ?? null
  // K3's *partial*: spending saved while the month ran, not saved again after it ended nor
  // confirmed complete. The banner says so; the Confirm settles it (spec §M1).
  const partial = monthFlows?.spending === 'partial'

  // Where this month sits against the server's month (spec §M3): balances open early for next
  // month only; a month beyond it saves nothing; spending opens once its month has begun.
  const phase = monthPhase(month)
  const notBegun = phase === 'next' || phase === 'beyond'
  // Balances recorded before their 1st, once that 1st has arrived: a save now makes them final
  // (K4), so an unchanged save IS the Confirm (spec §M4). The server never restamps a legacy or a
  // closed month (K4 as landed — the date would move the digest it was adopted or certified at),
  // so neither is offered one.
  const confirmable =
    recordedEarly(month, balancesMeta) &&
    review?.state !== 'unreviewed_history' &&
    review?.state !== 'closed' &&
    (phase === 'past' || phase === 'current')

  // The Balances step's two actions (spec §M1). Its Save is on while the part differs from what
  // the server holds, while the month has no snapshot at all (the pre-fill is a proposal the user
  // may record as it stands), or while its early balances await the Confirm — never for a month
  // beyond next month.
  const balancesSavable = phase !== 'beyond' && (balancesDirty || !monthExisted || confirmable)
  const balancesAction = confirmable && !balancesDirty ? `Confirm ${balancesPartName(month)}` : `Save ${balancesPartName(month)}`

  // Why "Save and close" stays off, when the server would refuse it too (spec §M1, §M5, §K4) —
  // said beside the button, in the order a user fixes them. Balances edited on screen are sent
  // with the close, so neither balances rule applies to them: the server records them first.
  const earlyAtClose = recordedEarly(month, balancesMeta) && review?.state !== 'unreviewed_history'
  const closeBlocker = !balancesValid
    ? 'Fix balance entries first.'
    : !monthExisted && !balancesDirty
      ? noBalancesBlocker(month)
      : earlyAtClose && !balancesDirty && balancesMeta.recorded_on !== null
        ? earlyBalancesBlocker(month, balancesMeta.recorded_on)
        : null
  // The month's story on Review (spec §M5): this 1st → the next 1st, from saved figures.
  const story = monthStory(month, next)
  // "Next" leads to what is due (spec §M1): on the current month's Balances step, while an ended
  // month's spending & take-home are due, the newest such month — else within the month.
  const dueFlows = month === currentMonthIso() ? (time?.flows_due[0] ?? null) : null
  const nextFromBalances =
    dueFlows !== null
      ? { label: `Next: ${flowsPartName(dueFlows.month)}`, go: () => goTo(dueFlows.month, 'spending') }
      : { label: `Next: ${monthNameOf(month)} spending`, go: () => setStep('spending') }

  // The ribbon ends at the current snapshot (2026-09-23 spec §M3, §K2): the current month, or next
  // month once its balances are recorded early — never further, so a month two ahead is neither
  // offered nor a chip (the old anchor, one past the latest covered month, offered "Start Nov" and
  // then the month after). The month on screen joins it only when it IS next month, the one month
  // that opens early, so "Record {Nov 1} balances early" lands on a chip.
  const current = currentMonthIso()
  const nextMonth = addMonths(current, 1)
  const anchor = [current, time?.current_snapshot?.month ?? current, month === nextMonth ? month : current]
    .sort()
    .at(-1) as string

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

  // A part step's kebab (2026-09-13 polish spec §11; per part since 2026-09-23 spec §M6): the
  // part's own delete behind the typed YYYY-MM arm, in a popover so opening it never pushes the
  // step's footer down. One step renders at a time, so the two share one open/arm state.
  const partActions = (part: DraftPart) => {
    const name = part === 'balances' ? balancesPartName(month) : flowsPartName(month)
    const other = part === 'balances' ? flowsPartName(month) : balancesPartName(month)
    const what =
      part === 'balances'
        ? `every account's figure on ${dayOf(month)}`
        : 'every category row and the household take-home'
    return (
      <div className="month-actions">
        <button
          ref={actionsTriggerRef}
          type="button"
          className="button month-actions-trigger"
          aria-label="Month actions"
          aria-haspopup="dialog"
          aria-expanded={actionsOpen}
          onClick={() => setActionsOpen((open) => !open)}
        >
          <Ellipsis size={15} aria-hidden="true" />
        </button>
        {actionsOpen && (
          <div ref={actionsSurfaceRef} className="popover-surface month-actions-popover" role="dialog" aria-label="Month actions">
            <p className="drill-hint">
              Delete {name}: {what}. {other} stay as they are. Undo is offered for six seconds
              afterwards, and the Activity card can undo it later.
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
                disabled={saving || deleting || deleteArm.trim() !== month.slice(0, 7)}
                onClick={() => void deletePart(part)}
              >
                {deleting ? 'Deleting…' : `Delete ${name}`}
              </button>
            </div>
          </div>
        )}
      </div>
    )
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
            {/* "Start {month}" is gone (spec §M3): the one month that opens ahead of time is next
                month, for its balances, and only while it has none. Shown once /coverage has
                answered — before that, "none" is not known. */}
            {coverage !== null && !hasBalances(nextMonth) && month !== nextMonth && (
              <button className="button" onClick={() => goTo(nextMonth, 'balances')}>
                <CalendarPlus size={15} /> Record {dayOf(nextMonth)} balances early
              </button>
            )}
          </>
        }
        // The wizard is a FORM, not a feed — its SAVE failures are banners inside it. Its LOAD is
        // a lifecycle like any other page's (2026-09-13 polish spec §9): a skeleton until the
        // first seed lands, an error-only view when a load fails with nothing to show, and the
        // busy dim over the previous month's card while a switch is in flight. `!loading`
        // retires an error the instant a switch or a Retry starts — the banner is about the
        // month being LEFT, and the load chain clears it on arrival.
        resource={
          loadError !== null && !loading && (seeded === null || staleSeed)
            ? { status: 'error', error: loadError, retry: retryLoad }
            : {
                status: loading && seeded === null ? 'loading' : 'ready',
                busy: loading,
                error: loading ? null : loadError,
                retry: retryLoad,
              }
        }
        skeleton={{
          tiles: 0,
          cards:
            step === 'review'
              ? [{ span: 12, height: 480 }, { span: 12, height: 58 }]
              : [{ span: 12, height: 640 }],
        }}
      >
        {/* What's due, first (2026-09-23 spec §M2): each due part a chip that opens it through the
            wizard's own month switch, amber once overdue; with nothing due, when the next part is. */}
        <WhatsDue time={coverage?.time} onOpen={(part) => goTo(part.month, part.step)} />
        <FeedBanner error={error} />
        {reviewConflict && <div className="draft-note"><span>The saved inputs changed during this visit. Reload to compare your draft with the latest saved figures.</span><button className="button" onClick={() => { setLoading(true); setLoadNonce(n => n + 1) }}>Reload latest and compare draft</button></div>}
        {emptyMonth && (
          // Spec §4: the repair prompt for a month that was saved with no spending — the
          // wizard is where the fix lives, so the banner carries both routes out of it.
          <FeedBanner
            error="This month was saved with no spending. Enter it below, or delete the empty month."
            action={{
              label: 'Delete the empty month',
              onAction: () => void deleteEmptySpending(),
              disabled: repairing || saving,
            }}
          />
        )}
        {/* Advisory, not an error: nothing failed — work was preserved. One banner per part
            (spec §M6), naming it; its discard is the only way to decline it, saving the way to
            accept it. */}
        {restoredParts.balances && (
          <div className="draft-note" role="status">
            <span>Restored unsaved {balancesPartName(month)} — they are not saved yet.</span>
            <button type="button" className="button" onClick={() => discardDraft('balances')}>
              Discard restored balances
            </button>
          </div>
        )}
        {restoredParts.flows && (
          <div className="draft-note" role="status">
            <span>Restored unsaved {flowsPartName(month)} — they are not saved yet.</span>
            <button type="button" className="button" onClick={() => discardDraft('flows')}>
              Discard restored spending
            </button>
          </div>
        )}
        {lastSave !== null && lastSave.month === month && (
          // The receipt (2026-09-04 spec §4): one line per part the save sent — and on a Review
          // save, the part it left alone — so a skip is as visible as a write. It renders above
          // the step body, on whichever step the save was made.
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h2 className="eyebrow">{receiptTitle(lastSave, review?.state === 'closed')}</h2>
            {lastSave.balances !== null && <p>{balancesSentence(lastSave.balances)}</p>}
            {(lastSave.kind === 'review' || lastSave.kind === 'close') && !lastSave.sentBalances && (
              <p>Balances: unchanged — not sent.</p>
            )}
            {lastSave.spending !== null && <p>{spendingSentence(lastSave.spending)}</p>}
            {(lastSave.kind === 'review' || lastSave.kind === 'close') && !lastSave.sentSpending && (
              <p>Spending: unchanged — not sent.</p>
            )}
            {(balancesDirty || flowsDirty) && (
              <p role="status">You have new unsaved changes. Save again to include them.</p>
            )}
            {lastSave.nextDue !== null && (
              // The toast's "Next due" as a working link (spec §M2): the toast's one action is Undo.
              <p>
                <Link
                  to={`/update?month=${lastSave.nextDue.month}&step=${lastSave.nextDue.step}`}
                  onClick={(event) => {
                    const part = lastSave.nextDue
                    if (part === null || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                    event.preventDefault()
                    goTo(part.month, part.step)
                  }}
                >
                  Next due: {lastSave.nextDue.name} →
                </Link>
              </p>
            )}
            <p>
              <Link to="/net-worth">See net worth</Link> · <Link to="/spending">See spending</Link>
            </p>
          </div>
        )}

        {seeded !== null && step === 'balances' && (
          <div
            key={seeded.generation}
            aria-busy={loading || undefined}
            inert={loading || undefined}
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
            <div className="step-head">
              <h2 className="eyebrow">
                {balancesPartName(month)}
                <InfoHint text="Every account&apos;s balance on this 1st, pre-filled from the 1st before; components are tracked inside their parent. Saving them never touches the month&apos;s spending or take-home." />
              </h2>
              {/* Offered only on balances that were saved (a delete of nothing would 404). */}
              {monthExisted && partActions('balances')}
            </div>
            {/* The Recorded-on box's successor (2026-09-23 spec §M4): which day the balances
                describe and when they were recorded — the server stamps it, never the wizard. */}
            <p className="balances-asof">
              {balancesLine(month, balancesMeta)}
              {!monthExisted && prevNetWorth !== null && ` — pre-filled from ${dayOf(addMonths(month, -1))}`}
            </p>
            {phase === 'beyond' && (
              <p className="part-note part-note-warn" role="status">
                {beyondBanner(month)}
              </p>
            )}
            {phase === 'next' && (
              <p className="part-note" role="status">
                {earlyBanner(month)}
              </p>
            )}
            {confirmable && balancesMeta.recorded_on !== null && (
              <p className="part-note part-note-warn" role="status">
                {confirmBanner(month, balancesMeta.recorded_on)}
              </p>
            )}
            <div className="meta-row">
              <label>
                Notes
                <input
                  type="text"
                  className="field-input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="optional"
                  disabled={phase === 'beyond'}
                />
              </label>
            </div>
            {/* One table, not a card per group: cells sit in a single visual column so the
                Phase 1 Enter/arrow protocol (DOM order = this GROUP_ORDER walk) goes straight
                down, the way the sheet's muscle memory expects (spec §4.2). */}
            {/* A book with no accounts: the table would be a header with nothing under it and a
                disabled Next with no reason (2026-09-14 guide §7.2). accounts.length === 0 after a
                finished load means exactly that — setAccounts only runs on success, and a FIRST
                load that fails leaves seeded === null, which renders the error view, not this step. */}
            {!loading && accounts.length === 0 && (
              <p className="empty-note">
                No accounts yet —{' '}
                <Link to="/settings?section=household#accounts">add them in Settings → Household → Accounts</Link>, or{' '}
                <Link to="/guide?section=start#start-setup">start with the guide</Link>.
              </p>
            )}
            <table className="data-table entry-table" hidden={!loading && accounts.length === 0}>
              <thead>
                <tr>
                  <th>Account</th>
                  {/* Dated, not relative (spec §M4): the 1st before and this 1st. */}
                  <th className="num entry-ref">{dayOf(addMonths(month, -1))}</th>
                  <th className="num">{dayOf(month)}</th>
                  <th className="num entry-delta">Δ since {dayOf(addMonths(month, -1))}</th>
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
                                          // A month beyond next month takes no balances yet
                                          // (2026-09-23 spec §M3) — its banner says when.
                                          disabled={phase === 'beyond'}
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
                                                disabled={phase === 'beyond'}
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
                  {/* Named by the day it compares with, like the Δ column (spec §M4). */}
                  {formatCurrency(preview.delta)} since {dayOf(addMonths(month, -1))}
                </span>
              )}
            </div>
            <div className="wizard-footer">
              <span />
              <div className="wizard-footer-actions">
                {/* Moving on saves nothing — the typed balances stay as a draft — so it is never
                    gated on them (plan decision 6). */}
                <button className="button" disabled={loading} onClick={nextFromBalances.go}>
                  {nextFromBalances.label}
                </button>
                {/* The step's primary IS its part's save (spec §M1), so Enter-Enter from the last
                    cell, Ctrl/Cmd+Enter and Ctrl+S all save the balances — and only them. */}
                <button
                  className="button button-primary"
                  data-entry-primary=""
                  disabled={saving || loading || review === null || accounts.length === 0 || !balancesValid || !balancesSavable}
                  onClick={() => void save('balances')}
                >
                  {saving ? 'Saving…' : balancesAction}
                </button>
              </div>
            </div>
          </div>
        )}

        {seeded !== null && step === 'spending' && (
          <div
            key={seeded.generation}
            aria-busy={loading || undefined}
            inert={loading || undefined}
            className="card"
            data-entry-scope=""
            onPaste={(e) =>
              handlePaste(e, categories, (id) => `amt-${id}`, (fills) =>
                setAmounts((cur) => ({ ...cur, ...fills })),
              )
            }
          >
            <div className="step-head">
              <h2 className="eyebrow">
                {flowsPartName(month)}
                <InfoHint text="The month&apos;s spend per category plus the household&apos;s take-home pay — a blank take-home skips the cashflow row. Saving them never creates or changes the month&apos;s balances." />
              </h2>
              {spendingExisted && partActions('flows')}
            </div>
            {/* When this month's spending can be entered (2026-09-23 spec §M3): once it has begun,
                and while it runs what is saved is kept as a partial month. */}
            {notBegun && (
              <p className="part-note" role="status">
                {notBegunSentence(month)}
              </p>
            )}
            {phase === 'current' && (
              <p className="part-note" role="status">
                {inProgressSentence(month)}
              </p>
            )}
            {partial && (
              // Above the table while the month is partly entered (spec §M1): a to-do, not an
              // error — the two ways out are the save and the Confirm below.
              <p className="part-note part-note-warn" role="status">
                {partialBanner(month)}
              </p>
            )}
            <div className="meta-row">
              <label>
                Household take-home
                <AmountInput
                  className={netPay.trim() === '' || isAmount(netPay) ? undefined : 'invalid'}
                  autoFocus
                  disabled={notBegun}
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
                  <th className="num">{monthNameOf(month)}</th>
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
                          disabled={notBegun}
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
                disabled={notBegun}
                aria-describedby="record-zero-hint"
                onChange={(e) => setRecordZero(e.target.checked)}
              />
              Confirm remaining categories as $0
            </label>
            <p className="drill-hint" id="record-zero-hint">
              Records untouched categories as $0.00. Amounts you entered stay as entered.
            </p>
            {pasteNote && (
              <p className="drill-hint" role="status" aria-live="polite">
                {pasteNote}
              </p>
            )}
            <div className="entry-footer" role="status" aria-label="Live totals">
              <span>
                Living spending (live): <strong>{formatCurrency(preview.livingSpend)}</strong>
              </span>
              <span>
                {/* Named for what it IS: the footer's other figure is the ALL-kind total, so
                    an unqualified "Savings rate" beside it reads as one minus the other. */}
                Savings rate — cash:{' '}
                {preview.savings === null ? '—' : formatPct(preview.savings, { signed: false })}
              </span>
            </div>
            <div className="wizard-footer">
              <button className="button" onClick={() => setStep('balances')}>
                Back
              </button>
              <div className="wizard-footer-actions">
                {partial && !flowsDirty && (
                  // "Confirm {September} spending is complete" (spec §M1): a month-review PUT with
                  // NO part that ticks spending — the one save K3 counts as confirmed complete.
                  // Offered while the part is clean; with edits on screen, saving them after the
                  // month has ended completes it instead.
                  <button
                    className="button"
                    disabled={saving || loading || review === null}
                    onClick={() => void save('confirm-spending')}
                  >
                    Confirm {monthNameOf(month)} spending is complete
                  </button>
                )}
                <button className="button" onClick={() => setStep('review')}>
                  Next: review
                </button>
                {/* The part's save is the primary (spec §M1): Enter-Enter, Ctrl/Cmd+Enter and
                    Ctrl+S save the month's spending & take-home — never its balances. */}
                <button
                  className="button button-primary"
                  data-entry-primary=""
                  disabled={saving || loading || review === null || !amountsValid || !flowsDirty || notBegun}
                  onClick={() => void save('spending')}
                >
                  {saving ? 'Saving…' : `Save ${monthNameOf(month)} spending`}
                </button>
              </div>
            </div>
          </div>
        )}

        {seeded !== null && step === 'review' && (
          <div key={seeded.generation} className="card" aria-busy={loading || undefined} inert={loading || undefined}>
            <div className="review-head">
              <h2 className="eyebrow">
                Review & save
                <InfoHint text="Review the entered figures, then save progress or close a completed month. Your entries stay in this browser until saved." />
              </h2>
              {review && <p className={`month-review-status month-review-status-${review.state}`}>{REVIEW_LABELS[review.state]}{review.closed_at ? ` · Last closed ${new Date(review.closed_at).toLocaleDateString()}` : ''}</p>}
            </div>
            {/* W5 (2026-09-13 audit): the four figures of the approved receipt (design §4.3) as
                real tiles — the app's tile vocabulary, not three label/value pairs 375px apart.
                Cash outflow carries the tax/transfers split the old floating line printed. */}
            {/* The first tile tells the month's story (2026-09-23 spec §M5): its 1st's balances as
                typed, and the change from that 1st to the next one, from saved figures. The glyph
                sits inside the sentence ("September's change: ▲ $X (…)"), so the tile is neutral
                and the row's data-story-tone colours its delta (MonthlyUpdatePage.css). */}
            <div className="kpi-row review-kpis" data-story-tone={story.tone ?? undefined}>
              <StatTile
                label={balancesPartName(month)}
                value={formatCurrency(preview.netWorth)}
                delta={story.text ?? undefined}
                tone="neutral"
                hint={`Every non-component ${dayOf(month)} balance from the Balances step, summed as it stands now. The line under it is ${monthNameOf(month)}'s change: the saved ${dayOf(month)} balances to the saved ${dayOf(addMonths(month, 1))} balances.`}
              />
              <StatTile
                label="Living spending"
                value={formatCurrency(preview.livingSpend)}
                hint="Living categories only — tax paid from take-home and transfers are counted apart."
              />
              <StatTile
                label="Cash outflow"
                value={formatCurrency(preview.cashSpend)}
                delta={`tax ${formatCurrency(preview.taxSpend)} · transfers ${formatCurrency(preview.transfers)}`}
                tone="neutral"
                hint="Living spending plus tax paid from take-home. Transfers to your own accounts stayed yours and are listed, not counted."
              />
              <StatTile
                label="Cash saved"
                value={preview.savings === null ? '—' : formatPct(preview.savings, { signed: false })}
                delta={preview.netPay === null || preview.cashSaved === null ? 'enter household take-home to measure' : `${formatCurrency(preview.cashSaved)} of ${formatCurrency(preview.netPay)} take-home`}
                tone="neutral"
                hint="(take-home − living − tax) ÷ take-home — the cash rate the Spending page reports for the month."
              />
            </div>
            <ReviewChanges accounts={accounts} categories={categories} balances={balances} amounts={amounts}
              saved={
                balancesBase?.month === month && flowsBase?.month === month
                  ? { balances: balancesBase.part.balances, amounts: flowsBase.part.amounts }
                  : null
              }
              balanceStory={{
                title: story.title,
                columns: [dayOf(month), dayOf(addMonths(month, 1))],
                from: savedBalances,
                to: story.to,
                empty:
                  story.unavailable ??
                  (story.to === null
                    ? `Reading ${balancesPartName(addMonths(month, 1))}…`
                    : `No balance changed from ${dayOf(month)} to ${dayOf(addMonths(month, 1))}.`),
              }}
              month={month} matrix={matrix} monthExisted={monthExisted} recordedCategories={recordedCategoryIds} />
            <fieldset className="review-confirmations" disabled={saving}>
              <legend>Confirm this month is complete</legend>
              {(['balances', 'spending', 'take_home'] as const).map(feed => <label key={feed}>
                <input type="checkbox" checked={reviewed[feed]} onChange={e => setReviewConfirmations(current => ({ ...current, [feed]: e.target.checked ? confirmationInputs[feed] : undefined }))} />
                {/* The three confirmations name what they certify (2026-09-23 spec §M5): this 1st's balances, the month's flows. */}
                {feed === 'balances' ? `I checked every ${dayOf(month)} account balance.` : feed === 'spending' ? `I checked ${monthNameOf(month)} spending, tax and transfers.` : `I checked ${monthNameOf(month)} household take-home.`}
              </label>)}
              {month === currentMonthIso() && <label><input type="checkbox" checked={finalCurrentMonth} onChange={e => setFinalCurrentMonth(e.target.checked)} />These figures are final even though this month is still in progress.</label>}
            </fieldset>
            {/* A month that has not begun (spec §M3): next month's balances may be recorded early,
                nothing further ahead saves at all, and neither can close before its month. */}
            {phase === 'next' && (
              <p className="drill-hint">
                {`${monthNameOf(month)} has not begun — its balances can be recorded early. Close it once the month has arrived and the figures are final.`}
              </p>
            )}
            {phase === 'beyond' && <p className="drill-hint">{beyondBanner(month)}</p>}
            {/* Said BEFORE the click, not only in the receipt after it: a Review save sends only
                the parts that changed (spec §M1), and a user who expected the other part to be
                written deserves to learn otherwise while they can still act on it. */}
            <p className="drill-hint" role="status">
              {reviewSaveNote(month, { balances: balancesDirty, spending: flowsDirty, balancesExist: monthExisted })}
            </p>
            <div className="wizard-footer">
              <button className="button" onClick={() => setStep('spending')}>
                Back
              </button>
              {/* T4: the only explanation of a disabled primary sits beside it, not 90px above. */}
              {closeBlocker !== null ? (
                <p className="drill-hint wizard-footer-note" role="status">{closeBlocker}</p>
              ) : !canRequestClose ? (
                <p className="drill-hint wizard-footer-note">Save progress at any time. To close, complete all three confirmations and enter spending and household take-home, including explicit zeros where appropriate.</p>
              ) : null}
              <div className="wizard-footer-actions">
                {/* accounts.length === 0 doubles as the "load succeeded" sentinel: after a
                    failed load both validity flags are vacuously true, and a meta-only PUT
                    to an existing month would clear its saved note. */}
                <button
                  className="button"
                  disabled={
                    saving || loading || review === null || accounts.length === 0 || !balancesValid || !amountsValid
                    || phase === 'beyond'
                  }
                  onClick={() => void save('review')}
                >
                  {saving ? 'Saving…' : 'Save progress'}
                </button>
                <button
                  className="button button-primary"
                  disabled={
                    saving || loading || review === null || accounts.length === 0 || !balancesValid || !amountsValid
                    || !canRequestClose || closeBlocker !== null
                  }
                  onClick={() => void save('close')}
                >
                  Save and close {monthNameOf(month)}
                </button>
              </div>
            </div>
          </div>
        )}
        {seeded !== null && step === 'review' && <HistoricalReview coverage={coverage} onChanged={() => { setCoverageNonce(n => n + 1) }} />}
      </PageFrame>
    </div>
  )
}
