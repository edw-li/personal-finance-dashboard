import { formatDateTime } from '../../utils/format'

// The server's restore-point grammar (services/snapshot.py RESTORE_POINT_NAME_RE): the UTC
// instant the point was written, to the microsecond. Parsed here only to NAME a point in a
// toast (2026-09-23 spec §B3) — every list reads the server's own `at` instead.
const RESTORE_POINT_RE = /^pre-restore-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})\d{3}\.zip$/

/** The ISO instant a restore point's name encodes, or null for any other name. */
export function restorePointInstant(name: string): string | null {
  const match = RESTORE_POINT_RE.exec(name)
  if (match === null) return null
  const [, year, month, day, hour, minute, second, millis] = match
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}Z`
}

/** "Sep 4, 2026, 9:15 AM" on the reader's clock — the Backups rows' own words — or the name
 *  itself when it does not parse (never a "—" standing where a file should be named). */
export function restorePointLabel(name: string): string {
  const instant = restorePointInstant(name)
  const label = instant === null ? '—' : formatDateTime(instant)
  return label === '—' ? name : label
}

/** The Restore card's arrival link for a stored file: the Backups rows' Restore… and the
 *  toasts' Undo both pre-select through it (RestoreCard's `?restore=` arrival). */
export function restoreHref(name: string): string {
  return `/settings?restore=${encodeURIComponent(name)}#restore`
}
