import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { fetchCalendar } from '../api/calendar'
import { fetchCoverage } from '../api/coverage'
import { fetchLots } from '../api/espp'
import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import type { OwnerScope } from '../api/netWorth'
import { fetchMoneyFlow } from '../api/overview'
import { fetchDividends, fetchHistory, fetchHoldings } from '../api/portfolio'
import { fetchMatrix, fetchYearly } from '../api/spending'
import { fetchSystemStatus } from '../api/system'
import { fetchAllTaxSummaries, fetchTaxYears } from '../api/taxes'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import { categoryFold } from '../charts/entities'
import { partialFootnote, partlyEnteredMonths } from '../charts/partlyEntered'
import ChartCard from '../components/ChartCard'
import InfoHint from '../components/InfoHint'
import { chipAmount, eventKey } from '../components/calendar/calendarView'
import { attentionItems, reviewAttentionItems } from '../components/overview/attention'
import DataStatusCard from '../components/overview/DataStatusCard'
import { netWorthComponents } from '../components/overview/netWorthReceipt'
import { netWorthHeadline, receiptAsOf, recordedSentence } from '../components/networth/headline'
import { GhostTile, SkeletonCard } from '../components/PageSkeleton'
import MoneyFlowCard from '../components/overview/MoneyFlowCard'
import {
  UP_NEXT_WINDOW_DAYS,
  type UpNextMoney,
  rankUpNext,
  upNextMoney,
  upNextWindow,
} from '../components/overview/upNext'
import { windowWords, ytdStats } from '../components/overview/ytd'
import {
  netWorthTrendCsv,
  netWorthTrendOption,
  notEnteredMonths,
  pickTaxSummary,
  RECENT_SPEND_MONTHS,
  recentSpendCsv,
  recentSpendOption,
  spendStats,
} from '../components/overview/overviewChartOptions'
import { performanceLede } from '../components/portfolio/benchmarkLede'
import PerformanceLede from '../components/portfolio/PerformanceLede'
import {
  liveFromHoldings,
  portfolioHistoryCsv,
  portfolioHistoryOption,
  weeklyLabelCapacity,
} from '../components/portfolio/historyChartOptions'
import PageFrame from '../components/shell/PageFrame'
import ScopeBar, { HOUSEHOLD_SNAPSHOT } from '../components/shell/ScopeBar'
import { useScope } from '../components/shell/useScope'
import { useChartDecals } from '../components/useChartDecals'
import StatTile from '../components/StatTile'
import useOverviewResource from '../components/overview/useOverviewResource'
import useSpendingEvidence from '../components/metrics/useSpendingEvidence'
import { FeedBanner } from '../components/shell/Feed'
import { metricReceipt } from '../utils/metricReceipt'
import { REVIEW_LABELS } from '../api/monthReview'
import OverviewChanges from '../components/overview/OverviewChanges'
import OverviewCustomize from '../components/overview/OverviewCustomize'
import { useAssistantView } from '../components/assistant/viewState'
import { DEFAULT_OVERVIEW_LAYOUT } from '../prefs/overviewLayout'
import { getLocal, setLocal, subscribe } from '../prefs/prefsStore'
import type {
  CalendarEvent,
  CalendarLiving,
  CoverageOut,
  DividendOut,
  EsppLotsResponse,
  HoldingsResponse,
  HouseholdOut,
  MoneyFlowOut,
  NetWorthSummary,
  NetWorthTimeseries,
  PortfolioHistory,
  SpendingMatrix,
  SpendingYearly,
  SystemStatus,
  TaxSummariesOut,
  TaxYearOut,
} from '../types/api'
import { formatCurrency, formatDate, formatMonth, formatPct } from '../utils/format'
import { todayIso } from '../utils/months'
import { toneOf } from '../utils/tone'
import '../components/panels.css'
import './OverviewPage.css'

// The complete data shape is assembled from four independent coherent groups:
// wealth, investments, spending/review, and planning. Each group updates its related
// figures together; the render uses Partial<OverviewData> as other groups arrive or fail.
interface OverviewData {
  summary: NetWorthSummary
  ts: NetWorthTimeseries
  holdings: HoldingsResponse
  history: PortfolioHistory
  matrix: SpendingMatrix
  taxes: TaxSummariesOut
  // Planning sources feed attention checks. The YTD rollup joins the independently
  // loaded wealth, spending and investment groups only when its inputs are present.
  lots: EsppLotsResponse
  taxYears: TaxYearOut[]
  yearly: SpendingYearly
  dividends: DividendOut[]
  system: SystemStatus
  // Coverage updates with the spending matrix and yearly rollup, so spending figures
  // and their completeness/window labels come from the same group refresh.
  coverage: CoverageOut
}

/** StatTile's delta grammar for a savings rate: above zero the household kept money,
 *  below it the household overspent. Shared by the two branches of the Saved row. */
function rateTone(rate: string): string {
  const value = Number(rate)
  return value > 0 ? 'delta-positive' : value < 0 ? 'delta-negative' : ''
}

// Keyed by the fetch parameters, like every other page's: an owner scope is a DIFFERENT
// snapshot, and one key for all of them would paint the wrong person's numbers.
const loadSpending = async () => { const [matrix, yearly, coverage] = await Promise.all([fetchMatrix(), fetchYearly(), fetchCoverage()]); return { matrix, yearly, coverage } }
const loadPlanning = async () => { const [taxes, lots, taxYears, system] = await Promise.all([fetchAllTaxSummaries(), fetchLots(), fetchTaxYears(), fetchSystemStatus()]); return { taxes, lots, taxYears, system } }

