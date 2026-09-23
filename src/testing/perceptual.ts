// Test-only perceptual colour checks (the dataviz validator's measure): OKLab ΔE × 100 between
// two token hexes, in BOTH themes. Builders emit the dark tokens and charts/recolor.ts maps them
// to the light set, so a pair is judged on each side of that map. A hex-identity test cannot see
// two DIFFERENT hexes that read as one colour (the 2026-09-23 review: the tax hue and the
// deficit red are 2.5 apart on the light theme).
import { lightFromDark } from '../charts/recolor'

/** The validator's normal-vision floor: below it, full-colour readers cannot tell a pair apart. */
export const NORMAL_VISION_FLOOR = 15

const toLinear = (channel: number) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function oklab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const r = toLinear((n >> 16) & 255)
  const g = toLinear((n >> 8) & 255)
  const b = toLinear(n & 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLab ΔE × 100 between two hexes. */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a)
  const [l2, a2, b2] = oklab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100
}

/** ΔE between two DARK token hexes on the dark theme and, through the recolor map, the light. */
export function deltaEBothThemes(darkA: string, darkB: string): { dark: number; light: number } {
  const light = (hex: string) => lightFromDark.get(hex.toLowerCase()) ?? hex
  return { dark: deltaE(darkA, darkB), light: deltaE(light(darkA), light(darkB)) }
}

/** A mark as a reader sees it: its colour, and the texture (echarts decal) it may carry. */
export interface Mark {
  color: string
  decal?: unknown
}

/** Two marks read as different things: their colours clear the floor in BOTH themes, or their
 *  textures differ (one hatched, the other not, or two different hatches). */
export function distinguishable(a: Mark, b: Mark): boolean {
  const { dark, light } = deltaEBothThemes(a.color, b.color)
  if (dark >= NORMAL_VISION_FLOOR && light >= NORMAL_VISION_FLOOR) return true
  return JSON.stringify(a.decal ?? null) !== JSON.stringify(b.decal ?? null)
}
