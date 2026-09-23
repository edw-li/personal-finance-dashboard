// Entity → colour (chart spec §12; 2026-09-23 spec §C2): PALETTE slots are assigned by WHO or
// WHAT a series is, never by its rank in a response, and never past eight — the tail folds into
// the Other gray. Account groups have fixed slots (GROUP_COLORS, re-exported); people take the
// household order (primary first, then by id, Joint last — lifted from NetWorthPage so the
// stack, the money-flow salary tints and any future per-person chart agree).
//
// THE MONEY-ENTITY TABLE — the one registry every chart below reads (spec §C2). Hexes are the
// DARK tokens; EChart recolors them under light (charts/recolor.ts), DOM swatches use the CSS
// variable entityCssVar() returns.
//
//   entity                                    colour               read by
//   ─────────────────────────────────────────────────────────────────────────────────────────
//   salary · paydays · base pay               PALETTE[0] (+ the    money flow, calendar,
//                                             per-earner tints)    comp
//   RSU vests · equity                        PALETTE[1]           money flow, calendar, comp
//   ESPP                                      PALETTE[2]           money flow, calendar,
//                                                                  paycheck sankey
//   investment / dividend income              PALETTE[3]           money flow, calendar,
//                                                                  dividends chart
//   other income (the balancing remainder)    OTHER gray           money flow
//   tax — liability, withholding, tax-kind    PALETTE[7]           money flow, paycheck
//   category, tax deadlines                                        sankey, spending, calendar
//   saved (cash kept)                         POSITIVE             money flow, spending sankey
//   pre-tax savings                           PALETTE[5]           money flow, paycheck sankey
//   deficit (drawdown)                        NEGATIVE             money flow, spending sankey
//   structural pass-through — gross, take-    MUTED                money flow, paycheck and
//   home, retained equity, estimates, refunds                      spending sankeys
//   Other (a fold)                            OTHER gray           every stack and sankey
//   cards · monthly update (calendar only)    PALETTE[4] · [6]     calendar
//   spending categories                       the fold below       every spending chart, the
//                                                                  money flow, trends
//
// RESERVATIONS (§C2.3), measured with the dataviz validator (OKLab ΔE×100): PALETTE[2] sits
// 4.2 (light) / 8.9 (dark) from POSITIVE and PALETTE[5] 3.7 (light) from it — both are the
// "kept" green family, so no spending category ever wears them; PALETTE[7] sits 2.5 (light)
// from NEGATIVE and is the ONE tax hue.
//
// THE CATEGORY FOLD (§C2.1): the Spending page's all-time ranking decides it once, for every
// chart and every year. The first tax-kind category takes the tax hue and goes FIRST in fold
// order (the stack's bottom segment); the others take CATEGORY_HUES in rank order —
// [P0, P1, P6, P4, P3], the only five-hue order over the non-green, non-tax slots whose every
// neighbouring pair clears the gates in both themes while the biggest category keeps slot 0
// (normal/CVD, dark · light): tax P7–P0 29/19 · 30/23, P0–P1 32/27 · 33/28, P1–P6 27/26 ·
// 29/27, P6–P4 20/16 · 21/17, P4–P3 19/13 · 17/10, and P3–Other 20/17 · 17/16. So the fold
// holds at most six categories; the rest are Other.
//
// ONE KNOWN REPEAT: inside the Overview money flow the income column and the spending column
// share hues (salary/biggest category P0, RSU/second P1, investment/fifth P3). Keeping both
// identities needs 11+ distinct hues and the validated palette has eight, two of them
// reserved. The two columns are never adjacent and never linked, and every node is labelled;
// within each column, and between every linked pair of columns, no two entities share a hue.
// Depends on: charts/theme.ts.
import type { SpendingMatrix } from '../types/api'
import {
  GROUP_COLORS,
  MUTED,
  NEGATIVE,
  OTHER_SERIES_COLOR,
  PALETTE,
  POSITIVE,
  SEQUENTIAL_BLUE,
} from './theme'

export { GROUP_COLORS }

/** The money entities' fixed colours (the table above). */
export const ENTITY = {
  salary: PALETTE[0],
  rsu: PALETTE[1],
  espp: PALETTE[2],
  investmentIncome: PALETTE[3],
  otherIncome: OTHER_SERIES_COLOR,
  tax: PALETTE[7],
  preTaxSavings: PALETTE[5],
  saved: POSITIVE,
  deficit: NEGATIVE,
  structural: MUTED,
  other: OTHER_SERIES_COLOR,
  card: PALETTE[4],
  ritual: PALETTE[6],
} as const

/** The salary hue FAMILY, per earner in split order. Slot 0 is the salary hue itself; the rest
 *  are lightness steps of the theme's own validated ramp (SEQUENTIAL_BLUE, whose index 6 IS
 *  PALETTE[0]). #86b6ef measures L* 72.7 against PALETTE[0]'s 55.9: dE 28.5 normal, 25.1
 *  protanope, 28.9 deuteranope, 15.1 tritanope, at 8.25:1 on the #171a21 surface. A fourth
 *  earner repeats the last tint and the LABELS carry the distinction. */
export const SALARY_TINTS = [PALETTE[0], SEQUENTIAL_BLUE[9], SEQUENTIAL_BLUE[3]] as const

/** The spending categories' hues, in fold order after the tax hue (the chain above). */
export const CATEGORY_HUES = [PALETTE[0], PALETTE[1], PALETTE[6], PALETTE[4], PALETTE[3]] as const

