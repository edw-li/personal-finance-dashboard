import { api } from './client'
import type {
  ActivityBatch,
  ActivityPage,
  ActivityRunDetail,
  HealthOut,
  RestoreReport,
  SnapshotEntry,
} from '../types/api'

// A restore rewrites every exported table in one transaction after writing a restore
// point; 120s is the importer's budget and the right one here too.
const RESTORE_TIMEOUT_MS = 120_000
const ACTIVITY_PAGE = 50

// GET /system/snapshots — newest first (2026-09-03 data-lifecycle spec §8).
export function fetchSnapshots(): Promise<SnapshotEntry[]> {
  return api<SnapshotEntry[]>('/system/snapshots')
}

// POST /system/snapshots — "Snapshot now"; rate-limited server-side (10/minute).
export function createSnapshot(): Promise<SnapshotEntry> {
  return api<SnapshotEntry>('/system/snapshots', { method: 'POST' })
}

// The File goes up on BOTH calls — dry run and apply are stateless twins (the importer's
// contract; report.dry_run says which ran).
export function restoreUpload(file: File, dryRun: boolean): Promise<RestoreReport> {
  const body = new FormData()
  body.append('file', file)
  return api<RestoreReport>(`/import/snapshot?dry_run=${dryRun}`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(RESTORE_TIMEOUT_MS),
  })
}

// A stored nightly file by name (the server validates the name's grammar; nothing else
// reaches the filesystem).
export function restoreStored(name: string, dryRun: boolean): Promise<RestoreReport> {
  return api<RestoreReport>(
    `/import/snapshot/stored/${encodeURIComponent(name)}?dry_run=${dryRun}`,
    { method: 'POST', signal: AbortSignal.timeout(RESTORE_TIMEOUT_MS) },
  )
}

// GET /activity — `before` is the previous page's next_before cursor (an ISO instant).
export function fetchActivity(before?: string): Promise<ActivityPage> {
  const params = new URLSearchParams({ limit: String(ACTIVITY_PAGE) })
  if (before !== undefined) params.set('before', before)
  return api<ActivityPage>(`/activity?${params.toString()}`)
}

export function fetchActivityRun(runId: number): Promise<ActivityRunDetail> {
  return api<ActivityRunDetail>(`/activity/runs/${runId}`)
}

// POST …/undo — 409s carry the router's sentence verbatim; the caller shows it.
export function undoBatch(batchId: string): Promise<ActivityBatch> {
  return api<ActivityBatch>(`/activity/batches/${batchId}/undo`, { method: 'POST' })
}

// GET /system/health (2026-09-03 data-lifecycle spec §11).
export function fetchHealth(): Promise<HealthOut> {
  return api<HealthOut>('/system/health')
}
