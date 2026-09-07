// ESPP fixtures shared by the builder, card and page tests (2026-09-07 visuals). The four lots
// are EsppPage.test.tsx's — the sheet's own numbers at a $171.31 quote — with the anatomy fields
// the lots envelope carries since the 2026-09-07 batch (computed with espp_calc, not by hand).
import type { EsppLotOut, EsppLotsResponse, EsppOfferingOut, PricePoint } from '../types/api'

export function esppLot(over: Partial<EsppLotOut> = {}): EsppLotOut {
  return {
    id: 1,
    purchase_date: '2024-02-29',
    qualifying_date: '2025-09-01',
    shares: '260.0000',
    subscription_price: '48.50900',
    purchase_fmv: '79.11200',
    purchase_price: '41.23265',
    sold_date: null,
    sold_price: null,
    notes: null,
    cost_basis: '10720.49',
    market_value: '44540.60',
    gain_amount: '33820.11',
    gain_pct: '3.154717',
    qualified: true,
    days_until_qualified: 0,
    is_sold: false,
    fmv_value: '20569.12',
    bargain_element: '9848.63',
    lookback_component: '7956.78',
    discount_component: '1891.85',
    appreciation: '23971.48',
    avg_paid_to_date: '41.23265',
    ...over,
  }
}

/** Held, qualified, well above its purchase FMV. */
export const heldLot = esppLot()
/** Sold after qualifying, at $120 — hollow on every chart. */
export const soldLot = esppLot({
  id: 2, purchase_date: '2024-08-30', shares: '255.0000', sold_date: '2025-10-15', sold_price: '120.00000',
  cost_basis: '10514.33', market_value: '30600.00', gain_amount: '20085.67', gain_pct: '1.910315',
  days_until_qualified: null, is_sold: true,
  fmv_value: '20173.56', bargain_element: '9659.23', lookback_component: '7803.77', discount_component: '1855.46', appreciation: '10426.44',
})
/** Sold before qualifying and BELOW its purchase FMV — hollow AND a realized loss overlay. */
export const soldLossLot = esppLot({
  id: 3, purchase_date: '2025-02-28', qualifying_date: '2026-02-28', shares: '274.0000', purchase_fmv: '124.80000',
  sold_date: '2025-11-03', sold_price: '110.00000',
  cost_basis: '11297.75', market_value: '30140.00', gain_amount: '18842.25', gain_pct: '1.667789',
  qualified: false, days_until_qualified: null, is_sold: true,
  fmv_value: '34195.20', bargain_element: '22897.45', lookback_component: '20903.73', discount_component: '1993.72', appreciation: '-4055.20',
})
/** Held, still qualifying, and a hair UNDER its purchase FMV at this quote — the loss overlay. */
export const underwaterLot = esppLot({
  id: 4, purchase_date: '2025-08-29', qualifying_date: '2026-08-29', shares: '241.0000', purchase_fmv: '174.18000',
  cost_basis: '9937.07', market_value: '41285.71', gain_amount: '31348.64',
  qualified: false, days_until_qualified: 13,
  fmv_value: '41977.38', bargain_element: '32040.31', lookback_component: '30286.71', discount_component: '1753.60', appreciation: '-691.67',
})

export const anatomyLots: EsppLotOut[] = [heldLot, soldLot, soldLossLot, underwaterLot]

export function esppLotsResponse(over: Partial<EsppLotsResponse> = {}): EsppLotsResponse {
  return {
    espp_ticker: 'NVDA',
    current_price: '171.3100',
    quoted_at: '2026-08-15T20:00:00Z',
    lots: anatomyLots,
    totals: {
      held: {
        lots: 2, shares: '501.0000', cost_basis: '20657.56', fmv_value: '62546.50',
        market_value: '85826.31', gain_amount: '65168.75', gain_pct: '3.154717',
        bargain_element: '41888.94', lookback_component: '38243.49', discount_component: '3645.45',
        appreciation: '23279.81', avg_paid: '41.23265',
      },
      sold: { lots: 2, shares: '529.0000', cost_basis: '21812.08', proceeds: '60740.00', gain_amount: '38927.92' },
    },
    ...over,
  }
}

export const septOffering: EsppOfferingOut = {
  id: 1, offering_start: '2023-09-01', subscription_price: '48.50900', notes: null,
}

/** Five daily bars around the first two purchases and the first sale's date range. */
export const bars: PricePoint[] = [
  { d: '2024-02-27', c: '75.0000' },
  { d: '2024-02-29', c: '79.1120' },
  { d: '2024-03-01', c: '80.0000' },
  { d: '2024-08-30', c: '119.3700' },
  { d: '2024-09-03', c: '121.0000' },
]
