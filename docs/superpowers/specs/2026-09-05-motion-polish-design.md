# Motion & polish batch — design (2026-09-05)

From the 2026-09-05 UI/UX pass: items 1, 2, 3, 4, 5, 8 plus the approved motion system (page
choreography, staggered entrance, scroll-linked reveal, sliding nav indicator). Approved in
conversation 2026-09-05. Read-only audit artefacts: session scratchpad `ux-pass/*`.

## 0. Goals

1. The eye never sees a stop between a click and the data: no blank frame on first visit, one
   continuous choreography from route change → card entrance → skeleton cross-fade → chart draw.
2. Charts actually animate in (they never have), and drill-downs morph instead of blanking.
3. Below-the-fold content rests in a soft shadow that says "more below" and brightens as it scrolls in.
4. Hints are always readable; errors say what failed in the app's own words; layout never jumps
   when data lands.

## 1. Motion tokens (`src/index.css`, mirrored in `src/theme/motion.ts` for JS consumers)

```
--t-fast:   120ms   (unchanged: hovers, toggles)
--t-page:   240ms   (was 180ms: route content enter)
--t-enter:  240ms   (card entrance)
--t-stagger: 40ms   (per-card offset, capped at 6 groups)
--t-xfade:  180ms   (skeleton → content cross-fade)
--t-nav:    200ms   (nav indicator slide)
--ease-out: cubic-bezier(0.2, 0, 0, 1)
--reveal-floor: 0.45    (edge brightness; was 0.62)
--reveal-range: 45%     (of the card's entry over which it reaches 1.0; was 35%)
--reveal-rise: 6px      (position-linked rise over the same range; was 4px)
--busy-dim: 0.7         (.loading-dim.is-loading; was a literal 0.55)
--scrim-h: 120px        (viewport-edge scrims, §4b: the fade's height AND its scroll range)
--scrim-alpha: 1        (multiplies the page-coloured end of the scrim gradient)
```

Revised 2026-09-05 after the first build was seen: at 0.62 the shadow was invisible against
the page's own contrast, and 0.62 vs the busy dim's 0.55 made "below the fold" and "refetching"
the same grey. The floor is now a real step down, the range wide enough that the brightening is
a gradient rather than a flick at the edge, and the busy dim is a token beside it so the
invariant can be pinned: **PLACE is always darker than STATE**, by at least a fifth of the
scale (`motion.test.ts`). `--busy-dim` is deliberately NOT in the reduce block — a status
colour is not motion.

Every duration in the shell, cards, toasts, palette and drawer reads a token; the hard-coded
values found by the audit (toast 160/140, palette 120/140, drawer 160, `.loading-dim` 0.15s,
flash 700ms in CSS and JS) move onto tokens (`--t-fast`/`--t-page`/`--t-flash: 700ms`).
`@media (prefers-reduced-motion: reduce)`: all durations 0ms, `--reveal-floor: 1`,
`--reveal-rise: 0`, chart `animation: false` (already), and no scroll-linked animation at all.
The scrim dials stay out of that block on purpose: reduce switches the scrims off outright
(`display: none`, §4b), which is a stronger statement than flattening a dial they read.

## 2. Route transition (item 2)

`Layout.tsx` keeps ONE `<Suspense>` outside the pathname-keyed `RouteBoundary` (the boundary gets a
`resetKey={pathname}` like `ShellErrorBoundary`), so React Router's transition holds the OLD page
until the new chunk resolves; the fallback is reached only when a chunk truly takes > 300ms.
The new page's content region (`.page-frame-body`, below the title row and scope row, which appear
immediately) enters with opacity 0→1 and translateY 8px→0 over `--t-page` `--ease-out`. Cached
revisits enter the same way (the entrance is the page's, not the data's). Proof in the smoke:
`#main` is never empty on any frame after a nav click; the old page is visible until the new one
paints.

## 3. Card entrance + stagger

Cards that are in the initial viewport (`.card`, `.stat-tile` groups, panels — everything the page
grid renders) run one entrance: `--enter` 0→1 (opacity) and translateY 8px→0 over `--t-enter`,
delayed by `index × --t-stagger` where index is the card's document order among initially-visible
cards, capped at 5 (six groups). Cards below the fold run NO entrance (`--enter: 1`).
Implementation: a `useStagger()` hook on the page grid assigns `--stagger-i` via `data-` attribute
at mount from `getBoundingClientRect().top < innerHeight`; pure CSS animates a registered custom
property `@property --enter { syntax: '<number>'; inherits: false; initial-value: 1 }`.

