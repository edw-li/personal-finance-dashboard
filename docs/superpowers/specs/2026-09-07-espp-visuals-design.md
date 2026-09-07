# ESPP page visuals — design (2026-09-07)

The `/espp` page tracks a real position — six lots, two offerings and a chained $25k modeler in
prod — entirely in three wide tables, one 14 px gauge and a single tile that sits alone in its
row. This design adds the visual layer the 2026-09-07 conversation approved: a five-tile position
strip, two chart cards side by side under it, and a two-bar limit meter that replaces the gauge.
Nothing about the lot math, the offerings resolution or the modeler chain changes; every drawn
figure is the server's.

**Touches:** `EsppPage.tsx` + `EsppPage.css`, a new `src/components/espp/` folder (two builders, a
meter, fixtures), `api/espp.py` + `schemas/espp.py` + `services/espp_calc.py` (additive wire
fields), `services/price_service.py` (backfill floor), `types/api.ts`, `skeletonMetrics.ts`.
**Builds on:** the chart grammar (`2026-09-03-chart-grammar-design.md`: `ChartCard`, `grammar.ts`,
`tooltip.ts`, `reference.ts`, `legend.ts`, the palette law) and the shell grammar (`Segmented`,
`PageFrame`). Neither is redesigned.
**Amends:** the master spec's `/espp` row (§6) gains the visuals; `2026-08-23-espp-offerings-
refactor-design.md` §9's "this feature has no charts" no longer holds.

## 0. Decisions (user Q&A, 2026-09-07)

| Question | Decision |
|---|---|
| Which visuals, out of the five brainstormed? | Three plus tiles: the lot anatomy chart, the employer price history with purchases, and the $25k chain meter. Deferred: the sell-now-vs-after-qualifying split (its content is better as lots-table columns later), the plan timeline, the contribution-percent sweep. |
| One view of the lot chart, or two? | Two, as a chart-local toggle: **Dollars** (default) and **Per share**. The user asked for the per-share view "in addition to the dollar view" and floated a toggle; a two-way `Segmented` on the card is the decision. The earlier `$ · %` normalization idea is dropped — per share is the comparable view. |
| Whitespace | The lone `$25k limit used` tile row becomes a five-tile strip. The two chart cards share one `card-grid` row at `span-6` each (stacking to full width under 1000 px, the grid's existing rule). Inside the modeler card the meter and its tiles span the card; the 720 px `max-width` on the gauge goes. |
| Colors for the three lot components | Slots 2, 3, 1 of the fixed palette — orange for Paid, green for Bargain element, blue for Appreciation. Validated with the dataviz palette script in both themes (§8.2); violet and pink alternatives failed the adjacency floors. |
| Where the new figures come from | The server. Per-lot components, position totals, running average paid and modeler totals are added to the existing payloads; the page composes and never re-derives (chart grammar §7, global rule 9). |
| Dashed, hatched, status colors | Unchanged meanings: dashed = reference or event; hatching stays the vesting chart's "priced at today's quote"; POSITIVE/NEGATIVE appear only as the price chart's above/below wash and the anatomy chart's loss overlay, both polarity. |
| Sold lots | Drawn **hollow** — outlined in their own component colors over the card surface, dots hollow too — on both anatomy views and on the price chart's purchase markers. The user asked for sold lots to look different (2026-09-07 review); hollow is the one free channel, since hatch and fade mean "estimate" on Comp and gray means the folded tail. The `Sold` cap label and axis suffix stay as the text backup. |
| Meter scale | Both rows of the $25k chain meter on one shared dollar scale — confirmed by the user at review. |

Standing decisions this design respects: the modeler's period contributions stay hand-entered
(2026-08-23 §1); knobs stay blank-means-server-default (§6.2); the app ships no IRS values; one
axis per chart; bars ≤ 24 px with the surface border; color follows the entity; every mount
through `ChartCard` with a required `ariaLabel`, a CSV twin and a fixture.

## 1. Context

### 1.1 The page today

`PageFrame` → one banner → a lone tile (`kpi-row kpi-row-lone`, the modeler's `$25k limit used —
{year}`) → Lots card (quote line, hint, 9-field form, 13-column table) → Subscription offerings
card (form, table, "use close" chip) → Purchase modeler card (year chips, three knobs, provenance
line, warnings, the gauge, two hand-rolled tiles, a 14-column editable table). No `ChartCard`
anywhere; the page does not import the chart chunk. Three independent feeds with sequence guards
(`lots`, `offerings`, `modeler`), a fourth best-effort fetch of 3650 days of employer closes for
the offerings chip (`bars`).

### 1.2 What is already on the wire

- **Per lot** (`LotOut`): `purchase_date`, `qualifying_date`, `shares`, `subscription_price`,
  `purchase_fmv`, `purchase_price`, `sold_date`, `sold_price`, and the computed `cost_basis`,
  `market_value`, `gain_amount`, `gain_pct`, `qualified`, `days_until_qualified`, `is_sold`.
  The envelope carries `espp_ticker`, `current_price`, `quoted_at`.
- **Per modeler period**: `contribution`, `available`, `purchase_price`, `shares`,
  `max_shares_25k`, `over_limit`, `cost`, `refund`, `carry_forward_out`, `unused_25k`,
  `value_25k`, `subscription_price`, `offering_start`; totals `total_25k_value`,
  `out_of_pocket_cost`, `fmv_of_shares`, `remaining_25k`.
- **Offerings**: `offering_start`, `subscription_price`, ascending.
- **Price history**: `GET /prices/history/{ticker}?days=` daily closes, oldest first; the page
  already requests 3650 days. The employer deep backfill (`backfill_employer_history`) is keyed
  to the earliest RSU vest only; prod's NVDA history starts around 2024-09-04, after the first
  two lots.

### 1.3 The real shape (dev copy of the spreadsheet import; prod has two more lots and two offerings)

| Lot | Shares | Subscription | FMV at purchase | Paid | Cost | Value at $230.36 |
|---|---|---|---|---|---|---|
| Feb 29, 2024 | 260 | 48.509 | 79.112 | 41.23265 | $10,720.49 | $59,893.60 |
| Aug 30, 2024 | 255 | 48.509 | 119.370 | 41.23265 | $10,514.33 | $58,741.80 |
| Feb 28, 2025 | 274 | 48.509 | 124.800 | 41.23265 | $11,297.75 | $63,118.64 |
| Aug 29, 2025 | 241 | 48.509 | 174.180 | 41.23265 | $9,937.07 | $55,516.76 |

Position: 1,030 shares · cost $42,469.64 · value $237,270.80 · gain $194,801.16 (+458.7 %). Of
the $84,711.41 bargain element at purchase, $7,494.64 was the 15 % discount and $77,216.77 the
lookback — ten to one, and nothing on the page says so. Both 2024 and 2025 bought exactly 515
shares, which is ⌊25,000 / 48.509⌋: the cap binds every year. Under the Sep 2025 offering the cap
is 146 shares and roughly $21.2k of contributions. These are the facts the three visuals are
built to show.

## 2. Page layout

Order, top to bottom, inside the frame:

1. **The banner** — unchanged (`describeLoadFailures` over the three feeds, one Retry).
2. **Position strip** — one `kpi-row` of five `StatTile`s (§4). Replaces the lone tile and its
   `kpi-row-lone` modifier on this page. Its skeleton is `SkeletonTileRow tiles={5}` while
   neither feed has answered; once one has, the strip renders with ghost tiles in the other
   feed's slots (`PageSkeleton`'s `GhostTile`, exported for this — it is module-private today),
   so the row's box is reserved from first paint
   (motion spec §6 skeleton parity; `cls/espp` was 0.06 of the page's 0.10 before the box was
   reserved).
3. **Two chart cards in a `card-grid`** — `Lot anatomy` (§5) at `span-6` and
   `{ticker} vs your purchases` (§6) at `span-6`, both `height={300}`. Under 1000 px the grid's
   existing rule stacks them full width. Each card reserves its own skeleton while its option is
   null and its feed is busy (`ChartCard`'s null+busy state).
4. **Lots card** — unchanged form and columns, plus a `<tfoot>` totals row (§4.3).
5. **Subscription offerings card** — unchanged.
6. **Purchase modeler card** — the gauge is replaced by the chain meter (§7), the two hand-rolled
   tiles become four `StatTile`s, both spanning the card.

The chart cards sit above the tables because they are the computed half of the page and the
tables are entry; the 2026-08-31 reorders put headline strips first on Comp and ESPP for the same
reason. The `.espp-page .card { margin-bottom: 1rem }` rule stays; the `card-grid` supplies its
own gap.

## 3. Backend additions (additive, no migration)

All four changes are read-side and additive; a stale tab that cached the old envelope keeps
working, and a new tab against an old backend renders the strip's lot tiles as ghosts until a
fresh payload lands (the fields are optional in `types/api.ts`).

### 3.1 `LotOut` — the components (in `espp_calc.lot_metrics`, pure)

| Field | Definition | Null when |
|---|---|---|
| `fmv_value` | `half_up2(shares × purchase_fmv)` — the lot's value at purchase | never |
| `bargain_element` | `fmv_value − cost_basis` (signed) | never |
| `lookback_component` | `half_up2(shares × max(purchase_fmv − subscription_price, 0))` | never |
| `discount_component` | `bargain_element − lookback_component` (signed; negative only when a hand-typed `purchase_price` exceeds the lower of subscription and FMV) | never |
| `appreciation` | `market_value − fmv_value` (signed; realized for a sold lot, since `market_value` is at the sale price) | `market_value` is null |
| `avg_paid_to_date` | cumulative `cost_basis` ÷ cumulative `shares` over every lot with `(purchase_date, id)` ≤ this one, quantized to `0.00001` (the lot price family) | never |

`avg_paid_to_date` needs the ordered list, so it is a new pure helper
`running_avg_paid(lots) -> list[Decimal]` called by the router's `list_lots`; `lot_metrics` stays
per-row. Plain `quantize` throughout, `+ ZERO` on every output (the module's signed-zero rule). It
counts every lot ever bought, sold or not — it is "average paid to date", the price chart's step,
not a tax basis; the name and the hint say so.

### 3.2 `LotsOut.totals` (new block)

```
totals: {
  held: { lots, shares, cost_basis, fmv_value, market_value, gain_amount, gain_pct,
          bargain_element, lookback_component, discount_component, appreciation, avg_paid },
  sold: { lots, shares, cost_basis, proceeds, gain_amount }
}
```

`held` sums the unsold lots; its quote-dependent fields (`market_value`, `gain_amount`,
`gain_pct`, `appreciation`) are null when the quote is missing, while `cost_basis`, `fmv_value`
and the bargain fields always sum. `gain_pct` is `gain_amount / cost_basis` at 6 dp — a money ratio, unlike the per-lot
`gain_pct`, which is the sheet's price ratio; the schema docstring records the difference.
`avg_paid` is held cost ÷ held shares at 5 dp, null with no held lots. `sold` sums the lots that
carry a `sold_date` and a `sold_price`; a half-filled sold row (date without price) counts in
`lots` and `shares` and contributes nothing to the money fields. Both blocks are all zeros at column scale, not absent, when empty — except the two ratios,
`gain_pct` and `avg_paid`, which are null there: a division by nothing has no honest figure.

### 3.3 `ModelerTotalsOut` — three more totals

`total_shares` (the chain's share count, serialized like the period counts), `total_contribution`
(sum of `contribution`), `total_refund` (sum of `refund`). The chain already computes all three;
they are exposed so the meter's labels and tiles never sum on the client.

### 3.4 Employer backfill floor

`backfill_employer_history` sets `needed = min(earliest RSU first vest, earliest lot
purchase_date, earliest offering_start) − 14 days`, skipping whichever sources are absent, and
returns 0 only when all three are. The watermark logic is untouched: a floor that moves earlier
re-arms the deep fetch, exactly as an older grant does today. Effect in prod: the next price
refresh reaches back to Aug 2023 (Sep 2023 offering minus the buffer), and the Feb/Aug 2024 lots
land on the price chart's line. The dev box cannot run this (the provider is blocked there); the
chart's footer states how many lots predate the stored history until it does (§6.4).

## 4. Position strip and lots totals

### 4.1 The five tiles

| Tile | Value | Delta | Tone | Feed |
|---|---|---|---|---|
| Market value | `totals.held.market_value` | — | neutral | lots |
| Cost basis | `totals.held.cost_basis` | — | neutral | lots |
| Unrealized gain | `totals.held.gain_amount` | `formatPct(gain_pct)`, signed | positive / negative by sign, neutral at zero | lots |
| Shares held | `formatShares(totals.held.shares)` | `{lots} lots` | neutral | lots |
| $25k limit used — {year} | unchanged | unchanged (`{remaining} left`) | neutral | modeler |

Hints: Market value — "Your unsold lots at the current quote." Cost basis — "What those lots cost
you, after the plan discount." Unrealized gain — "Market value less cost basis; the percentage is
against cost. Realized gains from sold lots are in the lots table's totals row." Shares held —
"Unsold ESPP shares across every lot." The fifth tile keeps its hint and its dirty note.

With no ticker or no quote, the first and third tiles render `—` with the existing quote-line
sentence as their delta ("no live quote"), never a zero. The tiles do not count up: neither the Comp strip nor the existing `$25k` tile does, and the
strip matches them (an earlier draft cited a count-up gating that does not exist).

### 4.2 Why five, always

`kpi-row` is `auto-fit minmax(220px, 1fr)`: five tiles fill a 1,400 px content column in one row;
a conditional sixth would wrap alone and recreate the whitespace this design removes. Realized
gain therefore lives in the lots table's totals row, not a tile.

### 4.3 Lots table totals row

A `<tfoot>` with one row for held lots (Shares, Cost basis, Market value, Gain, Gain %, the
`Disposition` cell reading `{n} held`) and, only when `totals.sold.lots > 0`, a second row for
sold lots (Shares, Cost basis, Market value = proceeds, Gain, the cell reading `{n} sold`). Every
figure is `totals.*`; the skeleton height `FEED_SKELETON.esppLots` grows by one `TABLE_ROW`.

## 5. Chart A — Lot anatomy

### 5.1 The card

```
<ChartCard
  title="Lot anatomy"
  hint="Each purchase split three ways: what you paid, the bargain element at purchase (the plan
        discount, plus the lookback when the price had risen above the subscription price), and
        the market's move since. Unsold lots at the current quote; sold lots at their sale price."
  ariaLabel="Stacked bar chart of each ESPP lot's value split into amount paid, bargain element
             at purchase and appreciation since, with a per-share view"
  option={…} empty="No lots yet — add your first purchase in the Lots card below."
  exportName="espp-lot-anatomy" csv={lotAnatomyCsv} height={300} span={6}
  controls={<Segmented variant="toggle" size="sm" ariaLabel="Lot chart view"
             options={[{value:'dollars',label:'Dollars'},{value:'per-share',label:'Per share'}]} …/>}
  footer={quote line · lookback sentence}
