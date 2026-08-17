import { api } from './client'
import type { ImportReport } from '../types/api'

// Parsing + applying a whole workbook outruns the 15s default; 120s is the
// refreshPrices precedent.
const IMPORT_TIMEOUT_MS = 120_000

// The File goes up on BOTH calls — dry-run and apply are stateless twins (the server keeps
// nothing between them; report.dry_run says which ran).
export function importXlsx(file: File, dryRun: boolean): Promise<ImportReport> {
  const body = new FormData()
  body.append('file', file)
  return api<ImportReport>(`/import/xlsx?dry_run=${dryRun}`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS),
  })
}