## 4. Scroll-linked reveal ("soft shadow")

CSS scroll-driven animation, no JS:

```
@property --reveal { syntax: '<number>'; inherits: false; initial-value: 1 }
@supports (animation-timeline: view()) {
  .page-frame-body .card { animation: reveal linear both;
    animation-timeline: view(var(--sticky-inset, 0px) 0px);
    animation-range: entry 0% entry var(--reveal-range), exit calc(100% - var(--reveal-range)) exit 100%; }
}
@keyframes reveal { from { --reveal: var(--reveal-floor); --rise: var(--reveal-rise) } to { --reveal: 1; --rise: 0px } }
.card { opacity: calc(var(--reveal) * var(--enter)); transform: translateY(calc(var(--rise) + var(--enter-y))); }
```

Brightness is the PRODUCT of the entrance dial and the position dial, so the card straddling the
bottom edge at load rises in with the cascade and settles at its position value with no snap.
Exempt (never dimmed): the header, scope row, toasts, palette, drawers, modals, the sticky entry
footer of the wizard. Off in print and under reduced motion. Browsers without `view()` timelines
show full brightness. Two CSS variables tune it; the spec values are the defaults.

**The timelines are inset by the sticky scope row** (added 2026-09-05, same review as the token
revision above). A `view()` timeline measures against the scrollport, but the top 50–70px of
this one is under `.page-frame-scope`: un-inset, a card scrolled back UP finished its exit range
while still hidden behind the row and emerged at full brightness, so the top-edge mirror existed
and was never seen. Both timelines take a block-axis START inset — `view(var(--sticky-inset, 0px)
0px)`, end inset 0 because the bottom of the viewport IS the bottom of the content — and
`PageFrame` writes `--sticky-inset` on `.page-frame-body` from the scope row's `offsetHeight`
under a `ResizeObserver` (density toggle, a row that wraps). The `0px` fallback is the value at
first paint before that effect runs and the permanent value on a page with no scope row; the
effect clears the property on unmount so a stale inset cannot outlive its row. Verified in Edge
152: `var()` parses inside `view()`, computes to `view(57px 0px)` and re-resolves live when the
variable changes, so no static-class fallback is needed.

## 4b. Viewport-edge scrims ("there is more, above and below")

Added 2026-09-05, same pass as the token revision. §4 dims one CARD as it nears an edge; this
says the same thing about the PAGE. Two pseudo-elements on the content region:

```
--scrim-h: 120px      (the fade's height AND the scroll distance it arrives/leaves over)
--scrim-alpha: 1      (multiplies the page-coloured END of the gradient; 0 = no scrim)

@supports (animation-timeline: scroll()) {
  .page-frame-body:not(:has(.entry-footer))::before,
  .page-frame-body:not(:has(.entry-footer))::after {
    content: ''; display: block; height: var(--scrim-h);
    pointer-events: none; z-index: 5; opacity: 0; }
  …::before { position: sticky; top: var(--sticky-inset, 0px);
    margin-bottom: calc(-1 * var(--scrim-h));
    background: linear-gradient(to bottom, color-mix(in srgb, var(--bg) calc(var(--scrim-alpha) * 100%), transparent), transparent);
    animation: scrim-in linear both; animation-timeline: scroll(root block);
    animation-range: 0 var(--scrim-h); }
  …::after  { position: sticky; bottom: 0; margin-top: calc(-1 * var(--scrim-h));
    background: linear-gradient(to top, …); animation: scrim-out linear both;
    animation-timeline: scroll(root block);
    animation-range: calc(100% - var(--scrim-h)) 100%; }
}
@keyframes scrim-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes scrim-out { from { opacity: 1 } to { opacity: 0 } }
```

Six decisions worth the words:

**Sticky, not fixed.** A fixed box is laid out against its nearest transformed ancestor, and
`.page-frame-body` is transformed for the length of its own entrance (§2) — a fixed scrim would
re-anchor mid-slide and travel with the page. Sticky also keeps the scrim inside the content
column, so it spans exactly the width the cards do (no gutter, no sidebar) with no measurement.

**The top scrim starts at the scope row's underside**, `top: var(--sticky-inset, 0px)` — the same
inset §4's `view()` timelines take, written by `PageFrame` under a `ResizeObserver`. At `top: 0`
the fade would lie over the row and dissolve the month and owner chips the reader steers with.
The bottom scrim needs no inset: the viewport's bottom edge IS the bottom of the content.

