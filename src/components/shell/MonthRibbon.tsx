import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMonth } from '../../utils/format'
import { addMonths, lastNMonths } from '../../utils/months'
import './shell.css'

// The app's signature device, second edition (2026-09-03 shell spec §7): a twelve-month
// window ending at the anchor that pages back to the earliest covered month, year labels where
// the year turns, a ring on the CURRENT month — which is not always the anchor, since the
// wizard anchors at max(next entry month, current month) — and TWO-TONE chips: left half
// balances, right half spending, so "entered" finally means which feed. Click semantics belong
// to the caller: view pages select a month, the wizard edits one; the Edit link is the other verb.
export interface RibbonCoverage {
  balances: ReadonlySet<string>
  spending: ReadonlySet<string>
}

export const RIBBON_PAGE = 12

/** The twelve months ending `page` pages before the anchor (page 0 = the anchor's own window). */
export function windowFor(anchor: string, page: number): string[] {
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
  today,
  earliest,
  coverage,
  selected,
  mode,
  onSelect,
  figures,
  editHref,
}: {
  /** The ribbon's right edge (first-of-month ISO) — the latest month it will show. */
  anchor: string
  /** The current calendar month, which wears the ring; defaults to the anchor. The wizard
   *  anchors ahead of today, so the right-edge month is not always the current one. */
  today?: string
  /** Earliest covered month across the feeds, or null while unknown (no paging back). */
  earliest: string | null
  /** Which months have balances / spending entered, or null until /coverage resolves — chips
   *  render hollow rather than claiming a month is empty. */
  coverage: RibbonCoverage | null
  selected?: string
  /** 'view' pages select a month and offer the Edit link; 'edit' IS the wizard, so it shows none. */
  mode: 'view' | 'edit'
  onSelect: (monthIso: string) => void
  /** Figure to print in a chip's label (Net worth: that month's total). */
  figures?: Record<string, string>
  /** View pages: where "Edit <month>" goes. */
  editHref?: (monthIso: string) => string
}) {
  // ‹ › paging is real state, not a memory keyed by anchor+selection: such a key can be
  // re-matched later (Back re-selecting an old month) and revive a window the selected chip is
  // no longer in. Clicking a chip inside the visible window never jumps it either way, because
  // pageContaining maps every month of a window back to that window's own page index.
  const [page, setPage] = useState(() => (selected ? pageContaining(anchor, selected) : 0))
  const [seen, setSeen] = useState({ anchor, selected })
  if (seen.anchor !== anchor || seen.selected !== selected) {
    // A selection made elsewhere (deep link, Back, the wizard's reset) recenters the window; a
    // cleared selection returns to the anchor window. Adjust-during-render, not an effect.
    setSeen({ anchor, selected })
    setPage(selected ? pageContaining(anchor, selected) : 0)
  }

  const months = windowFor(anchor, page)
  // The pagers go aria-disabled with the handlers guarding, never natively disabled: paging by
  // keyboard ends ON the press that hits the boundary, and a button that disables itself under
  // the user's finger leaves the tab order — focus drops to the document and the next Tab
  // restarts from the top of the page.
  const canGoEarlier = earliest !== null && months[0] > earliest
  const canGoLater = page > 0
  const todayMonth = today ?? anchor
  // Viewing the latest month still deserves the affordance — the current month is exactly what
  // the wizard is for — so an unselected view page edits the anchor.
  const editTarget = selected ?? anchor

  return (
    <div className="ribbon" role="group" aria-label="Month coverage">
      <button
        type="button"
        className="ribbon-page"
        aria-label="Earlier months"
        aria-disabled={!canGoEarlier}
        onClick={() => {
          if (canGoEarlier) setPage((p) => p + 1)
        }}
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
          month === todayMonth ? 'is-today' : '',
          month === selected ? 'selected' : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <span className="ribbon-slot" key={month}>
            {/* Calendar fact, not coverage: printing the year only once /coverage lands would
                grow the sticky row under the reader mid-load. */}
            {yearTurns && (
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
        aria-disabled={!canGoLater}
        onClick={() => {
          if (canGoLater) setPage((p) => Math.max(0, p - 1))
        }}
      >
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      {mode === 'view' && editHref !== undefined && (
        <Link
          className="ribbon-edit"
          to={editHref(editTarget)}
          aria-label={`Edit ${formatMonth(editTarget)} in the wizard`}
        >
          Edit ↗
        </Link>
      )}
    </div>
  )
}
