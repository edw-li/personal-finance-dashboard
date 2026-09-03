// The light-theme bridge for chart OPTIONS (shell spec §11). Builders keep importing the
// dark constants from charts/theme.ts (the "never invent a hue outside this file" rule is
// what makes this safe): under a light theme EChart deep-copies the option and swaps every
// exact dark token hex for its light counterpart at setOption time.
//
// What is and is not reached, precisely:
//   • gradient OBJECTS are walked like any other plain object, so a
//     `{ type: 'linear', colorStops: [{ color: PALETTE[0] }] }` gets its STOPS swapped;
//   • color STRINGS that are not an exact token hex — rgba(), hsl(), 'transparent',
//     a CSS `linear-gradient(...)` string — are not in the map and pass through;
//   • non-plain objects (Date, typed arrays, an echarts `graphic.LinearGradient`
//     INSTANCE) pass through by identity: a spread copy would drop their prototype and
//     hand echarts a lookalike it no longer recognizes;
//   • functions pass through by identity, so a formatter's OUTPUT is out of reach —
//     e.g. projectionChartOptions.ts builds tooltip HTML with PALETTE[0] baked into a
//     style attribute, and that swatch stays dark-blue under the light theme. Colors
//     that must follow the palette belong in the option, not in formatter markup.
import { DARK, LIGHT, type ThemeTokens } from '../theme/tokens'

// The dark set spends four hexes on TWO token names each, so a flat hex→hex map has to
// elect a winner wherever the light set SPLITS the pair. Last write wins, and the order
// below elects the meaning that actually reaches an option:
//   #1e222c  gridLine | surface2   → surface2   grid/axis lines only ever come from the
//   #262b36  axisLine | border     → border     REGISTERED theme, which is built per
//                                               palette (buildTheme) and never recolored;
//                                               surfaces do show up in option-level
//                                               tooltip/label backgrounds.
//   #c98500  warn     | palette[3] → moot       tokens.ts keeps ONE amber per theme, so
//                                               the light set does not split this pair:
//                                               both names write #996500 and whichever
//                                               wins is the same color. (Kept on the list
//                                               so a future re-split is noticed here.)
//   #3987e5  seq[6]   | palette[0] → palette[0] as a LONE color (GROUP_COLORS.cash and
//                                               every "primary series" fill). Inside a
//                                               sequential RAMP the position wins instead
//                                               — see the ramp keys below.
const SCALARS: (keyof ThemeTokens)[] = [
  'gridLine',
  'axisLine',
  'bg',
  'surface',
  'surface2',
  'border',
  'text',
  'muted',
  'accent',
  'positive',
  'negative',
  'warn',
  'otherSeries',
]

// Ramp entries are stored under a prefixed key so one Map can answer both questions:
// "what is this color on its own?" and "what is this color at step i of the scale?".
const RAMP = 'ramp:'

// BLOCK ORDER IS THE ELECTION: later writes overwrite earlier ones for a shared hex, so
// scalars → sequential → palette is exactly what makes palette[0] (not sequential[6]) and
// palette[3] (not warn) the lone-color winners documented above. Reordering re-elects.
function pairs(from: ThemeTokens, to: ThemeTokens): Map<string, string> {
  const map = new Map<string, string>()
  for (const key of SCALARS) map.set((from[key] as string).toLowerCase(), to[key] as string)
  from.sequential.forEach((hex, i) => {
    map.set(RAMP + hex.toLowerCase(), to.sequential[i])
    map.set(hex.toLowerCase(), to.sequential[i])
  })
  from.palette.forEach((hex, i) => map.set(hex.toLowerCase(), to.palette[i]))
  return map
}

export const lightFromDark: Map<string, string> = pairs(DARK, LIGHT)

/** THE RAMP RULE, exactly: an array is treated as a sequential ramp iff it has AT LEAST
 *  TWO entries and EVERY entry is a string that is a step of the dark scale (any steps, in
 *  any order, repeats allowed — position within the array is irrelevant; what is mapped by
 *  position is each hex's own index in the scale). Two adjacent steps therefore qualify,
 *  and one foreign leaf — a non-token hex, a number, an object — disqualifies the WHOLE
 *  array, which then falls back to elementwise recoloring where the shared hex #3987e5
 *  resolves to palette[0] instead. Ramp treatment exists so the step that doubles as
 *  palette[0] keeps its PLACE in the light scale instead of jumping to the categorical
 *  blue. `null` = not a ramp, recolor elementwise. */
function recolorRamp(items: unknown[], map: Map<string, string>): string[] | null {
  if (items.length < 2) return null
  const out: string[] = []
  for (const item of items) {
    if (typeof item !== 'string') return null
    const mapped = map.get(RAMP + item.toLowerCase())
    if (mapped === undefined) return null
    out.push(mapped)
  }
  return out
}

/** Deep-copies `value`, replacing string leaves found in `map` (case-insensitive).
 *  Only arrays and PLAIN objects are walked — functions (tooltip/axisLabel formatters)
 *  and non-plain objects fall through the final return and stay referentially identical,
 *  which is what keeps a recolored option behaviourally the same option. */
export function recolorOption(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === 'string') return map.get(value.toLowerCase()) ?? value
  if (Array.isArray(value)) {
    return recolorRamp(value, map) ?? value.map((item) => recolorOption(item, map))
  }
  if (value !== null && typeof value === 'object') {
    // Only `{}` literals and null-prototype bags are safe to rebuild key-by-key. A Date,
    // a typed array (echarts accepts them as series data) or an echarts LinearGradient
    // INSTANCE would come back as a plain lookalike with its prototype — and so its
    // methods and echarts' own type checks — gone. None of them can hold a token hex in
    // an enumerable string field, so passing them through by identity costs nothing.
    const proto: unknown = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return value
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = recolorOption(item, map)
    }
    return out
  }
  return value
}