**Zero net height in flow.** Each scrim gives back its own height as a negative margin
(`margin-bottom` on the top one, `margin-top` on the bottom), so the first card does not start
120px lower and the document does not grow by 240px. Proved as an A/B in the smoke, not asserted.

**`opacity: 0` is the base state, and it is load-bearing.** A `scroll()` timeline on a page too
short to scroll has no range, is *inactive*, and its animation does not apply at all — the base
style is what paints. Nothing is hidden above or below a page that already fits, so 0 is the only
right answer there.

**z-index 5**: above the cards (which declare none), below the sticky scope row (8), the drawer
(15), the palette (20) and toasts (30). `pointer-events: none`, so every click still lands on the
card underneath.

**Off** in print, under `prefers-reduced-motion: reduce` (both `display: none`, with the full
`:not(:has(…))` selector repeated — `:not(:has())` carries the specificity of what it holds, so a
shorter off switch would lose the cascade), in the monthly-update wizard (its sticky
`.entry-footer` already owns the bottom edge in the page's own colour; two stacked read as a
rendering fault), and in any browser with no `scroll()` timelines — the whole block is inside
`@supports`, because two permanent unfading bars would be worse than no hint.

Verified in Edge 152 on `/net-worth` at 1440×900, both themes: `::before`/`::after` computed
opacity reads **0 / 1** at `scrollTop` 0, **1 / 1** mid-page, **1 / 0** at the very bottom;
`elementFromPoint` 8px inside each band returns an element inside a `.card`; first-card top and
document `scrollHeight` are byte-identical with the pseudo-elements on and off. Smoke step
`scrims` (`tools/probes/motion-v/smoke.mjs`), screenshots under `motion-smoke/scrims/`.

## 5. Sliding nav indicator

One absolutely positioned `.nav-indicator` (3px accent bar, the height of a link) in the sidebar
nav; on route change it moves to the active link with `transform: translateY()` + `height` over
`--t-nav` `--ease-out`; the active icon tint transitions over `--t-fast`. Measured with refs on
`pathname` change and on resize; no per-link box-shadow any more. Reduced motion: instant.

## 6. Charts (items 1 and 3)

- `EChart.tsx`: the ResizeObserver callback calls `chart.resize()` ONLY when
  `el.clientWidth !== chart.getWidth() || el.clientHeight !== chart.getHeight()`; the initial no-op
  resize no longer kills the entrance. Entrances follow the house `MOTION` (theme.ts) — per-series
  overrides for sankey/pie/treemap/line so ECharts' type defaults (1000ms linear, 900ms quintic)
  stop winning.
- First paint waits for visibility: an IntersectionObserver (one-shot) delays the first
  `setOption` with animation until the card is ≥ 20% visible; a chart mounted below the fold draws
  itself as its card brightens. Subsequent `setOption`s (revalidation, scope change) keep today's
  cached-paint rule (`animationDuration: 0`). Theme swap re-init keeps the cached-paint rule too:
  no entrance replay.
- `group` (connect group) leaves the init-effect dependencies: it is applied in its own effect
  (`chart.group = …; connect`), so toggling the group on drill never disposes the instance and the
  bar → pie `universalTransition` morph plays (Spending, Taxes).
- Tooltip `transitionDuration` 0.12 (0 under reduce).

## 7. Skeleton parity + cross-fade (item 8)

- `ChartCard` skeleton reserves the FULL card: header row, controls row (when `actions`/legend are
  declared), canvas height, caption/footer line — so the card does not grow when data lands.
- `Feed` skeletons take a `height` measured from the loaded block's known layout (per call site),
  starting with Paycheck breakdown (320 → loaded height), Comp vesting, ESPP; `PageSkeleton`'s
  Net-worth ghost tiles/cards match the real 115px tiles and 491px chart card and ghost the owner line.
- Skeleton → content is a cross-fade: content mounts in place under the skeleton overlay; the
  skeleton fades out and the content fades in over `--t-xfade` (a `.xfade` wrapper in `Feed`),
  no height change. `.loading-dim` uses `--t-fast` and is gated by reduced motion; its busy
  opacity is `--busy-dim` (0.7, was a literal 0.55) — a token so §1's invariant holds, since the
  scroll shadow's floor must always be the darker of the two.
- Budget: layout shift ≤ 0.05 on every page in the smoke (paycheck, ESPP, comp, net worth are the
  known offenders at 0.15–0.22).

## 8. InfoHint placement (item 4)

