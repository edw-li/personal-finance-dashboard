import { GhostTile, SkeletonTileRow } from '../PageSkeleton'
import StatTile from '../StatTile'
import type { EsppHeldTotals, EsppLotsResponse, EsppModelerOut } from '../../types/api'
import { formatCurrency, formatPct, formatShares } from '../../utils/format'
import '../panels.css'
import './espp.css'

// The one sentence a screen reader gets while the whole row is still a ghost.
export const STRIP_LABEL = 'Loading the ESPP headline…'

/** Why a quote-dependent tile has no figure — the delta line under its em dash. */
function unpricedNote(lots: EsppLotsResponse): string {
  return lots.espp_ticker === null ? 'no ESPP ticker configured' : 'no live quote'
}

function gainTone(gain: string | null): 'positive' | 'negative' | 'neutral' {
  if (gain === null) return 'neutral'
  const n = Number(gain)
  return n > 0 ? 'positive' : n < 0 ? 'negative' : 'neutral'
}

/**
 * The page-top headline (2026-09-07 spec §4): four tiles from the lots feed, the $25k tile
 * from the modeler. Two feeds, ONE row — while neither has answered the row is a five-tile
 * ghost, and once one has, its tiles paint while the other feed's slots stay ghosts, so the
 * row's box never moves (the 2026-09-05 CLS lesson: a strip that appears out of nothing
 * shoved every card below it). Every figure is the server's `totals` / modeler total.
 */
export default function PositionStrip({
  lots,
  lotsBusy,
  modeler,
  modelerBusy,
  modelerDirty,
}: {
  lots: EsppLotsResponse | null
  lotsBusy: boolean
  modeler: EsppModelerOut | null
  modelerBusy: boolean
  /** The modeler card's dirty flag: the $25k figure is stale until the rows are saved. */
  modelerDirty: boolean
}) {
  // A warm snapshot written before this batch has no `totals`: not loaded yet, not empty.
  const held: EsppHeldTotals | undefined = lots?.totals?.held
  if (held === undefined && modeler === null) {
    // Both feeds failed with nothing cached: the page banner carries that; a ghost that never
    // resolves would only promise something that is not coming.
    if (!lotsBusy && !modelerBusy) return null
    return <SkeletonTileRow tiles={5} label={STRIP_LABEL} />
  }
  // …and the same rule per feed once the OTHER one has painted: a failed feed with nothing
  // cached shows its slots as em dashes (the banner names why), and only a feed still in
  // flight — a pre-batch snapshot included, since its mount fetch is that flight — ghosts.
  const lotsFailed = held === undefined && !lotsBusy
  const modelerFailed = modeler === null && !modelerBusy
  // Dim only what is being revalidated OVER something already painted.
  const dim = (held !== undefined && lotsBusy) || (modeler !== null && modelerBusy)
  return (
    <div className={`loading-dim${dim ? ' is-loading' : ''}`}>
      <div className="kpi-row">
        {held === undefined || lots === null ? (
          lotsFailed ? (
            <>
              <StatTile label="Market value" value="—" hint="Your unsold lots at the current quote." />
              <StatTile label="Cost basis" value="—" hint="What those lots cost you, after the plan discount." />
              <StatTile label="Unrealized gain" value="—" hint="Market value less cost basis; the percentage is against cost. Realized gains from sold lots are in the lots table's totals row." />
              <StatTile label="Shares held" value="—" hint="Unsold ESPP shares across every lot." />
            </>
          ) : (
            <>
              <GhostTile />
              <GhostTile />
              <GhostTile />
              <GhostTile />
            </>
          )
        ) : (
          <>
            <StatTile
              label="Market value"
              value={formatCurrency(held.market_value)}
              delta={held.market_value === null ? unpricedNote(lots) : undefined}
              tone="neutral"
              hint="Your unsold lots at the current quote."
            />
            <StatTile
              label="Cost basis"
              value={formatCurrency(held.cost_basis)}
              hint="What those lots cost you, after the plan discount."
            />
            <StatTile
              label="Unrealized gain"
              value={formatCurrency(held.gain_amount)}
              delta={held.gain_pct === null ? unpricedNote(lots) : formatPct(held.gain_pct)}
              tone={gainTone(held.gain_amount)}
              hint="Market value less cost basis; the percentage is against cost. Realized gains from sold lots are in the lots table's totals row."
            />
            <StatTile
              label="Shares held"
              value={formatShares(held.shares)}
              delta={`${held.lots} ${held.lots === 1 ? 'lot' : 'lots'}`}
              tone="neutral"
              hint="Unsold ESPP shares across every lot."
            />
          </>
        )}
        {modeler === null ? (
          modelerFailed ? (
            // No payload, so no year to name it by.
            <StatTile
              label="$25k limit used"
              value="—"
              hint="The Purchase modeler's chained total against the IRS §423 ceiling, at its current year and knobs — the meter in that card draws the same figure long."
            />
          ) : (
            <GhostTile />
          )
        ) : (
          <StatTile
            label={`$25k limit used — ${modeler.year}`}
            value={formatCurrency(modeler.totals.total_25k_value)}
            delta={`${formatCurrency(modeler.totals.remaining_25k)} left`}
            tone="neutral"
            hint="The Purchase modeler's chained total against the IRS §423 ceiling, at its current year and knobs — the meter in that card draws the same figure long."
          />
        )}
      </div>
      {/* The card's own dirty note, echoed beside the headline it disclaims — the tile and the
          meter must never disagree silently (2026-08-31 review round). */}
      {modelerDirty && modeler !== null && (
        <p className="drill-hint">
          Unsaved period edits below — this figure is stale until you save &amp; recalculate.
        </p>
      )}
    </div>
  )
}
