import { useState } from 'react'
import { ApiError } from '../../api/client'
import { deleteCategoryBudget, putCategoryBudget } from '../../api/spending'
import type { CategoryBudgetEntry, CategoryOut, SpendingMatrix } from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatMonth } from '../../utils/format'
import { budgetProgress } from '../../utils/spending'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import '../panels.css'
import './budgets.css'

interface EditorState {
  amount: string
  effectiveFrom: string // YYYY-MM; '-01' is appended at save (budgets are month-dated)
}

function failMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * The Budget card (spec §4.2): one 4px meter per BUDGETED category for the page's focused
 * month, unbudgeted actives collapsed below, and the app's first budget-management
 * surface — an inline effective-dated editor whose PUT response is the history it renders.
 * Plain HTML/CSS in the StatTile family, no ECharts.
 */
export default function BudgetPanel({
  matrix,
  monthIndex,
  onBudgetsChanged,
}: {
  matrix: SpendingMatrix
  monthIndex: number
  onBudgetsChanged: () => void
}) {
  const [editors, setEditors] = useState<Record<number, EditorState>>({})
  // Histories arrive ONLY as PUT responses (spec §3 — no history GET exists), so the
  // expandable list appears per category once this session has saved it.
  const [histories, setHistories] = useState<Record<number, CategoryBudgetEntry[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const month = matrix.months[monthIndex]
  // A5 (2026-08-31 tier-1): default to the FOCUSED month — the month the meters read.
  // The old next-calendar-month default made a first budget save successfully and
  // visibly do nothing (the meters were reading a month the budget hadn't reached).
  // months entries are YYYY-MM-01 (or YYYY-MM in old fixtures); the input wants YYYY-MM.
  const defaultEffectiveFrom = month.slice(0, 7)

  const seriesById = new Map(matrix.series.map((s) => [s.category_id, s]))
  const rows = matrix.categories
    .filter((c) => c.is_active)
    .map((category) => {
      const series = seriesById.get(category.id)
      const spent = series?.values[monthIndex] ?? null
      const budget = series?.budgets[monthIndex] ?? null
      return { category, budget, progress: budgetProgress(spent, budget) }
    })
  const budgeted = rows.flatMap((row) =>
    row.progress === null ? [] : [{ ...row, progress: row.progress }],
  )
  const unbudgeted = rows.filter((row) => row.progress === null)
  const overCount = budgeted.filter((row) => row.progress.over).length

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
        onBudgetsChanged()
      })
      .catch((err: unknown) => setError(failMessage(err, 'Failed to save the budget')))
      .finally(() => setBusy(false))
  }

  const removeRow = (category: CategoryOut, effectiveMonth: string) => {
    setBusy(true)
    setError(null)
    deleteCategoryBudget(category.id, effectiveMonth)
      .then(() => {
        setHistories((cur) => ({
          ...cur,
          [category.id]: (cur[category.id] ?? []).filter(
            (h) => h.effective_month !== effectiveMonth,
          ),
        }))
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
    return (
      <details className="budget-editor">
        <summary>Set budget</summary>
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
      </details>
    )
  }

  return (
    <section className="card span-12">
      <h2 className="eyebrow">
        Budgets — {formatMonth(month)}
        <InfoHint text="Each budgeted category's spend against its budget for the focused month. Budgets are effective-dated: a change applies from its month forward and never rewrites history. With no transaction feed there is no mid-month pacing — meters describe completed months and the live wizard entry." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {budgeted.length > 0 ? (
        <>
          <p className="drill-hint" role="status">
            {`${overCount} of ${budgeted.length} budgeted categories over in ${formatMonth(month)}`}
          </p>
          <div className="budget-rows">
            {budgeted.map(({ category, budget, progress }) => (
              <div className="budget-row" key={category.id}>
                <span className="budget-name">{category.name}</span>
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
                {editorBlock(category, budget)}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="empty-note">
          No budgets yet — set one below and the meters appear from that month on.
        </p>
      )}
      {unbudgeted.length > 0 && (
        <details className="budget-unbudgeted">
          <summary>{`No budget — set one (${unbudgeted.length})`}</summary>
          <div className="budget-rows">
            {unbudgeted.map(({ category, budget }) => (
              <div className="budget-row" key={category.id}>
                <span className="budget-name">{category.name}</span>
                {editorBlock(category, budget)}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
