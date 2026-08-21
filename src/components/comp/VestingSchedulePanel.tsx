import { useMemo } from 'react'
import EChart from '../EChart'
import InfoHint from '../InfoHint'
import StatTile from '../StatTile'
import type { VestingScheduleOut } from '../../types/api'
import { formatCurrency, formatDate, formatShares } from '../../utils/format'
import { vestingChartOption } from './vestingChartOptions'

/**
 * The computed half of the Comp page: three tiles, the vesting calendar, and every tranche of
 * every grant in one table. Pure display — it writes nothing and derives nothing, because the
 * whole payload is recomputed server-side on each read against the SERVER's day (the vested
 * split moves on its own between reads, so a figure re-derived here would disagree with the
 * one beside it).
 */
export default function VestingSchedulePanel({ schedule }: { schedule: VestingScheduleOut }) {
  // Memoized: EChart keys its effect on [option] with notMerge, so a fresh object every render
  // would replay the chart on unrelated state flips (AllocationPanel's note).
  const calendar = useMemo(
    () => vestingChartOption(schedule.vests, schedule.grants, schedule.latest_price),
    [schedule],
  )

  const { tiles, ticker, latest_price: latestPrice } = schedule
  // Named once, so all three tiles' hints say the same thing about the same quote.
  const quoteSource = ticker === null ? 'the latest employer quote' : `the latest ${ticker} quote`
  const nextVest = tiles.next_vest
  // The first tranche still ahead — the row the "next" badge belongs on. The feed is
  // chronological, so this is the same vest the tile names.
  const nextIndex = schedule.vests.findIndex((vest) => !vest.is_past)

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
    <section className="card">
      <h2 className="eyebrow">
        Vesting schedule
        <InfoHint
          text={`Every future vest from your grants — quarterly on the 3rd Wednesday; values at ${quoteSource}.`}
        />
      </h2>
      {/* The quote the future half of this card was priced against. The date is rendered, not
          judged: freshness math on an instant flags a Friday bar early on Monday (Plan 4's
          "the UI compares dates only"), and nothing here has a staleness rule to enforce. */}
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
      {schedule.grants.length === 0 ? (
        <>
          {warningNotes}
          <p className="empty-note">No grants yet — add one below to see the schedule.</p>
        </>
      ) : (
        <>
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
              hint={`The next tranche across every grant, valued at ${quoteSource}.`}
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
          {calendar && <EChart option={calendar} height={260} />}
          {warningNotes}
          <p className="drill-hint">
            Every tranche of every grant, past and future together. A past row carries the
            close it actually vested at; a future one has no close yet, so its value is left
            blank — the estimate at today&apos;s quote is in the tile and the chart above.
          </p>
          <div className="comp-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Grant</th>
                  <th className="num">Shares</th>
                  <th className="num">Price</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {schedule.vests.map((vest, index) => (
                  // A grant vests at most once on a date, so the pair is the row's identity.
                  <tr
                    key={`${vest.grant_id}-${vest.vest_date}`}
                    className={vest.is_past ? 'vest-past' : undefined}
                  >
                    <td>
                      {formatDate(vest.vest_date)}
                      {index === nextIndex && <span className="badge">next</span>}
                    </td>
                    <td>{vest.label}</td>
                    <td className="num">{formatShares(vest.shares)}</td>
                    {/* A past tranche was priced at the close on or before its own day; a
                        future one has no close at all, so the live quote is shown as the
                        estimate it is — and as nothing when there is no quote. */}
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
                    {/* Server-verbatim or nothing. A future tranche's value would have to be
                        multiplied out here, and this column sits beside figures the server
                        computed — the estimate lives in the tile and the chart above, where it
                        is labelled as one. */}
                    <td className="num">{vest.is_past ? formatCurrency(vest.value) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
