import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../api/client'
import { fetchHousehold } from '../api/household'
import { fetchTimeseries } from '../api/netWorth'
import { fetchProjection } from '../api/projection'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import ChartCard from '../components/ChartCard'
import { fitPolyTrend } from '../components/projection/polyTrend'
import {
  netWorthProjectionCsv,
  netWorthProjectionOption,
  projectionCsv,
  projectionOption,
} from '../components/projection/projectionChartOptions'
import {
  decodeProjection,
  encodeProjection,
  isEmptyProjection,
  labelForProjection,
  toParams,
  type ProjectionScenario,
} from '../components/projection/projectionScenario'
import ScenarioPanel from '../components/projection/ScenarioPanel'
import StatTile from '../components/StatTile'
import Segmented from '../components/shell/Segmented'
import PageFrame from '../components/shell/PageFrame'
import { useSandbox, type SandboxSpec } from '../sandbox/useSandbox'
import type { HouseholdOut, NetWorthTimeseries, PersonOut, ProjectionOut } from '../types/api'
import { formatCurrency, formatMonth, formatPct } from '../utils/format'
import '../components/panels.css'
import './ProjectionPage.css'

function message(err: unknown, fallback: string): string {
  // 404/422 details are the server's own sentences — rendered verbatim (house note).
  return err instanceof ApiError ? err.message : fallback
}

// The trend chart's own forward spans — deliberately DECOUPLED from the Horizon knob:
// the trend chart's axis carries the whole history before it even starts projecting, so
// the knob's "years into the future from now" made the two charts' axes disagree while
// claiming one number. 40 is the sheet's original sweep.
const TREND_SPANS = [1, 5, 10, 40] as const
type TrendSpan = (typeof TREND_SPANS)[number]

// One frozen empty roster, so "the household has not answered" keeps a stable identity and
// the sandbox spec's memo (and every child's props) does not churn on it.
const NO_PEOPLE: PersonOut[] = []

