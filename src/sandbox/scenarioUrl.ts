// The sandbox URL grammar (2026-09-03 planning-sandboxes spec §6): one repeated `whatif`
// query param, each value one entry `<kind>:<fields>` in the SERVER'S wire vocabulary —
// fractions, canonical decimals, ids — so decode → request body is a straight copy and the
// round trip is byte equality. Pure string code over URLSearchParams; nothing here knows a
// page. Page decoders compose these parsers and drop whatever comes back null.

export const WHATIF_PARAM = 'whatif'
/** The pre-sandbox ESPP lots-table link (`/taxes?whatif-lot=<id>`), kept working as an alias. */
export const LEGACY_LOT_PARAM = 'whatif-lot'

export interface ScenarioEntry {
  key: string
  fields: string[]
}

/** `<key>:<f1>[:<f2>…]` → parts, keeping empty fields ("sale:7:40::S" → ['7','40','','S']).
 *  Null for a value with no colon — the old `?whatif=TICKER` — or an empty key. */
export function parseEntry(raw: string): ScenarioEntry | null {
  const colon = raw.indexOf(':')
  if (colon <= 0) return null
  return { key: raw.slice(0, colon), fields: raw.slice(colon + 1).split(':') }
}

export function formatEntry(key: string, ...fields: string[]): string {
  return [key, ...fields].join(':')
}

/** The server's canonical decimal spellings and nothing else: "0.15", "250", "250.00",
 *  "-0.5". No exponent (Python's Decimal would accept "1e-3" and store a tenth of a
 *  percent for a thousandth — utils/percent.ts's warning), no "+", no bare point. */
export const WIRE_DECIMAL = /^-?\d+(?:\.\d+)?$/
export function isWireDecimal(text: string): boolean {
  return WIRE_DECIMAL.test(text)
}

/**
 * The wire spelling of tolerantly-typed text, or null when nothing here can rescue it.
 *
 * `canonicalAmount` is deliberately IDEMPOTENT — text already in plain form comes back
 * VERBATIM — so a box that accepted "+15", "200000." or ".5" hands those three straight on.
 * All three are spellings `WIRE_DECIMAL` refuses, and the first is one `decimal.ts`'s exact
 * arithmetic THROWS on (its PLAIN pattern has no "+"). Every control that turns typed text
 * into a knob normalizes here first, so the URL never learns a spelling the codec would drop
 * on the next render — and no comparison downstream is ever handed a "+".
 */
export function toWireDecimal(raw: string): string | null {
  let text = raw.trim()
  if (text.startsWith('+')) text = text.slice(1)
  if (text.endsWith('.')) text = text.slice(0, -1) // "200000." — a point with nothing after it
  if (text.startsWith('.')) text = `0${text}` // ".5" — the wire wants the leading zero
  else if (text.startsWith('-.')) text = `-0${text.slice(1)}`
  return isWireDecimal(text) ? text : null
}

/** A positive int4 (the ids' fence — api/paycheck.py's IdQuery bound). */
export function isPositiveInt(text: string): boolean {
  return /^[1-9]\d{0,9}$/.test(text) && Number(text) <= 2147483647
}

export const MONTH_TOKEN = /^\d{4}-(?:0[1-9]|1[0-2])$/

export function readEntries(params: URLSearchParams): string[] {
  return params.getAll(WHATIF_PARAM)
}

/** A COPY of `params` with the whatif family replaced by `entries` (and `drop`ped keys
 *  removed). Every other key — the shell's owner/range/month, Taxes' year — passes through
 *  untouched: the sandbox never owns them (spec §6). */
export function withEntries(
  params: URLSearchParams,
  entries: string[],
  drop: string[] = [],
): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete(WHATIF_PARAM)
  for (const key of drop) next.delete(key)
  for (const entry of entries) next.append(WHATIF_PARAM, entry)
  return next
}

/** The old `/taxes?whatif=TICKER` deep link: the first whatif value with no colon. */
export function legacyTicker(params: URLSearchParams): string | null {
  for (const value of params.getAll(WHATIF_PARAM)) {
    const text = value.trim()
    if (text !== '' && !text.includes(':')) return text
  }
  return null
}

