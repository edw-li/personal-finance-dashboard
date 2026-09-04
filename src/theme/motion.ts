// THE motion source of truth (2026-09-05 spec §1), in tokens.ts's shape: index.css carries
// the CSS copies for first paint and motion.test.ts fails on any drift; JS timers that must
// outlast a CSS animation read these numbers instead of re-typing them. fast = hovers,
// toggles, dims, overlay entrances; page = route content (was 180ms); enter = card
// entrance; stagger = per-card offset; xfade = skeleton → content (lane M3); nav =
// indicator slide; flash = pasted cell — the CSS animation AND the timer that clears it.
export const MOTION_MS = {
  fast: 120, page: 240, enter: 240, stagger: 40, xfade: 180, nav: 200, flash: 700,
} as const

export const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)'

/** Scroll-linked reveal (spec §4). Strings: these are CSS values, never arithmetic.
 *  Deepened 2026-09-05 from 0.62/35%/4px: at 0.62 the shadow was invisible next to the page's
 *  own contrast and read as the same grey as a busy body, so it said nothing. The floor is now
 *  a real step down, the range is wide enough that the brightening is a gradient rather than a
 *  flick near the edge, and the rise carries the extra travel that goes with it. */
export const REVEAL = { floor: '0.45', range: '45%', rise: '6px' } as const

/** The viewport-edge scrims (spec §4b). The reveal dims one CARD as it nears an edge; the
 *  scrims say the same thing about the PAGE — a 120px page-coloured fade at each edge of the
 *  content column, the top one arriving over the first 120px of scroll, the bottom one leaving
 *  over the last. `height` is one number in three places (the fade's height, the range it
 *  arrives over, the range it leaves over), so panels.css reads the token in all three rather
 *  than letting them drift. `alpha` multiplies the page-coloured END of the gradient only: it
 *  is a strength dial, never a geometry one, which is why it is a bare multiplier and not a
 *  colour. Strings, like REVEAL: these are CSS values, never arithmetic. */
export const SCRIM = { height: '120px', alpha: '1' } as const

/** The busy body's dim (`.loading-dim.is-loading`). Lives beside REVEAL.floor because the pair
 *  is the point: PLACE (below the fold) must never look like STATE (refetching), so the floor
 *  is always the darker of the two and motion.test.ts pins the gap between them. */
export const BUSY_DIM = '0.7' as const

/** Six groups, 0…5. Past that the cascade reads as lag, not choreography. */
export const STAGGER_CAP = 5

const DURATIONS = Object.keys(MOTION_MS) as (keyof typeof MOTION_MS)[]

/** The `:root` lines index.css must carry, character for character. */
export function cssMotionDeclarations(): string[] {
  return [
    ...DURATIONS.map((k) => `--t-${k}: ${MOTION_MS[k]}ms;`),
    `--ease-out: ${EASE_OUT};`,
    `--reveal-floor: ${REVEAL.floor};`,
    `--reveal-range: ${REVEAL.range};`,
    `--reveal-rise: ${REVEAL.rise};`,
    `--busy-dim: ${BUSY_DIM};`,
    `--scrim-h: ${SCRIM.height};`,
    `--scrim-alpha: ${SCRIM.alpha};`,
  ]
}

/** What `reduce` overrides. --ease-out is untouched: a curve over 0ms is still 0ms, and one
 *  name means no rule needs a reduced-motion twin. */
export function reducedMotionDeclarations(): string[] {
  return [...DURATIONS.map((k) => `--t-${k}: 0ms;`), '--reveal-floor: 1;', '--reveal-rise: 0px;']
}
