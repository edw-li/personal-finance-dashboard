import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import BusyButton from '../feedback/BusyButton'
import { SaveButton } from '../feedback/SaveButton'
import { SaveStatus } from '../feedback/SaveStatus'
import { useSaveState } from '../feedback/useSaveState'
import { useDeleteWithUndo } from '../feedback/useDeleteWithUndo'
import { useConfirm } from '../feedback/confirm'
import { flashElement, revealEditor, useEscapeCancel } from '../feedback/reveal'
import { useLatest } from '../reorder/useLatest'
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
  FlowsPartOut,
  SpendingMatrix,
} from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatMonth } from '../../utils/format'
import { currentMonthIso, todayIso } from '../../utils/months'
import { dueByName } from '../../utils/timeWords'
import { budgetProgress } from '../../utils/spending'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import { windowWords } from '../overview/ytd'
import { useToast } from '../ToastProvider'
import Disclosure from '../Disclosure'
import BudgetSuggestions from './BudgetSuggestions'
import { isPartialMonth } from '../../charts/partial'
import {
  budgetSinceIndex,
  budgetsElsewhere,
  budgetsOpeningIndex,
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
  flowsDue,
  onDefaultMonth,
}: {
  matrix: SpendingMatrix
  /** The month the URL names (a ribbon pick or a deep link), as an index — it always wins.
   *  null when the URL names none: the card then opens where the budgets are (spec §B5). */
  monthIndex: number | null
  /** The page's own focus month — used only when no month has a budget in force. */
  defaultIndex?: number
  /** Moves the page to a month (the aware empty state's "View Sep 2026"). */
  onViewMonth?: (month: string) => void
  onBudgetsChanged: () => void | Promise<void>
  /** `GET /coverage` `time.flows_due` (2026-09-23 spec §T12): an ended month listed with its
   *  spending partly entered or missing reads so — never as a complete month under budget. */
  flowsDue?: readonly FlowsPartOut[]
  /** Hears the month the card OPENS on with nothing picked (null when it has none) — the Budgets
   *  view's default month for the scope row's Back and Edit (2026-09-23 spec §T8). Never the
   *  picked month: with a pick on screen, Back must still know where "latest" is. */
  onDefaultMonth?: (month: string | null) => void
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
  const [editorError, setEditorError] = useState<{ field: 'amount' | 'month'; text: string } | null>(null)
  const [baselines, setBaselines] = useState<Record<number, EditorState>>({})
  const saveState = useSaveState({ dirty: openEditor !== null && JSON.stringify(editors[openEditor]) !== JSON.stringify(baselines[openEditor]) })
  const panelRef = useRef<HTMLElement>(null)
  const historiesRef = useLatest(histories)
  const reloadRef = useLatest(onBudgetsChanged)
  const ask = useConfirm()
  const deleteWithUndo = useDeleteWithUndo()
  const entryFor = (id: number) => panelRef.current?.querySelector<HTMLElement>(`[data-budget-category="${id}"]`) ?? null
  const closeEditor = () => {
    const id = openEditor
    setOpenEditor(null)
    setEditorError(null)
    saveState.clearError()
    if (id !== null) entryFor(id)?.querySelector<HTMLElement>('.budget-editor-toggle')?.focus()
  }
  useEscapeCancel(panelRef, closeEditor, openEditor !== null)
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState<BudgetSuggestionsOut | null>(null)
  const [suggestionsFailed, setSuggestionsFailed] = useState(false)
  // The last seed's skip detail; cleared by its Undo, replaced by the next seed.
  const [seedStatus, setSeedStatus] = useState<string | null>(null)
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
  // Where the card opens with nothing picked: the pin after a write (it lives only while nothing
  // is picked — a pick drops it, and so does Back), else where the budgets are, else the page's
  // focus month.
  const openingIndex =
    monthIndex === null && pinnedIndex >= 0
      ? pinnedIndex
      : (budgetsOpeningIndex(activeBook, currentMonthIso()) ?? defaultIndex)
  const monthIndexShown = monthIndex ?? openingIndex
  const monthAt = (index: number) => (index >= 0 && index < matrix.months.length ? matrix.months[index] : null)

  const shownMonth = monthAt(monthIndexShown)
  // The Budgets view's default month for the scope row's Back and Edit (§T8) is where the card
  // opens — it lives here, so the card says it rather than the page re-deriving it. Not the month
  // on screen: a pick would make the default equal the pick, and Back would never appear.
  const defaultMonth = monthAt(openingIndex)
  useEffect(() => {
    onDefaultMonth?.(defaultMonth)
  }, [onDefaultMonth, defaultMonth])

  if (shownMonth === null) {
    return <p className="empty-note">Select an entered month in the ribbon to review its budgets.</p>
  }

  const month = shownMonth
  // Rent entered on the 1st and nothing else yet must read as partial, not as under budget.
  const inProgress = isPartialMonth(month, todayIso())
  // …and after the month has ended too, while its spending is only partly entered or not entered
  // at all (2026-09-23 spec §T12): September's rent saved on Sep 7 read "0 of 13 over" on Oct 3.
  const flows = inProgress ? undefined : flowsDue?.find((part) => part.month === `${month.slice(0, 7)}-01`)
  const partlyEntered = flows?.spending === 'partial'
  const notEntered = flows?.spending === 'missing'
  // "due by Oct 15" while the date is ahead, "was due Oct 15" once it has passed (spec §K3's copy,
  // the ribbon's and Needs attention's words for the same month).
  const due = flows === undefined ? '' : flows.overdue ? `was due ${dueByName(flows)}` : `due by ${dueByName(flows)}`
  const badge = inProgress ? 'Month to date' : partlyEntered ? 'Partly entered' : notEntered ? 'Not entered yet' : null
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
    seedBudgets(effectiveMonth)
      .then((out) => {
        setSeedStatus(skipSummary(out.skipped))
        requestAnimationFrame(() => headingRef.current?.focus())
        keepMonth()
        void reloadRef.current()
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
                        requestAnimationFrame(() => headingRef.current?.focus())
                        toast.success(`Undone — the ${formatMonth(month)} seed is gone.`)
                        void reloadRef.current()
                      })
                      .catch((err: unknown) => {
                        toast.error(failMessage(err, 'Undo failed'))
                        headingRef.current?.focus()
                      })
                  },
                },
              },
        )
      })
      .catch((err: unknown) => toast.error(failMessage(err, 'Failed to seed the budgets')))
      .finally(() => setBusy(false))
  }

  const save = (category: CategoryOut, editor: EditorState) => {
    if (busy || saveState.status === 'clean' || saveState.status === 'saved' || saveState.status === 'saving') return
    const trimmed = editor.amount.trim()
    if (trimmed !== '' && !isAmount(trimmed)) {
      setEditorError({ field: 'amount', text: 'Enter a number, e.g. 80' })
      revealEditor(entryFor(category.id)?.querySelector('.budget-editor') ?? null)
      return
    }
    const amount = trimmed === '' ? null : canonicalAmount(trimmed)
    if (amount !== null && Number(amount) < 0) {
      setEditorError({ field: 'amount', text: "Budgets can't be negative" })
      revealEditor(entryFor(category.id)?.querySelector('.budget-editor') ?? null)
      return
    }
    if (!/^\d{4}-\d{2}$/.test(editor.effectiveFrom)) {
      setEditorError({ field: 'month', text: 'Pick an effective-from month' })
      revealEditor(entryFor(category.id)?.querySelector('.budget-editor') ?? null, '[type="month"]')
      return
    }
    setEditorError(null)
    void saveState.run(async () => {
      const history = await putCategoryBudget(category.id, { amount, effective_month: `${editor.effectiveFrom}-01` })
      const saved = { ...editor, amount: amount ?? '' }
      setHistories((cur) => ({ ...cur, [category.id]: history }))
      setEditors((cur) => ({ ...cur, [category.id]: saved }))
      setBaselines((cur) => ({ ...cur, [category.id]: saved }))
      keepMonth()
      await reloadRef.current()
      requestAnimationFrame(() => {
        const entry = entryFor(category.id)
        flashElement(entry?.querySelector('.budget-row') ?? null)
        // A first budget moves its row from the unbudgeted list into the meter list.
        if (document.activeElement === document.body) entry?.querySelector<HTMLInputElement>('.budget-editor input')?.focus()
      })
    })
  }

  const removeRow = (category: CategoryOut, effectiveMonthIso: string) => {
    const entry = historiesRef.current[category.id]?.find((row) => row.effective_month === effectiveMonthIso)
    if (!entry) return
    const rowId = `budget-history-${category.id}-${effectiveMonthIso}`
    void deleteWithUndo({
      name: `the ${formatMonth(effectiveMonthIso)} budget row for ${category.name}`,
      row: document.getElementById(rowId),
      request: () => deleteCategoryBudget(category.id, effectiveMonthIso),
      onDeleted: async () => {
        setHistories((cur) => ({ ...cur, [category.id]: (cur[category.id] ?? []).filter((row) => row.effective_month !== effectiveMonthIso) }))
        keepMonth()
        await reloadRef.current()
      },
      focusAfter: () => entryFor(category.id)?.querySelector<HTMLElement>('.budget-editor input') ?? headingRef.current,
      onRestored: async () => {
        setHistories((cur) => ({ ...cur, [category.id]: [...(cur[category.id] ?? []).filter((row) => row.effective_month !== effectiveMonthIso), entry]
          .sort((a, b) => a.effective_month.localeCompare(b.effective_month)) }))
        setOpenEditor(category.id)
        await reloadRef.current()
      },
      restoredRow: () => document.getElementById(rowId),
    })
  }

  const editorBlock = (category: CategoryOut, budget: string | null) => {
    const editor = editors[category.id] ?? {
      amount: budget ?? '',
      effectiveFrom: defaultEffectiveFrom,
    }
    const setEditor = (patch: Partial<EditorState>) => {
      setEditorError(null)
      saveState.clearError()
      setEditors((cur) => ({ ...cur, [category.id]: { ...editor, ...patch } }))
    }
    const history = histories[category.id]
    const suggestion = suggestionById.get(category.id)
    return (
      <div className="budget-editor">
        <form className="budget-editor-form" onSubmit={(event) => { event.preventDefault(); save(category, editor) }}>
          <label>
            Monthly budget
            <AmountInput
              value={editor.amount}
              onValueChange={(next) => setEditor({ amount: next })}
              placeholder="blank ends the budget"
              aria-label={`${category.name} budget amount`}
              aria-invalid={editorError?.field === 'amount' || undefined}
              aria-describedby={editorError?.field === 'amount' ? `budget-error-${category.id}` : undefined}
            />
            {editorError?.field === 'amount' && <span className="budget-field-error" id={`budget-error-${category.id}`} role="alert">{editorError.text}</span>}
          </label>
          <label>
            Effective from
            <input
              type="month"
              aria-invalid={editorError?.field === 'month' || undefined}
              className="field-input"
              aria-label={`${category.name} budget effective from`}
              value={editor.effectiveFrom}
              onChange={(e) => setEditor({ effectiveFrom: e.target.value })}
            />
          </label>
          {editorError?.field === 'month' && <span className="budget-field-error" role="alert">{editorError.text}</span>}
          <SaveButton type="submit" className="button" aria-label={`Save ${category.name} budget`} state={saveState} aria-disabled={busy || undefined}>
            Save
          </SaveButton>
          <SaveStatus state={saveState} />
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
        </form>
        {history !== undefined && (
          <ul className="budget-history">
            {history.map((entry) => (
              <li key={entry.effective_month} id={`budget-history-${category.id}-${entry.effective_month}`}>
                <span>
                  {`${formatMonth(entry.effective_month)} — ${
                    entry.amount === null ? 'budget ends' : formatCurrency(entry.amount)
                  }`}
                </span>
                <BusyButton
                  type="button"
                  className="button"
                  aria-label={`Delete the ${formatMonth(entry.effective_month)} budget row for ${category.name}`}
                  disabled={busy}
                  onClick={() => removeRow(category, entry.effective_month)}
                >
                  Delete
                </BusyButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // The row's one control: "Edit budget" where a budget stands, "Set budget" where none does.
  const editorToggle = (category: CategoryOut, verb: 'Set' | 'Edit') => (
    <BusyButton
      type="button"
      className="button budget-editor-toggle"
      aria-label={`${verb} ${category.name} budget`}
      aria-expanded={openEditor === category.id}
      onClick={() => {
        if (openEditor === category.id) { closeEditor(); return }
        const initial = { amount: rows.find((row) => row.category.id === category.id)?.budget ?? '', effectiveFrom: defaultEffectiveFrom }
        flushSync(() => {
          if (!editors[category.id]) {
            setEditors((cur) => ({ ...cur, [category.id]: initial }))
            setBaselines((cur) => ({ ...cur, [category.id]: initial }))
          }
          setOpenEditor(category.id)
          setEditorError(null)
          saveState.clearError()
        })
        revealEditor(entryFor(category.id)?.querySelector('.budget-editor') ?? null)
      }}
    >
      {verb} budget
    </BusyButton>
  )

  const newCount = counts === null ? 0 : counts.writes - counts.rewrites

  const viewMonth = (target: string) => {
    onViewMonth?.(target)
    // The pressed button leaves with the month it offered: hand focus to the card's heading
    // (the house hand-off) rather than letting it fall to <body>.
    requestAnimationFrame(() => headingRef.current?.focus())
  }

  return (
    <section className="card span-12" ref={panelRef}>
      {/* tabIndex -1: the focus target after "View <month>", never a tab stop of its own. */}
      <h2 className="eyebrow" ref={headingRef} tabIndex={-1}>
        Budgets — {formatMonth(month)}
        {/* JSX drops the line break: without the space the heading's text reads "Sep 2026Month
            to date" to a screen reader, whatever the badge's margin shows (SourceHealth's note). */}
        {badge !== null && (
          <>
            {' '}
            <span className="badge">{badge}</span>
          </>
        )}
        <InfoHint text="Each budgeted category's spend against its budget for the month shown: the month picked in the ribbon, or else this month when a budget is in force, else the latest month that has one. Budgets are effective-dated: a change applies from its month forward and never rewrites history — each row says since when. With no transaction feed there is no mid-month pacing: a month still in progress reads month to date, and a month whose spending was saved while it was running reads partly entered until it is saved again after it ends or confirmed complete. Start from my averages writes every living category's typical spend as an editable budget; the editor's chips offer the same figures one at a time." />
      </h2>
      {seedStatus !== null && (
        <p className="drill-hint budget-seed-status" role="status">
          {seedStatus}
        </p>
      )}
      {budgeted.length > 0 ? (
        <>
          <div className="budget-summary-row">
            <p className="drill-hint" role="status">
              {notEntered
                ? `${formatMonth(month)} spending is not entered yet (${due}) — the meters read only what is on file.`
                : `${overCount} of ${budgeted.length} budgeted categories over ${inProgress || partlyEntered ? 'so far ' : ''}in ${formatMonth(month)}${
                    partlyEntered ? ` — its spending is partly entered (${due})` : ''
                  }`}
            </p>
            {canSeed && (
              <BusyButton
                type="button"
                className="button"
                busy={busy}
                onClick={async (event) => {
                  if (await ask({
                    anchor: event.currentTarget,
                    title: 'Re-seed budgets from averages?',
                    body: `Rewrites ${counts?.rewrites ?? 0} existing ${counts?.rewrites === 1 ? 'budget' : 'budgets'} and sets ${newCount} new ${newCount === 1 ? 'one' : 'ones'} from ${formatMonth(month)}. One Undo reverts the whole seed.`,
                    confirmLabel: 'Re-seed budgets',
                    tone: 'default',
                  })) seed()
                }}
              >
                Re-seed from averages
              </BusyButton>
            )}
          </div>
          <div className="budget-rows">
            {budgeted.map(({ category, budget, since, progress }) => (
              <div className="budget-entry" key={category.id} data-budget-category={category.id} aria-current={openEditor === category.id ? true : undefined}>
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
            <BusyButton
              type="button"
              className="button"
              onClick={() => viewMonth(matrix.months[elsewhere.targetIndex])}
            >
              View {formatMonth(matrix.months[elsewhere.targetIndex])}
            </BusyButton>
          )}
        </div>
      ) : (
        <div className="budget-seed">
          {/* W6: a lead sentence beside its button — not a centred placeholder 24px from both. */}
          <div className="budget-seed-row">
            <p className="empty-note">No budgets yet.</p>
            <BusyButton
              type="button"
              className="button button-primary"
              // Disabled says THAT it cannot run; only the hint says why, so the button has to
              // name it — a disabled control is otherwise mute to a screen reader.
              aria-describedby="budget-seed-hint"
              busy={busy}
              inert={!canSeed}
              onClick={seed}
            >
              Start from my averages
            </BusyButton>
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
              <div className="budget-entry" key={category.id} data-budget-category={category.id} aria-current={openEditor === category.id ? true : undefined}>
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
