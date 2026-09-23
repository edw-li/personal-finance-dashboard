import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import {
  deleteCategoryBudget,
  fetchBudgetSuggestions,
  putCategoryBudget,
  seedBudgets,
} from '../../api/spending'
import type {
  BudgetSuggestionsOut,
  CategoryBudgetEntry,
  CategoryOut,
  SpendingMatrix,
} from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatMonth } from '../../utils/format'
import { currentMonthIso, todayIso } from '../../utils/months'
import { budgetProgress } from '../../utils/spending'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import { windowWords } from '../overview/ytd'
import { FeedBanner } from '../shell/Feed'
import { useToast } from '../ToastProvider'
import Disclosure from '../Disclosure'
import BudgetSuggestions from './BudgetSuggestions'
import {
  budgetSinceIndex,
  budgetsElsewhere,
  budgetsOpeningIndex,
  isMonthInProgress,
  type BudgetsElsewhere,
} from './budgetMonth'
import { MIN_SEED_MONTHS, seedCounts, skipSummary } from './budgetSeed'
import '../panels.css'
import './budgets.css'

interface EditorState {
  amount: string
  effectiveFrom: string // YYYY-MM; '-01' is appended at save (budgets are month-dated)
}

function failMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/** The aware empty state's sentence (spec §B5): the viewed month has no budget in force, and
 *  the book says where its budgets are instead of offering to write a second set. */
function elsewhereSentence(viewed: string, elsewhere: BudgetsElsewhere, target: string): string {
  const where =
    elsewhere.relation === 'start'
      ? elsewhere.everyBudget
        ? elsewhere.count === 1
          ? `your budget starts ${target}` // one budget is not counted: never "your 1 budget"
          : `your ${elsewhere.count} budgets start ${target}`
        : `your budgets start ${target}`
      : elsewhere.relation === 'resume'
        ? `your budgets resume ${target}`
        : `your budgets were last in force in ${target}`
  return `No budgets in force for ${viewed} — ${where}.`
}

/**
 * The Budget card (spec §4.2): one 4px meter per BUDGETED category for the page's focused
 * month, unbudgeted actives collapsed below, and the app's first budget-management
 * surface — an inline effective-dated editor whose PUT response is the history it renders.
 * Plain HTML/CSS in the StatTile family, no ECharts.
 *
 * 2026-09-07 (budget-seed spec §3): the empty state's one action — "Start from my averages"
 * writes every seedable living category's typical spend as a dated row from the focused
 * month, one change batch, one Undo — a confirm-first re-seed once budgets exist, and a
 * suggestion line in every editor. The figures come from GET /spending/budgets/suggestions,
 * fetched once; if that fails the meters and the editor are untouched and the seed says why.
 *
 * 2026-09-23 (spec §B5): the card reads the month the URL names, and otherwise opens where the
 * budgets ARE — it used to read the page's focus month (Aug) and call a book with 13 budgets
 * from Sep "No budgets yet", its primary button one click from writing 13 more dated Aug. The
 * seed is offered only to a book with no budget in force in any month; a month without budgets
 * in a book that has them says where they are instead.
 */
