import { useMemo, useState } from 'react'
import ChartCard from '../ChartCard'
import StatTile from '../StatTile'
import { useChartDecals } from '../useChartDecals'
import type { VestDayOut, VestingScheduleOut, VestOut } from '../../types/api'
import { formatCurrency, formatDate, formatShares } from '../../utils/format'
import { todayIso } from '../../utils/months'
import { vestingChartOption, vestingCsv, vestingTotals } from './vestingChartOptions'

/**
 * One vest date's rows: the summary row (the server's `vest_days` grouping, rendered
 * verbatim) and, while expanded, its per-grant tranche rows filtered from the flat feed.
 * The date cell is a real button (the accounts-table `.row-toggle` recipe) so the keyboard
 * reaches the expansion; the whole row stays clickable for the mouse.
 */
function DayRows({
  day,
  isNext,
  expanded,
  onToggle,
  tranches,
  latestPrice,
}: {
  day: VestDayOut
  isNext: boolean
  expanded: boolean
  onToggle: () => void
  tranches: VestOut[]
  latestPrice: string | null
}) {
  return (
    <>
      <tr
        className={day.is_past ? 'vest-past row-click' : 'row-click'}
        onClick={onToggle}
        style={{ cursor: 'pointer', background: expanded ? 'var(--surface-2)' : undefined }}
      >
        <td>
          <button
            type="button"
            className="row-toggle"
            aria-expanded={expanded}
            aria-label={`Toggle the ${formatDate(day.vest_date)} tranches`}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {formatDate(day.vest_date)}
          </button>
          {isNext && <span className="badge">next</span>}
        </td>
        <td className="num">{day.tranche_count}</td>
        <td className="num">{formatShares(day.shares)}</td>
        {/* Both money cells are the server's own grouping: a past day's close (every tranche
            on one day priced at the SAME bar, so this is exact), a future day's quote — with
            the est. marker carrying the difference. Null renders as the em dash either way. */}
        <td className="num">
          {formatCurrency(day.fmv)}
          {day.value_is_estimate && <span className="sub"> est.</span>}
        </td>
        <td className="num">
          {formatCurrency(day.value)}
          {day.value_is_estimate && <span className="sub"> est.</span>}
        </td>
      </tr>
      {tranches.map((vest) => (
        <tr
          key={`${vest.grant_id}-${vest.vest_date}`}
          className={vest.is_past ? 'vest-tranche vest-past' : 'vest-tranche'}
        >
          {/* The grant's name sits where the date would repeat — the expansion is the
              breakdown OF the date above it, and repeating the date four times is exactly
              the clutter the grouping retired. */}
          <td className="vest-tranche-label">{vest.label}</td>
          <td className="num" />
          <td className="num">{formatShares(vest.shares)}</td>
          <td className="num">
            {vest.is_past ? (
              formatCurrency(vest.fmv)
            ) : latestPrice === null ? (
              '—'
            ) : (
              <>
                {formatCurrency(latestPrice)} <span className="sub">est.</span>
              </>
            )}
          </td>
          {/* A past tranche's value is the server's; a future one's estimate lives on the
              day row above, where the server computed it — never multiplied out here. */}
          <td className="num">{vest.is_past ? formatCurrency(vest.value) : '—'}</td>
        </tr>
      ))}
    </>
  )
}

// One wording for one quote: the strip's tile hints and the schedule card's own hint
// describe the same figure, so both read this instead of keeping two copies in sync.
function quoteSourceOf(ticker: string | null): string {
  return ticker === null ? 'the latest employer quote' : `the latest ${ticker} quote`
}

/**
 * The schedule's three headline tiles, hoisted to the page top (2026-08-31 audit: the
 * next-vest figures sat below the fold). Same payload, same figures, rendered once — the
 * panel below keeps the quote line, the calendar and the table.
 */
export function VestingTiles({ schedule }: { schedule: VestingScheduleOut }) {
  const { tiles, ticker } = schedule
  // The no-grants branch lives HERE, beside the panel's own empty state that renders the
  // message (2026-08-31 review round): one owner for one condition, so the page gate and
  // the panel's empty branch can never drift apart.
  if (schedule.grants.length === 0) return null
  const quoteSource = quoteSourceOf(ticker)
  const nextVest = tiles.next_vest
  return (
    <div className="kpi-row">
      <StatTile
        label="Next vest"
        // formatDate's own null branch renders the em dash, so a schedule with nothing
        // ahead of it says so rather than showing a blank tile.
        value={formatDate(nextVest?.vest_date)}
        delta={
          nextVest === null
            ? undefined
            : `${formatShares(nextVest.shares)} sh · ${formatCurrency(nextVest.est_value)}`
        }
        hint={`The next vest date across every grant, all of its tranches summed and valued at ${quoteSource} — the same row the table badges.`}
      />
      <StatTile
        label="Unvested"
        value={`${formatShares(tiles.unvested_shares)} sh`}
        delta={formatCurrency(tiles.unvested_value)}
        hint={`Every share not yet vested, valued at ${quoteSource}.`}
      />
      <StatTile
        label="Vested this year"
        value={`${formatShares(tiles.vested_this_year_shares)} sh`}
        // No delta at all when nothing this year could be priced: an em dash under a
        // real share count would read as "worth nothing" rather than "not known".
        delta={
          tiles.vested_this_year_income === null
            ? undefined
            : formatCurrency(tiles.vested_this_year_income)
        }
        hint="This year's vests, each valued at its own vest-date close — the priced subset only."
      />
    </div>
  )
}