// The two feeds with no owner dimension server-side. Under an owner scope their cards say
// so, rather than letting the chip imply a filter that never ran.
const SPENDING_HINT =
  "Living spending for the latest eligible month, compared with eligible months within the previous 12 calendar months. Tax paid from take-home and transfers are separate."
const PERFORMANCE_HINT =
  "Portfolio value vs cost basis, checkpointed weekly after Monday's close; the pinging dot is live. Same deposits in VOO invests every inferred contribution in VOO as it lands — the fair comparison, and the line above the chart states the gap since the first checkpoint."

// The up-next window slides with the calendar day — key it by today so a date rollover
// misses cleanly instead of painting yesterday's window.
function upNextKey(): string {
  return `overview:upnext:${todayIso()}`
}

// The up-next card's one read (2026-09-23 spec §B2): the window's events and its living-cost
// estimates are ONE response, cached together under the day key so they are never two instants.
interface UpNextData {
  events: CalendarEvent[]
  living: CalendarLiving[]
}

function flowKey(year: number | null): string {
  return `overview:flow:${year ?? 'auto'}`
}

/** The money the window actually moves — the list is capped, this is not. Each piece is one
 *  unbroken span, the "·" glued to the clause before it, so a narrow card wraps between clauses
 *  and never inside a figure (2026-09-23 spec §B2). */
function UpNextMoneyLine({ money }: { money: UpNextMoney }) {
  return (
    <p className="drill-hint up-next-line">
      <span className="up-next-clause">{money.lead}</span>
      {money.clauses.map((clause, index) => (
        <Fragment key={index}>
          {index === 0 ? ' ' : <>&nbsp;&middot; </>}
          <span className="up-next-clause">{clause}</span>
        </Fragment>
      ))}
    </p>
  )
}

/** Whose view this is, in words (audit item 11). The scope row fetched the household for
 *  its own chips and published it under the shell key, so the name costs no thirteenth
 *  request — and a miss (the row still in flight, or a household fetch that failed) falls
 *  back to words that are true of every person. */
function scopeName(owner: Exclude<OwnerScope, null>): string {
  if (owner === 'joint') return 'Joint'
  const household = getSnapshot<HouseholdOut>(HOUSEHOLD_SNAPSHOT)
  return household?.people.find((person) => person.id === owner)?.name ?? 'this person'
}

