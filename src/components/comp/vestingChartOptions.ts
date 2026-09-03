// Pure option builder for the comp page's vesting calendar — no React, no fetching, no theme
// decisions of its own (compChartOptions.ts's posture). Reduced motion and the dark theme are
// the EChart wrapper's job, so everything here is data.
//
// Number() at this boundary is deliberate and display-only: the server quantized every figure
// to cents, so the chart parses the strings ONCE here and never hands a float back to the API
// (src/utils/format.ts's rule).
import type { EChartsOption } from '../../charts/echarts'
import { BAR_MARKS, grid, moneyAxis, monthAxis, roundTo, stagger } from '../../charts/grammar'
import { legendFor } from '../../charts/legend'
import { annotationRules, todayRule } from '../../charts/markLine'
import { OTHER_SERIES_COLOR, PALETTE, SURFACE } from '../../charts/theme'
import { axisTooltip } from '../../charts/tooltip'
import type { AxisTooltipParam } from '../../charts/tooltip'
import type { RsuGrantOut, VestOut } from '../../types/api'
import type { ExportTable } from '../../utils/download'
import { escapeHtml, formatCurrency, formatDate } from '../../utils/format'

/** The name the ninth grant and everything after it stacks under. */
export const OTHER_GRANT_LABEL = 'Other'

/** Tone-on-tone hatching for bars valued at today's quote rather than a stored close (F6):
 *  45° lines in the card surface over the grant's own colour — a token hex, so the light
 *  recolor and the conformance colour rule both hold. */
export const ESTIMATE_HATCH = {
  symbol: 'rect' as const,
  symbolSize: 1,
  dashArrayX: [1, 0],
  dashArrayY: [2, 4],
  rotation: -Math.PI / 4,
  color: SURFACE,
}

/**
 * Exported for tests. Per-grant rows plus the TOTAL the stack adds up to (2026-08-21 user
 * request: the bar's combined value, on hover — per-bar labels would collide at quarterly
 * density). A full formatter builds HTML, and grant LABELS are user text, so escapeHtml is
 * mandatory on every series name (SpendingPage's rule); echarts' own `marker` spans and our
 * formatted figures are the only other markup.
 */
export function vestingTooltipFormatter(params: unknown): string {
  const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
  const rows = list.filter(
    (p): p is AxisTooltipParam & { value: number } =>
      typeof p.value === 'number' && Number.isFinite(p.value),
  )
  if (rows.length === 0) return ''
  const lines = rows.map(
    (p) => `${p.marker ?? ''}${escapeHtml(p.seriesName ?? '')}: ${formatCurrency(p.value)}`,
  )
  const total = rows.reduce((sum, p) => sum + p.value, 0)
  return [
    `<strong>${escapeHtml(rows[0].axisValueLabel ?? '')}</strong>`,
    ...lines,
    `<strong>Total: ${formatCurrency(total)}</strong>`,
  ].join('<br/>')
}

// The palette's fixed order IS the CVD-safety mechanism (charts/theme.ts): eight slots, never
// a ninth and never a wrap back to the first. A tenth grant is a legend problem, not a licence
// to put two grants in one hue — so the tail folds into the neutral gray reserved for exactly
// this (AllocationPanel / SpendingPage's "Other").
const MAX_GRANT_SLOTS = PALETTE.length

/**
 * What one tranche contributes to its stack, or null when it must not draw at all.
 *
 * A PAST vest carries the server's own `value` — fmv on or before its date times shares — and
 * a null there means the price history had no bar behind it: the vest happened, its value is
 * unknown, and the payload's `warnings` is where that is said. It contributes 0 rather than
 * inventing a figure.
 *
 * A FUTURE vest has no close to be priced at, so it is worth the latest quote times its
 * shares. With no quote it draws NOTHING: a zero-height bar would say "this vest is worth
 * nothing", which is a different claim from "we do not know yet".
 */
function contribution(vest: VestOut, latestPrice: string | null): number | null {
  if (vest.is_past) return vest.value === null ? 0 : Number(vest.value)
  if (latestPrice === null) return null
  return vest.shares * Number(latestPrice)
}

/** The strip's two figures: past tranches at their stored closes, future ones at the quote. */
export function vestingTotals(
  vests: VestOut[],
  latestPrice: string | null,
): { vested: number; unvested: number | null } {
  const vested = roundTo(
    vests.filter((v) => v.is_past && v.value !== null).reduce((sum, v) => sum + Number(v.value), 0),
    2,
  )
  const futureShares = vests.filter((v) => !v.is_past).reduce((sum, v) => sum + v.shares, 0)
  return {
    vested,
    unvested: latestPrice === null ? null : roundTo(futureShares * Number(latestPrice), 2),
  }
}

/**
 * One stacked bar per vest DATE, one segment per grant — the whole vesting calendar, past
 * tranches at what they were worth and future ones at what today's quote would make them.
 *
 * Grants keep their feed order and their slot: a grant that is entirely in the future still
 * holds its colour when the quote is missing, so a reload that finds a price cannot recolour
 * the chart underneath the reader.
 *
 * Returns null when there is nothing worth drawing — fewer than two tranches on the wire (one
 * bar is a number, not a trend), or nothing left to plot once the unpriced future is omitted.
 * The caller renders an empty note, the house pattern for a builder with nothing to draw.
 */
