// Continuous colour scales (chart spec §12) and the two heatmap transforms behind F1.
// `sequentialVisualMap` is the spending heatmap's current visualMap verbatim; the diverging
// map is the ONLY reader of the DIVERGING tuple. Both return plain literals — recolor.ts maps
// the `inRange.color` arrays by position under the light theme (the ramp rule), whichever way
// round they are. Depends on: charts/theme.ts.
import { DIVERGING, MUTED, SEQUENTIAL_BLUE } from './theme'

const BAR = {
  calculable: false,
  orient: 'horizontal' as const,
  left: 'center' as const,
  bottom: 0,
  textStyle: { color: MUTED },
}

export interface SequentialVisualMapInput {
  min: number
  max: number
  formatter: (value: number) => string
  /** visualMap `text` is [high, low] — the labels at the two ends of the bar. */
  labels?: [string, string]
}

export function sequentialVisualMap({ min, max, formatter, labels }: SequentialVisualMapInput) {
  return {
    min,
    max,
    ...BAR,
    inRange: { color: [...SEQUENTIAL_BLUE] },
    formatter: (value: unknown) => formatter(value as number),
    ...(labels ? { text: labels } : {}),
  }
}

export interface DivergingVisualMapInput {
  /** Half-width: the scale runs center − span … center + span. */
  span: number
  center?: number
  formatter: (value: number) => string
  labels?: [string, string]
  /** Which arm paints the HIGH end. Gains read blue (default); "above your average
   *  spend" reads orange. */
  highArm?: 'blue' | 'orange'
}

export function divergingVisualMap({
  span,
  center = 0,
  formatter,
  labels,
  highArm = 'blue',
}: DivergingVisualMapInput) {
  return {
    type: 'continuous' as const,
    min: center - span,
    max: center + span,
    ...BAR,
    inRange: { color: highArm === 'blue' ? [...DIVERGING] : [...DIVERGING].reverse() },
    formatter: (value: unknown) => formatter(value as number),
    ...(labels ? { text: labels } : {}),
  }
}

/** F1 "Row": each row on its own 0 → max scale, so a $200 category's busiest month reads as
 *  dark as a $2,000 one's. Nulls stay null (absent ≠ zero); an all-zero row stays zero. */
export function rowNormalize(rows: (number | null)[][]): (number | null)[][] {
  return rows.map((row) => {
    const max = row.reduce<number>((m, v) => (v === null ? m : Math.max(m, v)), 0)
    return row.map((v) => (v === null ? null : max > 0 ? v / max : 0))
  })
}

/** F1 "vs average": (value − mean of the prior `window` non-null months) ÷ that mean, as a
 *  ratio. Null until `minPrior` prior months exist (sparse history says nothing), null when
 *  the month itself is absent, null when the mean is zero (a ratio to nothing). */
export function vsAverage(
  rows: (number | null)[][],
  { window = 12, minPrior = 6 }: { window?: number; minPrior?: number } = {},
): (number | null)[][] {
  return rows.map((row) =>
    row.map((v, i) => {
      if (v === null) return null
      const prior = row.slice(Math.max(0, i - window), i).filter((x): x is number => x !== null)
      if (prior.length < minPrior) return null
      const mean = prior.reduce((a, b) => a + b, 0) / prior.length
      return mean > 0 ? (v - mean) / mean : null
    }),
  )
}
