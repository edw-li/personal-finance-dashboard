import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../api/client'
import { fetchTimeseries } from '../api/netWorth'
import { fetchProjection } from '../api/projection'
import type { ProjectionParams } from '../api/projection'
import EChart from '../components/EChart'
import ChartZoomHint from '../components/ChartZoomHint'
import InfoHint from '../components/InfoHint'
import { fitPolyTrend } from '../components/projection/polyTrend'
import {
  netWorthProjectionOption,
  projectionCsv,
  projectionOption,
} from '../components/projection/projectionChartOptions'
import StatTile from '../components/StatTile'
import type { NetWorthTimeseries, ProjectionOut } from '../types/api'
import { formatCurrency, formatMonth, formatPct } from '../utils/format'
import { isPlainDecimal, shiftPoint } from '../utils/percent'
import '../components/panels.css'
import './ProjectionPage.css'

function message(err: unknown, fallback: string): string {
  // 404/422 details are the server's own sentences — rendered verbatim (house note).
  return err instanceof ApiError ? err.message : fallback
}

// The eight what-if knobs, percent-form where the wire wants fractions ("5" = 5%/yr —
// shiftPoint converts on the way out, the echo shifts back on the way in). Blank means
// "let the server decide", which is the whole modeler contract: derived from the data for
// the five older knobs, the planning DEFAULT for the three assumptions. All eight seed
// from the echo (2026-08-20 user revision). An explicit 0 is a value, not a blank —
// volatility 0 turns the fan off, inflation 0 reads nominal dollars.
interface Knobs {
  annualReturn: string
  monthlyContribution: string
  annualSpend: string
  swr: string
  volatility: string
  inflation: string
  contributionGrowth: string
  years: string
}

const EMPTY_KNOBS: Knobs = {
  annualReturn: '',
  monthlyContribution: '',
  annualSpend: '',
  swr: '',
  volatility: '',
  inflation: '',
  contributionGrowth: '',
  years: '',
}

// The router's own fences, refused here in the BOX's vocabulary rather than spending a
// request on the 422 (PaycheckPage's posture) — percent boxes hold percents, so the
// server's fraction-worded bounds would call a perfectly good 5 out of range.
const RETURN_MIN_PCT = -50
const RETURN_MAX_PCT = 50
// 0 is INSIDE the volatility fence: it is the fan's off switch server-side, not a refusal.
const VOLATILITY_MAX_PCT = 100
const INFLATION_MIN_PCT = -10
const INFLATION_MAX_PCT = 25
const GROWTH_MAX_PCT = 25
const YEARS_MIN = 1
const YEARS_MAX = 60

// The trend chart's own forward spans — deliberately DECOUPLED from the Horizon knob:
// the trend chart's axis carries the whole history before it even starts projecting, so
// the knob's "years into the future from now" made the two charts' axes disagree while
// claiming one number. 40 is the sheet's original sweep.
const TREND_SPANS = [1, 5, 10, 40] as const
type TrendSpan = (typeof TREND_SPANS)[number]

