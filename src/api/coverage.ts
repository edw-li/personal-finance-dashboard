import { api } from './client'
import type { CoverageOut } from '../types/api'

// No trailing slash (the /settings and /household precedent: the router mounts GET on the
// bare prefix, and "/coverage/" would cost a 307).
export function fetchCoverage(): Promise<CoverageOut> {
  return api<CoverageOut>('/coverage')
}