The bubble opens ABOVE by default; when `rect.top < bubbleHeight + stuckRowHeight + 8` it opens
below (`.infohint-bubble.is-below`); horizontal flip unchanged. Bubble `z-index: 9` (above the
scope row's 8, below drawer 15 / palette 20 / toasts 30). Hit area padded to 24×24 without
changing the 13px glyph; `aria-label` becomes "About {first four words}…" with the full sentence in
`aria-describedby` (no double read).

## 9. Error feedback (item 5)

- One grammar: `Couldn't load {noun} — {detail}`; for 5xx the detail becomes
  "the server had a problem (HTTP {status})" instead of the raw body; network errors "you're offline
  or the server is unreachable". Implemented once in `src/api/client.ts` (`describeError(err, noun)`)
  and used by every page's load `catch`.
- One load banner per page: ESPP (three), Paycheck and Comp (two) collapse their parallel-load
  failures into a single banner listing the parts that failed, with one Retry that retries them all.
- Settings cards split `loadError` (banner WITH Retry) from `formError` (inline, NO Retry, the
  `SettingsPage` idiom at :449): Accounts, Categories, Household, Limits, Assistant.
- The wizard's load failure goes through `PageFrame`'s resource (`status: 'error'`, `retry` bumps
  a load nonce) — no more dead form; its action failures keep using toasts/banners.
- `FeedBanner` gets `retry?: () => void` as the ONLY way to show Retry (no default).

## 10. Testing and verification

Unit: `useStagger` indices; `@property`/keyframe presence pinned by CSS tests (`src/index.css` parsed);
`EChart` resize guard (mock `getWidth`), first-visible deferral (mock IO), stable `group` effect
(no dispose on group change); `ChartCard` skeleton height parity (render skeleton vs loaded, same
`offsetHeight` in jsdom with fixed heights); InfoHint flip branch; `describeError` table; every card's
`formError` vs `loadError` rendering; wizard error resource + Retry; nav indicator position after
route change (fake `getBoundingClientRect`). Smoke (`tools/probes/motion-v/`): per-frame paint
deltas prove ≥ 300ms of chart entrance on Net worth/Taxes/Portfolio; `#main` non-empty on every frame
after each nav click; CLS ≤ 0.05 per page; indicator transform changes over ~200ms; InfoHint under a
stuck row fully inside the viewport; `--reveal` ≈ 0.45 on the card at the bottom edge and 1 mid-page,
and — the inset's own proof — a scroll back UP that reads ≈ 0.45 on the card whose bottom edge has
just cleared the STUCK scope row, rising to 1 once ~45% of it is visible BELOW the row (the top edge
of the viewport is the wrong ruler now; the row's underside is the right one);
reduced-motion emulation: no animations, floor 1; error banner copy on a stubbed 500. The
`scrims` step (§4b) reads the two pseudo-elements' computed opacity at three scroll positions
(0/1, 1/1, 1/0), hit-tests 8px inside each band, and A/Bs the page height with them and without.

## 11. Lanes

| Lane | Scope | Owns |
|---|---|---|
| M2 shell motion | §1 tokens + `motion.ts`, §2 route transition, §3 stagger, §4 reveal, §4b scrims, §5 nav indicator | `index.css`, `Layout.tsx/.css`, `RouteBoundary`, `panels.css` (reveal/stagger block), `shell/PageFrame.tsx` body wrapper, toast/palette/drawer duration tokens |
| M1 charts | §6 | `src/charts/EChart.tsx`, `theme.ts`, `sankey.ts`, `SpendingPage.tsx:497`, `TaxesPage` group |
| M3 skeletons | §7 | `ChartCard.tsx`, `shell/Feed.tsx` (body/skeleton/xfade), `PageSkeleton.tsx`, per-page skeleton heights |
| M4 hints + errors | §8, §9 | `InfoHint.tsx`, `panels.css` (infohint block), `api/client.ts`, settings cards, ESPP/Paycheck/Comp/wizard load catches, `FeedBanner` retry prop |
| V | §10 | verify on main after merges |

Merge order M2 → M1 → M3 → M4 → V (tokens land first; M3/M4 use `var(--t-xfade, 180ms)`-style
fallbacks so they build standalone). `panels.css` is touched by M2 (new reveal block at the end) and
M4 (infohint block) — disjoint regions. `Feed.tsx` is touched by M3 (body) and M4 (banner) — disjoint.
Opus implementers, one combined review per lane, fixes re-verified only for Important+, local
merges only, no push, no deletions.

## 12. Not in scope

Mobile layout, table scroll wrappers, ribbon overflow, keyboard roving in the scope row, toast
keyboard reach, palette default highlight, copy fixes, print stylesheet (all remain on the audit list).
