import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FocusEvent as ReactFocusEvent, ReactNode } from 'react'
import { createDividend, deleteDividend, updateDividend } from '../../api/portfolio'
import AmountInput from '../AmountInput'
import ChartCard from '../ChartCard'
import InfoHint from '../InfoHint'
import StatTile from '../StatTile'
import TableScroll from '../TableScroll'
import { revealInBox } from '../tableScrollDom'
import BusyButton from '../feedback/BusyButton'
import { SaveButton } from '../feedback/SaveButton'
import { SaveStatus } from '../feedback/SaveStatus'
import { flashElement, useEscapeCancel } from '../feedback/reveal'
import { useDeleteWithUndo } from '../feedback/useDeleteWithUndo'
import { useLatest } from '../reorder/useLatest'
import { useRecordFeedback } from './useRecordFeedback'
import type { DividendOut, SecurityOut } from '../../types/api'
import { canonicalAmount } from '../../utils/amount'
import { formatCurrency, formatDate, formatShares } from '../../utils/format'
import { todayIso } from '../../utils/months'
import { incomeStats, monthlyIncomeCsv, monthlyIncomeOption } from './dividendChartOptions'
import { defaultOpenMonth, entriesLabel, groupDividendsByMonth, monthKeyOf, monthsLabel } from './dividendMonths'
import { FeedBanner } from '../shell/Feed'
import './portfolio.css'
import './dividends.css'

interface FormState {
  security_id: string
  account: string
  pay_date: string
  amount: string
  notes: string
}

const EMPTY: FormState = { security_id: '', account: '', pay_date: '', amount: '', notes: '' }

// The row → form seed, TransactionsPanel's startEdit rule: the SERVER's strings verbatim,
// so a focus+blur of an untouched box is a no-op (canonicalAmount's idempotence guarantee).
function seedFrom(dividend: DividendOut): FormState {
  return {
    security_id: String(dividend.security_id),
    account: dividend.account ?? '',
    pay_date: dividend.pay_date,
    amount: dividend.amount,
    notes: dividend.notes ?? '',
  }
}

// The body both verbs share. It carries no security_id: DividendUpdate has no such field,
// so an edit cannot move a payment between tickers (delete and re-add is the honest way to
// do that) — the POST path adds it back. One builder, so the two can never drift.
function toBody(form: FormState) {
  return {
    account: form.account.trim() || null,
    pay_date: form.pay_date,
    // The wire belt: a submit reached without a blur (a click straight off the keyboard)
    // must not ship "$1,050" to a Decimal column.
    amount: canonicalAmount(form.amount),
    notes: form.notes.trim() || null,
  }
}

/** The note under an Account box (2026-09-09 audit item 27) — TransactionsPanel's twin,
 * because these two forms are the only free-text doors into the account roster.
 *
 * `resolve_portfolio_account` GET-OR-CREATES on the exact string typed here and tags a new
 * account to the PRIMARY person — an ownership decision made by a typo, invisible until the
 * scope chips disagree with the holdings. The roster is the same list Settings edits: a
 * label that is not on it is about to become a new account, and the form says so before the
 * save rather than after. Trimmed and exact, because that is how the server matches.
 *
 * Null while the roster is unknown (still loading, or its fetch failed): this is a warning
 * about creating something new, and an empty roster would raise it over every account the
 * household already has. */
function newAccountNote(
  typed: string,
  accounts: string[] | null,
  primaryName: string | null,
): string | null {
  const label = typed.trim()
  if (accounts === null || label === '' || accounts.includes(label)) return null
  return `New account '${label}' will be created and assigned to ${primaryName ?? 'the primary member'} — re-tag it in Settings → Accounts`
}

/** How long a saved entry's reveal waits for the refetched ledger (Task 8 review): a refetch that
 *  answers in time scrolls the box to the row; a ledger that lands later is some other change, and
 *  the reveal lapses rather than jolting the box then. Exported for the tests (Feed's precedent). */
export const REVEAL_WINDOW_MS = 10_000

