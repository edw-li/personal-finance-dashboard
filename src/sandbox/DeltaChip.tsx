import { formatCurrency } from '../utils/format'
import { toneOf } from '../utils/tone'
import type { Tone } from '../utils/tone'
import { decimalsIn, trimZeros } from './decimal'
import './sandbox.css'

// A signed, formatted delta with a tone (2026-09-03 planning-sandboxes spec §8.3). `invert`
// flips the colour for cost lines so a RISE reads red — WhatIfPanel's inverted() promoted to
// a component: the glyph follows the number, the colour follows good/bad. Number() is
// display-only (utils/format.ts's rule); the value shown is the server's string, signed.
export type DeltaKind = 'money' | 'points' | 'plain'

export function inverted(tone: Tone): Tone {
  return tone === 'positive' ? 'negative' : tone === 'negative' ? 'positive' : 'neutral'
}

export function formatDelta(value: string, kind: DeltaKind): string {
  const tone = toneOf(value)
  const sign = tone === 'positive' ? '+' : tone === 'negative' ? '-' : ''
  const abs = value.startsWith('-') ? value.slice(1) : value
  if (kind === 'money') return tone === 'neutral' ? formatCurrency(abs) : `${sign}${formatCurrency(abs)}`
  if (kind === 'points') {
    // Percentage POINTS, at least one decimal so "+2 pp" and "+2.0 pp" cannot both appear.
    const decimals = Math.max(1, Math.min(2, decimalsIn(trimZeros(abs))))
    return `${sign}${Number(abs).toFixed(decimals)} pp`
  }
  return `${sign}${trimZeros(abs)}`
}

export default function DeltaChip({
  value,
  kind,
  invert = false,
}: {
  value: string | null
  kind: DeltaKind
  invert?: boolean
}) {
  if (value === null) return <span className="delta-chip delta-chip-neutral">—</span>
  const tone = toneOf(value)
  const shown = invert ? inverted(tone) : tone
  return <span className={`delta-chip delta-chip-${shown}`}>{formatDelta(value, kind)}</span>
}
