// Single copy (staleness.ts precedent): the delta-tone rule for stat tiles. Zero is
// NEUTRAL — a flat day/month is neither good nor bad, and a green "▲ $0.00" is a lie
// in every direction. Ratified Plan 6 Task 8 review: PortfolioPage's zero rule wins;
// NetWorthPage/Overview previously mapped zero to positive (forked helpers, now deleted).
//
// Number() here is display-only (src/utils/format.ts's rule): nothing derived from it is
// ever rendered as a figure or sent back to the API — only a CSS class and a glyph.
export type Tone = 'positive' | 'negative' | 'neutral'

export function toneOf(value: string | number | null | undefined): Tone {
  if (value == null) return 'neutral'
  const n = Number(value)
  return n > 0 ? 'positive' : n < 0 ? 'negative' : 'neutral'
}