/** A toggled month's rows while they glide (dividends.css): 'enter' from the toggle that opens the month
 *  until the glide ends, 'leave' from the toggle that folds it until its rows have folded away — the one
 *  time a closed month still renders rows. */
type MonthGlide = 'enter' | 'leave'

/** How many of a gliding month's rows glide: enough to fill the tallest box (720px) at 30px a row, so
 *  the rest are always below the box's view. They mount once an opening glide ends and unmount as a
 *  fold starts, out of sight. Measured in Edge on production's 72-entry month: gliding every row cost
 *  a ~200ms first frame and 100ms frames after it; the whole ledger at once (Expand all), 1.5s — so
 *  the bulk buttons do not glide at all. Exported for the tests, as REVEAL_WINDOW_MS is. */
export const GLIDE_ROWS = 24

/** Whether the browser can say when a glide ends, which is when a folding month's rows unmount. jsdom
 *  cannot, so there — and anywhere else without it — a toggle folds at once, as it always did. Whether
 *  anything actually moves is the stylesheet's call: under reduced motion, or without interpolate-size,
 *  no transition starts and the wait for one ends at once. */
const canGlide = () => typeof document.body.getAnimations === 'function'

/** The animations at or under `el` that will end — the glides a wait can hold for. A scroll-driven one
 *  (the page's scrims and card reveals run on scroll timelines) or an endless one never finishes, and a
 *  wait on it would hold a folded month's rows, or a save's reveal, for ever. */
const endingAnimations = (el: Element) =>
  el.getAnimations({ subtree: true }).filter((animation) => {
    const end = animation.effect?.getComputedTiming().endTime
    return typeof end === 'number' && Number.isFinite(end)
  })

/** An entry row's cell. Its content sits in a block the month's glide can size: a table row takes no
 *  height of its own, but a block inside each of its cells can (dividends.css). */
function Cell({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <td className={className}>
      <div className="dividend-cell">{children}</div>
    </td>
  )
}

