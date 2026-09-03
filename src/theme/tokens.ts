// THE color source of truth for both palettes (2026-09-03 shell spec §11). index.css carries
// static copies for first paint and tokens.test.ts keeps them equal; charts/theme.ts builds
// the ECharts theme from here; charts/recolor.ts maps DARK → LIGHT inside options.
// Dark values are the pre-existing ones (index.css + charts/theme.ts), unchanged except
// `otherSeries`, raised from #4a5060 (2.16:1) to meet 3:1 on the surface.

export interface ThemeTokens {
  bg: string
  surface: string
  surface2: string
  border: string
  text: string
  muted: string
  accent: string
  positive: string
  negative: string
  warn: string
  gridLine: string
  axisLine: string
  otherSeries: string
  /** Fixed slot order IS the CVD-safety mechanism — never reorder (charts/theme.ts). */
  palette: readonly [string, string, string, string, string, string, string, string]
  /** 12 steps, near-zero first (recedes into the card), for heatmaps. */
  sequential: readonly string[]
}

export const DARK: ThemeTokens = {
  bg: '#0f1115',
  surface: '#171a21',
  surface2: '#1e222c',
  border: '#262b36',
  text: '#e6e9ef',
  muted: '#8b93a3',
  accent: '#4f8cff',
  positive: '#3fb968',
  negative: '#e05252',
  warn: '#c98500',
  gridLine: '#1e222c',
  axisLine: '#262b36',
  otherSeries: '#6b7382',
  palette: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  sequential: [
    '#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6',
    '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#cde2fb',
  ],
}

// Cool neutral (approved 2026-09-03): pale blue-gray page, white cards, the same hue
// family darkened until each slot clears 3:1 on white. `accent` and `positive` are one
// notch darker than the mockup's #3b7dd8 (4.11:1) and #1f8f4e (4.12:1): both are worn by
// SMALL text — links, deltas — so the spec's 4.5:1 acceptance floor binds, not 3:1
// (tokens.test.ts). Hue and saturation are unchanged; only lightness moved.
export const LIGHT: ThemeTokens = {
  bg: '#f2f5f9',
  surface: '#ffffff',
  surface2: '#f7f9fc',
  border: '#e1e7ef',
  text: '#141a24',
  muted: '#5f6b7a',
  accent: '#2d73d5',
  positive: '#1d8649',
  negative: '#c73a3a',
  warn: '#a86400',
  gridLine: '#e6ebf2',
  axisLine: '#d5dce6',
  otherSeries: '#7f8a9c',
  palette: ['#2f6fdc', '#c94f1e', '#15895f', '#a86f00', '#c2436f', '#1f7a1f', '#6f63d6', '#c94848'],
  sequential: [
    '#e8f0fb', '#d3e2f7', '#bcd3f2', '#a3c2ec', '#89b0e6', '#6f9ddf',
    '#5589d6', '#3f76cb', '#2f65b8', '#255399', '#1d427c', '#153260',
  ],
}

/** The CSS custom-property declarations a palette expands to — the shape index.css must
 *  carry verbatim (tokens.test.ts). Order is stable so the test can diff by set. */
export function cssDeclarations(t: ThemeTokens): string[] {
  return [
    `--bg: ${t.bg};`,
    `--surface: ${t.surface};`,
    `--surface-2: ${t.surface2};`,
    `--border: ${t.border};`,
    `--text: ${t.text};`,
    `--muted: ${t.muted};`,
    `--accent: ${t.accent};`,
    `--positive: ${t.positive};`,
    `--negative: ${t.negative};`,
    `--warn: ${t.warn};`,
    `--grid-line: ${t.gridLine};`,
    `--axis-line: ${t.axisLine};`,
    `--other-series: ${t.otherSeries};`,
    ...t.palette.map((hex, i) => `--chart-${i + 1}: ${hex};`),
  ]
}

function channel(hex: string, offset: number): number {
  const c = parseInt(hex.slice(offset, offset + 2), 16) / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.x relative luminance of a #rrggbb color. */
export function luminance(hex: string): number {
  const h = hex.replace('#', '')
  return 0.2126 * channel(h, 0) + 0.7152 * channel(h, 2) + 0.0722 * channel(h, 4)
}

/** WCAG contrast ratio between two #rrggbb colors (order-independent). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