/>
```

The footer's two sentences: the quote line the Lots card already prints (`NVDA · $230.36 · as of
Sep 4, 2026`), and, when `totals.held.bargain_element` is positive, "Of the {bargain} bargain
element across your held lots, {discount} was the plan discount and {lookback} the lookback." —
the ten-to-one fact, from `totals`, never summed here. When `totals.sold.lots > 0` the quote line
gains a third clause, `Hollow = sold` — the vesting footer's `Hatched = at today's quote` idiom.

### 5.2 Shared shape

- One category per lot, ordered by `(purchase_date, id)` — the feed's order. Label `Feb 2024`
  (month and year of purchase); if two lots share a month, both use the full `formatDate`.
  `monthAxis(labels, { gap: true })`; ≤ 12 categories set `interval: 0` by the grammar.
- Series ids are stable across the two views (`paid`, `bargain`, `appreciation`, `loss`), so the
  toggle re-runs `setOption` as an update on the house 300 ms clock, not an entrance.
- Tooltip: `axisTooltip({ unit: 'money', pointer: 'shadow', groups, totalLabel, references,
  footer })` — groups sorted valueDesc, then the total, then reference rows, then the lot's
  lines through the `footer(dataIndex, params)` hook (escaped lines under everything, keyed by
  the hovered column): `260 sh · paid $41.23 · FMV $79.11 · subscription $48.51`, `bargain:
  $7,494.64 discount + $77,216.77 lookback` (from the lot's own components), and `Sold Mar 12,
  2026 at $x` or `Qualifies in 300 days` from the disposition fields.
- Sold lots are drawn **hollow**: each segment's data item overrides `itemStyle` to a
  `'transparent'` fill (a color the conformance rule admits) with a 1.5 px border in its own
  component color — `PALETTE[1]`, `[2]`, `[0]` — so the column keeps its composition but reads as
  emptied, which is what happened to the shares. The column also carries a `capLabel` reading
  `Sold` and the axis label gains ` (sold)`, so the distinction never rests on the outline alone.
  No fade and no hatch: both already mean "estimate" on the Comp page, and gray is the folded
  tail. With `Appearance › Chart patterns` on, the aria decal paints fills only, so a hollow
  column stays hollow. The probe eyeballs the doubled hairline where two outlined segments meet.
- Legend: `legendFor(count, selected)`, picks mirrored into page state (§9 of the grammar).
- Colors: Paid `PALETTE[1]`, Bargain element `PALETTE[2]`, Appreciation `PALETTE[0]`; loss
  overlay `NEGATIVE`; markers as below. Fixed by component, never by lot — lots pass eight by 2028.

### 5.3 Dollars view (default)

`moneyAxis()` zero-anchored. Stack `lot`, `BAR_MARKS` (its 22 px cap and surface hairline),
`stagger(i)`:

1. **Paid** = `cost_basis`.
2. **Bargain element** = `max(bargain_element, 0)`.
3. **Appreciation** = `max(market_value − max(fmv_value, cost_basis), 0)` — measured from the
   higher of the FMV value and the cost, so the column top equals the value even when an
   over-typed purchase price makes the bargain element negative (that segment then draws zero
   and the tooltip carries the signed figure).

The column top equals `market_value` whenever appreciation is non-negative. When
`appreciation < 0` (the lot is below its purchase FMV) a second stack `loss` overlays the same
column via `barGap: '-100%'` (both stacks share one `barMaxWidth`): a transparent, silent base of
`market_value`, then **Below purchase FMV** = `fmv_value − market_value` in `NEGATIVE`. The solid
column still stops at `fmv_value`; the
red overlay's lower edge is the market value, and the tooltip's total row says so. Legend lists
`Below purchase FMV` only when at least one lot needs it. A negative `bargain_element` (an
over-typed purchase price) draws a zero-height segment and the tooltip carries the signed figure.
Unpriced lots (no quote, or a sold row missing its price) draw Paid and Bargain only. Tooltip
`totalLabel: 'Value'`; groups are the three component names.

### 5.4 Per share view

The dumbbell form for "before → after per item": every lot on one price axis, its range from the
price paid up to today's quote or its sale price. `moneyAxis()` stays zero-anchored so the
discount reads as a true share of the price. Stack `ladder`, `BAR_MARKS` with `barMaxWidth: 10`
spread after it (a dumbbell's bar is thin; the surface hairline stays):

0. A transparent, silent base = `purchase_price` (excluded from legend and tooltip).
1. **Bargain element** = `max(purchase_fmv − purchase_price, 0)`.
2. **Appreciation** = `max(price − max(purchase_fmv, purchase_price), 0)` where `price` =
   `sold_price` or the quote — from the higher of the FMV and the paid price, as in §5.3.
3. Loss overlay as in §5.3, per share: base = `price`, **Below purchase FMV** = `purchase_fmv −
   price` when negative appreciation.

Two scatter series ride the ends (`symbolSize: 9`, `itemStyle.borderColor: INK`): **Paid**, a
`PALETTE[1]` circle at `purchase_price` — the same name and hue as the Dollars view's base
segment, so the legend entry survives the toggle — and **Price**, a `PALETTE[0]` circle at `price`
(absent for unpriced lots). On a sold lot the range bar and both dots go hollow (§5.2: `SURFACE`
fill on the dots, a 1.5 px border in the dot's own color), and its Price dot sits at the sale price
rather than on the quote line. A third scatter, **Subscription price**, is a `MUTED` diamond with
an `INK` border at `subscription_price` — the annotation-marker grammar, filled, so hollow stays
reserved for sold; where FMV sat above it, the gap between the diamond and the color change is the
lookback, drawn. A `referenceLine('Current quote', …)` runs across
every category at `current_price` — every unsold column's blue dot sits on it, which is the view's
point: the spread is your entry prices, the line is where they all are today.

Tooltip: groups are the two per-share components with `totalLabel: 'Gain per share'`;
`references: ['Paid', 'Price', 'Subscription price', 'Current quote']`; the same annotation lines
as the Dollars view. The `Paid` and `Price` scatters carry their values in the references rows and
are excluded from the group sort. This view's legend carries seven entries, four of them long,
which outrun a half-width card — so it is a `scroll` legend below the grammar's eight-entry
threshold; the Dollars view and the price chart keep plain legends.

### 5.5 CSV twin

One row per lot: Purchased, Status, Shares, Paid / sh, FMV at purchase / sh, Subscription / sh,
Price / sh (quote or sale), Cost, Discount component, Lookback component, Bargain element,
Appreciation, Value — verbatim wire strings.

### 5.6 Chart ↔ table

Hovering a column sets `highlightLotId` in page state; the lots table row wears `is-highlighted`
(the `.is-editing` tint at lower weight). Clicking a column scrolls that row into view
(`scrollIntoView({ block: 'nearest' })`) and holds the highlight 2 s. Should-have, not a gate.

## 6. Chart B — `{ticker} vs your purchases`

### 6.1 The card

Title `NVDA vs your purchases` (the ticker from the lots envelope; `Employer price vs your
purchases` when null). Hint: "Daily closes over the chosen window. Dashed rules: the subscription
price of the offering in force, and your average paid per share to date, which steps up at each
purchase. The wash is green above your average paid and red below. Diamonds are purchases;
triangles are sales." `ariaLabel`: "Line chart of {ticker}'s daily closes against the subscription
price and your average paid per share, with purchase markers." `exportName="espp-price-history"`,
`height={300}`, `span={6}`, `zoomable`, `csv={esppPriceCsv}`. Controls: the Portfolio chips
`1Y · 3Y · All` (`PRICE_SPANS`), **default All** — the ESPP story is years long. The chips slice
the 3650-day series the page already holds; chips whose window predates the first stored bar are
disabled by `reachableSpans` exactly as on the holding drill-in.

Empty sentences: no ticker → "No ESPP ticker configured — set the espp_ticker setting to chart
the price."; ticker but fewer than two bars → "No stored price history for {ticker} yet — run a
price refresh."

### 6.2 Builder `esppPriceOption({ points, offerings, lots, currentPrice, window })`

`grid('endLabel')`, `dateAxis(labels)`, `moneyAxis({ zero: false })` (a price line has no additive
reading — the holding chart's own rule), `timeZoom(dates, 'all')`.

- **Close** — `LINE`, `PALETTE[0]`.
- **Subscription price** — `referenceLine(name, data, { step: 'end' })`: for each bar date the
  covering offering's price (greatest `offering_start ≤ date`), null before the first offering.
  `endLabel` on, reading `Subscription` — the full name outruns the 84 px gutter.
- **Avg paid to date** — the same shape over `avg_paid_to_date`: for each bar date the value of
  the latest lot with `purchase_date ≤ date`, null before the first lot. `endLabel` on, reading
  `Avg paid`. Of the two rules, the one ending higher takes `verticalAlign: 'bottom'` and the
  other `'top'`, so the end labels never collide.
- **Wash** — the holding chart's two transparent-base stacks (`Above avg paid` in `POSITIVE`,
  `Below avg paid` in `NEGATIVE`, 0.12 opacity, out of the legend), against the stepped average
  rather than a constant; nothing drawn before the first purchase.
- **Purchases** — scatter, one point per lot at the last bar on or before `purchase_date`,
  skipped and counted for the footer when the purchase falls before the first stored bar or
  after the last (a later lot drawn at an old close would lie), plotted at that bar's
  close, `PALETTE[1]` diamond, `symbolSize: 10`, `INK` border, `z: 11`; a lot since sold draws
  hollow (`SURFACE` fill, `PALETTE[1]` border) — the page's one meaning for hollow. Annotation
  lines through the tooltip's `annotations` hook: `Feb 29, 2024 · 260 sh · paid $41.23 · FMV
  $79.11`, with ` · sold Mar 12, 2026` appended on a sold lot.
- **Sales** — scatter of sold lots at `sold_date`, the events grammar's sell glyph (a `MUTED`
  triangle rotated 180°), lines `Sold Mar 12, 2026 · 260 sh at $x`.

Tooltip: `axisTooltip({ unit: 'money', references: ['Subscription price', 'Avg paid to date'],
annotationSeries: ['Purchases', 'Sales'], annotations })`.

### 6.3 Which price is which

Chart A prices unsold lots at the lots envelope's `current_price` (the same quote as the table);
chart B's line ends at the last stored bar. The two can differ by a day; each card prints its own
"as of", exactly as Portfolio's holdings table and holding drill-in do today.

### 6.4 Footer

`priceWindowSummary` as on the holding chart — "+41.2 % over this window · history since Aug 11,
2025" when the extent is known — plus, when any lot falls outside the stored bars: "2 lots predate the stored history and 1
postdates it — the next price refresh reaches them." (either half alone when the other count
is zero).

### 6.5 CSV twin

Date, Close, Subscription price, Avg paid to date, Purchase (shares or blank), Sale (shares or
blank) — one row per bar in the window.

## 7. Chart C — the $25k chain meter (modeler card)

A `LimitChainMeter` HTML component in the pace meter's grammar — no canvas; this is a meter, not
a chart — replacing `.gauge`, full card width. Two rows on **one shared dollar scale**, so the
reader sees directly that the limit counts shares at the subscription price while cash buys them
at the discounted price (the two-limit confusion the 2026-09-02 audit flagged). The scale is
`max(25,000, total_contribution + carry_forward)`; the $25k constant remains a denominator for
pixel widths only, every figure is the server's (the gauge's existing rule).

**Row 1 — "Limit used, at the subscription price".** A `surface-2` track spanning $25,000 on the
shared scale — the full row when the scale is $25,000, ending short of the right edge when
contributions push the scale past it, with the hairline tick at the same point. One segment per
period in chain order, width `value_25k / scale`: H1 in `--accent`, H2 in `--accent`
at 0.55 opacity — two steps of one hue for two ordered periods (an ordinal job, not identity) —
with a 2 px surface gap between them. Left label
`{total_25k_value} used`, right label `{remaining_25k} left`, both server figures. When any
period is `over_limit`, an advisory sentence under the row: "Cap reached in {label} — {refund}
refunded." The chain can never exceed the limit by construction (each period's shares are capped
at `max_shares_25k`), so there is no overflow tick.

**Row 2 — "Your contributions".** No track. Segments from the left on the same scale:
`carry_forward` in (`surface-2` with a border, only when non-zero), then per period `cost`
(H1 `--accent`, H2 at 0.55), then `total_refund` in `--other-series`. Label left
`{total_contribution} contributed`, right `{total_refund} refunded · {last carry_forward_out}
carries forward` (each clause only when non-zero).

**Legend row** under both: swatch chips for the H1 label, the H2 label, Refunded, Remaining.
Each row is `role="meter"` with `aria-valuemin/max/now` clamped to the scale and an
`aria-valuetext` in dollars; every figure is also printed as text (never color alone), and the
period labels come from the payload (`row.label`), so a mid-cycle year with two offerings still
reads correctly. The existing dirty note dims the meter with the rest of the card.

**Tiles.** The two hand-rolled `.stat-tile` divs become four `StatTile`s in one `kpi-row`: Out of
pocket (`out_of_pocket_cost`), Shares bought (`total_shares`), FMV of shares (`fmv_of_shares`),
Refunded (`total_refund`, tone neutral). Hints as today's plus "Cash the cap sent back — nothing
carries when a purchase is capped."

## 8. Grammar, color, motion, accessibility

### 8.1 Grammar

Both ECharts builders live in `src/components/espp/esppChartOptions.ts` (pure, no React, the
`Number()`-at-the-boundary rule), each with a fixture in `src/charts/fixtures/`
(`esppLotAnatomyDollars`, `esppLotAnatomyPerShare`, `esppPrice`) so the conformance test enforces
token colors, grammar axes, branded tooltips, `barMaxWidth ≤ 24`, dashed-only-on-references and
stagger on stacks. `LimitChainMeter` lives beside them with its CSS in `EsppPage.css`.

### 8.2 Color, validated

Dataviz validator over the three component slots, adjacent pairs:

| Mode | Slots | Result |
|---|---|---|
| dark, surface `#171a21` | `#d95926 · #199e70 · #3987e5` | all checks pass; worst CVD ΔE 9.4 (deutan), normal-vision 20.9 |
| light, surface `#ffffff` | `#c94f1e · #15895f · #2f6fdc` | all checks pass; worst CVD ΔE 9.7 (deutan), normal-vision 22.8 |

Rejected by the same script: violet `PALETTE[6]` beside blue (ΔE 1.9 protan, 9.8 normal) and
pink `PALETTE[4]` beside orange (11.6 normal). The audit's note that slot 3's green sits near
`POSITIVE` does not bite here: chart A draws no status wash, and the loss overlay is red beside
blue, not green.

### 8.3 Motion and skeletons

Entrance is the frame's (`ChartCard` reads `fromCache`); the view toggle is an update; reduced
motion is inherited. The strip reserves five tile boxes from first paint; each chart card
reserves its 300 px; `FEED_SKELETON.esppLots` gains one row. The lane's smoke re-runs the ESPP
CLS probe.

### 8.4 Accessibility

Required `ariaLabel`s as written; CSV and Table twins on both charts; the meter's `role="meter"`
rows and printed figures; legends on every multi-series chart; `Appearance › Chart patterns`
textures the stacks through the aria decal with no per-series hatch to collide with.

## 9. Testing

**Backend.** `test_espp_calc.py`: the six new lot fields on a priced lot, a sold lot, an unpriced
lot, a below-FMV lot, an over-typed `purchase_price` (negative discount component), and
`running_avg_paid` over three lots in chain order. `test_espp_api.py`: the `totals` block for held
and sold lots and its all-zero shape; nulls when unpriced; the three modeler totals equal the
period sums. `test_price_service.py`: the floor reaches the earliest lot when it predates the
earliest vest, the earliest offering when it predates both, skips with no sources, and the
existing self-extinguish and watermark tests stay green.

**Frontend.** `esppChartOptions.test.ts`: dollars segments sum to `market_value`; the loss overlay
appears only for negative appreciation and stacks over the same column; sold columns carry the
cap label and the hollow item style, and so do a sold lot's per-share dots and its purchase marker
on the price chart; unpriced lots draw two segments; per-share bases equal the paid price, dots and
subscription diamonds land on their prices, the current-quote reference spans every category;
stable ids across views; label collision rule; price builder — subscription steps null before the
first offering and switch at a second offering's start, average-paid steps null before the first
lot, purchase markers snap to the last bar on or before the date and are skipped before the first
bar, sales markers, window slicing, `reachableSpans`; both CSVs. `LimitChainMeter.test.tsx`:
segment widths on the shared scale, the scale growing past $25k when contributions exceed it,
`aria-valuetext`, the capped sentence, the carry clause. `EsppPage.test.tsx`: five tiles with
ghost tiles while a feed is pending, `—` tiles without a quote, the toggle switching the option,
chart-to-table highlight, footer sentences, both empty states, the totals rows, the meter in place
of the gauge. Fixtures added to the conformance walk.

**Real-canvas probe before merge** (the 2026-08-25 lesson, and the chart-grammar rule for new
forms): the per-share view's two overlapping stacks with `barGap: '-100%'`, scatters over bars on
a category axis, `endLabel` on step references, in both themes; then the ESPP page smoke at
1600 px in both themes with hover screenshots and the CLS probe.

## 10. Rollout

1. **Plan 1 — backend and types**: §3.1–3.4, `types/api.ts` (optional fields), tests. Merges
   first; nothing else depends on the UI.
2. **Plan 2 — strip, totals row, meter**: §2, §4, §7 — no chart chunk involved, so it can run
   beside Plan 3.
3. **Plan 3 — the two chart cards**: §5, §6, fixtures, the probe.
4. **Verify**: full suites, conformance, both-theme smoke, CLS, the census-style before/after of
   the tiles against the table's own sums.

## 11. Out of scope (recorded)

The sell-now-vs-after-qualifying decomposition (revisit as lots-table columns backed by
`decompose_espp`); the plan timeline; the contribution-percent sweep and its endpoint; a price
scenario control on the lots; per-person ESPP; any change to the lots, offerings or periods
forms, the modeler chain, or stored data; mobile.

## Summary for the coordinator

1. Three visuals plus tiles, approved 2026-09-07: lot anatomy with a Dollars · Per share toggle,
   employer price history with purchases, a two-bar $25k chain meter; strip of five tiles.
2. Layout: strip → two `span-6` chart cards in a `card-grid` → Lots (with totals row) →
   Offerings → Modeler (meter + four tiles spanning the card). No lone tile, no 720 px cap.
3. Backend is additive: six per-lot component fields, a `totals` block, three modeler totals, and
   the employer backfill floor extended to the earliest lot or offering. No migration.
4. Colors: Paid orange, Bargain green, Appreciation blue — slots 2, 3, 1, validated both themes;
   `NEGATIVE` only for the below-FMV overlay and the price wash. Sold lots draw hollow on every
   ESPP chart; hatch, fade and gray keep their existing meanings.
5. Every chart through `ChartCard` with aria, CSV, fixture; the meter is HTML in the pace meter's
   grammar; a real-canvas probe of the per-share form precedes merge.
6. Three plans: backend first, then strip/meter and charts in parallel, then verify.

## 12. Amendments from the lane reviews (2026-09-07 night)

Recorded here so the spec matches what shipped; each came out of a review round and is pinned
by a test.

- **Strip**: no count-up (§4.1); a feed that failed with nothing cached renders its slots as
  `—` tiles rather than ghosts pulsing forever — ghosts mean "in flight" only; the dirty note
  wears `drill-hint`; `GhostTile` is `aria-hidden` and exported; `--m-stat-tile` is declared on
  `.loading-fallback` as well as `.page-skeleton`, so a ghost row is 115 px from first paint.
- **Meter**: a `Carried in` legend chip when a carry-forward leads the cash row; the segments
  row is the clipped pill, not the segments; the carry-forward text is the server string.
- **Component CSS**: `.espp-warning` lives in `src/components/espp/espp.css` (the page imports
  it); the chart cards' row highlight lives in `charts.css`.
- **Lot anatomy**: appreciation measured from the higher of FMV and paid (§5.3, §5.4); the
  per-share legend scrolls (§5.4); the footer is suppressed while the payload lacks the anatomy
  (a pre-batch snapshot), so the Lots card's quote line is never printed twice.
- **Price chart**: end labels read `Subscription` / `Avg paid` and part by rank (§6.2); markers
  dated outside the stored bars are skipped and counted (§6.2, §6.4); "history since" is
  earned only when the whole fetched series reveals its extent and the window starts at its
  first bar — a chip slice cannot answer inception on its own.
- **Probe**: `animation: false` on both panels and a 600 px canvas, the real span-6 width.
- **Verify**: the dev vite proxy pins `/api` to the shared backend on 8000, so the smoke re-aims
  same-origin API reads at the lane's backend; the page's own CLS is 0 in both themes, and the
  ~0.13 the shell's route-hold cross-fade books intermittently is page-independent and carried
  to the motion owner.
