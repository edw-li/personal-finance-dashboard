// THE color source of truth for both palettes (2026-09-03 shell spec §11). index.css carries
// static copies for first paint and tokens.test.ts keeps them equal; the chart bridge
// (charts/theme.ts, charts/recolor.ts) reads these slots — theme.ts derives the registered
// ECharts theme from them, recolor.ts maps DARK → LIGHT inside built options.
// Dark values are the pre-existing ones (index.css + charts/theme.ts), unchanged except
// `otherSeries`, raised from #4a5060 (2.16:1) to meet 3:1 on the surface.

/** The palette actually in force. It lives HERE rather than with the state that owns it
 *  (components/shell/ThemeProvider, which re-exports it for UI callers) so the chart
 *  bridge can type its arguments without charts/ importing from components/ — that file
 *  is the lazy chart chunk's root and must not reach into React's tree, even by name. */
export type ResolvedTheme = 'dark' | 'light'

export interface ThemeTokens {
  bg: string
  surface: string
  surface2: string
  border: string
  text: string
  muted: string
  accent: string
  /** Ink for text/glyphs painted ON `accent` (primary buttons, the skip link) — the one
   *  token that must invert between themes: near-black on the dark theme's bright accent,
   *  white on the light theme's deep one (tokens.test.ts holds both to 4.5:1). */
  onAccent: string
  positive: string
  negative: string
  warn: string
  gridLine: string
  axisLine: string
  otherSeries: string
  /** Fixed slot order IS the CVD-safety mechanism — never reorder (charts/theme.ts). */
  palette: readonly [string, string, string, string, string, string, string, string]
  /** 12 steps, near-zero first (recedes into the card), for heatmaps. A fixed-LENGTH tuple
   *  like `palette`: charts/recolor.ts maps DARK → LIGHT by POSITION, so equal lengths are
   *  what guarantee every dark step has a light twin (a 13th dark step would otherwise map
   *  to undefined and paint a hole). The compiler enforces it here; recolor.test.ts pins
   *  the resulting map. */
  sequential: readonly [
    string, string, string, string, string, string,
    string, string, string, string, string, string,
  ]
}

export const DARK: ThemeTokens = {
  bg: '#0f1115',
  surface: '#171a21',
  surface2: '#1e222c',
  border: '#262b36',
  text: '#e6e9ef',
  muted: '#8b93a3',
  accent: '#4f8cff',
  onAccent: '#0b0e14',
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
// family darkened until every slot clears its floor. The floor is read against BOTH
// text-bearing backgrounds — the white card AND the pale page (--bg #f2f5f9, the weaker of
// the two) — because deltas, links and advisories sit on bare page as often as they sit on
// a card (tokens.test.ts). Small text carries the spec's 4.5:1, chart slots 3:1.
// That two-background floor is why the three small-text tones sit one notch below the
// mockup's #3b7dd8 / #1f8f4e / #a86400, which cleared 4.5:1 on white alone:
// accent #296dcc (4.62 on --bg, 5.06 on white), positive #1b7e44 (4.67 / 5.10),
// warn #996500 (4.56 / 4.98). accent and positive keep the hue and saturation of the tone
// they replace (215.0°, 144.8°) — only lightness moved. warn IS palette[3], one amber per
// theme exactly as in DARK, and #996500 is back on the palette amber's 39.7° hue that the
// retired #a86400 (35.7°) had drifted off; the chart slot moved with it.
export const LIGHT: ThemeTokens = {
  bg: '#f2f5f9',
  surface: '#ffffff',
  surface2: '#f7f9fc',
  border: '#e1e7ef',
  text: '#141a24',
  muted: '#5f6b7a',
  accent: '#296dcc',
  onAccent: '#ffffff',
  positive: '#1b7e44',
  negative: '#c73a3a',
  warn: '#996500',
  gridLine: '#e6ebf2',
  axisLine: '#d5dce6',
  otherSeries: '#7f8a9c',
  palette: ['#2f6fdc', '#c94f1e', '#15895f', '#996500', '#c2436f', '#1f7a1f', '#6f63d6', '#c94848'],
  sequential: [
    '#e8f0fb', '#d3e2f7', '#bcd3f2', '#a3c2ec', '#89b0e6', '#6f9ddf',
    '#5589d6', '#3f76cb', '#2f65b8', '#255399', '#1d427c', '#153260',
  ],
}

/** The CSS custom-property declarations a palette expands to — the shape index.css must
 *  carry verbatim (tokens.test.ts diffs value-by-value, last declaration wins). */
export function cssDeclarations(t: ThemeTokens): string[] {
  return [
    `--bg: ${t.bg};`,
    `--surface: ${t.surface};`,
    `--surface-2: ${t.surface2};`,
    `--border: ${t.border};`,
    `--text: ${t.text};`,
    `--muted: ${t.muted};`,
    `--accent: ${t.accent};`,
    `--on-accent: ${t.onAccent};`,
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

/** Only full #rrggbb is accepted. Shorthand (#abc), named colors and rgba() would each
 *  parse to NaN and silently sail through the contrast floors, so they throw here. */
const HEX6 = /^#[0-9a-f]{6}$/i

/** WCAG 2.x relative luminance of a #rrggbb color. */
export function luminance(hex: string): number {
  if (!HEX6.test(hex)) throw new Error(`luminance() needs a #rrggbb color, got: ${hex}`)
  const h = hex.slice(1)
  return 0.2126 * channel(h, 0) + 0.7152 * channel(h, 2) + 0.0722 * channel(h, 4)
}

/** WCAG contrast ratio between two #rrggbb colors (order-independent). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
