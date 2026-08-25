// Single copy (percent.ts precedent): the holdings table and the overview freshness cue
// must call a quote stale on the same day, or the two screens disagree about the same row.
// quoted_at is the BAR date (UTC midnight) — compare DATES, not instants, or a Friday bar
// reads stale on Monday evening (Plan 4 note).
export const STALE_AFTER_DAYS = 4

export function isStaleQuote(quotedAt: string | null, today: Date = new Date()): boolean {
  if (!quotedAt) return false
  // Bar-date vs today's DATE (forward note: "UI compares dates only") — an instant
  // comparison flags a Friday bar early on Monday evening.
  const bar = Date.parse(`${quotedAt.slice(0, 10)}T00:00:00Z`)
  // `today` is injectable for tests only; the default keeps every call site a one-argument
  // call. toISOString() is UTC, which is what the bar dates are stamped in.
  const midnight = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`)
  return midnight - bar > STALE_AFTER_DAYS * 86_400_000
}

// Nightly-backup staleness — ONE copy for the Settings System card (amber tone, red
// wording) and the Overview attention strip's prod-only nag, so both flip at the same
// hour. Unlike quote bars these are full INSTANTS (backup_db.sh stamps UTC to the
// second), so instant math is the honest comparison — no date-only slicing here.
export const BACKUP_STALE_HOURS = 48
export const BACKUP_OVERDUE_DAYS = 7

export type BackupAge = 'fresh' | 'stale' | 'overdue'

export function backupAge(lastSuccessAt: string, now: Date = new Date()): BackupAge {
  const age = now.getTime() - Date.parse(lastSuccessAt)
  // NaN (an unparseable stamp) fails BOTH > checks and would read fresh by fall-through,
  // so it is called out explicitly: a marker we cannot read must nag, not reassure.
  if (Number.isNaN(age) || age > BACKUP_OVERDUE_DAYS * 86_400_000) return 'overdue'
  if (age > BACKUP_STALE_HOURS * 3_600_000) return 'stale'
  return 'fresh'
}