export default function BudgetPanel({
  matrix,
  monthIndex,
  defaultIndex = -1,
  onViewMonth,
  onBudgetsChanged,
}: {
  matrix: SpendingMatrix
  /** The month the URL names (a ribbon pick or a deep link), as an index — it always wins.
   *  null when the URL names none: the card then opens where the budgets are (spec §B5). */
  monthIndex: number | null
  /** The page's own focus month — used only when no month has a budget in force. */
  defaultIndex?: number
  /** Moves the page to a month (the aware empty state's "View Sep 2026"). */
  onViewMonth?: (month: string) => void
  onBudgetsChanged: () => void
}) {
  const toast = useToast()
  const [editors, setEditors] = useState<Record<number, EditorState>>({})
  // The one open inline editor (2026-09-13 polish spec §11/§16): a row's Set/Edit button opens
  // its editor and closes any other. What was typed in a closed editor stays in `editors`
  // (keyed by category), so switching rows never loses work.
  const [openEditor, setOpenEditor] = useState<number | null>(null)
  // Histories arrive ONLY as PUT responses (spec §3 — no history GET exists), so the
  // expandable list appears per category once this session has saved it.
  const [histories, setHistories] = useState<Record<number, CategoryBudgetEntry[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState<BudgetSuggestionsOut | null>(null)
  const [suggestionsFailed, setSuggestionsFailed] = useState(false)
  // The last seed's skip detail; cleared by its Undo, replaced by the next seed.
  const [seedStatus, setSeedStatus] = useState<string | null>(null)
  const [confirmReseed, setConfirmReseed] = useState(false)
  // The house manages focus explicitly in its drawers; this is the card's first
  // confirm-first control, so it owes the same courtesy — Cancel hands focus back to
  // the button that asked, instead of dropping it on <body>.
  const reseedRef = useRef<HTMLButtonElement>(null)
  // "View <month>" moves the card, and the button that was pressed leaves with the month it
  // offered — the heading takes focus so it does not fall to <body>.
  const headingRef = useRef<HTMLHeadingElement>(null)
  // A write never moves the card out from under the reader (spec §B5): while the card chooses
  // its own month, the month a seed, save or delete was made on stays in view — a first seed
  // from Aug would otherwise re-resolve to Sep the moment Sep became budgeted too. The pin
  // belongs to the URL month it was made under, so a ribbon pick or "Back to latest" drops it
  // (adjusted during render, the house idiom — never a setState in an effect).
  const [pinned, setPinned] = useState<string | null>(null)
  const [pinnedUnder, setPinnedUnder] = useState(monthIndex)
  if (pinnedUnder !== monthIndex) {
    setPinnedUnder(monthIndex)
    setPinned(null)
  }

  useEffect(() => {
    let cancelled = false
    fetchBudgetSuggestions()
      .then((out) => {
        if (!cancelled) setSuggestions(out)
      })
      .catch(() => {
        if (!cancelled) setSuggestionsFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The meters show ACTIVE categories only, so the month rules read the same set: an archived
  // category's budget neither opens a month nor keeps the seed away.
  const activeIds = new Set(matrix.categories.filter((c) => c.is_active).map((c) => c.id))
  const activeBook = {
    months: matrix.months,
    series: matrix.series.filter((s) => activeIds.has(s.category_id)),
  }
  // The URL's month, else the pinned month, else where the budgets are (today's month when one
  // is in force there, else the latest month with one), else the page's own focus month.
  const pinnedIndex = pinned === null ? -1 : matrix.months.indexOf(pinned)
  const monthIndexShown =
    monthIndex ??
    (pinnedIndex >= 0
      ? pinnedIndex
      : (budgetsOpeningIndex(activeBook, currentMonthIso()) ?? defaultIndex))

  if (monthIndexShown < 0 || monthIndexShown >= matrix.months.length) {
    return <p className="empty-note">Select an entered month in the ribbon to review its budgets.</p>
  }

  const month = matrix.months[monthIndexShown]
  // Rent entered on the 1st and nothing else yet must read as partial, not as under budget.
  const inProgress = isMonthInProgress(month, todayIso())
  // A5 (2026-08-31 tier-1): default to the FOCUSED month — the month the meters read.
  // The old next-calendar-month default made a first budget save successfully and
  // visibly do nothing (the meters were reading a month the budget hadn't reached).
  // months entries are YYYY-MM-01 (or YYYY-MM in old fixtures); the input wants YYYY-MM.
  const defaultEffectiveFrom = month.slice(0, 7)
  const effectiveMonth = `${defaultEffectiveFrom}-01`
  const keepMonth = () => {
    if (monthIndex === null) setPinned(month)
  }

  const seriesById = new Map(matrix.series.map((s) => [s.category_id, s]))
  const rows = matrix.categories
    .filter((c) => c.is_active)
    .map((category) => {
      const series = seriesById.get(category.id)
      const spent = series?.values[monthIndexShown] ?? null
      const budget = series?.budgets[monthIndexShown] ?? null
      const since = series === undefined ? null : budgetSinceIndex(series.budgets, monthIndexShown)
      return {
        category,
        budget,
        since: since === null ? null : matrix.months[since],
        progress: budgetProgress(spent, budget),
      }
    })
  const budgeted = rows.flatMap((row) =>
    row.progress === null ? [] : [{ ...row, progress: row.progress }],
  )
  const unbudgeted = rows.filter((row) => row.progress === null)
  const overCount = budgeted.filter((row) => row.progress.over).length
  // Non-null exactly when this month has no budget in force but another month does.
  const elsewhere = budgeted.length > 0 ? null : budgetsElsewhere(activeBook, monthIndexShown)

  const suggestionById = new Map((suggestions?.suggestions ?? []).map((s) => [s.category_id, s]))
  const seedWindow = suggestions?.window ?? null
  const counts =
    suggestions === null ? null : seedCounts(matrix, monthIndexShown, suggestions.suggestions)
  const canSeed =
    counts !== null &&
    seedWindow !== null &&
    seedWindow.months >= MIN_SEED_MONTHS &&
    counts.writes > 0

  // The seed button's caption: what it would write, or why it cannot yet (spec §3.1).
  const seedHint = (): string => {
    if (suggestionsFailed) return "Not yet — couldn't load the suggestions."
    if (suggestions === null || counts === null) return 'Loading suggestions…'
    if (seedWindow === null || seedWindow.months < MIN_SEED_MONTHS) {
      return `Not yet — needs at least three complete months of spending (${seedWindow?.months ?? 0} so far).`
    }
    if (counts.writes === 0) {
      return 'Nothing to seed — every category is dormant, sparse, not living spend or already at its average.'
    }
    return `Writes a budget for ${counts.writes} living ${counts.writes === 1 ? 'category' : 'categories'} with three or more complete months, effective from ${formatMonth(month)}: the mean of ${windowWords(seedWindow)}, or the latest month for steady costs like rent. Everything stays editable; one Undo reverts it all.`
  }

  const seed = () => {
    setBusy(true)
    setError(null)
    setConfirmReseed(false)
    seedBudgets(effectiveMonth)
      .then((out) => {
        setSeedStatus(skipSummary(out.skipped))
        keepMonth()
        onBudgetsChanged()
        const n = out.written.length
        const done = `Seeded ${n} ${n === 1 ? 'budget' : 'budgets'} from averages, from ${formatMonth(month)}`
        const batchId = out.batch_id
        // The wizard's contract: a null batch means nothing changed, so there is no Undo.
        toast.success(
          done,
          batchId === null
            ? undefined
            : {
                action: {
                  label: 'Undo',
                  onAction: () => {
                    undoBatch(batchId)
                      .then(() => {
                        setSeedStatus(null)
                        toast.success(`Undone — the ${formatMonth(month)} seed is gone.`)
                        onBudgetsChanged()
                      })
                      .catch((err: unknown) => toast.error(failMessage(err, 'Undo failed')))
                  },
                },
              },
        )
      })
      .catch((err: unknown) => setError(failMessage(err, 'Failed to seed the budgets')))
      .finally(() => setBusy(false))
  }

  const save = (category: CategoryOut, editor: EditorState) => {
    const trimmed = editor.amount.trim()
    // Blank ENDS the budget from that month (the stored null marker, spec §2); anything
    // else must be a non-negative amount — mirrors the server's 422s so the round trip
    // never surprises.
    const amount = trimmed === '' ? null : canonicalAmount(trimmed)
    if (amount !== null && (!isAmount(trimmed) || Number(amount) < 0)) {
      setError('Budget must be a non-negative amount (or blank to end the budget)')
      return
    }
    if (!/^\d{4}-\d{2}$/.test(editor.effectiveFrom)) {
      setError('Pick an effective-from month')
      return
    }
    setBusy(true)
    setError(null)
    putCategoryBudget(category.id, {
      amount,
      effective_month: `${editor.effectiveFrom}-01`,
    })
      .then((history) => {
        setHistories((cur) => ({ ...cur, [category.id]: history }))
        setEditors((cur) => {
          const next = { ...cur }
          delete next[category.id]
          return next
        })
        // The editor STAYS open: the PUT's response is the effective-dated history rendered
        // inside it, and that list is the save's only receipt (its own tests pin it). One
        // editor at a time is still the rule — it is the row's button that closes this one.
        keepMonth()
        onBudgetsChanged()
      })
      .catch((err: unknown) => setError(failMessage(err, 'Failed to save the budget')))
      .finally(() => setBusy(false))
  }

  const removeRow = (category: CategoryOut, effectiveMonthIso: string) => {
    setBusy(true)
    setError(null)
    deleteCategoryBudget(category.id, effectiveMonthIso)
      .then(() => {
        setHistories((cur) => ({
          ...cur,
          [category.id]: (cur[category.id] ?? []).filter(
            (h) => h.effective_month !== effectiveMonthIso,
          ),
        }))
        keepMonth()
        onBudgetsChanged()
      })
      .catch((err: unknown) => setError(failMessage(err, 'Failed to delete the budget row')))
      .finally(() => setBusy(false))
  }

  const editorBlock = (category: CategoryOut, budget: string | null) => {
    const editor = editors[category.id] ?? {
      amount: budget ?? '',
      effectiveFrom: defaultEffectiveFrom,
    }
    const setEditor = (patch: Partial<EditorState>) =>
      setEditors((cur) => ({ ...cur, [category.id]: { ...editor, ...patch } }))
    const history = histories[category.id]
    const suggestion = suggestionById.get(category.id)
    return (
      <div className="budget-editor">
        <div className="budget-editor-form">
          <label>
            Monthly budget
            <AmountInput
              value={editor.amount}
              onValueChange={(next) => setEditor({ amount: next })}
              placeholder="blank ends the budget"
              aria-label={`${category.name} budget amount`}
            />
          </label>
          <label>
            Effective from
            <input
              type="month"
              className="field-input"
              aria-label={`${category.name} budget effective from`}
              value={editor.effectiveFrom}
              onChange={(e) => setEditor({ effectiveFrom: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="button"
            aria-label={`Save ${category.name} budget`}
            disabled={busy}
            onClick={() => save(category, editor)}
          >
            Save
          </button>
          {/* A5: promoted into the control row (was parked between the form and the
              history list) — the past-dating warning must be read at the moment the date
              is chosen, one short line. */}
          <p className="drill-hint budget-editor-hint">
            Defaults to {formatMonth(month)} — the month the meters read. Dating it in the
            past re-writes what that era&apos;s budget was.
          </p>
          {suggestion !== undefined && (
            <BudgetSuggestions
              categoryName={category.name}
              kind={category.kind}
              suggestion={suggestion}
              onPick={(amount) => setEditor({ amount })}
            />
          )}
        </div>
        {history !== undefined && (
          <ul className="budget-history">
            {history.map((entry) => (
              <li key={entry.effective_month}>
                <span>
                  {`${formatMonth(entry.effective_month)} — ${
                    entry.amount === null ? 'budget ends' : formatCurrency(entry.amount)
                  }`}
                </span>
                <button
                  type="button"
                  className="button"
                  aria-label={`Delete the ${formatMonth(entry.effective_month)} budget row for ${category.name}`}
                  disabled={busy}
                  onClick={() => removeRow(category, entry.effective_month)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // The row's one control: "Edit budget" where a budget stands, "Set budget" where none does.
  const editorToggle = (category: CategoryOut, verb: 'Set' | 'Edit') => (
    <button
      type="button"
      className="button budget-editor-toggle"
      aria-label={`${verb} ${category.name} budget`}
      aria-expanded={openEditor === category.id}
      onClick={() => setOpenEditor((current) => (current === category.id ? null : category.id))}
    >
      {verb} budget
    </button>
  )

  const newCount = counts === null ? 0 : counts.writes - counts.rewrites

  const viewMonth = (target: string) => {
    onViewMonth?.(target)
    // The pressed button leaves with the month it offered: hand focus to the card's heading
    // (the house hand-off) rather than letting it fall to <body>.
    requestAnimationFrame(() => headingRef.current?.focus())
  }

  return (
    <section className="card span-12">
      {/* tabIndex -1: the focus target after "View <month>", never a tab stop of its own. */}
      <h2 className="eyebrow" ref={headingRef} tabIndex={-1}>
        Budgets — {formatMonth(month)}
        {/* JSX drops the line break: without the space the heading's text reads "Sep 2026Month
            to date" to a screen reader, whatever the badge's margin shows (SourceHealth's note). */}
        {inProgress && (
          <>
            {' '}
            <span className="badge">Month to date</span>
          </>
        )}
        <InfoHint text="Each budgeted category's spend against its budget for the month shown: the month picked in the ribbon, or else this month when a budget is in force, else the latest month that has one. Budgets are effective-dated: a change applies from its month forward and never rewrites history — each row says since when. With no transaction feed there is no mid-month pacing: a month still in progress reads month to date. Start from my averages writes every living category's typical spend as an editable budget; the editor's chips offer the same figures one at a time." />
      </h2>
      <FeedBanner error={error} />
      {seedStatus !== null && (
        <p className="drill-hint budget-seed-status" role="status">
          {seedStatus}
        </p>
      )}
      {budgeted.length > 0 ? (
        <>
          <div className="budget-summary-row">
            <p className="drill-hint" role="status">
              {`${overCount} of ${budgeted.length} budgeted categories over ${inProgress ? 'so far ' : ''}in ${formatMonth(month)}`}
            </p>
            {canSeed && !confirmReseed && (
              <button
                ref={reseedRef}
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setConfirmReseed(true)}
              >
                Re-seed from averages
              </button>
            )}
          </div>
          {confirmReseed && counts !== null && (
            <p className="drill-hint budget-reseed-confirm">
              {/* The live region is the SENTENCE only: a role="status" wrapping the buttons
                  re-announces "Confirm Cancel" with every re-render of the count. */}
              <span role="status">
                {`Rewrites ${counts.rewrites} existing ${counts.rewrites === 1 ? 'budget' : 'budgets'} and sets ${newCount} new ${newCount === 1 ? 'one' : 'ones'} from ${formatMonth(month)}.`}
              </span>
              {/* autoFocus: the confirm IS the answer to the click that opened this line, so
                  focus follows the question rather than staying on a button that just left. */}
              <button type="button" className="button" autoFocus disabled={busy} onClick={seed}>
                Confirm
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setConfirmReseed(false)
                  // The Re-seed button remounts with that state change, so the ref points at
                  // the NEW node by the time the frame runs.
                  requestAnimationFrame(() => reseedRef.current?.focus())
                }}
              >
                Cancel
              </button>
            </p>
          )}
          <div className="budget-rows">
            {budgeted.map(({ category, budget, since, progress }) => (
              <div className="budget-entry" key={category.id}>
                <div className="budget-row">
                  <span className="budget-label">
                    <span className="budget-name">{category.name}</span>
                    {/* Its effective month (spec §B5): which budget is being read, and from when. */}
                    {since !== null && (
                      <span className="budget-since">since {formatMonth(since)}</span>
                    )}
                  </span>
                  <div
                    className="budget-meter"
                    role="meter"
                    aria-label={`${category.name} spend vs budget`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress.fillPct)}
                    aria-valuetext={`${formatCurrency(progress.spent)} of ${formatCurrency(progress.budget)}`}
                  >
                    <div
                      className={`budget-fill${progress.over ? ' is-over' : ''}`}
                      style={{ width: `${progress.fillPct.toFixed(2)}%` }}
                    />
                    {/* Over-ness rides a POSITION channel (the tick past the track's end),
                        not colour alone — the summary line carries it in words too. */}
                    {progress.over && <span className="budget-overflow-tick" aria-hidden="true" />}
                  </div>
                  <span className={`budget-figures${progress.over ? ' delta-negative' : ''}`}>
                    {`${formatCurrency(progress.spent)} / ${formatCurrency(progress.budget)}`}
                  </span>
                  {editorToggle(category, 'Edit')}
                </div>
                {openEditor === category.id && editorBlock(category, budget)}
              </div>
            ))}
          </div>
        </>
      ) : elsewhere !== null ? (
        // Budgets exist, just not this month: say where they are — and offer no seed, which
        // would write a second, overlapping set dated this month (spec §B5).
        <div className="budget-elsewhere">
          <p className="empty-note">
            {elsewhereSentence(
              formatMonth(month),
              elsewhere,
              formatMonth(matrix.months[elsewhere.targetIndex]),
            )}
          </p>
          {onViewMonth !== undefined && (
            <button
              type="button"
              className="button"
              onClick={() => viewMonth(matrix.months[elsewhere.targetIndex])}
            >
              View {formatMonth(matrix.months[elsewhere.targetIndex])}
            </button>
          )}
        </div>
      ) : (
        <div className="budget-seed">
          {/* W6: a lead sentence beside its button — not a centred placeholder 24px from both. */}
          <div className="budget-seed-row">
            <p className="empty-note">No budgets yet.</p>
            <button
              type="button"
              className="button button-primary"
              // Disabled says THAT it cannot run; only the hint says why, so the button has to
              // name it — a disabled control is otherwise mute to a screen reader.
              aria-describedby="budget-seed-hint"
              disabled={busy || !canSeed}
              onClick={seed}
            >
              Start from my averages
            </button>
          </div>
          <p className="drill-hint budget-seed-hint" id="budget-seed-hint">
            {seedHint()}
          </p>
        </div>
      )}
      {unbudgeted.length > 0 && (() => {
        // Where budgets exist in other months, "No budget yet" would contradict the sentence
        // above it ("your 13 budgets start Sep 2026"): name the month instead (spec §B5).
        const title =
          elsewhere === null
            ? `No budget yet (${unbudgeted.length})`
            : `No budget in force for ${formatMonth(month)} (${unbudgeted.length})`
        const rows = (
          <div className="budget-rows">
            {unbudgeted.map(({ category, budget }) => (
              <div className="budget-entry" key={category.id}>
                <div className="budget-row budget-row-unbudgeted">
                  <span className="budget-name">{category.name}</span>
                  {editorToggle(category, 'Set')}
                </div>
                {openEditor === category.id && editorBlock(category, budget)}
              </div>
            ))}
          </div>
        )
        // A disclosure only while budgets exist above it (spec §11); with none, getting one set IS
        // the card's job, so the list is open and plain.
        return budgeted.length > 0 ? (
          <Disclosure className="budget-unbudgeted" summary={title}>{rows}</Disclosure>
        ) : (
          <section className="budget-unbudgeted">
            <h3 className="eyebrow">{title}</h3>
            {rows}
          </section>
        )
      })()}
    </section>
  )
}
