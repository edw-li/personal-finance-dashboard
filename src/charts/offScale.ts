// Values clipped by a robust axis, drawn AT the edge (2026-09-23 spec §C3): the edge markers and
// the rule that keeps their labels from printing over each other. Moved out of grammar.ts
// (which re-exports every symbol). Depends on: charts/theme.ts, charts/formatters.ts.
import { compactMoney, percentLabel } from './formatters'
import { MUTED } from './theme'

/** One clipped point: its position on the category axis, its label, its true value. */
export interface OffScalePoint {
  index: number
  x: string
  value: number
}

/** One edge marker. `lift` raises its label clear of another series' label; `label: false`
 *  keeps the triangle without the text. */
export interface OffScaleMark {
  x: string
  value: number
  lift?: number
  label?: boolean
}

/** The share of the visible window one off-scale label needs: about 60 px of a half-width
 *  card's 420 px plot. Clipped months closer together than that share one label. It is a
 *  fraction, not pixels, because a builder cannot know the card (§C4), and a fraction
 *  follows the zoom. */
export const OFF_SCALE_LABEL_SHARE = 1 / 7

/** Month gap below which clipped points share one label, for `visible` months on screen. */
export const offScaleGap = (visible: number) => Math.max(1, Math.ceil(visible * OFF_SCALE_LABEL_SHARE))

/** Which edge markers carry their true-value label, over EVERY series clipped at one edge
 *  (spec §C3; `series[k]` holds series k's clipped points in axis order). Labels are selective,
 *  so they never print over each other. Points of any series fewer than `minGap` months apart
 *  chain into one cluster, and each series labels only its most extreme point in a cluster.
 *  The rest keep their triangle, and the tooltip keeps every true value. A series whose cluster
 *  an earlier series already labels is lifted clear of it, unless both would print the same
 *  text at the same month: that reads as one label. */
export function offScaleMarks(
  series: readonly (readonly OffScalePoint[])[],
  {
    direction,
    minGap,
    lift,
    text,
  }: { direction: 'up' | 'down'; minGap: number; lift: number; text: (value: number) => string },
): OffScaleMark[][] {
  const everyPoint = series
    .flatMap((points, k) => points.map((point) => ({ point, k })))
    .sort((a, b) => a.point.index - b.point.index)
  const clusterOf = new Map<OffScalePoint, number>()
  let cluster = -1
  let previous = Number.NEGATIVE_INFINITY
  for (const { point } of everyPoint) {
    if (point.index - previous >= minGap) cluster += 1
    clusterOf.set(point, cluster)
    previous = point.index
  }
  const further = (a: OffScalePoint, b: OffScalePoint) =>
    (direction === 'down' ? b.value < a.value : b.value > a.value) ? b : a
  const labelled = series.map((points) => {
    const best = new Map<number, OffScalePoint>()
    for (const point of points) {
      const c = clusterOf.get(point) as number
      const held = best.get(c)
      best.set(c, held === undefined ? point : further(held, point))
    }
    return best
  })
  return series.map((points, k) =>
    points.map((point) => {
      const c = clusterOf.get(point) as number
      if (labelled[k].get(c) !== point) return { x: point.x, value: point.value, label: false }
      const clear = labelled
        .slice(0, k)
        .map((best) => best.get(c))
        .filter((other): other is OffScalePoint => other !== undefined)
        .filter((other) => !(other.index === point.index && text(other.value) === text(point.value))).length
      return clear === 0 ? { x: point.x, value: point.value } : { x: point.x, value: point.value, lift: lift * clear }
    }),
  )
}

/** Clipped values drawn AT the edge (spec §C3): a small triangle pointing off the plot, labelled
 *  with the true value ("$25.9K ↑", "-1073% ↓") — the tooltip keeps the true value too, because
 *  the series data is never altered. `lift` stacks the label of a second clipped series at the
 *  same place so two labels never print over each other; `label: false` (offScaleMarks, one
 *  label per cluster) keeps the triangle alone. Undefined when nothing is clipped. */
export function offScaleMarkPoint(
  marks: readonly OffScaleMark[],
  {
    edge,
    direction,
    color,
    unit,
  }: { edge: number; direction: 'up' | 'down'; color: string; unit: 'money' | 'percent' },
) {
  if (marks.length === 0) return undefined
  const format = unit === 'money' ? compactMoney : percentLabel
  const arrow = direction === 'up' ? '↑' : '↓'
  return {
    silent: true as const,
    symbol: 'triangle' as const,
    symbolSize: 8,
    symbolRotate: direction === 'up' ? 0 : 180,
    itemStyle: { color },
    label: {
      show: true as const,
      color: MUTED,
      fontSize: 11,
      // Inside the plot: above the edge sits the legend, below the floor the month axis.
      position: direction === 'up' ? ('bottom' as const) : ('top' as const),
    },
    data: marks.map((mark) => ({
      // echarts' MarkPointDataItemOption requires a name; the month it marks is the honest one.
      name: mark.x,
      coord: [mark.x, edge] as [string, number],
      value: mark.value,
      label:
        mark.label === false
          ? { show: false as const }
          : {
              formatter: `${format(mark.value)} ${arrow}`,
              ...(mark.lift ? { offset: [0, direction === 'up' ? mark.lift : -mark.lift] as [number, number] } : {}),
            },
    })),
  }
}
