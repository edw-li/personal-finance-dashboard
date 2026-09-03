// The light-theme bridge for chart OPTIONS (shell spec §11). Builders keep importing the
// dark constants from charts/theme.ts (the "never invent a hue outside this file" rule is
// what makes this safe): under a light theme EChart deep-copies the option and swaps every
// exact dark token hex for its light counterpart at setOption time. Gradients, rgba()
// strings and anything not in the map pass through untouched.
import { DARK, LIGHT, type ThemeTokens } from '../theme/tokens'

// The dark set spends four hexes on TWO token names each, and the light set splits every
// one of them, so a flat hex→hex map has to elect a winner. Last write wins, and the order
// below elects the meaning that actually reaches an option:
//   #1e222c  gridLine | surface2   → surface2   grid/axis lines only ever come from the
//   #262b36  axisLine | border     → border     REGISTERED theme, which is built per
//                                               palette (buildTheme) and never recolored;
//                                               surfaces do show up in option-level
//                                               tooltip/label backgrounds.
//   #c98500  warn     | palette[3] → palette[3] worn by bars, not by warning chips.
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

/** A sequential ramp — two or more strings, every one a step of the dark scale — mapped
 *  BY POSITION, so the step that doubles as palette[0] keeps its place in the light ramp
 *  instead of jumping to the categorical blue. `null` = not a ramp, recolor elementwise. */
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
 *  Only arrays and objects are walked — functions (tooltip/axisLabel formatters) fall
 *  through the final return and stay referentially identical, which is what keeps a
 *  recolored option behaviourally the same option. */
export function recolorOption(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === 'string') return map.get(value.toLowerCase()) ?? value
  if (Array.isArray(value)) {
    return recolorRamp(value, map) ?? value.map((item) => recolorOption(item, map))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = recolorOption(item, map)
    }
    return out
  }
  return value
}
