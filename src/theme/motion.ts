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

/** Scroll-linked reveal (spec §4). Strings: these are CSS values, never arithmetic. */
export const REVEAL = { floor: '0.62', range: '35%', rise: '4px' } as const

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
  ]
}

/** What `reduce` overrides. --ease-out is untouched: a curve over 0ms is still 0ms, and one
 *  name means no rule needs a reduced-motion twin. */
export function reducedMotionDeclarations(): string[] {
  return [...DURATIONS.map((k) => `--t-${k}: 0ms;`), '--reveal-floor: 1;', '--reveal-rise: 0px;']
}