// The eight knobs and the retirement months live in the URL (2026-09-03 planning-sandboxes
// spec §11): `?whatif=annual_return:0.06&whatif=retire:2:2035-06` IS the request the page
// sends, so a link reproduces a scenario exactly and the back button leaves the page rather
// than replaying slider positions. Blank means DERIVED — the knob is absent from the URL
// and the empty run's echo stands in for it. Recalculate is retired: `useSandbox` previews
// live through the already-pure GET /projection on a 300 ms trailing edge.
export default function ProjectionPage() {
  // The default run the last visit cached — the sandbox's initial baseline (and result, when
  // the URL carries no scenario), so the first paint is instant and revalidated underneath.
  const [cachedProjection] = useState(() => getSnapshot<ProjectionOut>('projection:default'))
  // The frame's Retry: a new dataKey re-runs the live scenario, the baseline and every pin.
  const [retryNonce, setRetryNonce] = useState(0)
  // Read before the spec so a pin's label can name the person; state, so its identity is
  // stable across renders and the spec's memo actually holds.
  const [household, setHousehold] = useState<HouseholdOut | null>(null)
  const roster = household?.people ?? NO_PEOPLE
  const spec = useMemo<SandboxSpec<ProjectionScenario, ProjectionOut>>(
    () => ({
      page: 'projection',
      decode: decodeProjection,
      encode: encodeProjection,
      isEmpty: isEmptyProjection,
      preview: (scenario) => fetchProjection(toParams(scenario)),
      dataKey: `projection:${retryNonce}`,
      debounceMs: 300,
      initialBaseline: cachedProjection ?? null,
      // The empty run IS the page's default payload — the one knob-free projection the
      // snapshot cache may hold (knob-parameterized runs never enter it).
      onBaseline: (baseline) => setSnapshot('projection:default', baseline),
      // A pin's default name says WHO retires, not which id (spec §11).
      labelFor: (scenario) => labelForProjection(scenario, roster),
    }),
    [retryNonce, cachedProjection, roster],
  )
  const sandbox = useSandbox(spec)
  // What the tiles and charts draw: the live scenario, or the derived run while it is empty.
  const data = sandbox.result ?? sandbox.baseline
  // A 404 is "nothing to project from yet" (no snapshots): the wizard, not a Retry.
  const missing = sandbox.result === null && sandbox.errorStatus === 404
  // The page's RESOURCE is the derived run. A knob's refusal belongs to the knobs card,
  // which words it itself through the panel's Feed and keeps the earlier figures on
  // screen — repeating it on the frame would say the same 422 twice and offer a Retry that
  // re-sends the scenario the server just refused. A failure with nothing on screen has no
  // other surface, so that one still rides the frame.
  const pageError = missing ? null : sandbox.empty || data === null ? sandbox.error : null

  // The history behind the trend chart — its OWN state and failure: the card degrades to a
  // note while the tiles, the investable chart and the knobs keep running.
  const [history, setHistory] = useState<NetWorthTimeseries | null>(
    () => getSnapshot<NetWorthTimeseries>('projection:history') ?? null,
  )
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [trendYears, setTrendYears] = useState<TrendSpan>(10)

  useEffect(() => {
    // Mount-only, never on a knob: the history doesn't change with the scenario — the
    // horizon reaches the chart through the projection echo instead.
    fetchTimeseries()
      .then((res) => {
        const previous = getSnapshot<NetWorthTimeseries>('projection:history')
        setSnapshot('projection:history', res)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(res)) return
        setHistory(res)
      })
      .catch((err: unknown) => setHistoryError(message(err, 'Failed to load net-worth history')))
  }, [])

  useEffect(() => {
    // Fetched on its own, never inside a Promise.all: the knobs are an affordance, and a
    // household hiccup must not blank the projection (NetWorthPage's isolated-fetch
    // posture). Once per visit; its own failure means no retirement knobs and nothing else.
    fetchHousehold()
      .then(setHousehold)
      .catch(() => setHousehold(null))
  }, [])


  // Still the cached payload — the very object on the first paint, or a revalidation that
  // changed nothing: either way a cached paint, so both charts stay still (2026-08-27 spec
  // §1). Identity alone would re-arm the entrance for an identical payload, because every
  // run resolves into a fresh object.
  const cachedJson = useMemo(
    () => (cachedProjection === undefined ? null : JSON.stringify(cachedProjection)),
    [cachedProjection],
  )
  const fromCache = useMemo(
    () =>
      data !== null &&
      cachedJson !== null &&
      (data === cachedProjection || JSON.stringify(data) === cachedJson),
    [data, cachedJson, cachedProjection],
  )

  // Linear/Log for the fan (F3) and the two charts' mirrored legend picks (§9) — page state,
  // fed back through the memoized options so a knob never resets them.
  const [log, setLog] = useState(false)
  const [fanLegend, setFanLegend] = useState<Record<string, boolean>>({})
  const [trendLegend, setTrendLegend] = useState<Record<string, boolean>>({})
  const onFanLegend = (selected: Record<string, boolean>) =>
    setFanLegend((current) => ({ ...current, ...selected }))
  const onTrendLegend = (selected: Record<string, boolean>) =>
    setTrendLegend((current) => ({ ...current, ...selected }))
  // Pinned scenarios that have answered join the chart as reference series (spec §11); one
  // still running, or refused, simply is not drawn.
  const references = useMemo(
    () =>
      sandbox.pins.flatMap((pin) => {
        const result = sandbox.pinResults[pin.id]
        return result === 'pending' || 'error' in result
          ? []
          : [{ name: pin.label, data: result.projected }]
      }),
    [sandbox.pins, sandbox.pinResults],
  )
  // Memoized (F3): EChart keys its setOption effect on [option], and a fresh object per
  // slider tick would redraw both charts on every pixel.
  const chart = useMemo(
    () => (data === null ? null : projectionOption(data, { log, selected: fanLegend, references })),
    [data, log, fanLegend, references],
  )
  const fit = useMemo(
    () => (history === null ? null : fitPolyTrend(history.months, history.net_worth)),
    [history],
  )
  const nwChart = useMemo(
    () =>
      history === null || data === null
        ? null
        : netWorthProjectionOption(history, fit, data.start_month, trendYears, {
            selected: trendLegend,
          }),
    [history, fit, data, trendYears, trendLegend],
  )

  return (
    <div className="page projection-page">
      <PageFrame
        title="Projection"
        resource={{
          // `missing` is not a failure to recover from: it renders its own empty state as
          // READY children, so the frame offers no alert and no Retry for it.
          status: missing
            ? 'ready'
            : data === null
              ? pageError !== null
                ? 'error'
                : 'loading'
              : 'ready',
          error: pageError,
          // NOT the sandbox's busy: the frame's dim covers the whole page (opacity only —
          // the controls stay live), so a 300 ms preview tick would visibly grey out the
          // very slider under the pointer. The two charts carry the cue themselves, and the
          // compare table gets it from the panel's own Feed.
          busy: false,
          fromCache,
          // A 422 is the SCENARIO's refusal, not the data's: re-running the same dataKey
          // would ask the server the same question it just answered, forever. On this page
          // the frame is the only surface a knob refusal can reach (the panel keeps its own
          // when there are figures under it), so Retry there has to mean what Reset to
          // derived means — drop the entries the server named and run without them.
          retry: () =>
            !sandbox.empty && sandbox.errorStatus === 422
              ? sandbox.reset()
              : setRetryNonce((n) => n + 1),
        }}
        skeleton={{ tiles: 5, cards: [{ span: 12, height: 340 }] }}
      >
        {missing ? (
          <section className="card">
            <h2 className="eyebrow">Projected investable balance</h2>
            {/* The server's sentence, plus where to go next: the projection stands on the
                latest net-worth snapshot, and a fresh database has none. */}
            <p className="empty-note">
              {sandbox.error} — <Link to="/update">enter a monthly update</Link> to start one.
            </p>
          </section>
        ) : (
          data !== null && (
            <>
              <div className="kpi-row">
                <StatTile
                  label="FI target"
                  value={data.fi_target === null ? '—' : formatCurrency(data.fi_target)}
                  delta={
                    data.fi_target === null
                      ? undefined
                      : `annual spend ÷ ${formatPct(data.swr_pct, { signed: false })} SWR`
                  }
                  tone="neutral"
                  hint="Annual spend ÷ withdrawal rate — the balance at which withdrawals could cover spending."
                />
                <StatTile
                  label="FI ratio"
                  value={
                    data.fi_ratio === null ? '—' : formatPct(data.fi_ratio, { signed: false })
                  }
                  hint="Investable balance as a share of the FI target."
                />
                <StatTile
                  label="Investable balance"
                  value={formatCurrency(data.starting_balance)}
                  delta={`as of ${formatMonth(data.base_month)}`}
                  tone="neutral"
                  hint="Pre-tax + post-tax + taxable + equity from the latest snapshot — cash and liabilities excluded."
                />
                <StatTile
                  label="Projected FI date"
                  value={data.fi_month === null ? '—' : formatMonth(data.fi_month)}
                  delta={
                    data.coast_fi_month === null
                      ? undefined
                      : `growth alone: ${formatMonth(data.coast_fi_month)}`
                  }
                  tone="neutral"
                  hint="First month the projected balance reaches the target; &quot;growth alone&quot; repeats it with contributions off."
                />
                <StatTile
                  label="FI probability"
                  value={
                    data.fi_probability === null
                      ? '—'
                      : formatPct(data.fi_probability, { signed: false })
                  }
                  delta={
                    // The gate stays p50 (the fan's presence); p10/p90 append around it —
                    // a stale backend that predates either simply names fewer percentiles.
                    data.fi_month_p50 === null
                      ? undefined
                      : `${
                          data.fi_month_p10 === null
                            ? ''
                            : `p10 ${formatMonth(data.fi_month_p10)} · `
                        }p50 ${formatMonth(data.fi_month_p50)}${
                          data.fi_month_p90 === null
                            ? ''
                            : ` · p90 ${formatMonth(data.fi_month_p90)}`
                        }`
                  }
                  tone="neutral"
                  hint="Share of 500 simulated paths reaching the target within the horizon, with optimistic (p10), median (p50) and pessimistic (p90) dates."
                />
              </div>

              {data.warnings.length > 0 && (
                // Advisory, never an error banner: the model ran — these are the honest
                // asterisks on what it ran with (the paycheck warnings register).
                <div className="projection-warnings">
                  {data.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              )}

              <div className="card-grid">
                <ChartCard
                  title="Net worth over time (projected)"
                  hint="Every snapshot as dots with a quadratic best-fit extended forward — momentum, not a plan. Log axis: equal steps are equal multiples; months at or below $0 are not drawn on the log scale."
                  // A refused fit draws dots ALONE, so the sentence must not promise a curve
                  // that is not on the canvas.
                  ariaLabel={
                    fit === null
                      ? 'Net worth history as dots, on a log scale'
                      : `Net worth history with a fitted trend extended ${trendYears} ${trendYears === 1 ? 'year' : 'years'} forward, on a log scale`
                  }
                  option={historyError === null ? nwChart : null}
                  // Advisory, never the page banner: the rest of the page runs without it.
                  error={historyError}
                  // The trend curve is extended from the projection's own t0, so a run in
                  // flight makes this card's tail stale as well as the fan below.
                  busy={(history === null && historyError === null) || sandbox.busy}
                  empty="Not enough monthly snapshots to chart yet."
                  exportName="net-worth-trend"
                  csv={
                    history === null
                      ? undefined
                      : () => netWorthProjectionCsv(history, fit, data.start_month, trendYears)
                  }
                  height={340}
                  zoomable
                  onLegendChange={onTrendLegend}
                  controls={
                    <Segmented
                      variant="toggle"
                      size="sm"
                      ariaLabel="Trend span"
                      options={TREND_SPANS.map((span) => ({ value: String(span), label: `${span}Y` }))}
                      value={String(trendYears)}
                      onChange={(value) => setTrendYears(Number(value) as TrendSpan)}
                    />
                  }
                  footer={
                    <p className="drill-hint">
                      {fit === null
                        ? 'The polynomial trendline needs at least three snapshots — showing the history alone. Log-scale axis: equal steps are equal multiples; months at or below $0 are not drawn on the log scale.'
                        : `Second-degree polynomial best-fit over every monthly net-worth snapshot, extended ${trendYears} ${trendYears === 1 ? 'year' : 'years'} — momentum, not a plan; the knob-driven model is the chart below. Log-scale axis: equal steps are equal multiples; months at or below $0 are not drawn on the log scale.`}
                    </p>
                  }
                />
                <ChartCard
                  title="Projected investable balance"
                  hint="Deterministic compounding at your assumptions; the bands hold the middle 50% and 80% of simulated outcomes. FI and Coast FI mark the months the target is reached; the shaded months come after it. The FI target and any pinned scenarios are dashed grey, each labelled at its own end."
                  ariaLabel={`Projected investable balance over the next ${data.years} years`}
                  option={chart}
                  busy={sandbox.busy}
                  empty="Nothing to chart at this horizon."
                  exportName="projection"
                  csv={() => projectionCsv(data)}
                  height={340}
                  zoomable
                  onLegendChange={onFanLegend}
                  controls={
                    <Segmented
                      variant="toggle"
                      size="sm"
                      ariaLabel="Axis scale"
                      options={[
                        { value: 'linear', label: 'Linear' },
                        { value: 'log', label: 'Log' },
                      ]}
                      value={log ? 'log' : 'linear'}
                      onChange={(value) => setLog(value === 'log')}
                    />
                  }
                  footer={
                    <p className="drill-hint">
                      Deterministic compounding at one assumed return — a planning sketch, not a
                      forecast. The chart reads in today&apos;s dollars by default (inflation is
                      modelled); set inflation to 0 to read nominal dollars. The growth-only line
                      is the same balance with contributions turned off. With a volatility, bands
                      are percentiles across 500 simulated lognormal-return paths — seed-stable,
                      so identical knobs redraw identical bands; the median path is their 50th.
                      On the Log scale, months at or below $0 are not drawn.
                    </p>
                  }
                />
              </div>

              {/* Server order: primary first, then by id — every owner control's order. */}
              <ScenarioPanel sandbox={sandbox} baseline={sandbox.baseline} people={roster} />
            </>
          )
        )}
      </PageFrame>
    </div>
  )
}
