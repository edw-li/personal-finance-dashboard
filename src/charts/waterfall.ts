// The invisible-placeholder waterfall (lifted from taxChartOptions, 2026-09-04): an opening
// bar on the floor, each step floating on the remainder LEFT after it, a closing bar on the
// floor. `delta` is what a step DOES to the running total (a tax is −tax), `amount` is what
// it REPORTS (the tax itself) — the tooltip and the cap label say the amount. Used by the tax
// waterfall and the net-worth "What moved" bridge. Depends on: grammar.ts, tooltip.ts, theme.ts.
import type { ExportTable } from '../utils/download'
import { formatCurrency, formatCurrencyCompact } from '../utils/format'
import { capLabel, roundTo, stagger } from './grammar'
import { INK, SURFACE } from './theme'
import { itemTooltip } from './tooltip'

export interface WaterfallEnd {
  label: string
  amount: number
  color: string
}

export interface WaterfallItem {
  label: string
  /** The signed figure the step reports. */
  amount: number
  /** The change applied to the running remainder (a tax is the negative of its amount). */
  delta: number
  color: string
}

export interface WaterfallStep {
  label: string
  amount: number
  /** Floor of the floating segment (the invisible placeholder bar). */
  base: number
  /** Height of the visible segment: |delta|, so a step in either direction draws. */
  height: number
  color: string
  /** What is left after this step; null on the two full-height end bars. */
  remaining: number | null
}

export function waterfallSteps(opening: WaterfallEnd, items: WaterfallItem[], closing: WaterfallEnd): WaterfallStep[] {
  const steps: WaterfallStep[] = [
    { label: opening.label, amount: opening.amount, base: 0, height: opening.amount, color: opening.color, remaining: null },
  ]
  let remainder = opening.amount
  for (const item of items) {
    // The chain is float arithmetic on cent-quantized figures — each remainder lands back on
    // cents (a running remainder is chart geometry, never a reported figure).
    const after = roundTo(remainder + item.delta, 2)
    steps.push({
      label: item.label,
      amount: item.amount,
      // A step that goes UP (a credit-driven negative tax, a gain) spans [before, after]: the
      // LOWER end is the floor and |delta| the height, which reduces to "floor = remainder
      // after" for every ordinary downward step.
      base: Math.min(remainder, after),
      height: Math.abs(roundTo(item.delta, 2)),
      color: item.color,
      remaining: after,
    })
    remainder = after
  }
  // The closing bar is the CALLER's figure (the server's take-home, the month's net worth),
  // never the chain's last remainder — the chain landing on it is the caller's invariant.
  steps.push({ label: closing.label, amount: closing.amount, base: 0, height: closing.amount, color: closing.color, remaining: null })
  return steps
}

export function waterfallSeries(steps: WaterfallStep[]) {
  const placeholder = {
    name: 'placeholder',
    type: 'bar' as const,
    stack: 'waterfall',
    // 'all', not echarts' default 'samesign': samesign un-floats a segment whose base has
    // gone negative (total_tax > gross on a half-entered year), flattening the walk.
    stackStrategy: 'all' as const,
    // Silent + transparent: it exists only to lift the visible segment off the floor.
    silent: true,
    itemStyle: { color: 'transparent' },
    emphasis: { itemStyle: { color: 'transparent' } },
    tooltip: { show: false },
    data: steps.map((s) => s.base),
  }
  const amount = {
    name: 'Amount',
    type: 'bar' as const,
    stack: 'waterfall',
    stackStrategy: 'all' as const,
    // Series index 1 of the stack (§11): 12ms behind the transparent floor it rides on,
    // which is only ever felt as the walk starting a frame later.
    ...stagger(1),
    barMaxWidth: 24,
    itemStyle: { borderColor: SURFACE, borderWidth: 1 },
    emphasis: { itemStyle: { borderColor: INK } },
    // Direct labels: a waterfall is read step by step, and hover-only numbers make that a hunt.
    label: capLabel((p) => formatCurrencyCompact(steps[p.dataIndex]?.amount ?? 0)),
    data: steps.map((s) => ({ value: s.height, itemStyle: { color: s.color } })),
  }
  // Returned as a TUPLE: the two series have different shapes, and a plain array literal
  // widens to a union in which `label` (only the Amount series has one) reads as possibly
  // undefined at every destructuring site.
  return [placeholder, amount] as [typeof placeholder, typeof amount]
}

/** Item trigger, not axis: an axis tooltip would announce the invisible placeholder too. */
export function waterfallTooltip(steps: WaterfallStep[]) {
  return itemTooltip<{ dataIndex?: number }>({
    body: (p) => {
      const step = steps[p.dataIndex ?? -1]
      if (step === undefined) return null
      return {
        value: step.amount,
        label: step.label,
        ...(step.remaining === null ? {} : { sub: `Left: ${formatCurrency(step.remaining)}` }),
      }
    },
  })
}

export function waterfallCsv(steps: WaterfallStep[]): ExportTable {
  return {
    headers: ['Step', 'Amount', 'Remaining'],
    rows: steps.map((s) => [s.label, s.amount.toFixed(2), s.remaining === null ? '' : s.remaining.toFixed(2)]),
  }
}
