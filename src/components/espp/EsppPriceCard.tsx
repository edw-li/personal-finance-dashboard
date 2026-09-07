import { useMemo, useState } from 'react'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import type { EsppLotOut, EsppOfferingOut, PricePoint } from '../../types/api'
import { formatPct } from '../../utils/format'
import { todayIso } from '../../utils/months'
import { PRICE_SPANS, extentKnown, priceWindowSummary, reachableSpans } from '../portfolio/priceChartOptions'
import type { SpanDays } from '../portfolio/priceChartOptions'
import { esppPriceCsv, esppPriceOption, lotsOutsideHistory, sliceWindow } from './esppChartOptions'
import '../panels.css'

// The page fetches this many days once (the offerings chip's series); the chips slice it.
const FETCHED_DAYS = 3650

/**
 * The employer's daily closes against the subscription rule and your average paid (2026-09-07
 * spec §6). The chips are WINDOWS over the one fetched series, not refetches — the page already
 * holds ten years for the offerings chip — so a chip whose window reaches past the stored history
 * is disabled (the holding drill-in's `reachableSpans` rule), and the default is the widest
 * live one: All when the history is long, 1Y when it is a year old. `bars === null` means the
 * fetch has not answered; `[]` means there is nothing to draw.
 */
export default function EsppPriceCard({
  ticker,
  bars,
  offerings,
  lots,
}: {
  ticker: string | null
  bars: PricePoint[] | null
  offerings: EsppOfferingOut[]
  lots: EsppLotOut[]
}) {
  const today = todayIso()
  const [pick, setPick] = useState<SpanDays>(3650)
  // Memoized so the in-flight `null` does not hand the two memos below a FRESH [] every render
  // (which would rebuild the option on every keystroke elsewhere on the page).
  const all = useMemo(() => bars ?? [], [bars])
  const reachable = reachableSpans(all, FETCHED_DAYS, today)
  const live = PRICE_SPANS.map((s) => s.days).filter((d) => reachable[d])
  const span: SpanDays = reachable[pick] ? pick : (live[live.length - 1] ?? 365)
  const window = useMemo(() => sliceWindow(all, span, today), [all, span, today])
  const option = useMemo(() => esppPriceOption({ points: window, offerings, lots }), [window, offerings, lots])
  const summary = priceWindowSummary(window, span, today)
  // 'history since' is a claim about INCEPTION, and here a chip is a client-side SLICE of one
  // fetched series, so summary.extentKnown — which asks whether a RESPONSE came back short of the
  // window it requested — cannot answer it: a 1Y slice of a decade opens a year ago, not at the
  // start of anything. The claim is earned only when the 3650-day fetch itself came back short
  // (so the stored history really begins at its first bar) AND this window still reaches that bar.
  const sinceInception =
    extentKnown(all, FETCHED_DAYS, today) && window.length > 0 && window[0].d === all[0].d
  // Both sides, one sentence: a lot the window cannot reach has no marker on the chart either
  // (barAt refuses it), and a reader who counts four lots and three diamonds deserves to be told
  // why. The single-side wording repeats the noun rather than leaving "it" with no antecedent.
  const outside = lotsOutsideHistory(all, lots)
  const missing = outside.before + outside.after
  const beforeClause =
    outside.before === 0 ? '' : `${outside.before} ${outside.before === 1 ? 'lot predates' : 'lots predate'}`
  // The trailing clause drops the noun the leading one already established ("...and 2 postdate it").
  const afterVerb = outside.after === 1 ? 'postdates' : 'postdate'
  const reach =
    missing === 0
      ? null
      : `${
          beforeClause !== '' && outside.after > 0
            ? `${beforeClause} the stored history and ${outside.after} ${afterVerb} it`
            : beforeClause !== ''
              ? `${beforeClause} the stored history`
              : `${outside.after} ${outside.after === 1 ? 'lot' : 'lots'} ${afterVerb} the stored history`
        } — the next price refresh reaches ${missing === 1 ? 'it' : 'them'}.`
  const name = ticker ?? 'the employer'

  return (
    <ChartCard
      title={ticker === null ? 'Employer price vs your purchases' : `${ticker} vs your purchases`}
      hint="Daily closes over the chosen window. Dashed rules: the subscription price of the offering in force, and your average paid per share to date, which steps up at each purchase. The wash is green above your average paid and red below. Diamonds are purchases (hollow once sold); triangles are sales."
      ariaLabel={`Line chart of ${name}'s daily closes against the subscription price and your average paid per share, with purchase markers`}
      option={option}
      empty={
        ticker === null
          ? 'No ESPP ticker configured — set the espp_ticker setting to chart the price.'
          : `No stored price history for ${ticker} yet — run a price refresh.`
      }
      exportName="espp-price-history"
      csv={window.length > 0 ? () => esppPriceCsv(window, offerings, lots) : undefined}
      height={300}
      span={6}
      zoomable
      busy={ticker !== null && bars === null}
      controls={
        <Segmented
          variant="toggle"
          size="sm"
          ariaLabel="History window"
          options={PRICE_SPANS.map((s) => ({ value: String(s.days), label: s.label, disabled: !reachable[s.days] }))}
          value={String(span)}
          onChange={(value) => setPick(Number(value) as SpanDays)}
        />
      }
      footer={
        summary === null && reach === null ? undefined : (
          <>
            {summary !== null && (
              <p className="drill-hint">
                {formatPct(summary.changePct)} over this window ·{' '}
                {sinceInception ? `history since ${summary.since}` : `window from ${summary.since}`}
              </p>
            )}
            {reach !== null && <p className="drill-hint">{reach}</p>}
          </>
        )
      }
    />
  )
}