export function vestingChartOption(
  vests: VestOut[],
  grants: RsuGrantOut[],
  latestPrice: string | null,
  { todayIso, selected }: { todayIso: string; selected?: Record<string, boolean> },
): EChartsOption | null {
  if (vests.length < 2) return null

  const folded = grants.length > MAX_GRANT_SLOTS
  const slotCount = folded ? MAX_GRANT_SLOTS + 1 : grants.length
  const slotByGrantId = new Map<number, number>()
  grants.forEach((grant, index) => {
    slotByGrantId.set(grant.id, folded && index >= MAX_GRANT_SLOTS ? MAX_GRANT_SLOTS : index)
  })

  // Only the tranches that will actually draw open a column: an omitted future vest, or one
  // whose grant is missing from the echo (a torn feed — the router drops an unschedulable
  // grant from BOTH lists), must not leave an axis label no bar can reach.
  const drawable = vests
    .map((vest) => ({ vest, amount: contribution(vest, latestPrice) }))
    .filter(({ vest, amount }) => amount !== null && slotByGrantId.has(vest.grant_id))
  if (drawable.length === 0) return null

  // The empty-LOOKING chart: every column would draw at zero height, and not one drawable
  // tranche is a past vest with a stored close behind it. An axis of flat zeros says "these
  // vests were worth nothing", which is the one thing an unpriced vest does not mean
  // (`contribution`'s note) — so the caller's empty note, with the payload's warnings beside
  // it, is the honest answer. A PRICED zero still draws: a 0.00 close, or a zero-share tranche
  // valued at a real quote, is a figure the server actually computed, and the column IS its
  // answer.
  //
  // With no past tranche at all the second clause is vacuously true, so an all-FUTURE chart of
  // zeros nulls as well — the same answer for the same reason, and unreachable with validated
  // data regardless: a grant's tranches sum to its `shares` (>= 1), so every future column can
  // only be zero if the latest quote itself is 0.
  if (
    drawable.every(({ amount }) => amount === 0) &&
    !drawable.some(({ vest }) => vest.is_past && vest.value !== null)
  ) {
    return null
  }

  // The feed is chronological, but the chart owns its own x-axis order rather than trusting
  // it (tcTrajectoryOption's reasoning). ISO dates sort as strings.
  const dates = [...new Set(drawable.map(({ vest }) => vest.vest_date))].sort()
  const columnByDate = new Map(dates.map((date, index) => [date, index]))

  // Zero-filled, not null-filled: a grant with nothing on a column contributes a real 0 so
  // the stack stays aligned (SpendingPage's stacked months).
  const rows: number[][] = Array.from({ length: slotCount }, () => dates.map(() => 0))
  for (const { vest, amount } of drawable) {
    const slot = slotByGrantId.get(vest.grant_id) as number
    rows[slot][columnByDate.get(vest.vest_date) as number] += amount as number
  }

  const names = Array.from({ length: slotCount }, (_, slot) =>
    folded && slot === MAX_GRANT_SLOTS ? OTHER_GRANT_LABEL : grants[slot].label,
  )

  // A future column is priced at TODAY's quote, not at a close it never had: it hatches, and
  // its tooltip rows say "(est.)" (F6).
  const futureDates = new Set(drawable.filter(({ vest }) => !vest.is_past).map(({ vest }) => vest.vest_date))
  const today = annotationRules([todayRule(dates, todayIso, formatDate)])

  return {
    grid: grid(),
    legend: legendFor(slotCount, selected),
    tooltip: axisTooltip({
      unit: 'money',
      groups: names,
      pointer: 'shadow',
      // A future column's rows are estimates at today's quote; the item carries the flag.
      rowSuffix: (param) => {
        const item = param.data as { estimate?: boolean } | number | null | undefined
        return typeof item === 'object' && item !== null && item.estimate === true ? '(est.)' : null
      },
    }),
    xAxis: monthAxis(
      dates.map((date) => formatDate(date)),
      { gap: true },
    ),
    yAxis: moneyAxis(),
    series: rows.map((data, slot) => ({
      name: names[slot],
      type: 'bar' as const,
      stack: 'vest',
      ...BAR_MARKS,
      ...stagger(slot),
      color: folded && slot === MAX_GRANT_SLOTS ? OTHER_SERIES_COLOR : PALETTE[slot],
      // The Today rule rides the first series only — one rule, not one per grant.
      ...(slot === 0 && today ? { markLine: today } : {}),
      data: data.map((value, column) =>
        futureDates.has(dates[column])
          ? { value: roundTo(value, 2), itemStyle: { decal: ESTIMATE_HATCH }, estimate: true }
          : roundTo(value, 2),
      ),
    })),
  }
}

/** Every drawable tranche (F12): past at its stored value, future at the quote, flagged. */
export function vestingCsv(
  vests: VestOut[],
  grants: RsuGrantOut[],
  latestPrice: string | null,
): ExportTable {
  const known = new Set(grants.map((g) => g.id))
  return {
    headers: ['Vest date', 'Grant', 'Shares', 'Value', 'Estimate'],
    rows: vests
      .filter((v) => known.has(v.grant_id))
      .map((v) => [
        v.vest_date,
        v.label,
        v.shares,
        v.is_past
          ? (v.value ?? '')
          : latestPrice === null
            ? ''
            : roundTo(v.shares * Number(latestPrice), 2).toFixed(2),
        v.is_past ? 'no' : 'yes',
      ]),
  }
}
