// Test-only perceptual colour checks (the dataviz validator's measure): OKLab ΔE × 100 between
// two token hexes, in BOTH themes. Builders emit the dark tokens and charts/recolor.ts maps them
// to the light set, so a pair is judged on each side of that map. A hex-identity test cannot see
// two DIFFERENT hexes that read as one colour (the 2026-09-23 review: the tax hue and the
// deficit red are 2.5 apart on the light theme). Colour-vision deficiency is measured the
// validator's way too (deltaECvd): the pair as a protanope and as a deuteranope sees it, the
// worse of the two.
import { lightFromDark } from '../charts/recolor'

/** The validator's normal-vision floor: below it, full-colour readers cannot tell a pair apart. */
export const NORMAL_VISION_FLOOR = 15

const toLinear = (channel: number) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

type Rgb = [number, number, number]

/** A hex as linear-light RGB, each channel 0–1. */
function linear(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [toLinear((n >> 16) & 255), toLinear((n >> 8) & 255), toLinear(n & 255)]
}

// Machado, Oliveira & Fernandes (2009) dichromacy at severity 1.0, applied in linear RGB — the
// validator's own model. Its CVD thresholds are calibrated to this simulation: another (Viénot
// 1999, Brettel 1997) moves borderline pairs.
const MACHADO: Record<'protan' | 'deutan', readonly Rgb[]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/** A linear colour as a dichromat sees it (out-of-gamut results clamp, as the validator's do). */
function simulate([r, g, b]: Rgb, kind: keyof typeof MACHADO): Rgb {
  const rows = MACHADO[kind]
  return rows.map(([mr, mg, mb]) => clamp01(mr * r + mg * g + mb * b)) as Rgb
}

function oklabFromLinear([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

const distance = (x: Rgb, y: Rgb) => {
  const [l1, a1, b1] = oklabFromLinear(x)
  const [l2, a2, b2] = oklabFromLinear(y)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100
}

/** OKLab ΔE × 100 between two hexes. */
export function deltaE(a: string, b: string): number {
  return distance(linear(a), linear(b))
}

/** OKLab ΔE × 100 between two hexes as a protanope and as a deuteranope sees them — the worse
 *  of the two (the validator's CVD separation). */
export function deltaECvd(a: string, b: string): number {
  const [x, y] = [linear(a), linear(b)]
  return Math.min(distance(simulate(x, 'protan'), simulate(y, 'protan')), distance(simulate(x, 'deutan'), simulate(y, 'deutan')))
}

const lightOf = (hex: string) => lightFromDark.get(hex.toLowerCase()) ?? hex

/** ΔE between two DARK token hexes on the dark theme and, through the recolor map, the light. */
export function deltaEBothThemes(darkA: string, darkB: string): { dark: number; light: number } {
  return { dark: deltaE(darkA, darkB), light: deltaE(lightOf(darkA), lightOf(darkB)) }
}

/** A pair's separation, normal vision and CVD, in both themes — the form entities.ts's header
 *  quotes ("normal/CVD, dark · light"). */
export function separation(
  darkA: string,
  darkB: string,
): { dark: { normal: number; cvd: number }; light: { normal: number; cvd: number } } {
  const [la, lb] = [lightOf(darkA), lightOf(darkB)]
  return {
    dark: { normal: deltaE(darkA, darkB), cvd: deltaECvd(darkA, darkB) },
    light: { normal: deltaE(la, lb), cvd: deltaECvd(la, lb) },
  }
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
