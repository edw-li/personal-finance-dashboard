// The two axis label formatters (chart spec §13), passed by REFERENCE: conformance.ts checks
// every value/log axis formatter by identity against these, so a builder never re-spells them.
// A leaf module, so the axes (grammar.ts) and the off-scale markers (offScale.ts) share them
// without importing each other. Depends on: utils/format.ts.
import { formatCurrencyCompact, formatPct } from '../utils/format'

/** Compact money ticks ($1.2K, $1.45M) — THE money axis formatter (§13), passed by reference. */
export const compactMoney = (value: number): string => formatCurrencyCompact(value)
/** Whole-percent ticks (§13) — THE percent axis formatter. */
export const percentLabel = (value: number): string =>
  formatPct(value, { signed: false, decimals: 0 })
