// Whole cents from the server's 2dp decimal strings — the one reader behind the sums the charts
// rank, compare and fan (the Spending page's all-time category ranking, the money flow's
// category totals, the "Where … went" year window). Rounding the double is exact here: a 2dp
// string parses to the nearest double, and ×100 lands within far less than half a cent of the
// integer for any amount a household carries, so Math.round recovers it (0.29 × 100 is
// 28.999999999999996). An absent cell is zero: an absent month adds nothing to a sum.
//
// The calendar keeps its own STRICT reader (components/calendar/cashflow.ts toCents): it throws
// on anything that is not a plain 2dp decimal, because its feed promises exactly that and a
// stray exponent there is a bug worth hearing about.
export const toCents = (value: string | null | undefined): number =>
  value === null || value === undefined ? 0 : Math.round(Number(value) * 100)