/** The old `/taxes?whatif-lot=<id>` link — TaxesPage's integer fence, verbatim. */
export function legacyLotId(params: URLSearchParams): number | null {
  const raw = params.get(LEGACY_LOT_PARAM)
  if (raw === null) return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** A duplicate identity keeps the LAST entry (spec §6); order is otherwise first-seen —
 *  `Map.set` on a key it already holds OVERWRITES in place, so the winner inherits the
 *  loser's position and a knob does not jump down the URL when it is nudged twice. */
export function lastWins<T>(entries: T[], identity: (entry: T) => string): T[] {
  const byId = new Map<string, T>()
  for (const entry of entries) byId.set(identity(entry), entry)
  return [...byId.values()]
}

// ── Typed kinds ─────────────────────────────────────────────────────────────────────────

/** `sale:<security_id>:<shares>[:<price>][:<L|S>]` — a brokerage leg. An empty price field
 *  is the API's omit case (the latest quote); the term defaults long. Mirrors SaleLegIn. */
export interface SaleEntry {
  security_id: number
  shares: string
  price?: string
  term: 'long' | 'short'
}

export function parseSale(fields: string[]): SaleEntry | null {
  if (fields.length < 2 || fields.length > 4) return null
  const [id, shares, price = '', term = ''] = fields
  if (!isPositiveInt(id)) return null
  if (!isWireDecimal(shares) || Number(shares) <= 0) return null
  if (price !== '' && (!isWireDecimal(price) || Number(price) <= 0)) return null
  if (term !== '' && term !== 'L' && term !== 'S') return null
  const sale: SaleEntry = { security_id: Number(id), shares, term: term === 'S' ? 'short' : 'long' }
  if (price !== '') sale.price = price
  return sale
}

export function formatSale(sale: SaleEntry): string {
  const fields = [String(sale.security_id), sale.shares]
  if (sale.price !== undefined || sale.term === 'short') fields.push(sale.price ?? '')
  if (sale.term === 'short') fields.push('S')
  return formatEntry('sale', ...fields)
}

/** `espp:<lot_id>[:<price>]` — an ESPP lot sale; empty price = the ESPP quote. */
export interface EsppEntry {
  lot_id: number
  sale_price?: string
}

export function parseEspp(fields: string[]): EsppEntry | null {
  if (fields.length < 1 || fields.length > 2) return null
  const [id, price = ''] = fields
  if (!isPositiveInt(id)) return null
  if (price !== '' && (!isWireDecimal(price) || Number(price) <= 0)) return null
  const espp: EsppEntry = { lot_id: Number(id) }
  if (price !== '') espp.sale_price = price
  return espp
}

export function formatEspp(espp: EsppEntry): string {
  return espp.sale_price === undefined
    ? formatEntry('espp', String(espp.lot_id))
    : formatEntry('espp', String(espp.lot_id), espp.sale_price)
}

/** `retire:<person_id>:<YYYY-MM>` — mirrors the projection API's `retire=` spelling. */
export interface RetireEntry {
  person_id: number
  month: string
}

export function parseRetire(fields: string[]): RetireEntry | null {
  if (fields.length !== 2) return null
  const [id, month] = fields
  if (!isPositiveInt(id) || !MONTH_TOKEN.test(month)) return null
  return { person_id: Number(id), month }
}

export function formatRetire(retire: RetireEntry): string {
  return formatEntry('retire', String(retire.person_id), retire.month)
}

/** `<input_key>:<decimal|null>` — a tax override in the year's input-definition vocabulary.
 *  The caller checks the key against the definitions it has; this only checks the shape. */
export function parseOverride(entry: ScenarioEntry): { key: string; value: string | null } | null {
  if (entry.fields.length !== 1) return null
  const [value] = entry.fields
  if (value === 'null') return { key: entry.key, value: null }
  return isWireDecimal(value) ? { key: entry.key, value } : null
}

export function formatOverride(key: string, value: string | null): string {
  return formatEntry(key, value ?? 'null')
}

/** `<knob>:<token>` restricted to an allow-list; `accept` judges the token per key. */
export function parseKnob<K extends string>(
  entry: ScenarioEntry,
  keys: readonly K[],
  accept: (key: K, value: string) => boolean,
): { key: K; value: string } | null {
  if (entry.fields.length !== 1) return null
  if (!(keys as readonly string[]).includes(entry.key)) return null
  const key = entry.key as K
  const [value] = entry.fields
  return accept(key, value) ? { key, value } : null
}