/** Primary first, then everyone else by id — the server's own owner_series order. */
export function orderedPeople<P extends { id: number; is_primary: boolean }>(people: readonly P[]): P[] {
  return [...people].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id)
}

/** A person's palette slot; `null` (Joint) sits after every person; an unknown id takes the
 *  primary's slot rather than -1 (the page's own `Math.max(findIndex, 0)`). */
export function personSlot(
  people: readonly { id: number; is_primary: boolean }[],
  personId: number | null,
): number {
  const ordered = orderedPeople(people)
  if (personId === null) return ordered.length
  return Math.max(ordered.findIndex((p) => p.id === personId), 0)
}

/** The colour for a slot: the eight validated hues, then the fold gray — never a wrap. */
export function slotColor(slot: number): string {
  return slot < PALETTE.length ? PALETTE[slot] : OTHER_SERIES_COLOR
}

export interface RankedCategory {
  id: number
  kind: string
  /** All-time total in integer cents: exact, so two equal Decimal totals tie exactly. */
  totalCents: number
}

/** The fold: `ids` in fold (stack/legend/node) order, `colors` for exactly those ids. */
export interface CategoryFold {
  ids: number[]
  colors: ReadonlyMap<number, string>
}

export const EMPTY_FOLD: CategoryFold = { ids: [], colors: new Map() }

const toCents = (value: string | null | undefined) =>
  value === null || value === undefined ? 0 : Math.round(Number(value) * 100)

/** The Spending page's all-time ranking: biggest total first; ties keep the server's series
 *  order (sort_order, id) — Array.prototype.sort is stable. */
export function rankCategories(matrix: Pick<SpendingMatrix, 'categories' | 'series'>): RankedCategory[] {
  const kindOf = new Map(matrix.categories.map((c) => [c.id, c.kind as string]))
  return matrix.series
    .map((s) => ({
      id: s.category_id,
      kind: kindOf.get(s.category_id) ?? 'living',
      totalCents: s.values.reduce((acc, v) => acc + toCents(v), 0),
    }))
    .sort((a, b) => b.totalCents - a.totalCents)
}

/** Hues for a ranked list (see THE CATEGORY FOLD above). Dormant and net-refund categories have
 *  nothing to stack and take no hue; the walk stops at the first category that cannot get one,
 *  so the fold is always a prefix of the ranking (plus the tax category it passed). */
export function foldCategories(ranked: readonly RankedCategory[]): CategoryFold {
  const colors = new Map<number, string>()
  const ids: number[] = []
  let taxId: number | null = null
  let next = 0
  for (const entry of ranked) {
    if (entry.totalCents <= 0) continue
    if (entry.kind === 'tax' && taxId === null) {
      taxId = entry.id
      colors.set(entry.id, ENTITY.tax)
      continue
    }
    if (next >= CATEGORY_HUES.length) break
    colors.set(entry.id, CATEGORY_HUES[next])
    next += 1
    ids.push(entry.id)
  }
  return { ids: taxId === null ? ids : [taxId, ...ids], colors }
}

/** The fold a spending matrix implies — the ONE function every spending chart and the Overview
 *  money flow read (spec §C2.1). */
export function categoryFold(matrix: Pick<SpendingMatrix, 'categories' | 'series'>): CategoryFold {
  return foldCategories(rankCategories(matrix))
}

/** A category's colour: its fold hue, or the Other gray outside the fold. */
export function foldColor(fold: CategoryFold, id: number): string {
  return fold.colors.get(id) ?? ENTITY.other
}

/** Spending › Trends, where a reader picks categories explicitly: a folded pick wears its fold
 *  colour; the first pick outside the fold wears the Other gray; any further outsider borrows
 *  the first CATEGORY_HUE no pick in THIS chart wears. Outside the fold there is no app-wide
 *  identity to keep, and two picks must never share a line colour (spec §C2.2). */
export function pickColors(picks: readonly number[], fold: CategoryFold): Map<number, string> {
  const out = new Map<number, string>()
  const used = new Set<string>()
  for (const id of picks) {
    const color = fold.colors.get(id)
    if (color === undefined) continue
    out.set(id, color)
    used.add(color)
  }
  let grayTaken = false
  for (const id of picks) {
    if (out.has(id)) continue
    if (!grayTaken) {
      out.set(id, ENTITY.other)
      grayTaken = true
      continue
    }
    const spare = CATEGORY_HUES.find((hue) => !used.has(hue)) ?? ENTITY.other
    out.set(id, spare)
    used.add(spare)
  }
  return out
}

// Token hex → the CSS custom property that follows the theme (index.css declares them). The
// sequential ramp has none, so its steps stay hexes — the cost tooltip.ts's swatches document.
const CSS_VARS: ReadonlyMap<string, string> = new Map<string, string>([
  ...PALETTE.map((hex, i) => [hex.toLowerCase(), `var(--chart-${i + 1})`] as [string, string]),
  [OTHER_SERIES_COLOR.toLowerCase(), 'var(--other-series)'],
  [MUTED.toLowerCase(), 'var(--muted)'],
  [POSITIVE.toLowerCase(), 'var(--positive)'],
  [NEGATIVE.toLowerCase(), 'var(--negative)'],
])

/** A registry colour for a DOM swatch or border: the theme-following variable when one exists. */
export function entityCssVar(hex: string): string {
  return CSS_VARS.get(hex.toLowerCase()) ?? hex
}