export default function DividendsPanel({
  securities,
  dividends,
  annualIncome,
  accounts = null,
  primaryName = null,
  onChanged,
}: {
  securities: SecurityOut[]
  dividends: DividendOut[]
  /** `totals.annual_income` — a SERVER figure, rendered verbatim. */
  annualIncome: string | null
  /** The household's existing portfolio account labels, for the Account box's datalist and
   *  its "this one is new" note (2026-09-09 audit item 27). Null — the default — is "the
   *  roster is unknown", which offers no completions and warns about nothing; the page
   *  passes it while its own fetch is in flight or after that fetch failed. */
  accounts?: string[] | null
  /** Who a NEW account would be assigned to, for that note; null falls back to a
   *  description rather than inventing a name. */
  primaryName?: string | null
  onChanged: () => void | Promise<void>
}) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  // True while the form holds a just-saved row's context rather than a blank slate — the
  // one piece of state the carry-forward cue and the submit label read.
  const [kept, setKept] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tickers = new Map(securities.map((s) => [s.id, s.ticker]))
  const { formRef: editorRef, state: saveState, ...feedback } = useRecordFeedback(form, [], 'data-dividend-id')
  const latest = useLatest({ onChanged, editingId })
  const deleteWithUndo = useDeleteWithUndo()
  const cancelEdit = () => {
    if (busy) return
    feedback.focusRow(editingId)
    setEditingId(null)
    setForm(EMPTY)
    feedback.begin(EMPTY)
    setKept(false)
    setError(null)
  }
  useEscapeCancel(editorRef, cancelEdit, editingId !== null && !busy)
  const accountNote = newAccountNote(form.account, accounts, primaryName)
  // Only the CHART option is memoized (EChart keys its notMerge setOption on [option], so
  // a fresh object per keystroke in the form below would redraw it); the tiles are plain
  // numbers and memoizing them would buy nothing.
  const chart = useMemo(() => monthlyIncomeOption(dividends, todayIso()), [dividends])
  const stats = incomeStats(dividends, todayIso())
  // The ledger as months (2026-09-24 table-scroll spec §4): 378 entries on production made this card
  // ~19 screens tall; grouped, it is one line a month inside a capped box.
  const months = useMemo(() => groupDividendsByMonth(dividends), [dividends])
  // One month open, the rest folded — the newest on or before today's (defaultOpenMonth: a
  // future-dated manual entry must not fold the current month away) — seeded the first time rows
  // exist: a cold load renders with none and seeds when the payload lands, a warm snapshot seeds at
  // mount. Adjusted during render (React's derived-state idiom, PortfolioPage's owner switch), never
  // in an effect. Not persisted: every visit opens on the current month.
  const firstOpen = defaultOpenMonth(months, todayIso())
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(firstOpen === null ? [] : [firstOpen]),
  )
  const [seeded, setSeeded] = useState(firstOpen !== null)
  if (!seeded && firstOpen !== null) {
    setSeeded(true)
    setOpen(new Set([firstOpen]))
  }
  const allOpen = months.every((month) => open.has(month.key))
  // The months gliding open or shut. Only a month line's own toggle glides; Expand all and Collapse all
  // change at once (GLIDE_ROWS says why), stopping any glide under way, and a month that opens any other
  // way (the first paint, a save's month) simply renders open.
  const [glides, setGlides] = useState<ReadonlyMap<string, MonthGlide>>(() => new Map())
  const setOpenMonths = (next: ReadonlySet<string>, glide: boolean) => {
    if (!glide) setGlides((prev) => (prev.size === 0 ? prev : new Map()))
    else if (canGlide()) {
      const moved = months.filter((month) => open.has(month.key) !== next.has(month.key))
      if (moved.length > 0) {
        setGlides((prev) => {
          const started = new Map(prev)
          for (const month of moved) started.set(month.key, next.has(month.key) ? 'enter' : 'leave')
          return started
        })
      }
    }
    setOpen(next)
  }
  const toggleMonth = (key: string) => {
    const next = new Set(open)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setOpenMonths(next, true)
  }
  const openMonth = (key: string) => {
    setOpen((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
    // A month caught folding away turns round and opens again — the save's reveal is looking for its row.
    setGlides((prev) => {
      if (prev.get(key) !== 'leave') return prev
      const rest = new Map(prev)
      rest.delete(key)
      return rest
    })
  }
  // The capped box (TableScroll's element), which the uncover and the reveal below scroll.
  const boxRef = useRef<HTMLDivElement>(null)
  // Passed month lines stack at one offset — the browser pins a table's sticky cells against the whole
  // table, not their row group (measured in Edge, 2026-09-24) — so the newest one passed covers the
  // rest (spec §4.3). A click on a line, or a Tab onto a covered one (onLineFocus), first scrolls the
  // BOX until that month's group starts just under the column header: Shift+Tab back up the ledger
  // would otherwise rest on a toggle hidden under a later month's line, which the browser will not
  // scroll to because it counts as in view (WCAG 2.4.11), and collapsing the month you are inside
  // keeps your place instead of dropping you among the months below.
  const uncoverMonth = (group: HTMLElement | null) => {
    const box = boxRef.current
    if (box === null || group === null) return
    const head = parseFloat(box.style.getPropertyValue('--table-head-h')) || 0
    const bandTop = box.getBoundingClientRect().top + box.clientTop + head
    const top = group.getBoundingClientRect().top
    if (top < bandTop - 1) box.scrollTop -= bandTop - top
  }
  // Whether a later month's line is pinned over this one. Only the NEXT line needs reading: the lines
  // stick in order, so if it is not over this one, no later line is. The th cells, not the rows: the
  // sticky offset moves the cells, while a tr keeps its place in the table's layout.
  const isCovered = (line: HTMLElement | null) => {
    const next = line?.closest('tbody')?.nextElementSibling?.querySelector<HTMLElement>('.dividend-month-row > th')
    if (!line || !next) return false
    return next.getBoundingClientRect().top < line.getBoundingClientRect().bottom - 1
  }
  // Whether the reader's last key was Tab (Shift+Tab included) — the keyboard's own walk, which is what
  // the focus uncover serves. Any other key, or a pointer press, clears it. On the document and in the
  // capture phase, so a control that stops a key's propagation cannot hide it from the ledger.
  const lastKeyTab = useRef(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      lastKeyTab.current = event.key === 'Tab'
    }
    const onPointer = () => {
      lastKeyTab.current = false
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [])
  // A line's toggle took focus. It uncovers only when a Tab brought focus here from another element
  // AND a later month's line really covers it. Focus that arrives any other way is being HANDED BACK,
  // not walked to, and moving the box then loses the reader's place: a window or tab switch re-fires
  // it with no relatedTarget (Edge, 2026-09-24), and an overlay returns it from its own input as it
  // closes — the command palette's Esc, a detail panel's or the chart Expand dialog's close (the
  // Task 8 review's repro: a line clicked, the box 900px on through its month, Ctrl+K, Esc, and the
  // box jumped back to the month's start). A click uncovers through the line's own handler, always.
  const onLineFocus = (event: ReactFocusEvent<HTMLButtonElement>) => {
    if (event.relatedTarget === null || !lastKeyTab.current) return
    if (!isCovered(event.currentTarget.closest('th'))) return
    uncoverMonth(event.currentTarget.closest('tbody'))
  }
  // A saved entry to bring into view once the refreshed ledger renders (spec §4.5): its id, the
  // ledger it was saved against, and when. The next ledger the page renders after the save consumes
  // it — the row found, it is revealed; not found, it is dropped. Commits that still hold the
  // save-time ledger (the one that opens its month among them) leave it waiting. A delete or a new
  // edit drops it first (remove, startEdit): the reader has moved on, and the reveal would ride THAT
  // refetch to a row they have left. And it lapses REVEAL_WINDOW_MS after the save: a refetch that
  // fails, or comes back identical (PortfolioPage then keeps the ledger it has, the same array),
  // leaves it armed, and the next snapshot the page applies — a price refresh, a scope switch — can
  // land at any later moment, when scrolling the box to the old row would only be a jolt. A ref,
  // not state: it is never drawn.
  const pendingReveal = useRef<{ id: number; ledger: DividendOut[]; at: number; focus: boolean } | null>(null)
  useEffect(() => {
    const pending = pendingReveal.current
    if (pending === null || pending.ledger === dividends) return
    pendingReveal.current = null
    if (performance.now() - pending.at > REVEAL_WINDOW_MS) return
    const box = boxRef.current
    const row = box?.querySelector<HTMLElement>(`tr[data-dividend-id="${pending.id}"]`)
    if (!box || !row) return
    const reveal = () => {
      if (!row.isConnected) return
      // The month line pins under the column header, so the row lands below both.
      const monthLine = row.closest('tbody')?.querySelector<HTMLElement>('.dividend-month-row')
      revealInBox(box, row, monthLine?.getBoundingClientRect().height ?? 0)
      flashElement(row)
      if (pending.focus) row.querySelector<HTMLButtonElement>('[data-edit]')?.focus({ preventScroll: true })
    }
    // A month still gliding (toggled just before the save) is still moving the rows the reveal
    // measures, so it waits for the ledger to come to rest.
    const moving = canGlide() ? endingAnimations(box) : []
    if (moving.length === 0) reveal()
    else void Promise.allSettled(moving.map((animation) => animation.finished)).then(reveal)
  }, [dividends])
  // A glide is over when every transition in its month's group is: the rows' heights and fades, the
  // chevron's turn. Then an opened month's rows drop the clip they glide under and a folded month's
  // rows unmount. Reversing a month mid-glide records the other glide, which re-runs this effect: the
  // first wait is dropped (its cancelled transitions settle it too) and the new glide is waited on.
  useEffect(() => {
    if (glides.size === 0) return
    let current = true
    for (const [key, glide] of glides) {
      const group = boxRef.current?.querySelector<HTMLElement>(`tbody[data-month="${key}"]`)
      const running = group ? endingAnimations(group) : []
      void Promise.allSettled(running.map((animation) => animation.finished)).then(() => {
        if (!current) return
        setGlides((prev) => {
          if (prev.get(key) !== glide) return prev
          const next = new Map(prev)
          next.delete(key)
          return next
        })
      })
    }
    return () => {
      current = false
    }
  }, [glides])

  const startEdit = (dividend: DividendOut) => {
    // A new edit moves the reader on: an earlier save's reveal is moot (see pendingReveal).
    pendingReveal.current = null
    setEditingId(dividend.id)
    // The form now describes ONE stored row, not a run of new ones — the create session,
    // and the cue that narrates it, are over.
    setKept(false)
    setForm(seedFrom(dividend))
    feedback.begin(seedFrom(dividend))
    setError(null)
    feedback.reveal()
  }

  const submit = () => {
    if (busy) return
    // .trim() on the amount, matching TransactionsPanel's guard: whitespace is not a
    // number, and untrimmed it reaches the API as "" — an opaque pydantic decimal error.
    if (!form.security_id || !form.pay_date || !form.amount.trim()) {
      setError('Security, pay date and amount are required')
      feedback.reveal(!form.security_id ? '#div-security' : !form.pay_date ? '#div-pay-date' : '#div-amount')
      return
    }
    setBusy(true)
    setError(null)
    const body = toBody(form)
    const request =
      editingId !== null
        ? updateDividend(editingId, body)
        : createDividend({ ...body, security_id: Number(form.security_id) })
    void saveState.run(() => request
      .then((saved) => {
        if (editingId === null) {
          // The next payment starts here — BEFORE the reset, and that order is load-bearing
          // (998f05c's invariant, proven on the paycheck/comp/ESPP panels). This form
          // carries no data-entry-scope, so Enter is the browser's implicit submit and the
          // caret is still sitting in an AmountInput when this lands. Moving it BLURS that
          // box synchronously, and the blur's commit closes over the box's PRE-reset text —
          // canonicalizing a "$1,050" into an enqueued write that would land on top of the
          // cleared box and resurrect the payment just saved. Today's target IS the only
          // committing box on this form, so the transfer is a no-op that fires no blur at
          // all; the order is still stated, because the day this form grows a second money
          // cell the bug would otherwise arrive silently.
          // The focus-return DOM protocol (spec §5.1, plan decision 6): AmountInput exposes
          // no ref API by design, so the panel addresses its first entry cell through a
          // stable id — the arrangement `data-entry-cell` uses for the keyboard protocol.
          document.getElementById('div-amount')?.focus()
          // Carry-forward (spec §5.1): a quarter's dividends arrive as a run of rows that
          // share a security, an account and a pay date — only the payment changes.
          // Functional, so it composes over any blur write above rather than racing it.
          // `kept` says so out loud, because a form that keeps its values after a save
          // otherwise reads as a save that never happened.
          const next = { ...form, amount: '', notes: '' }
          setForm(next)
          feedback.saved(next, null, false)
          setKept(true)
        } else {
          // An edit is a one-off correction rather than a session: full reset, create mode
          // back, cue down.
          feedback.focusRow(editingId)
          setForm(EMPTY)
          feedback.saved(EMPTY, null, true)
          setEditingId(null)
          setKept(false)
        }
        // The entry's month opens — the month it was saved INTO, which an edit may have moved it to —
        // and once the refetched ledger renders, the box scrolls to it (spec §4.5). The id is the
        // response's: both verbs answer with the saved row (DividendOut). editingId is only the
        // fallback for a response that carries no id — the tests' mocks resolve {} — so an edit
        // still finds its row. The page never moves, so the caret the create path just parked in
        // the amount box stays in view.
        openMonth(monthKeyOf(body.pay_date))
        const id = typeof saved?.id === 'number' ? saved.id : editingId
        if (id !== null) pendingReveal.current = { id, ledger: dividends, at: performance.now(), focus: editingId !== null }
        return latest.current.onChanged()
      })).finally(() => setBusy(false))
  }

  const remove = (dividend: DividendOut) => {
    if (busy) return
    pendingReveal.current = null
    setBusy(true)
    const index = dividends.findIndex((row) => row.id === dividend.id)
    const neighbour = dividends[index + 1] ?? dividends[index - 1]
    void deleteWithUndo({
      name: `the ${tickers.get(dividend.security_id) ?? '?'} dividend entry dated ${formatDate(dividend.pay_date)}`,
      row: feedback.row(dividend.id),
      request: () => deleteDividend(dividend.id),
      onDeleted: () => {
        if (latest.current.editingId === dividend.id) {
          setEditingId(null)
          setForm(EMPTY)
          feedback.begin(EMPTY)
        }
        setKept(false)
        return latest.current.onChanged()
      },
      onRestored: () => {
        openMonth(monthKeyOf(dividend.pay_date))
        return latest.current.onChanged()
      },
      restoredRow: () => feedback.row(dividend.id),
      focusAfter: () => (neighbour ? feedback.row(neighbour.id)?.querySelector<HTMLButtonElement>('[data-delete]') : null)
        ?? editorRef.current?.querySelector<HTMLButtonElement>('[type="submit"]') ?? null,
    }).finally(() => setBusy(false))
  }

  return (
    <section className="card">
      <h2 className="eyebrow">
        Dividends
        <InfoHint text="The dividend log. Refreshes write auto rows from real events — shares held on the ex-date × the per-share amount; manual entry covers manual-priced holdings and older history." />
      </h2>
      <p className="hint">
        Refreshes log dividends automatically for auto-priced tickers — rows marked{' '}
        <span className="badge">auto</span> are rewritten by refreshes, and deleting one
        brings it back next run. Manual entry remains for manual-priced holdings and
        history older than the refresh window. Auto amounts are recorded on the ex-date.
      </p>
      {(chart || stats.trailing12 !== null) && (
        <>
          <div className="kpi-row">
            <StatTile
              label="Trailing 12-mo income"
              value={stats.trailing12 === null ? '—' : formatCurrency(stats.trailing12)}
              hint="Dividend entries in the last 12 months, including the current one. Automatic entries are ex-date estimates; manual entries use the entered pay date."
            />
            <StatTile
              label="YTD income"
              value={stats.ytd === null ? '—' : formatCurrency(stats.ytd)}
              hint="Dividend entries this calendar year. Automatic entries use ex-date and do not confirm payment."
            />
            <StatTile
              label="Projected annual income"
              value={annualIncome === null ? '—' : formatCurrency(annualIncome)}
              hint="Each holding's trailing-12-month dividend rate × shares held, summed."
            />
          </div>
          <ChartCard
            title="Monthly dividend income"
            hint="Dividend entries by recorded month over the trailing two years, quiet months at zero. Automatic records use ex-date estimates; manual records use the entered pay date."
            ariaLabel="Bar chart of dividend income per month over the trailing two years"
            option={chart}
            empty="No dividends in the trailing two years."
            exportName="dividends"
            csv={() => monthlyIncomeCsv(dividends, todayIso())}
            height={220}
          />
        </>
      )}
      {kept && (
        // role=status: the cue appears in the same beat the focus jumps into the amount
        // box, so a screen-reader user would otherwise never learn why the form is still
        // full (InputsForm's live-region idiom). No new colors or motion — plain
        // .drill-hint, per decision 7.
        <p className="drill-hint" role="status" aria-live="polite">
          Security, account and date kept — enter the next payment.
        </p>
      )}
      <form
        ref={editorRef}
        onChangeCapture={() => { setError(null); saveState.clearError() }}
        className="entry-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Security
          {/* disabled while editing: DividendUpdate carries no security_id, so the ticker a
              stored payment belongs to is not editable — TransactionsPanel's rule. */}
          <select
            id="div-security"
            value={form.security_id}
            disabled={editingId !== null}
            onChange={(e) => {
              // The cue claims the security was kept; the moment it is changed the
              // sentence stops being true, so it comes down with the change.
              setKept(false)
              setForm((f) => ({ ...f, security_id: e.target.value }))
            }}
          >
            <option value="">Select…</option>
            {securities.map((s) => (
              <option key={s.id} value={s.id}>{s.ticker}</option>
            ))}
          </select>
        </label>
        <label>
          Account
          {/* .field-input by hand: the shared chrome used to arrive from `.entry-form input`,
              which is now select-only — every plain text control in this form states it. */}
          {/* aria-label, not the wrapping label's text: the note below is a describedby, so
              the box keeps announcing "Account" rather than the whole sentence. */}
          <input className="field-input" list={accounts === null ? undefined : 'div-account-labels'} aria-label="Account" aria-describedby={accountNote === null ? undefined : 'div-account-note'} value={form.account} onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))} />
          {/* Completions, not a fence: a genuinely new account is a legal thing to type, so
              the box stays free text and the note below owns the consequence. No roster, no
              list at all — an empty one is a dropdown arrow that opens on nothing. */}
          {accounts !== null && (
            <datalist id="div-account-labels">
              {accounts.map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
          )}
          {accountNote !== null && (
            <p className="hint" id="div-account-note">
              {accountNote}
            </p>
          )}
        </label>
        <label>
          Pay date
          <input id="div-pay-date" className="field-input" type="date" value={form.pay_date} onChange={(e) => setForm((f) => ({ ...f, pay_date: e.target.value }))} />
        </label>
        <label>
          Amount
          <AmountInput id="div-amount" value={form.amount} onValueChange={(next) => setForm((f) => ({ ...f, amount: next }))} />
        </label>
        <label className="notes-field">
          Notes
          <input className="field-input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </label>
        <div className="form-actions">
          <SaveButton className="button" type="submit" state={saveState} inert={busy && saveState.status !== 'saving'}>
            {/* The label is the second half of the carry-forward cue: "Add another" is what
                a form still holding the last row's context is actually about to do. */}
            {editingId !== null ? 'Save changes' : kept ? 'Add another' : 'Add dividend'}
          </SaveButton>
          <SaveStatus state={saveState} />
          <FeedBanner error={error} />
          {editingId !== null && (
            <BusyButton className="button" type="button" inert={busy} onClick={cancelEdit}>Cancel</BusyButton>
          )}
        </div>
      </form>
      {dividends.length === 0 ? (
        <p className="empty-note">No dividends recorded.</p>
      ) : (
        <>
          <div className="dividend-months-bar">
            <p className="hint">
              {monthsLabel(months.length)} · {entriesLabel(dividends.length)}
            </p>
            {/* The find-in-page door: a folded month's rows are not rendered, so Ctrl+F reaches only
                what is open (spec §4.2). A single month has nothing to fold. */}
            {months.length > 1 && (
              <button
                type="button"
                className="button"
                onClick={() => setOpenMonths(allOpen ? new Set() : new Set(months.map((month) => month.key)), false)}
              >
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>
          <TableScroll className="dividend-scroll" label="Dividends by month" ref={boxRef}>
            <table className="port-table dividend-table">
              <thead>
                <tr>
                  <th>Ticker</th><th>Account</th><th>Recorded date</th>
                  <th className="num">Amount</th><th>Source</th>
                  <th className="num">Per share</th><th>Notes</th><th />
                </tr>
              </thead>
              {months.map((month) => {
                const isOpen = open.has(month.key)
                const glide = glides.get(month.key)
                const totalId = `dividend-month-total-${month.key}`
                return (
                  // One row group per month inside ONE table: the column grid stays shared, so the
                  // amounts line up down the whole ledger.
                  <tbody key={month.key} data-month={month.key}>
                    {/* The whole line toggles for the mouse; the button is the keyboard's and the
                        screen reader's control — its click bubbles here, so one toggle per press. */}
                    <tr
                      className="dividend-month-row"
                      onClick={(event) => {
                        uncoverMonth(event.currentTarget.closest('tbody'))
                        toggleMonth(month.key)
                      }}
                    >
                      <th scope="rowgroup" colSpan={3}>
                        {/* Named "Sep 2026, 40 entries" — the comma is for the ear alone; without it
                            the name runs "2026 40" together — and described by the month's total,
                            which the toggle would otherwise never say. */}
                        <button
                          type="button"
                          className="dividend-month-toggle"
                          aria-expanded={isOpen}
                          aria-describedby={totalId}
                          onFocus={onLineFocus}
                        >
                          <ChevronRight size={14} aria-hidden="true" className="dividend-month-chevron" />
                          <span className="dividend-month-label">{month.label}</span>
                          <span className="visually-hidden">,</span>{' '}
                          <span className="dividend-month-count">{entriesLabel(month.rows.length)}</span>
                        </button>
                      </th>
                      <td className="num" id={totalId}>{formatCurrency(month.totalCents / 100)}</td>
                      <td colSpan={4} />
                    </tr>
                    {(isOpen || glide === 'leave') &&
                      (glide === undefined ? month.rows : month.rows.slice(0, GLIDE_ROWS)).map((d) => (
                        // inert while folding: the rows are on their way out, so for the length of the
                        // glide neither a Tab nor a screen reader finds them.
                        <tr
                          key={d.id}
                          data-dividend-id={d.id}
                          aria-current={editingId === d.id ? true : undefined}
                          className={(editingId === d.id ? 'is-editing ' : '') + (
                            glide === 'enter' ? 'dividend-entry is-entering'
                              : glide === 'leave' ? 'dividend-entry is-leaving'
                                : 'dividend-entry'
                          )}
                          inert={glide === 'leave'}
                        >
                          <Cell>{tickers.get(d.security_id) ?? '?'}</Cell>
                          <Cell>{d.account ?? '—'}</Cell>
                          <Cell>{formatDate(d.pay_date)}<span className="sub">{d.source === 'auto' ? ' · ex-date' : ' · entered pay date'}</span></Cell>
                          <Cell className="num">{formatCurrency(d.amount)}</Cell>
                          <Cell><span className="badge">{d.source === 'auto' ? 'auto' : 'manual'}</span></Cell>
                          <Cell className="num">
                            {d.per_share === null ? '—' : formatCurrency(d.per_share)}
                            {d.shares_held !== null && (
                              <span className="sub"> × {formatShares(d.shares_held)}</span>
                            )}
                          </Cell>
                          <Cell className="notes-cell">{d.notes ?? ''}</Cell>
                          {/* disabled={busy} on both: submit()'s .then closes over editingId and the
                              form as they were when it fired, so a row action taken mid-flight is
                              undone by the reset that lands after it — a seeded edit silently wiped,
                              or worse, a PATCH aimed at whatever editingId the closure still holds.
                              Shutting the row for the duration of a save is the cheap fix. */}
                          <Cell className="row-actions">
                            {/* aria-label: a row button named just "Edit"/"Delete" tells a
                                screen-reader user nothing about what it acts on. Delete needs it
                                MORE since the delete went instant (2026-08-25 polish §8): the
                                confirm() sentence that used to name the row before anything
                                happened is gone, so the button is the last chance to say it. */}
                            <BusyButton
                              className="button"
                              type="button"
                              inert={busy}
                              data-edit
                              aria-label="Edit this dividend"
                              onClick={() => startEdit(d)}
                            >
                              Edit
                            </BusyButton>
                            <BusyButton
                              className="button"
                              type="button"
                              inert={busy}
                              data-delete
                              aria-label="Delete this dividend"
                              onClick={() => remove(d)}
                            >
                              Delete
                            </BusyButton>
                          </Cell>
                        </tr>
                      ))}
                  </tbody>
                )
              })}
            </table>
          </TableScroll>
        </>
      )}
    </section>
  )
}
