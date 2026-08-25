import { api } from './client'
import type { MoneyFlowOut } from '../types/api'

// Omitting `year` lets the SERVER pick (the current product year — its clock, not the
// browser's). An unknown year still answers 200 with renderable: false + a reason.
export function fetchMoneyFlow(year?: number): Promise<MoneyFlowOut> {
  return api<MoneyFlowOut>(
    year === undefined ? '/overview/money-flow' : `/overview/money-flow?year=${year}`,
  )
}
