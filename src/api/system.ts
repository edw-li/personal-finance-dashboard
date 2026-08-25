import { api } from './client'
import type { SystemStatus } from '../types/api'

// GET /system/status — the refresh-status superset (spec §3). Overview swapped its
// /prices/refresh-status fetch for this; PortfolioPage still uses the old endpoint.
export function fetchSystemStatus(): Promise<SystemStatus> {
  return api<SystemStatus>('/system/status')
}