export default function OverviewPage() {
  const [layout, setLayout] = useState(() => getLocal('overview_layout') ?? DEFAULT_OVERVIEW_LAYOUT)
  useEffect(() => subscribe('overview_layout', setLayout), [])
  // The URL owns the scope (2026-09-03 shell spec §6) and the scope row writes it; this
  // page only reads it, so there is no local owner state to keep in step.
  const { scope } = useScope({ owner: true })
  const owner = scope.owner
  useAssistantView({ owner: owner === null ? null : String(owner) })
  const wealthLoader = useCallback(async () => {
    const [summary, ts] = await Promise.all([fetchSummary(owner), fetchTimeseries('monthly', owner)])
    return { summary, ts }
  }, [owner])
  const investmentsLoader = useCallback(async () => {
    const [holdings, history, dividends] = await Promise.all([fetchHoldings(owner), fetchHistory(), fetchDividends()])
    return { holdings, history, dividends }
  }, [owner])
  const wealth = useOverviewResource(`overview:wealth:${owner ?? 'all'}`, 'wealth', wealthLoader)
  const investments = useOverviewResource(`overview:investments:${owner ?? 'all'}`, 'investments', investmentsLoader)
  const spending = useOverviewResource('overview:spending', 'spending and review', loadSpending)
  const planning = useOverviewResource('overview:planning', 'planning', loadPlanning)
  const data = useMemo<Partial<OverviewData>>(() => ({ ...wealth.data, ...investments.data, ...spending.data, ...planning.data }), [wealth.data, investments.data, spending.data, planning.data])
  const fromCache = wealth.fromCache
  const spendingEvidence = useSpendingEvidence(data.matrix?.default_month ?? undefined, data.matrix)

  // The agenda has its own day-keyed cache and failure state, independent of the four
  // groups above. A failed refresh keeps the last loaded schedule with a notice;
  // without a previous answer, the card reports that upcoming events are unavailable.
  const [upNext, setUpNext] = useState<UpNextData | null>(
    () => getSnapshot<UpNextData>(upNextKey()) ?? null,
  )
  const [upNextFailed, setUpNextFailed] = useState(false)
  const upNextSeq = useRef(0)

  const loadUpNext = () => {
    const seq = ++upNextSeq.current
    // The line's own window (exactly 45 days, today included), so what is fetched is what is summed.
    const { start, end } = upNextWindow(todayIso())
    fetchCalendar(start, end)
      .then((data) => {
        if (seq !== upNextSeq.current) return
        const key = upNextKey()
        const next: UpNextData = { events: data.events, living: data.living ?? [] }
        const previous = getSnapshot<UpNextData>(key)
        setSnapshot(key, next)
        setUpNextFailed(false)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(next)) return
        setUpNext(next)
      })
      .catch(() => {
        if (seq !== upNextSeq.current) return
        setUpNextFailed(true)
      })
  }

  // Money flow is independently keyed by year, with its own sequence and inline error.
  // Its failure leaves the agenda and other data groups available.
  const [flow, setFlow] = useState<MoneyFlowOut | null>(
    () => getSnapshot<MoneyFlowOut>(flowKey(null)) ?? null,
  )
  const [flowFailed, setFlowFailed] = useState(false)
  // null = let the server pick the year (the current product year); a chip click pins it.
  const [flowYear, setFlowYear] = useState<number | null>(null)
  const flowSeq = useRef(0)

  const loadFlow = (year: number | null) => {
    const seq = ++flowSeq.current
    fetchMoneyFlow(year ?? undefined)
      .then((data) => {
        if (seq !== flowSeq.current) return
        const previous = getSnapshot<MoneyFlowOut>(flowKey(year))
        setSnapshot(flowKey(year), data)
        setFlowFailed(false)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data)) return
        setFlow(data)
      })
      .catch(() => {
        if (seq !== flowSeq.current) return
        setFlowFailed(true)
      })
  }

  // Chip flip: an already-seen year paints instantly and revalidates underneath. The peek
  // lives HERE rather than inside loadFlow because loadFlow also runs in the mount effect's
  // body, where a synchronous setState is a house react-hooks violation.
  const showFlowYear = (year: number | null) => {
    setFlowYear(year)
    const peeked = getSnapshot<MoneyFlowOut>(flowKey(year))
    setFlow(peeked ?? null)
    loadFlow(year)
  }

  useEffect(() => {
    loadUpNext()
    loadFlow(null)
    // mount-only: these two are household-wide and never re-run on a scope change; both
    // are plain functions over stable setters (house idiom).
    return () => {
      // A response after logout must not repopulate the cleared session cache.
      upNextSeq.current += 1
      flowSeq.current += 1
    }
  }, [])

  // The busy flag is raised by the CALLERS, never inside load(): load() runs in the mount
  // effect's synchronous body, where a setState is a house react-hooks violation.
  const reload = () => {
    wealth.retry()
    investments.retry()
    spending.retry()
    planning.retry()
    loadUpNext()
    loadFlow(flowYear)
  }

  // The only memoized values on the page — EChart keys its setOption effect on [option],
  // so a fresh object every render would redraw all three charts on every keystroke
  // elsewhere. Everything else below is a plain const.
  const nwTrend = useMemo(() => (data.ts ? netWorthTrendOption(data.ts) : null), [data])
  // The ping is derived from the OWNER-FILTERED holdings, but /portfolio/history is
  // household-wide by design (see the fetch above), so under a person scope plotting their
  // total at the end of the household series draws a fake cliff. PortfolioPage has carried
  // this guard since 2026-08-31 (A3); this copy is the same rule, one page later — null
  // also suppresses the dashed connector and the "Live" legend entry, both inside the
  // builder's livePt branch.
  // The home card compares against the same deposits in VOO only (2026-09-23 spec §C8, shell
  // F5): the starting-balance line invited "we beat the S&P nine-fold". Portfolio keeps it,
  // legend-off, for the reader who asks for it.
  // The weekly axis takes as many month labels as the card's plot fits (code review 5).
  // Keyed on the two feeds it draws, not on `data`: that merges four feeds landing on their own,
  // and the spending feed landing after the investments handed the chart a new, byte-identical
  // option — repainted already-drawn, cutting the entrance it had just begun (code re-review 2).
  const [perfLabels, setPerfLabels] = useState<number | undefined>(undefined)
  const onPerfWidth = useCallback((width: number) => setPerfLabels(weeklyLabelCapacity(width)), [])
  const perf = useMemo(
    () =>
      data.history && data.holdings
        ? portfolioHistoryOption(
            data.history,
            owner === null ? liveFromHoldings(data.holdings) : null,
            null,
            { startingBalance: 'omit', labels: perfLabels },
          )
        : null,
    [data.history, data.holdings, owner, perfLabels],
  )
  // The card states the honest benchmark's answer over the whole history it draws
  // (2026-09-23 spec §C8; shell F5): "Ahead of the same deposits in VOO by $263.7K".
  const perfLede = useMemo(
    () => (data.history ? performanceLede(data.history, { preset: 'all' }) : null),
    [data],
  )
  // The months whose "0.00" is an absence rather than a figure (audit item 14). Memoized
  // beside the options it feeds, not recomputed per render: it rides INTO the bars' memo,
  // and a fresh Set every render would redraw that chart on every keystroke elsewhere.
  const notEntered = useMemo(
    () => (data.matrix && data.coverage ? notEnteredMonths(data.matrix, data.coverage) : new Set<string>()),
    [data],
  )
  // The month in progress is drawn as such (2026-09-23 spec §C5): judged against the product's
  // today, hatched or faded by Appearance › Chart patterns.
  const spendToday = todayIso()
  const patterns = useChartDecals()
  // A month whose spending is only partly entered keeps that look after it has ended (2026-09-23
  // spec §T12) — `time.flows_due` from the coverage the spending group already fetched.
  const bars = useMemo(
    () =>
      data.matrix
        ? recentSpendOption(data.matrix, RECENT_SPEND_MONTHS, notEntered, {
            todayIso: spendToday,
            patterns,
            flowsDue: data.coverage?.time?.flows_due,
          })
        : null,
    [data, notEntered, spendToday, patterns],
  )
  // The bars' '*', said in words under the card (code review 13): which kind of partial it marks.
  const spendFootnote = data.matrix
    ? partialFootnote(
        data.matrix.months.slice(-RECENT_SPEND_MONTHS),
        spendToday,
        partlyEnteredMonths(data.coverage?.time?.flows_due),
      )
    : null
  // The money flow's category colours are the Spending page's own (2026-09-23 spec §C2): the
  // fold comes from the same all-time ranking over the matrix this page already loads.
  const matrix = data.matrix
  const flowFold = useMemo(() => (matrix ? categoryFold(matrix) : null), [matrix])

  // Audit item 11: the server answers an owner with no accounts with zero TOTALS, and a
  // page of $0.00 tiles over a flat line reads as "you have nothing" rather than "there is
  // nothing here to show" (the trend's all-zero series also makes ECharts pick a 0..1 axis
  // and print a $0/$1 ladder). An owner scope only: a fresh database's own empty states
  // already say what is missing, and the household is not "this person".
  const emptyScope = data.ts !== undefined && owner !== null && data.ts.accounts.length === 0
  const emptyScopeNote =
    emptyScope && owner !== null ? `No accounts for ${scopeName(owner)} yet` : null

  // An empty book — no snapshot at all — gets one card that says what to do first (2026-09-14
  // guide spec §7.1). Household scope only: a person or joint scope with nothing in it is the
  // empty-scope note's case above, and a book with months but no accounts cannot exist.
  const emptyBook = owner === null && data.ts !== undefined && data.ts.months.length === 0

  // The 45-day money line, one reading for both of the agenda's branches (spec §B2).
  const upNextMoneyNow =
    upNext === null ? null : upNextMoney(upNext.events, upNext.living, todayIso())

  const summary = data?.summary
  // The hero's words by date (2026-09-23 spec §T1) — the story note rides only while the month
  // the change covers is listed as due in the coverage the spending group already fetched.
  const headline = summary ? netWorthHeadline(summary, data.coverage?.time?.flows_due) : null
  // Rendered verbatim, never re-derived: these are the server's own totals fields (the
  // `totals.unrealized_gl` lesson).
  const totals = data.holdings?.totals
  const asOf = data.holdings?.as_of ?? null
  // Audit item 15: the day change is the newest quote's move against ITS prior close, so
  // "today" is a claim about that quote and not about the moment the page is read — on a
  // Sunday, or after a failed refresh, the tile was still calling Friday's move today's.
  // latest_quote_at is the NEWEST stamp (as_of is the oldest, the staleness clock); the
  // fallback is stale-tab armor only, since server-side both derive from one quote list.
  const quoteDay = (data.holdings?.latest_quote_at ?? asOf)?.slice(0, 10) ?? null
  // Carries its own leading space so a missing quote date omits the WORD rather than
  // guessing "today" — with no quote on file there is no day to name (review round).
  const dayChangeWhen =
    quoteDay === null ? '' : quoteDay === todayIso() ? ' today' : ` on ${formatDate(quoteDay)}`
  const stats = data.matrix ? spendStats(data.matrix, notEntered) : null
  const currentYear = new Date().getFullYear()
  const tax = data.taxes ? pickTaxSummary(data.taxes.years, currentYear) : null
  // Plain consts like their siblings (the memo rule below covers CHART options only) —
  // the strip's and the YTD card's rules are cheap math over the snapshot.
  // Review rows lead (they are this household's own ritual), then the feed checks; both are
  // phrased as actions and rendered by the same strip (2026-09-13 polish spec §14). A month the
  // flows line already asks for is left to it (2026-09-23 spec §T3).
  const attention = [
    ...reviewAttentionItems(data.coverage?.review_months, todayIso(), data.coverage?.time?.flows_due),
    ...attentionItems({
      months: data.ts?.months, holdings: data.holdings, lots: data.lots,
      taxYears: data.taxYears, system: data.system, coverage: data.coverage,
    }, todayIso()).filter(item => item.key !== 'espp-qualifying'),
  ]
  const ytd = data.ts && data.yearly && data.dividends && data.coverage ? ytdStats(data.ts, data.yearly, data.dividends, data.coverage, todayIso()) : null
  // Shown once ANY feed has history — on a fresh database the empty states below carry
  // the message, and a card of five dashes would just restate them.
  const showYtd =
    ytd !== null &&
    data !== null &&
    ((data.ts?.months.length ?? 0) > 0 || (data.yearly?.years.length ?? 0) > 0 || (data.dividends?.length ?? 0) > 0)

  // The matrix months are a UNION of spending rows and net-pay rows, so a month whose
  // paycheck is entered but whose spending is not comes back with an explicit "0.00". A
  // green "▼ under $5,000.00 12-mo avg" would congratulate the user for a month they have
  // not entered yet, so the tile keeps its label and says nothing else.
  const cashflowOnly =
    stats?.total === null

  // ONE object, three channels: the words, the colour and the glyph are either all present
  // or all absent, which is the invariant a comment used to assert across three separate
  // predicates. Spending up is BAD, so tone is the INVERSE of direction here — and that is
  // exactly why the tile hands StatTile an explicit direction: left to derive the glyph
  // from the tone, an over-average month would render ▼ on a number that went UP. Glyph =
  // direction, colour = good/bad, "over"/"under" = the judgment in words; the same fact
  // three ways, and none of them wrong. (avg12 and aboveAvg are null together — spendStats
  // — but both are named so the narrowing is the compiler's job, not a reader's memory.)
  // The MONTH rides the delta line too (W2, 2026-09-13 audit): the label is "Living spending"
  // at every width, and a month with no comparison still says which month it is — neutral,
  // no glyph.
  const spendMonth = stats?.month ? formatMonth(stats.month) : null
  const spendDelta =
    stats && stats.avg12 !== null && stats.aboveAvg !== null && !cashflowOnly
      ? {
          text: `${Number(stats.total) === stats.avg12 ? 'at' : stats.aboveAvg ? 'over' : 'under'} ${formatCurrency(stats.avg12)} previous 12-mo average${spendMonth ? ` · ${spendMonth}` : ''}`,
          tone: Number(stats.total) === stats.avg12 ? ('neutral' as const) : stats.aboveAvg ? ('negative' as const) : ('positive' as const),
          direction: Number(stats.total) === stats.avg12 ? undefined : stats.aboveAvg ? ('up' as const) : ('down' as const),
        }
      : spendMonth !== null
        ? { text: spendMonth, tone: 'neutral' as const, direction: undefined }
        : null
  // The compared month's review state — a badge on the tile when it is not closed (T1); the
  // sentence about the comparison window lives in the Data status card.
  const reviewState = spendingEvidence.data?.review?.state

  // Two cards the owner scope cannot reach: /spending/matrix has no owner dimension, and
  // the weekly /portfolio/history checkpoints are household-wide. Saying so beats a silent
  // number that looks filtered.
  const spendingHint =
    owner === null ? SPENDING_HINT : `${SPENDING_HINT} Household total — spending has no owner.`
  const performanceHint =
    owner === null
      ? PERFORMANCE_HINT
      : `${PERFORMANCE_HINT} Household history; owner scope does not apply to the weekly checkpoints.`

  const taxLabel =
    tax === null
      ? 'Estimated tax'
      : `Estimated tax — ${tax.year}${
          tax.year < currentYear
            ? ' (latest)'
            : tax.year > currentYear
              ? ' (planned)'
              : ' (est.)'
        }`

  const tileElements = {
    net_worth: wealth.busy && data.summary === undefined ? <GhostTile delta={false} /> : (
              <StatTile
                hero
                // Named by the day the balances describe, with what the change spans (2026-09-23
                // spec §T1): "as of Sep 22" + Provisional + "since Sep 1 · 21 days", or
                // "· September: Sep 1 → Oct 1" between two final 1sts. Never "MoM".
                label={headline?.label ?? 'Net worth'}
                badge={emptyScopeNote === null ? headline?.badge : undefined}
                value={emptyScopeNote !== null ? '—' : formatCurrency(summary?.net_worth)}
                // A FRESH-paint flourish only: a cached paint is a number the user has already
                // seen, and re-counting it would fake newness. Money rides the wire as a decimal
                // string, hence Number() for the easing math — the last frame drops the override
                // and renders `value` itself, so the end state is the string above verbatim.
                countUp={
                  emptyScopeNote === null && !fromCache && summary?.net_worth != null
                    ? { value: Number(summary.net_worth), format: formatCurrency }
                    : undefined
                }
                // Both halves or neither: a bare amount with no rate reads as a total. The
                // empty scope takes the slot instead — a $0.00 change is arithmetic over two
                // numbers that were never there.
                delta={emptyScopeNote !== null ? emptyScopeNote : headline?.delta}
                tone={emptyScopeNote !== null ? 'neutral' : toneOf(summary?.mom_delta)}
                hint="Assets minus liabilities from your latest balances, dated by when they describe, with the change since the balances before them."
                // The receipt stands on the as-of date, and says why a provisional snapshot is one
                // (2026-09-23 spec §T1, §0.4(e)).
                evidence={summary ? metricReceipt({ id: 'net_worth', label: 'Net worth', value: summary.net_worth, definition: `Sum of non-component account balances, including signed liabilities, in your latest balances.${recordedSentence(summary)}`, scope: owner ?? 'Household', as_of: receiptAsOf(summary), ...(summary.provisional ? { completeness: 'provisional' } : {}), source_link: `/net-worth${owner === null ? '' : `?owner=${owner}`}`, components: netWorthComponents(summary.groups) }) : undefined}
              />
    ),
    portfolio: investments.busy && data.holdings === undefined ? <GhostTile delta={false} /> : (
              <StatTile
                label="Portfolio"
                // Holdings hang off accounts, so the scope with none has no portfolio
                // either — the hero beside it carries the sentence, and a second copy of
                // it in this row would be noise (audit item 11).
                value={emptyScopeNote !== null ? '—' : formatCurrency(totals?.market_value)}
                // Omitted before the first price refresh — there is no day to compare to.
                delta={
                  emptyScopeNote === null &&
                  totals?.day_change_amount != null &&
                  totals.day_change_pct != null
                    ? `${formatCurrency(totals.day_change_amount)} (${formatPct(
                        totals.day_change_pct,
                      )})${dayChangeWhen}`
                    : undefined
                }
                tone={emptyScopeNote !== null ? 'neutral' : toneOf(totals?.day_change_amount)}
                hint="Market value of every priced holding at the latest quotes, and today's move vs the prior close."
                evidence={data.holdings ? metricReceipt({ id: 'portfolio_value', label: 'Portfolio value', value: totals?.market_value ?? null, definition: 'Shares held multiplied by available prices. Missing quotes are excluded from priced value; quote dates can differ from refresh time.', scope: owner ?? 'Household', as_of: asOf, source_link: `/portfolio${owner === null ? '' : `?owner=${owner}`}`, completeness: (totals?.unpriced_count ?? 0) > 0 ? 'mixed' : 'complete', warnings: (totals?.unpriced_count ?? 0) > 0 ? [`${totals!.unpriced_count} holdings have no price.`] : [], components: [{ label: 'Unpriced holdings', value: totals?.unpriced_count ?? 0, unit: 'count' }] }) : undefined}
              />
    ),
    living_spending: spending.busy && data.matrix === undefined ? <GhostTile delta={false} /> : (
              <StatTile
                label="Living spending"
                badge={reviewState !== undefined && reviewState !== 'closed' ? REVIEW_LABELS[reviewState] : undefined}
                value={cashflowOnly ? '—' : formatCurrency(stats?.total)}
                delta={spendDelta?.text}
                tone={spendDelta?.tone}
                direction={spendDelta?.direction}
                hint={spendingHint}
                evidence={spendingEvidence.metric('living_spending')}
              />
    ),
    tax: planning.busy && data.taxes === undefined ? <GhostTile delta={false} /> : (
              <StatTile
                label={taxLabel}
                value={tax === null ? '—' : formatCurrency(tax.totals.total_tax)}
                delta={tax ? `${formatPct(tax.totals.effective_rate, { signed: false })} effective rate · Household` : undefined}
                hint="Estimated tax liability from the existing tax engine, for the year named in the label."
                evidence={tax ? metricReceipt({ id: 'estimated_tax', label: `Estimated tax for ${tax.year}`, value: tax.totals.total_tax, definition: 'Tax-engine estimate using the saved income, deductions, filing status and tax tables for this year.', source_link: `/taxes?year=${tax.year}`, as_of: null, completeness: 'estimate', components: [{ label: 'Gross income', value: tax.totals.gross_income, unit: 'USD' }, { label: 'Effective tax rate', value: tax.totals.effective_rate, unit: 'ratio' }] }) : undefined}
              />
    )
  }
  const deeperCards = {
    ytd: showYtd && ytd ? (
              <section className="card ytd-card span-12">
                <h2 className="eyebrow">
                  Year to date — {ytd.year}
                  <InfoHint text="The year so far, each figure over the window it was measured on: net-worth change from your Jan 1 balances to your latest ones, living spend (tax payments and transfers are counted apart), net pay, savings with payroll deductions counted in, and dividend entries (automatic records use ex-date)." />
                </h2>
                <dl className="ytd-facts">
                  <div className="ytd-fact">
                    <dt>Net worth</dt>
                    <dd>
                      {/* From the Jan 1 balances to the current ones (2026-09-23 spec §T2): a
                          dash before any exist this year, "$0 so far" while they ARE the
                          current ones, else the change — the words under it name both ends. */}
                      {ytd.netWorthState === 'none' || ytd.netWorthDelta === null ? (
                        '—'
                      ) : ytd.netWorthState === 'zero' ? (
                        <span className="ytd-value">$0 so far</span>
                      ) : (
                        // Glyph + colour + the signed number — three channels, none alone
                        // (StatTile's delta grammar). Up is good here, so glyph and tone agree.
                        // The amount is one unbreakable run (W4): the sub-line wraps, it never does.
                        <span
                          className={`ytd-value ${
                            ytd.netWorthDelta > 0 ? 'delta-positive' : ytd.netWorthDelta < 0 ? 'delta-negative' : ''
                          }`.trim()}
                        >
                          <span aria-hidden="true">
                            {ytd.netWorthDelta > 0 ? '▲ ' : ytd.netWorthDelta < 0 ? '▼ ' : ''}
                          </span>
                          {formatCurrency(ytd.netWorthDelta)}
                          {ytd.netWorthPct !== null && ` (${formatPct(ytd.netWorthPct)})`}
                        </span>
                      )}
                      <span className="ytd-sub">{ytd.netWorthWords}</span>
                    </dd>
                  </div>
                  <div className="ytd-fact">
                    <dt>
                      Living spending
                      {ytd.spendWindow && (
                        <span className="ytd-sub"> {windowWords(ytd.spendWindow)}</span>
                      )}
                    </dt>
                    <dd>{formatCurrency(ytd.spend)}</dd>
                  </div>
                  <div className="ytd-fact">
                    <dt>
                      Net pay
                      {ytd.netPayWindow && (
                        <span className="ytd-sub"> {windowWords(ytd.netPayWindow)}</span>
                      )}
                    </dt>
                    <dd>{formatCurrency(ytd.netPay)}</dd>
                  </div>
                  {/* The headline is the TOTAL rate — payroll deductions are savings too
                      (spec §2) — with cash beside it, because the two answer different
                      questions: what the household kept, and what it could still spend. */}
                  <div className="ytd-fact">
                    <dt>
                      Saved
                      {ytd.savedWindow && (
                        <span className="ytd-sub"> {windowWords(ytd.savedWindow)}</span>
                      )}
                    </dt>
                    <dd>
                      {ytd.totalRate === null ? (
                        // A backend older than the savings service knows only the cash
                        // reading. Dashing the row would hide a rate the user's own data
                        // still supports; the word "cash" keeps the two from being confused.
                        ytd.cashRate === null ? (
                          '—'
                        ) : (
                          <>
                            <span className={rateTone(ytd.cashRate)}>
                              {formatPct(ytd.cashRate, { signed: false })} cash
                            </span>
                            {ytd.cashSaved !== null && (
                              <span className="ytd-sub"> {formatCurrency(ytd.cashSaved)}</span>
                            )}
                          </>
                        )
                      ) : (
                        <>
                          <span className={rateTone(ytd.totalRate)}>
                            {formatPct(ytd.totalRate, { signed: false })} total
                          </span>
                          <span className="ytd-sub">
                            {' '}
                            {formatCurrency(ytd.totalSaved)} · cash{' '}
                            {formatPct(ytd.cashRate, { signed: false })} (
                            {formatCurrency(ytd.cashSaved)})
                          </span>
                        </>
                      )}
                    </dd>
                  </div>
                  <div className="ytd-fact">
                    <dt>
                      Dividends
                      <span className="ytd-sub"> ex-date for automatic records</span>
                    </dt>
                    <dd>{ytd.dividends === null ? '—' : formatCurrency(ytd.dividends)}</dd>
                  </div>
                </dl>
              </section>
            ) : ytd === null && (wealth.busy || investments.busy || spending.busy) ? (
              // Spec §9: reserve the slot while the feeds behind it are still in flight — the card
              // used to appear out of nothing when `dividends` landed and shoved the deeper stack
              // down 212px on a slow investments feed.
              <div className="span-12">
                <SkeletonCard height={96} label="Loading year to date…" />
              </div>
            ) : null,
    performance: (
              <ChartCard
                span={6}
                title="Portfolio performance"
                hint={performanceHint}
                ariaLabel="Line chart of portfolio value against cost basis and benchmark lines, weekly"
                option={perf}
                empty="No performance history yet."
                exportName="portfolio-performance"
                onWidth={onPerfWidth}
                csv={data.history ? () => portfolioHistoryCsv(data.history!, { startingBalance: 'omit' }) : undefined}
                height={280}
                busy={investments.busy} error={investments.error} selectionScopeKey={String(owner)}
                // The row is reserved while the feed is in flight, so the card does not grow
                // by a line — and shove the cards below it — the moment the sentence lands. A
                // NO-BREAK space, spelled as an escape: a plain one collapses to 0px.
                lede={
                  perfLede !== null ? (
                    <PerformanceLede line={perfLede} />
                  ) : investments.busy ? (
                    '\u00a0'
                  ) : undefined
                }
                footer={
                  <NavLink className="drill-hint" to="/portfolio">
                    Open portfolio →
                  </NavLink>
                }
              />
    ),
    spending: (
              <ChartCard
                span={6}
                title="Recent spending"
                // The dashed line is spendStats.avg12 (the twelve months BEFORE the
                // latest), which is also the figure the spend tile compares against — the
                // hint has to name that window, not "their average", or one label reads as
                // two numbers (F14).
                hint="Living spending in the recent recorded months. The reference is the previous 12-calendar-month eligible average for the latest reviewed or adopted historical month."
                ariaLabel="Bar chart of living spending with the previous 12-month eligible average"
                option={bars}
                empty="No spending months yet."
                exportName="recent-spending"
                csv={data.matrix ? () => recentSpendCsv(data.matrix!, RECENT_SPEND_MONTHS, { todayIso: spendToday, flowsDue: data.coverage?.time?.flows_due }) : undefined}
                height={240}
                busy={spending.busy} error={spending.error}
                selectionAdapter={params => {
                  if (!data.matrix || typeof params.dataIndex !== 'number') return null
                  const index = Math.max(0, data.matrix.months.length - RECENT_SPEND_MONTHS) + params.dataIndex
                  const month = data.matrix.months[index]
                  return month ? { kind: 'period', id: `living:${month}`, period: month, label: formatMonth(month), scope: 'Household', values: [{ label: 'Living spending', value: data.matrix.living_total?.[index] ?? null, unit: 'USD' }], source: { href: `/spending?month=${month}`, label: 'Open spending' } } : null
                }}
                footer={
                  spendFootnote !== null ? (
                    // The '*' in words (code review 13, spec §C5, §T12): one line with the drill
                    // link, so the caption row keeps the one line it reserves in every state.
                    <p className="drill-hint chart-footnote-line">
                      <span>{spendFootnote}</span> ·{' '}
                      <NavLink className="drill-hint" to="/spending">
                        Open spending →
                      </NavLink>
                    </p>
                  ) : (
                    <NavLink className="drill-hint" to="/spending">
                      Open spending →
                    </NavLink>
                  )
                }
              />
    ),
    money_flow: (
              <MoneyFlowCard
                flow={flow}
                failed={flowFailed}
                onRetry={() => loadFlow(flowYear)}
                onYearChange={showFlowYear}
                fold={flowFold}
                // Wait for the fold rather than draw once in the payload's own ranking and
                // recolour a moment later; a failed spending feed falls back to that ranking.
                foldPending={matrix === undefined && spending.busy}
              />
    ),
  }

  return (
    <div className="page overview-page">
      <PageFrame
        title="Overview"
        actions={
          /* Nothing but idempotent GETs and no mutation anywhere on this page, so the
             button stays live while a load is in flight: an impatient second click is
             harmless, the body dims to show the work, and seqRef decides which answer
             lands. */
          <><OverviewCustomize value={layout} onChange={next => { setLayout(next); setLocal('overview_layout', next) }} /><button type="button" className="button" onClick={reload}>
            Refresh
          </button></>
        }
        scopeRow={<ScopeBar owner />}
        resource={{ status: 'ready', fromCache }}
        skeleton={{
          tiles: 4,
          cards: [
            { span: 12, height: 220 },
            { span: 12, height: 280 },
            { span: 12, height: 240 },
            { span: 12, height: 200 },
          ],
        }}
      >
        <div className="overview-feed-notices">
          {[wealth, investments, spending, planning].map((resource, index) => <FeedBanner key={index} error={resource.error ? `${resource.error}${resource.stale ? '. Showing earlier data for this section.' : ''}` : null} retry={resource.retry} />)}
        </div>
        {data !== null && (
          <>
            <div className="kpi-row">{layout.tiles.map(id => <Fragment key={id}>{tileElements[id]}</Fragment>)}</div>
            <div className="overview-primary">
              <div className="overview-wealth-column">
              <ChartCard
                title="Net worth trend"
                hint="Net worth at every monthly snapshot — the series the Net Worth page breaks down by group."
                ariaLabel="Line chart of net worth at every monthly snapshot"
                option={emptyScopeNote !== null ? null : nwTrend}
                empty={emptyScopeNote ?? 'No snapshots yet.'}
                exportName="net-worth-trend"
                csv={data.ts ? () => netWorthTrendCsv(data.ts!) : undefined}
                height={220}
                selectionAdapter={params => {
                  const index = params.dataIndex
                  if (!data.ts || typeof index !== 'number' || !data.ts.months[index]) return null
                  const month = data.ts.months[index]
                  return { kind: 'period', id: `net-worth:${owner}:${month}`, period: month, label: formatMonth(month), scope: owner ?? 'Household', values: [{ label: 'Net worth', value: data.ts.net_worth[index], unit: 'USD' }], source: { href: `/net-worth?month=${month}${owner === null ? '' : `&owner=${owner}`}`, label: 'Open net worth records' } }
                }}
                busy={wealth.busy} error={wealth.error} selectionScopeKey={String(owner)}
                footer={
                  <NavLink className="drill-hint" to="/net-worth">
                    Open net worth →
                  </NavLink>
                }
              />
                <OverviewChanges data={data.ts} />
              </div>
              <aside className="overview-agenda-column">
                {emptyBook && (
                  <section className="card overview-start" aria-labelledby="overview-start-title">
                    <h2 className="eyebrow" id="overview-start-title">Start here</h2>
                    <p>This dashboard is empty. Three steps get it going:</p>
                    <ol className="overview-start-steps">
                      <li>
                        <Link to="/settings?section=household#accounts">Add your household and accounts</Link> — every
                        balance needs an account to live in.
                      </li>
                      <li>
                        <Link to="/settings?section=data#import">Import your workbook</Link> or{' '}
                        <Link to="/update">enter your first month</Link>.
                      </li>
                      <li>
                        <Link to="/guide">Read the guide</Link> — setup order, the monthly routine, every page.
                      </li>
                    </ol>
                    <p className="drill-hint">
                      After that: one <Link to="/guide?section=routines#routine-monthly">monthly update</Link> in the
                      first days of each month.
                    </p>
                  </section>
                )}
            <div className="card up-next overview-agenda">
              <h2 className="eyebrow">
                Up next
                <InfoHint text="The next few dated events — vests, ESPP dates, ex-dividends, paydays, deadlines — from the calendar." />
              </h2>
              {upNextFailed && (
                <p className="drill-hint" role="status">
                  {upNext === null ? "Couldn't load upcoming events." : "Couldn't refresh upcoming events. Showing the last loaded schedule."}{' '}
                  <button type="button" className="button" onClick={loadUpNext}>Retry upcoming events</button>
                </p>
              )}
              {upNext === null ? !upNextFailed && <p className="drill-hint">Loading upcoming events...</p> : rankUpNext(upNext.events, todayIso()).length === 0 ? (
                <>
                  <p className="drill-hint">
                    {upNextFailed
                      ? `The last loaded schedule had no events in the next ${UP_NEXT_WINDOW_DAYS} days.`
                      : `Nothing scheduled in the next ${UP_NEXT_WINDOW_DAYS} days.`}
                  </p>
                  {/* Nothing dated, but the days still cost money: the line stands on its own
                      whenever there is a living estimate to show (lane B1 review, M5). */}
                  {upNextMoneyNow !== null && upNextMoneyNow.living && (
                    <UpNextMoneyLine money={upNextMoneyNow} />
                  )}
                </>
              ) : (
                <>
                  <ul className="up-next-list">
                    {rankUpNext(upNext.events, todayIso()).map((event) => {
                      const amount = chipAmount(event)
                      const row = (
                        <>
                          <span className="up-next-date">{formatDate(event.date)}</span>{' '}
                          {event.label}
                          {amount !== null && <span className="up-next-amount num">{amount}</span>}
                        </>
                      )
                      return (
                        <li key={eventKey(event)}>
                          {event.href !== null ? (
                            <NavLink to={event.href} className="up-next-link">
                              {row}
                            </NavLink>
                          ) : (
                            // Custom events are informational — no page to open (spec §9.2).
                            <span className="up-next-link up-next-plain">{row}</span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  {upNextMoneyNow !== null && <UpNextMoneyLine money={upNextMoneyNow} />}
                </>
              )}
              <NavLink className="drill-hint" to="/calendar">
                Open calendar →
              </NavLink>
            </div>

                <section className="card overview-attention"><h2 className="eyebrow">Needs attention</h2>
            {/* The dashboard's to-do list: each line is a condition the snapshot itself
                proves and a link to where it gets fixed. The card always renders: with an
                empty list it reads "No outstanding data checks.", or says which feeds have
                not answered yet — a card that vanished would read the same as one that
                failed to load. */}
            {attention.length > 0 && (
              <nav className="attention-strip" aria-label="Needs attention">
                {attention.map((item) => (
                  // A part of the monthly update that is due but not late is a to-do: neutral,
                  // the same link (2026-09-23 spec §T3); everything else keeps the amber accent.
                  <NavLink key={item.key} className={`attention-item${item.tone === 'todo' ? ' is-todo' : ''}`} to={item.to}>
                    {item.text} →
                  </NavLink>
                ))}
              </nav>
            )}

                  {attention.length === 0 && <p className="drill-hint">{wealth.data && investments.data && spending.data && planning.data ? 'No outstanding data checks.' : 'Additional checks are waiting for their data feeds.'}</p>}
                </section>
                <DataStatusCard
                  asOf={asOf}
                  coverage={data.coverage}
                  comparison={
                    spendingEvidence.data?.review
                      ? { month: spendingEvidence.data.review.month, included: spendingEvidence.data.comparison.window?.included.length ?? 0 }
                      : null
                  }
                />
              </aside>
            </div>
            <div className="overview-deeper card-grid">{layout.cards.map(id => <Fragment key={id}>{deeperCards[id]}</Fragment>)}</div>
          </>
        )}
      </PageFrame>
    </div>
  )
}