export default function ProjectionPage() {
  const [data, setData] = useState<ProjectionOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The 404 branch is not a failure to recover from — it is "there is nothing to project
  // from yet", so it gets its own flag rather than the error banner: with no snapshots
  // behind it the answer on screen is the monthly-update wizard, not a Retry.
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)
  const [knobs, setKnobs] = useState<Knobs>(EMPTY_KNOBS)
  // The history behind the new chart — its OWN state and failure: the card degrades to a
  // note while the tiles, the investable chart and the form keep running.
  const [history, setHistory] = useState<NetWorthTimeseries | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [trendYears, setTrendYears] = useState<TrendSpan>(10)
  // Two recalculates in a row are two runs in flight; only the newest may land.
  const seqRef = useRef(0)
  // Seeded once, ever: a later echo must not overwrite knobs mid-typing. (This page keeps
  // echo-seeding because blank knobs here mean "derived defaults" the user should SEE to
  // adjust; the ESPP modeler retired its seed in favour of blank-means-smart-default.)
  const knobsSeeded = useRef(false)

  // Promise callbacks only — no setState in an effect's synchronous body (react-hooks 7).
  // The mount fetch is covered by the initial busy value; the handlers below flip it.
  const load = (params: ProjectionParams = {}) => {
    const seq = ++seqRef.current
    fetchProjection(params)
      .then((res) => {
        if (seq !== seqRef.current) return
        setData(res)
        setError(null)
        setMissing(false)
        if (!knobsSeeded.current) {
          knobsSeeded.current = true
          // The echo IS the seed, for all eight knobs alike: the server answers with the
          // values it actually used (derived or defaulted), shifted into the boxes'
          // percent vocabulary. Per-field, because the boxes are on screen throughout this
          // first load (EsppPage's rule). The three assumption knobs seeded like the rest
          // (2026-08-20 user revision — the earlier placeholder treatment is retired);
          // their null-echo guards are stale-backend armor, leaving those boxes blank.
          setKnobs((current) => ({
            ...current,
            annualReturn:
              current.annualReturn === '' ? shiftPoint(res.annual_return, 2) : current.annualReturn,
            monthlyContribution:
              current.monthlyContribution === ''
                ? res.monthly_contribution
                : current.monthlyContribution,
            annualSpend: current.annualSpend === '' ? (res.annual_spend ?? '') : current.annualSpend,
            swr: current.swr === '' ? shiftPoint(res.swr_pct, 2) : current.swr,
            years: current.years === '' ? String(res.years) : current.years,
            volatility:
              current.volatility === '' && res.volatility != null
                ? shiftPoint(res.volatility, 2)
                : current.volatility,
            inflation:
              current.inflation === '' && res.inflation != null
                ? shiftPoint(res.inflation, 2)
                : current.inflation,
            contributionGrowth:
              current.contributionGrowth === '' && res.contribution_growth != null
                ? shiftPoint(res.contribution_growth, 2)
                : current.contributionGrowth,
          }))
        }
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        // Dropped, not kept: the chart is a function of the knobs, and leaving the last
        // run on screen would read as the answer for the current ones (EsppPage's modeler).
        setData(null)
        setMissing(err instanceof ApiError && err.status === 404)
        setError(message(err, 'Failed to run the projection'))
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }

  useEffect(() => {
    load()
    // mount-only: load is a plain function over stable setters (house idiom)
  }, [])

  useEffect(() => {
    // Mount-only, never on Recalculate: the history doesn't change with the knobs — the
    // horizon reaches the chart through the projection echo instead.
    fetchTimeseries()
      .then((res) => setHistory(res))
      .catch((err: unknown) =>
        setHistoryError(message(err, 'Failed to load net-worth history')),
      )
  }, [])

  const setKnob = (field: keyof Knobs) => (value: string) => {
    setKnobs((current) => ({ ...current, [field]: value }))
    setFormError(null) // the sentence described the values that WERE in the boxes
  }

  const recalculate = () => {
    const ret = knobs.annualReturn.trim()
    if (ret !== '') {
      if (!isPlainDecimal(ret)) {
        setFormError('Annual return % must be a number')
        return
      }
      const n = Number(ret)
      if (n < RETURN_MIN_PCT || n > RETURN_MAX_PCT) {
        setFormError(`Annual return % must be between ${RETURN_MIN_PCT} and ${RETURN_MAX_PCT}`)
        return
      }
    }
    const swr = knobs.swr.trim()
    if (swr !== '') {
      if (!isPlainDecimal(swr)) {
        setFormError('Withdrawal rate % must be a number')
        return
      }
      const n = Number(swr)
      if (!(n > 0) || n > 100) {
        setFormError('Withdrawal rate % must be greater than 0 and at most 100')
        return
      }
    }
    const contribution = knobs.monthlyContribution.trim()
    if (contribution !== '' && !isPlainDecimal(contribution)) {
      setFormError('Monthly contribution must be a number')
      return
    }
    const spend = knobs.annualSpend.trim()
    if (spend !== '' && (!isPlainDecimal(spend) || !(Number(spend) > 0))) {
      setFormError('Annual spend must be a positive number')
      return
    }
    const volatility = knobs.volatility.trim()
    if (volatility !== '') {
      if (!isPlainDecimal(volatility)) {
        setFormError('Volatility % must be a number')
        return
      }
      const n = Number(volatility)
      if (n < 0 || n > VOLATILITY_MAX_PCT) {
        setFormError(`Volatility % must be between 0 and ${VOLATILITY_MAX_PCT}`)
        return
      }
    }
    const inflation = knobs.inflation.trim()
    if (inflation !== '') {
      if (!isPlainDecimal(inflation)) {
        setFormError('Inflation % must be a number')
        return
      }
      const n = Number(inflation)
      if (n < INFLATION_MIN_PCT || n > INFLATION_MAX_PCT) {
        setFormError(`Inflation % must be between ${INFLATION_MIN_PCT} and ${INFLATION_MAX_PCT}`)
        return
      }
    }
    const growth = knobs.contributionGrowth.trim()
    if (growth !== '') {
      if (!isPlainDecimal(growth)) {
        setFormError('Contribution growth % must be a number')
        return
      }
      const n = Number(growth)
      if (n < 0 || n > GROWTH_MAX_PCT) {
        setFormError(`Contribution growth % must be between 0 and ${GROWTH_MAX_PCT}`)
        return
      }
    }
    const years = knobs.years.trim()
    if (years !== '') {
      const n = Number(years)
      if (!Number.isInteger(n) || n < YEARS_MIN || n > YEARS_MAX) {
        setFormError(`Horizon must be a whole number of years between ${YEARS_MIN} and ${YEARS_MAX}`)
        return
      }
    }
    setBusy(true)
    setError(null)
    setMissing(false)
    setFormError(null)
    load({
      annualReturn: ret === '' ? '' : shiftPoint(ret, -2),
      monthlyContribution: contribution,
      annualSpend: spend,
      swr: swr === '' ? '' : shiftPoint(swr, -2),
      volatility: volatility === '' ? '' : shiftPoint(volatility, -2),
      inflation: inflation === '' ? '' : shiftPoint(inflation, -2),
      contributionGrowth: growth === '' ? '' : shiftPoint(growth, -2),
      years,
    })
  }

  const chart = data === null ? null : projectionOption(data)
  const fit = history === null ? null : fitPolyTrend(history.months, history.net_worth)
  const nwChart =
    history === null || data === null
      ? null
      : netWorthProjectionOption(history, fit, data.start_month, trendYears)

  return (
    <div className="page projection-page">
      <div className="page-header">
        <h1>Projection</h1>
        <div className="spacer" />
      </div>

      {error !== null && !missing && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button className="button" aria-label="Retry the projection" onClick={recalculate}>
            Retry
          </button>
        </div>
      )}

      {missing ? (
        <section className="card">
          <h2 className="eyebrow">Projected investable balance</h2>
          {/* The server's sentence, plus where to go next: the projection stands on the
              latest net-worth snapshot, and a fresh database has none. */}
          <p className="empty-note">
            {error} — <Link to="/update">enter a monthly update</Link> to start one.
          </p>
        </section>
      ) : (
        data && (
          <div className={`loading-dim${busy ? ' is-loading' : ''}`}>
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
                  data.fi_month_p50 === null
                    ? undefined
                    : `p50 ${formatMonth(data.fi_month_p50)}${
                        data.fi_month_p90 === null
                          ? ''
                          : ` · p90 ${formatMonth(data.fi_month_p90)}`
                      }`
                }
                tone="neutral"
                hint="Share of 500 simulated paths reaching the target within the horizon, with median (p50) and pessimistic (p90) dates."
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

            <section className="card projection-chart-card">
              <div className="projection-chart-header">
                <h2 className="eyebrow">
                  Net worth over time (projected)
                  <InfoHint text="Every snapshot as dots with a quadratic best-fit extended forward — momentum, not a plan. Log axis: equal steps are equal multiples." />
                </h2>
                <div className="segmented" role="group" aria-label="Trend span">
                  {TREND_SPANS.map((span) => (
                    <button
                      key={span}
                      type="button"
                      className={trendYears === span ? 'active' : ''}
                      aria-pressed={trendYears === span}
                      onClick={() => setTrendYears(span)}
                    >
                      {span}Y
                    </button>
                  ))}
                </div>
              </div>
              {historyError !== null ? (
                // Advisory, never the page banner: the rest of the page runs without it.
                <p className="empty-note">{historyError}</p>
              ) : history === null ? (
                <p className="empty-note">Loading net-worth history…</p>
              ) : nwChart === null ? (
                <p className="empty-note">Not enough monthly snapshots to chart yet.</p>
              ) : (
                <>
                  <EChart option={nwChart} height={340} />
                  <ChartZoomHint />
                  <p className="drill-hint">
                    {fit === null
                      ? 'The polynomial trendline needs at least three snapshots — showing the history alone. Log-scale axis: equal steps are equal multiples.'
                      : `Second-degree polynomial best-fit over every monthly net-worth snapshot, extended ${trendYears} ${trendYears === 1 ? 'year' : 'years'} — momentum, not a plan; the knob-driven model is the chart below. Log-scale axis: equal steps are equal multiples.`}
                  </p>
                </>
              )}
            </section>

            <section className="card projection-chart-card">
              <h2 className="eyebrow">
                Projected investable balance
                <InfoHint text="Deterministic compounding at your assumptions; the bands hold the middle 50% and 80% of simulated outcomes." />
              </h2>
              {chart && data ? (
                <>
                  <EChart
                    option={chart}
                    height={340}
                    exportConfig={{ name: 'projection', csv: () => projectionCsv(data) }}
                  />
                  <ChartZoomHint />
                </>
              ) : (
                <p className="empty-note">Nothing to chart at this horizon.</p>
              )}
              <p className="drill-hint">
                Deterministic compounding at one assumed return — a planning sketch, not a
                forecast. The chart reads in today&apos;s dollars by default (inflation is
                modelled); set inflation to 0 to read nominal dollars. The growth-only line
                is the same balance with contributions turned off. With a volatility, bands
                are percentiles across 500 simulated lognormal-return paths — seed-stable,
                so identical knobs redraw identical bands.
              </p>
            </section>

            <section className="card">
              <h2 className="eyebrow">
                Assumptions
                <InfoHint text="Every knob the projection runs on. Blank boxes restore their defaults or re-derive from your data on Recalculate." />
              </h2>
              <p className="drill-hint">
                Blank boxes re-derive on Recalculate: contribution from the trailing 12
                months of (net pay − spend), annual spend from the trailing spend, the
                withdrawal rate from Settings, and the three assumptions from their
                defaults (15 / 3 / 3). Percents are percents (5 = 5%). Volatility turns on
                the bands; inflation converts everything to today&apos;s dollars;
                contribution growth models raises. 0 turns the fan off (volatility) or
                reads nominal dollars (inflation).
              </p>
              <form
                className="projection-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  recalculate()
                }}
              >
                <label>
                  Annual return (%/yr)
                  <input
                    className="field-input"
                    inputMode="decimal"
                    value={knobs.annualReturn}
                    onChange={(e) => setKnob('annualReturn')(e.target.value)}
                  />
                </label>
                <label>
                  Monthly contribution
                  <input
                    className="field-input"
                    inputMode="decimal"
                    value={knobs.monthlyContribution}
                    onChange={(e) => setKnob('monthlyContribution')(e.target.value)}
                  />
                </label>
                <label>
                  Annual spend
                  <input
                    className="field-input"
                    inputMode="decimal"
                    value={knobs.annualSpend}
                    onChange={(e) => setKnob('annualSpend')(e.target.value)}
                  />
                </label>
                <label>
                  Withdrawal rate (%/yr)
                  <input
                    className="field-input"
                    inputMode="decimal"
                    value={knobs.swr}
                    onChange={(e) => setKnob('swr')(e.target.value)}
                  />
                </label>
                <label>
                  Volatility (%/yr)
                  <input
                    className="field-input"
                    inputMode="decimal"
                    value={knobs.volatility}
                    onChange={(e) => setKnob('volatility')(e.target.value)}
                  />
                </label>
                <label>
                  Inflation (%/yr)
                  <input
                    className="field-input"
                    inputMode="decimal"
                    value={knobs.inflation}
                    onChange={(e) => setKnob('inflation')(e.target.value)}
                  />
                </label>
                <label>
                  Contribution growth (%/yr)
                  <input
                    className="field-input"
                    inputMode="decimal"
                    value={knobs.contributionGrowth}
                    onChange={(e) => setKnob('contributionGrowth')(e.target.value)}
                  />
                </label>
                <label>
                  Horizon (years)
                  <input
                    className="field-input"
                    inputMode="numeric"
                    value={knobs.years}
                    onChange={(e) => setKnob('years')(e.target.value)}
                  />
                </label>
                <div className="projection-actions">
                  <button type="submit" className="button button-primary" disabled={busy}>
                    {busy ? 'Projecting…' : 'Recalculate'}
                  </button>
                </div>
              </form>
              {formError && (
                <div className="error-banner" role="alert">
                  {formError}
                </div>
              )}
            </section>
          </div>
        )
      )}
      {data === null && !missing && busy && <p className="empty-note">Loading the projection…</p>}
    </div>
  )
}
