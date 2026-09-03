import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMonth } from '../../utils/format'
import { addMonths, lastNMonths } from '../../utils/months'
import './shell.css'

// The app's signature device, second edition (2026-09-03 shell spec §7): a twelve-month
// window that pages back to the earliest covered month, year labels where the year turns, a
// ring on the current month, and TWO-TONE chips — left half balances, right half spending —
// so "entered" finally means which feed. Click semantics belong to the caller: view pages
// select a month, the wizard edits one; the Edit link covers the other verb.
export interface RibbonCoverage {
  balances: ReadonlySet<string>
  spending: ReadonlySet<string>
}

export const RIBBON_PAGE = 12

function windowFor(anchor: string, page: number): string[] {
  return lastNMonths(addMonths(anchor, -page * RIBBON_PAGE), RIBBON_PAGE)
}

/** The page index whose window contains `month` (0 = the window ending at the anchor). */
export function pageContaining(anchor: string, month: string): number {
  const [ay, am] = anchor.split('-').map(Number)
  const [my, mm] = month.split('-').map(Number)
  const distance = ay * 12 + am - (my * 12 + mm)
  return distance <= 0 ? 0 : Math.floor(distance / RIBBON_PAGE)
}

export default function MonthRibbon({
  anchor,
  earliest,
  coverage,
  selected,
  mode,
  onSelect,
  figures,
  editHref,
}: {
  /** The current calendar month (first-of-month ISO) — the ribbon's right edge. */
  anchor: string
  /** Earliest covered month across the feeds, or null while unknown (no paging back). */
  earliest: string | null
  coverage: RibbonCoverage | null
  selected?: string
  mode: 'view' | 'edit'
  onSelect: (monthIso: string) => void
  /** Figure to print in a chip's label (Net worth: that month's total). */
  figures?: Record<string, string>
  /** View pages: where "Edit <month>" goes. */
  editHref?: (monthIso: string) => string
}) {
  // The window is DERIVED from the selection, not synced to it: ‹ › paging is remembered against
  // the scope it happened in, so any new anchor or selection — a deep link, "Back to latest"
  // clearing the month — retires that memory and the window follows the selection again. The
  // obvious sync is an effect, which the house forbids (react-hooks/set-state-in-effect), and
  // adjusting state during render trips its sibling set-state-in-render; deriving needs neither.
  // Clicking a chip inside the visible window never jumps it: pageContaining maps every month of
  // a window back to that window's own page index.
  const scope = `${anchor}|${selected ?? ''}`
  const [paged, setPaged] = useState<{ scope: string; page: number } | null>(null)
  const page = paged?.scope === scope ? paged.page : selected ? pageContaining(anchor, selected) : 0
  const goTo = (next: number) => setPaged({ scope, page: Math.max(0, next) })

  const months = windowFor(anchor, page)
  const canGoEarlier = earliest !== null && months[0] > earliest
  const canGoLater = page > 0

  return (
    <div className="ribbon" role="group" aria-label="Month coverage">
      <button
        type="button"
        className="ribbon-page"
        aria-label="Earlier months"
        disabled={!canGoEarlier}
        onClick={() => goTo(page + 1)}
      >
        <ChevronLeft size={14} aria-hidden="true" />
      </button>
      {months.map((month, index) => {
        const hasBalances = coverage?.balances.has(month) ?? false
        const hasSpending = coverage?.spending.has(month) ?? false
        const yearTurns = index === 0 || month.slice(0, 4) !== months[index - 1].slice(0, 4)
        const state =
          coverage === null
            ? 'coverage unknown'
            : hasBalances && hasSpending
              ? 'balances and spending entered'
              : hasBalances
                ? 'balances entered, spending missing'
                : hasSpending
                  ? 'spending entered, balances missing'
                  : 'nothing entered'
        const figure = figures?.[month]
        const label = `${formatMonth(month)} — ${figure ? `${figure} — ` : ''}${state}`
        const classes = [
          'month-chip2',
          hasBalances ? 'has-balances' : '',
          hasSpending ? 'has-spending' : '',
          month === anchor ? 'is-today' : '',
          month === selected ? 'selected' : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <span className="ribbon-slot" key={month}>
            {yearTurns && coverage !== null && (
              <span className="ribbon-year" aria-hidden="true">
                {month.slice(0, 4)}
              </span>
            )}
            <button
              type="button"
              className={classes}
              title={label}
              aria-label={label}
              aria-pressed={selected === undefined ? undefined : month === selected}
              onClick={() => onSelect(month)}
            >
              <span className="month-chip2-dot" aria-hidden="true" />
              <span className="month-chip2-label">{formatMonth(month).slice(0, 3)}</span>
            </button>
          </span>
        )
      })}
      <button
        type="button"
        className="ribbon-page"
        aria-label="Later months"
        disabled={!canGoLater}
        onClick={() => goTo(page - 1)}
      >
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      {mode === 'view' && selected !== undefined && editHref !== undefined && (
        <Link className="ribbon-edit" to={editHref(selected)} aria-label={`Edit ${formatMonth(selected)} in the wizard`}>
          Edit ↗
        </Link>
      )}
    </div>
  )
}
