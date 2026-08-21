# Info Hints — Design Spec

**Date:** 2026-08-20
**Status:** User-requested: "an information icon hover tooltip next to every graph title
or section/value title that briefly gives information of what the value or chart is
trying to show in context." Design details settled autonomously in-session.
**Feature branch:** `feature/info-hints`

## 1. What ships

A small ⓘ affordance beside every chart title, section title, and KPI/value tile on the
data pages, showing a one-or-two-sentence explanation on hover **and keyboard focus**.
Every string is authored in the plan (finance semantics must be exact — XIRR, component
accounts, the S&P baseline caveat, qualified vs disqualified, average cost).

## 2. The component — `src/components/InfoHint.tsx`

- A bare `<button type="button" className="info-hint">` (natively focusable; no JS
  tooltip machinery) wrapping a lucide `Info` icon (`size={13}`, `aria-hidden`).
- The text rides twice: `aria-label={text}` (what a screen reader gets) and
  `data-tip={text}` (what the CSS bubble renders). Clicking does nothing — hover and
  `:focus-visible` are the affordance; on touch, tapping focuses, which shows the bubble.
- Bubble: pure CSS `::after` reading `content: attr(data-tip)` — `--surface-2`
  background, `--border` border, 8px radius, `max-width: 280px`, `white-space: normal`,
  `text-align: left`, `--text` ink at 0.78rem, positioned above the icon anchored left.
  One `z-index: 2` (the codebase's first, commented: the bubble must float over chart
  canvases; nothing else stacks). No transition (nothing to reduce for reduced-motion).
- Styles live in `panels.css` (the shared vocabulary — the component is used from a
  dozen chunks and panels.css ships with every page chunk that needs it).

## 3. Placement rules

- **Card/section titles:** inside the heading element, after the text —
  `<h2 className="eyebrow">Title <InfoHint text="…" /></h2>` (same for `.panel-title`
  h2s and inner h3 eyebrows). The icon inherits the heading's line; CSS vertically
  centers it.
- **KPI tiles:** `StatTile` gains an optional `hint?: string` prop rendered inside
  `.stat-label` after the label text. Hand-rolled `.stat-tile` blocks (EsppPage modeler,
  MonthlyUpdate review) get the same treatment inline only where listed.
- **Dynamic titles** (e.g. "Holdings — NVDA", "Totals — 2026") keep one static hint —
  the hint describes the section's job, not the current selection.
- NOT hinted: navigation, MonthRibbon/RangeChips controls, the attention strip,
  freshness rows, forms' individual fields (their labels + existing hints carry them),
  LoginPage, error banners.

## 4. Copy

All ~60 strings are authored in the plan's placement table, grouped by file, and are the
binding deliverable — implementers transcribe them verbatim (typo fixes only). Register:
sentence case, one or two short sentences, says what the number/chart IS and any honesty
caveat the page already lives by (baseline not contribution-matched; XIRR needs dates;
preview is client math; nothing stored).

## 5. Testing

- `InfoHint.test.tsx`: renders a button with the aria-label and `data-tip`; icon is
  aria-hidden; type="button".
- `StatTile.test.tsx`: hint renders beside the label when passed, absent otherwise.
- One page-level presence check (ProjectionPage: the FI-target tile and both chart
  titles carry hints) — the rest are transcription, pinned by review not by per-page
  tests (adding ~60 presence asserts across 10 test files is churn without protection).
- Existing tests keep passing: text queries still match headings (the icon adds no text
  node — the label lives in attributes).

## 6. Non-goals

- No rich/HTML tooltip content, no links inside bubbles, no per-user dismissal state.
- No repositioning logic (bubbles anchor above-left; titles sit at card left edges
  app-wide, so right-edge clipping is not a live case — accepted v1).
- No hints on Login or on individual form fields.