/**
 * The computed half of the Comp page: the vesting calendar and the vest table grouped one row
 * per date (2026-08-21 revision), each date expandable into its per-grant tranches. Its three
 * headline tiles moved to the page-top strip (`VestingTiles`, 2026-08-31 audit) — the card
 * order around this one is untouched. Pure display — it writes nothing and derives nothing,
 * because the whole payload is recomputed server-side on each read against the SERVER's day
 * (the vested split moves on its own between reads, so a figure re-derived here would disagree
 * with the one beside it).
 */
export default function VestingSchedulePanel({ schedule }: { schedule: VestingScheduleOut }) {
  // The legend picks the panel mirrors back into the option (§9), and the calendar itself.
  // Memoized: EChart keys its effect on [option] with notMerge, so a fresh object every render
  // would replay the chart on unrelated state flips (AllocationPanel's note).
  const [legend, setLegend] = useState<Record<string, boolean>>({})
  // Appearance › Chart patterns textures every series, so the estimate marker switches
  // from a hatch to a fade with it (and so does the footnote below).
  const patterns = useChartDecals()
  const calendar = useMemo(
    () =>
      vestingChartOption(schedule.vests, schedule.grants, schedule.latest_price, {
        todayIso: todayIso(),
        selected: legend,
        patterns,
      }),
    [schedule, legend, patterns],
  )

  const { ticker, latest_price: latestPrice } = schedule
  // The strip's two figures (F6): what has vested, summed from its own stored closes, and
  // the server's own unvested total — never re-derived here (it is judged against the
  // SERVER's day, so a client copy would disagree with the tile above).
  const totals = vestingTotals(schedule.vests)
  // The heading's hint says what the strip's tiles say — quoteSourceOf is the one wording.
  const quoteSource = quoteSourceOf(ticker)
  // The first DATE still ahead — the row the "next" badge belongs on. The feed is
  // chronological, so this is the day the strip's Next vest tile lands on.
  const nextDayIndex = schedule.vest_days.findIndex((day) => !day.is_past)

  // The expanded date (2026-08-21 revision, the user's own design): one date's tranches open
  // at a time — clicking another date swaps the expansion rather than stacking a second one,
  // and re-clicking the open date folds it. Stored as the DATE, never an index, so a reload
  // that reshapes the day list cannot mis-target (SpendingPage's detailMonth posture).
  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  const toggleDay = (date: string) =>
    setExpandedDate((current) => (current === date ? null : date))

  // Rendered in BOTH branches below: a grant too broken to schedule is dropped from `grants`
  // with a warning naming it, so the zero-grant empty state is exactly where a warning is most
  // likely to be the only evidence that the grant exists at all. Drift first — it is
  // informational (focal history disagreeing with a grant is a hint, never an error) and the
  // two lists stay apart so they can be toned apart later.
  const warningNotes = (
    <>
      {schedule.drift_warnings.map((warning) => (
        <p className="hint" key={warning}>
          {warning}
        </p>
      ))}
      {schedule.warnings.map((warning) => (
        <p className="hint" key={warning}>
          {warning}
        </p>
      ))}
    </>
  )

  return (
    <ChartCard
      title="Vesting schedule"
      hint={`Every vest from your grants — quarterly on the 3rd Wednesday. Past dates at their own close, future dates at ${quoteSource} (hatched, marked est.); the dashed rule is today.`}
      ariaLabel="Stacked bar chart of vest value per vest date by grant, future dates at today’s quote"
      option={schedule.grants.length === 0 ? null : calendar}
      empty={
        schedule.grants.length === 0
          ? 'No grants yet — add one above to see the schedule.'
          : 'Nothing priced to draw yet — see the notes below.'
      }
      exportName="vesting-calendar"
      csv={() => vestingCsv(schedule.vests, schedule.grants, latestPrice)}
      height={260}
      onLegendChange={(selected) => setLegend((current) => ({ ...current, ...selected }))}
      footer={
        <>
          {/* The quote the future half of this card was priced against. The date is rendered,
              not judged: freshness math on an instant flags a Friday bar early on Monday
              (Plan 4's "the UI compares dates only"), and nothing here has a staleness rule. */}
          {ticker === null ? (
            <p className="drill-hint">
              No employer ticker configured — set the espp_ticker setting to value these vests.
            </p>
          ) : latestPrice === null ? (
            <p className="drill-hint">
              {`${ticker} — no live quote; the future half of this card is unvalued.`}
            </p>
          ) : (
            <p className="drill-hint">
              {`${ticker} · ${formatCurrency(latestPrice)} · as of ${formatDate(schedule.quoted_at)}`}
            </p>
          )}
          {schedule.grants.length > 0 && (
            <p className="drill-hint">
              Vested {formatCurrency(totals.vested)} · Unvested{' '}
              {formatCurrency(schedule.tiles.unvested_value)} (est.)
              {' · '}
              <span>{patterns ? 'Faded' : 'Hatched'} = at today’s quote</span>
            </p>
          )}
          {warningNotes}
          {schedule.grants.length > 0 && (
            <>
              <p className="drill-hint">
                One row per vest date, every grant summed (past days at their own close, future
                days at today&apos;s quote, marked est.). Click a date to expand its per-grant
                tranches — opening another date folds the first.
              </p>
              <div className="vest-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="num">Tranches</th>
                      <th className="num">Shares</th>
                      <th className="num">Price</th>
                      <th className="num">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.vest_days.map((day, index) => (
                      <DayRows
                        key={day.vest_date}
                        day={day}
                        isNext={index === nextDayIndex}
                        expanded={expandedDate === day.vest_date}
                        onToggle={() => toggleDay(day.vest_date)}
                        tranches={
                          expandedDate === day.vest_date
                            ? schedule.vests.filter((vest) => vest.vest_date === day.vest_date)
                            : []
                        }
                        latestPrice={latestPrice}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      }
    />
  )
}
