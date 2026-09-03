# Data lifecycle F1 — Backups & snapshots card, Restore card, System card marker, backup nag — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/superpowers/specs/2026-09-03-data-lifecycle-design.md` §7 UI and §8 UI: the System card's backup row reads the verify-phase marker ("· encrypted · verified" / "· not verified — reason", colour never the only channel) and loses its download button; the **Backups & snapshots** card (`id="backups"`) lists the stored nightly files with Snapshot now, Download snapshot and per-file Restore… links; the **Restore** card (`id="restore"`) takes a file or a stored snapshot, dry-runs into `RestoreReportView`, arms Restore only from a clean dry run of the current selection plus the snapshot's typed date, confirms, toasts, and prints the router's sentences verbatim; the Overview nag appends "and last night's was not verified"; the palette gains the four new Settings sections.

**Architecture:** Both cards follow the settings-card house recipe (own fetch, `seqRef`, plain `load`, `FeedBanner` for errors, `useToast` for outcomes) and read only Phase 0's `api/lifecycle.ts` fetchers and types. The Backups → Restore handoff rides the URL (`/settings?restore=<name>#restore`) and `useArrivalValue`, so no state is lifted into `SettingsPage`. `RestoreReportView` is Phase 0's.

**Tech Stack:** React 19, react-router 7, TypeScript, vitest + Testing Library.

**Worktree / commands:** Branch `lifecycle-f1` from main AFTER `lifecycle-base` merged (check: `src/api/lifecycle.ts` and `src/components/settings/RestoreReportView.tsx` exist, `src/components/paletteRegistry.ts` exists). From the worktree root, with the `node_modules` junction (`cmd /c mklink /J node_modules ..\..\node_modules`): `npx vitest run <file>`; `npx tsc -b`; `npx eslint <paths>`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/settings/SystemCard.tsx` (+ test, modify) | marker wording; download button removed |
| `src/components/settings/BackupsCard.tsx` (+ test, new) | stored snapshots list, Snapshot now, Download, Restore… links |
| `src/components/settings/RestoreCard.tsx` (+ test, new) | source picker, dry run, typed-date arm, confirm, restore |
| `src/components/settings/settings.css` (modify) | the two cards' layout rules |
| `src/components/overview/attention.ts` (+ test, modify) | the verified nag |
| `src/components/paletteRegistry.ts` (+ test, modify) | four Settings sections |
| `src/pages/SettingsPage.tsx` (+ test, modify) | mount the two cards after System |

---

### Task 1: System card — the verified marker, no download button

**Files:**
- Modify: `src/components/settings/SystemCard.tsx`, `src/components/settings/SystemCard.test.tsx`

- [ ] **Step 1: Rewrite the affected tests**

In `src/components/settings/SystemCard.test.tsx`:

Replace the `vi.mock('../../api/system', …)` block and its import with:

```ts
vi.mock('../../api/system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/system')>()),
  fetchSystemStatus: vi.fn(),
}))
import { fetchSystemStatus } from '../../api/system'
```

Remove `vi.mocked(downloadSnapshot).mockResolvedValue(undefined)` from `beforeEach`, and DELETE the two tests `downloads the snapshot with a busy state on the button` and `surfaces a failed export without hiding the facts` (the download moved to the Backups card — Task 2 tests it there). Drop the now-unused `act` import if eslint flags it.

Change the three backup-line expectations:
- in `renders the healthy rows verbatim`: `screen.getByText(\`${formatDateTime(backup.last_success_at)} (1.2M)\`)` → `screen.getByText(\`${formatDateTime(backup.last_success_at)} · 1.2M\`)`
- in `tones the backup amber past 48 hours, wording unchanged`: `` `${formatDateTime(backup.last_success_at)} (1.2M)` `` → `` `${formatDateTime(backup.last_success_at)} · 1.2M` ``
- in `changes the WORDING past seven days, not colour alone`: `` `${formatDateTime(backup.last_success_at)} (1.2M) — more than a week old` `` → `` `${formatDateTime(backup.last_success_at)} · 1.2M — more than a week old` ``

Append two tests:

```ts
// The verify phase (2026-09-03 data-lifecycle spec §8): "Last backup" now means "the dump
// restores", and the row says so in words.
it('reads a verified, encrypted marker as words, bytes from size_bytes', async () => {
  const backup = {
    ...backupOut(10),
    size_bytes: 110_592,
    encrypted: true,
    retention_days: 30,
    verified: true,
    verified_at: hoursAgo(10),
    row_counts: { net_worth_snapshots: 33, monthly_spending: 621, position_transactions: 210 },
  }
  vi.mocked(fetchSystemStatus).mockResolvedValue(systemOut({ backup }))
  render(<SystemCard />)
  const stamp = await screen.findByText(
    `${formatDateTime(backup.last_success_at)} · 108.0 KB · encrypted · verified`,
  )
  expect(stamp.className).toBe('')
  expect(screen.queryByRole('button', { name: 'Download snapshot (.zip)' })).toBeNull()
})

it('says NOT verified with the reason, in the overdue tone — colour is never the only channel', async () => {
  const backup = {
    ...backupOut(10),
    size_bytes: 110_592,
    encrypted: true,
    verified: false,
    verify_error: 'row count mismatch: live monthly_spending=621 vs restored monthly_spending=600',
  }
  vi.mocked(fetchSystemStatus).mockResolvedValue(systemOut({ backup }))
  render(<SystemCard />)
  const stamp = await screen.findByText(
    `${formatDateTime(backup.last_success_at)} · 108.0 KB · encrypted · not verified — ` +
      'row count mismatch: live monthly_spending=621 vs restored monthly_spending=600',
  )
  expect(stamp.className).toBe('system-overdue')
})
```

- [ ] **Step 2: Run to verify the new/changed tests fail**

Run: `npx vitest run src/components/settings/SystemCard.test.tsx`
Expected: FAIL — the ` · 1.2M` spellings, the verified line, and the download button still rendering.

- [ ] **Step 3: Implement**

In `src/components/settings/SystemCard.tsx`:

Replace `backupLine`:

```ts
// The marker's words (2026-09-03 data-lifecycle spec §8): stamp · size · encrypted · verified,
// or "· not verified — <reason>" in the overdue tone. size_bytes (the verify-phase script)
// wins over the older du -h string; both parse, because every new field is optional.
function backupLine(status: SystemStatus): { text: string; className: string } {
  if (status.backup === null) {
    // The permanent, unremarkable state on a dev box — said plainly. The prod-only
    // nagging lives on the Overview strip (attention.ts), never here.
    return { text: 'No backup recorded', className: '' }
  }
  const backup = status.backup
  const parts = [
    formatDateTime(backup.last_success_at),
    backup.size_bytes != null ? formatBytes(backup.size_bytes) : backup.size,
  ]
  if (backup.encrypted === true) parts.push('encrypted')
  let className = ''
  if (backup.verified === true) {
    parts.push('verified')
  } else if (backup.verified === false) {
    parts.push(`not verified — ${backup.verify_error ?? 'no reason recorded'}`)
    className = 'system-overdue'
  }
  let text = parts.join(' · ')
  const age = backupAge(backup.last_success_at)
  if (age === 'overdue') {
    // Past seven days the WORDING changes too (spec §3) — colour is never the only channel.
    text += ' — more than a week old'
    className = 'system-overdue'
  } else if (age === 'stale' && className === '') {
    className = 'system-stale'
  }
  return { text, className }
}
```

Remove the download: delete `downloading`/`onDownload` from `SystemFacts`' props and the `<button …>Download snapshot (.zip)</button>` (leave `<dd><span className={backup.className}>{backup.text}</span></dd>`), delete the `downloading`/`downloadError` state, the `download` function, the `downloadError` banner, and the `downloadSnapshot` import (keep `fetchSystemStatus`). Update the JSDoc: "…the nightly-backup marker with its verify verdict…". The InfoHint text becomes: `"Operational status: the last price refresh and its schedule, the nightly backup marker recorded by the backup script — with whether last night's dump restored — and the database's size and migration head. Snapshots and downloads live on the Backups card."`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/settings/SystemCard.test.tsx src/pages/SettingsPage.test.tsx`
Expected: PASS. (`SettingsPage.test` never clicked the download button.)

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SystemCard.tsx src/components/settings/SystemCard.test.tsx
git commit -m "feat(settings): System card reads the verified-backup marker in words; download moves to Backups"
```

---

### Task 2: `BackupsCard`

**Files:**
- Create: `src/components/settings/BackupsCard.tsx`, `src/components/settings/BackupsCard.test.tsx`
- Modify: `src/components/settings/settings.css`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/settings/BackupsCard.test.tsx
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { SnapshotEntry } from '../../types/api'
import { formatDateTime } from '../../utils/format'
import ToastProvider from '../ToastProvider'
import BackupsCard from './BackupsCard'

vi.mock('../../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lifecycle')>()),
  fetchSnapshots: vi.fn(),
  createSnapshot: vi.fn(),
}))
vi.mock('../../api/system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/system')>()),
  downloadSnapshot: vi.fn(),
}))
import { createSnapshot, fetchSnapshots } from '../../api/lifecycle'
import { downloadSnapshot } from '../../api/system'

const NEWEST: SnapshotEntry = {
  name: 'finance-export-20260903-233000.zip',
  at: '2026-09-03T23:30:00+00:00',
  size_bytes: 2_097_152,
  alembic_head: 'c3a7e19d5b42',
  restorable: true,
}
const FOREIGN: SnapshotEntry = {
  name: 'finance-export-20260902-233000.zip',
  at: '2026-09-02T23:30:00+00:00',
  size_bytes: 1_048_576,
  alembic_head: 'b8e4d17c2a90',
  restorable: false,
}

function mount() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <BackupsCard />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(fetchSnapshots).mockResolvedValue([NEWEST, FOREIGN])
  vi.mocked(createSnapshot).mockResolvedValue({ ...NEWEST, name: 'finance-export-20260904-091500.zip', at: '2026-09-04T09:15:00+00:00' })
  vi.mocked(downloadSnapshot).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('BackupsCard', () => {
  it('lists the stored snapshots newest first with size and age, and a Restore… link only when restorable', async () => {
    mount()
    expect(await screen.findByRole('region', { name: 'Backups & snapshots' })).toBeTruthy()
    expect(document.getElementById('backups')).toBeTruthy()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('finance-export-20260903-233000.zip')
    expect(rows[0].textContent).toContain(`${formatDateTime(NEWEST.at)} · 2.0 MB`)
    const restore = screen.getByRole('link', { name: 'Restore…' })
    expect(restore.getAttribute('href')).toBe('/settings?restore=finance-export-20260903-233000.zip#restore')
    // The foreign-schema file is listed (it is on the volume) but offered no restore.
    expect(rows[1].textContent).toContain('different schema — not restorable here')
    expect(screen.getAllByRole('link', { name: 'Restore…' })).toHaveLength(1)
  })

  it('Snapshot now prepends the new entry and toasts its name', async () => {
    mount()
    await screen.findByRole('link', { name: 'Restore…' })
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot now' }))
    expect(screen.getByRole('button', { name: 'Writing…' })).toBeTruthy()
    await waitFor(() => expect(createSnapshot).toHaveBeenCalledTimes(1))
    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('finance-export-20260904-091500.zip')
    expect(screen.getByText('Snapshot written — finance-export-20260904-091500.zip')).toBeTruthy()
    expect(fetchSnapshots).toHaveBeenCalledTimes(1) // no refetch needed: the POST answers the entry
  })

  it('downloads the export with a busy state, and shows a failure without dropping the list', async () => {
    let release: () => void = () => {}
    vi.mocked(downloadSnapshot).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Download snapshot (.zip)' }))
    expect((screen.getByRole('button', { name: 'Preparing…' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      release()
    })
    expect((screen.getByRole('button', { name: 'Download snapshot (.zip)' }) as HTMLButtonElement).disabled).toBe(false)
    vi.mocked(downloadSnapshot).mockRejectedValue(new ApiError('Export timed out', 0))
    fireEvent.click(screen.getByRole('button', { name: 'Download snapshot (.zip)' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Export timed out')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('shows the rate-limit sentence verbatim when Snapshot now is refused', async () => {
    vi.mocked(createSnapshot).mockRejectedValue(new ApiError('Rate limit exceeded: 10 per 1 minute', 429))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Snapshot now' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Rate limit exceeded: 10 per 1 minute')
  })

  it('banners a failed load with Retry, and says so when the volume is empty', async () => {
    vi.mocked(fetchSnapshots).mockRejectedValueOnce(new ApiError('snapshots unavailable', 500)).mockResolvedValueOnce([])
    mount()
    expect((await screen.findByRole('alert')).textContent).toContain('snapshots unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading snapshots' }))
    expect(await screen.findByText(/No stored snapshots yet/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/settings/BackupsCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the card and its styles**

```tsx
// src/components/settings/BackupsCard.tsx
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { createSnapshot, fetchSnapshots } from '../../api/lifecycle'
import { downloadSnapshot } from '../../api/system'
import type { SnapshotEntry } from '../../types/api'
import { formatBytes, formatDateTime } from '../../utils/format'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import { useToast } from '../ToastProvider'
import '../panels.css'
import './settings.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Backups & snapshots (2026-09-03 data-lifecycle spec §8): the nightly logical snapshots on
 * the data volume — the restorable backup pg_dump cannot give the app — with "Snapshot now"
 * (the on-demand backup), the export download (moved here from the System card), and a
 * Restore… link per file that pre-selects it in the Restore card through the URL. The host's
 * encrypted dump stays described on the System card; this card is about what the app itself
 * can read back.
 */
export default function BackupsCard() {
  const [entries, setEntries] = useState<SnapshotEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // One busy flag for the two writes: neither should start while the other is in flight.
  const [busy, setBusy] = useState<'snapshot' | 'download' | null>(null)
  // Its OWN slot, never `error`: a failed action must not hide a list that loaded fine.
  const [actionError, setActionError] = useState<string | null>(null)
  const seqRef = useRef(0)
  const toast = useToast()

  // A plain function over stable setters, called from the effect and Retry (house idiom).
  const load = () => {
    const seq = ++seqRef.current
    fetchSnapshots()
      .then((list) => {
        if (seq !== seqRef.current) return
        setEntries(list)
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load stored snapshots.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only (house idiom)
  }, [])

  const snapshotNow = () => {
    setBusy('snapshot')
    setActionError(null)
    createSnapshot()
      .then((entry) => {
        // The POST answers the entry, so the list updates without a second fetch.
        setEntries((current) => [entry, ...(current ?? []).filter((e) => e.name !== entry.name)])
        toast.success(`Snapshot written — ${entry.name}`)
      })
      .catch((err: unknown) => setActionError(message(err, 'Snapshot failed.')))
      .finally(() => setBusy(null))
  }

  const download = () => {
    setBusy('download')
    setActionError(null)
    downloadSnapshot()
      .catch((err: unknown) => setActionError(message(err, 'Export failed.')))
      .finally(() => setBusy(null))
  }

  return (
    <section className="card span-6" id="backups" role="region" aria-label="Backups & snapshots">
      <h2 className="eyebrow">
        Backups &amp; snapshots
        <InfoHint text="Nightly at 23:30 PT the app writes its own export ZIP to the data volume and keeps the newest fourteen; each can be restored from the Restore card. Snapshot now writes one immediately. The host's encrypted database dump is separate and described on the System card." />
      </h2>
      <div className="settings-card-actions">
        <button type="button" className="button button-primary" disabled={busy !== null} onClick={snapshotNow}>
          {busy === 'snapshot' ? 'Writing…' : 'Snapshot now'}
        </button>
        <button type="button" className="button" disabled={busy !== null} onClick={download}>
          {busy === 'download' ? 'Preparing…' : 'Download snapshot (.zip)'}
        </button>
      </div>
      <FeedBanner error={actionError} />
      <FeedBanner error={error} retry={load} retryLabel="Retry loading snapshots" />
      {entries === null && error === null && <p className="empty-note">Loading…</p>}
      {entries !== null && entries.length === 0 && (
        <p className="empty-note">No stored snapshots yet — the nightly job writes the first one at 23:30 PT.</p>
      )}
      {entries !== null && entries.length > 0 && (
        <ul className="backups-list">
          {entries.map((entry) => (
            <li key={entry.name} className="backups-row">
              <span className="system-mono">{entry.name}</span>
              <span className="settings-note">
                {formatDateTime(entry.at)} · {formatBytes(entry.size_bytes)}
                {entry.restorable ? '' : ' · different schema — not restorable here'}
              </span>
              {entry.restorable && (
                <Link className="button" to={`/settings?restore=${encodeURIComponent(entry.name)}#restore`}>
                  Restore…
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="settings-note">
        Newest fourteen kept. A restore writes a pre-restore point first, so the way back is
        always one more restore away.
      </p>
    </section>
  )
}
```

Append to `src/components/settings/settings.css`:

```css
/* --- backups & restore cards (2026-09-03 data-lifecycle spec §7–§8) --- */

.backups-list {
  list-style: none;
  margin: 0.75rem 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.backups-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.75rem;
}

.backups-row .button {
  margin-left: auto;
  padding: 0.3rem 0.6rem;
  font-size: 0.78rem;
}

/* The Restore card's source picker: a file input OR a stored-snapshot select, stacked. */
.restore-source {
  display: grid;
  gap: 0.6rem;
  max-width: 520px;
  margin-bottom: 0.75rem;
}

/* The typed-date arm and the red button, side by side (the wizard's danger-row shape). */
.restore-arm {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.6rem;
  margin-top: 0.75rem;
}

.restore-arm label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/settings/BackupsCard.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/BackupsCard.tsx src/components/settings/BackupsCard.test.tsx src/components/settings/settings.css
git commit -m "feat(settings): Backups & snapshots card — stored files, Snapshot now, download, Restore… links"
```

---

### Task 3: `RestoreCard`

**Files:**
- Create: `src/components/settings/RestoreCard.tsx`, `src/components/settings/RestoreCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/settings/RestoreCard.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { RestoreReport, SnapshotEntry } from '../../types/api'
import ToastProvider from '../ToastProvider'
import RestoreCard from './RestoreCard'

vi.mock('../../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lifecycle')>()),
  fetchSnapshots: vi.fn(),
  restoreUpload: vi.fn(),
  restoreStored: vi.fn(),
}))
import { fetchSnapshots, restoreStored, restoreUpload } from '../../api/lifecycle'

const STORED: SnapshotEntry = {
  name: 'finance-export-20260902-233000.zip',
  at: '2026-09-02T23:30:00+00:00',
  size_bytes: 2_097_152,
  alembic_head: 'c3a7e19d5b42',
  restorable: true,
}

function report(over: Partial<RestoreReport> = {}): RestoreReport {
  return {
    dry_run: true,
    applied: false,
    exported_at: '2026-09-02T23:30:00+00:00',
    schema: { snapshot_head: 'c3a7e19d5b42', server_head: 'c3a7e19d5b42', compatible: true },
    tables: {
      accounts: { current: 25, incoming: 25, identical: true },
      account_balances: { current: 800, incoming: 781, identical: false },
    },
    preserved_settings: ['backup_status'],
    warnings: [],
    errors: [],
    restore_point: null,
    batch_id: null,
    run_id: 3,
    ...over,
  }
}

function mount(entry = '/settings') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <RestoreCard />
      </ToastProvider>
    </MemoryRouter>,
  )
}

const confirmSpy = vi.spyOn(window, 'confirm')
const select = () => screen.getByLabelText('Stored snapshot') as HTMLSelectElement
const dateBox = () => screen.getByLabelText("Type the snapshot's date (YYYY-MM-DD) to confirm") as HTMLInputElement
const dryButton = () => screen.getByRole('button', { name: /^dry run/i }) as HTMLButtonElement
const restoreButton = () => screen.getByRole('button', { name: /^restor(e|ing…)$/i }) as HTMLButtonElement

beforeEach(() => {
  vi.mocked(fetchSnapshots).mockResolvedValue([STORED])
  vi.mocked(restoreStored).mockResolvedValue(report())
  vi.mocked(restoreUpload).mockResolvedValue(report())
  confirmSpy.mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RestoreCard', () => {
  it('offers the stored snapshots and arms Dry run once one is chosen', async () => {
    mount()
    expect(await screen.findByRole('region', { name: 'Restore' })).toBeTruthy()
    expect(document.getElementById('restore')).toBeTruthy()
    expect(dryButton().disabled).toBe(true)
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    expect(dryButton().disabled).toBe(false)
    expect(restoreButton().disabled).toBe(true)
  })

  it('dry-runs the stored file, renders the report, and arms Restore only on the typed date', async () => {
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await waitFor(() => expect(restoreStored).toHaveBeenCalledWith(STORED.name, true))
    expect(await screen.findByText('Dry run — nothing was written.')).toBeTruthy()
    expect(screen.getByText('account_balances')).toBeTruthy()
    expect(restoreButton().disabled).toBe(true)
    fireEvent.change(dateBox(), { target: { value: '2026-09-03' } }) // the wrong day
    expect(restoreButton().disabled).toBe(true)
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    expect(restoreButton().disabled).toBe(false)
  })

  it('restores after the confirm sentence, toasts, and shows the applied report', async () => {
    vi.mocked(restoreStored)
      .mockResolvedValueOnce(report())
      .mockResolvedValueOnce(report({ dry_run: false, applied: true, restore_point: 'pre-restore-20260904-091500-123456.zip', batch_id: 'b-1' }))
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await screen.findByText('Dry run — nothing was written.')
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    fireEvent.click(restoreButton())
    expect(confirmSpy).toHaveBeenCalledWith(
      'Restore the snapshot from Sep 2, 2026? A restore point of the current database is written ' +
        'first (kept with the last three), then every exported table is replaced. Other pages ' +
        'reload on their next visit.',
    )
    await waitFor(() => expect(restoreStored).toHaveBeenCalledWith(STORED.name, false))
    expect(await screen.findByText('Restored.')).toBeTruthy()
    expect(screen.getByText('Restore point written: pre-restore-20260904-091500-123456.zip')).toBeTruthy()
    expect(screen.getByText('Restored snapshot from Sep 2, 2026 — other pages reload on their next visit')).toBeTruthy()
    // An applied report arms nothing: dry-run again to restore again.
    expect(restoreButton().disabled).toBe(true)
  })

  it('spends no request when the confirm is declined', async () => {
    confirmSpy.mockReturnValue(false)
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await screen.findByText('Dry run — nothing was written.')
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    fireEvent.click(restoreButton())
    expect(restoreStored).toHaveBeenCalledTimes(1)
  })

  it('uploads a chosen file for the dry run and disarms when the selection changes', async () => {
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    const file = new File(['zip bytes'], 'finance-export-20260901-1200.zip')
    fireEvent.change(screen.getByLabelText('Snapshot file (.zip)'), { target: { files: [file] } })
    fireEvent.click(dryButton())
    await waitFor(() => expect(restoreUpload).toHaveBeenCalledWith(file, true))
    await screen.findByText('Dry run — nothing was written.')
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    expect(restoreButton().disabled).toBe(false)
    // Picking a stored file instead drops the report and the arm: they described the upload.
    fireEvent.change(select(), { target: { value: STORED.name } })
    expect(screen.queryByText('Dry run — nothing was written.')).toBeNull()
    expect(restoreButton().disabled).toBe(true)
  })

  it('keeps Restore disabled on an incompatible or erroring dry run, and prints the router sentence verbatim', async () => {
    vi.mocked(restoreStored).mockResolvedValueOnce(
      report({ schema: { snapshot_head: 'b8e4d17c2a90', server_head: 'c3a7e19d5b42', compatible: false } }),
    )
    mount()
    await waitFor(() => expect(select().options).toHaveLength(2))
    fireEvent.change(select(), { target: { value: STORED.name } })
    fireEvent.click(dryButton())
    await screen.findByText(/incompatible$/)
    fireEvent.change(dateBox(), { target: { value: '2026-09-02' } })
    expect(restoreButton().disabled).toBe(true)
    vi.mocked(restoreStored).mockRejectedValueOnce(
      new ApiError('This snapshot was exported at schema `b8e4d17c2a90`; this server runs `c3a7e19d5b42`. Restore it on a server at `b8e4d17c2a90`, or use the nightly database dump.', 409),
    )
    fireEvent.click(dryButton())
    expect((await screen.findByRole('alert')).textContent).toContain('This snapshot was exported at schema `b8e4d17c2a90`')
  })

  it('pre-selects a stored snapshot named in the URL and strips the param', async () => {
    mount(`/settings?restore=${encodeURIComponent(STORED.name)}#restore`)
    await waitFor(() => expect(select().value).toBe(STORED.name))
    expect(dryButton().disabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/settings/RestoreCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the card**

```tsx
// src/components/settings/RestoreCard.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchSnapshots, restoreStored, restoreUpload } from '../../api/lifecycle'
import type { RestoreReport, SnapshotEntry } from '../../types/api'
import { formatBytes, formatDate, formatDateTime } from '../../utils/format'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import { useToast } from '../ToastProvider'
import { useArrivalValue } from '../useArrivalParam'
import RestoreReportView from './RestoreReportView'
import '../panels.css'
import './settings.css'

// What is being restored: a file the user picked, or a stored nightly by name. Exactly one.
type Source = { kind: 'file'; file: File } | { kind: 'stored'; name: string }

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Restore (2026-09-03 data-lifecycle spec §7): file picker or a stored snapshot, Dry run into
 * the shared report view, then Restore — armed ONLY by a clean dry run of the current
 * selection (compatible schema, no errors) plus the snapshot's date typed out (the month-
 * delete arm pattern). The server's sentences (400/409/422/500) render verbatim; success
 * toasts and the applied report names the restore point.
 */
export default function RestoreCard() {
  const [stored, setStored] = useState<SnapshotEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [report, setReport] = useState<RestoreReport | null>(null)
  const [busy, setBusy] = useState<'dry' | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [armText, setArmText] = useState('')
  const seqRef = useRef(0)
  const toast = useToast()

  const load = () => {
    const seq = ++seqRef.current
    fetchSnapshots()
      .then((list) => {
        if (seq !== seqRef.current) return
        setStored(list)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setLoadError(message(err, 'Could not load stored snapshots.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only (house idiom)
  }, [])

  // A report describes exactly ONE source. Any change of selection drops it and the arm.
  const pick = (next: Source | null) => {
    setSource(next)
    setReport(null)
    setError(null)
    setArmText('')
  }

  // ?restore=<name> from the Backups card's Restore… link: pre-select once the list has
  // landed (returning false keeps the param until it has), then the hook strips the param.
  useArrivalValue(
    'restore',
    useCallback(
      (name: string) => {
        if (stored === null) return false
        if (stored.some((entry) => entry.name === name && entry.restorable)) pick({ kind: 'stored', name })
        return true
      },
      [stored],
    ),
  )

  const run = (dryRun: boolean) => {
    if (source === null) return
    setBusy(dryRun ? 'dry' : 'apply')
    setError(null)
    const request =
      source.kind === 'file' ? restoreUpload(source.file, dryRun) : restoreStored(source.name, dryRun)
    request
      .then((result) => {
        setReport(result)
        if (result.applied) {
          setArmText('')
          const when = result.exported_at === null ? 'snapshot' : `snapshot from ${formatDate(result.exported_at)}`
          // The /import mutation path already invalidated every page snapshot (client.ts).
          toast.success(`Restored ${when} — other pages reload on their next visit`)
        }
      })
      .catch((err: unknown) => {
        // Verbatim: the router's 400/409/422/500 sentences are the whole explanation.
        setError(message(err, 'Restore failed — is the server reachable?'))
        // A failed APPLY leaves a database nobody has dry-run; the standing report described
        // the one before. A failed dry run wrote nothing and the older report still holds.
        if (!dryRun) setReport(null)
      })
      .finally(() => setBusy(null))
  }

  const snapshotDate = report?.exported_at === null || report === null ? null : report.exported_at.slice(0, 10)
  const canRestore =
    source !== null &&
    report !== null &&
    report.dry_run &&
    report.errors.length === 0 &&
    report.schema.compatible &&
    snapshotDate !== null &&
    armText.trim() === snapshotDate &&
    busy === null

  const restore = () => {
    if (!canRestore || report === null || report.exported_at === null) return
    const ok = window.confirm(
      `Restore the snapshot from ${formatDate(report.exported_at)}? A restore point of the current ` +
        'database is written first (kept with the last three), then every exported table is ' +
        'replaced. Other pages reload on their next visit.',
    )
    if (!ok) return
    run(false)
  }

  const restorable = (stored ?? []).filter((entry) => entry.restorable)

  return (
    <section className="card span-6" id="restore" role="region" aria-label="Restore">
      <h2 className="eyebrow">
        Restore
        <InfoHint text="Replaces every exported table from a snapshot ZIP — one this app wrote, at this server's schema. Dry run shows what would change and writes nothing. Restore first writes a pre-restore point, so the step back is one more restore. Your login, the operational trails and this server's backup markers are never touched." />
      </h2>
      <div className="restore-source">
        <label>
          Snapshot file (.zip)
          <input
            className="field-input"
            type="file"
            accept=".zip"
            aria-label="Snapshot file (.zip)"
            disabled={busy !== null}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              pick(file === null ? null : { kind: 'file', file })
            }}
          />
        </label>
        <label>
          Stored snapshot
          <select
            className="field-input"
            aria-label="Stored snapshot"
            disabled={busy !== null}
            value={source?.kind === 'stored' ? source.name : ''}
            onChange={(e) => pick(e.target.value === '' ? null : { kind: 'stored', name: e.target.value })}
          >
            <option value="">Choose a stored snapshot…</option>
            {restorable.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {formatDateTime(entry.at)} · {formatBytes(entry.size_bytes)} · {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FeedBanner error={loadError} retry={load} retryLabel="Retry loading stored snapshots" />
      <div className="settings-card-actions">
        <button type="button" className="button" disabled={source === null || busy !== null} onClick={() => run(true)}>
          {busy === 'dry' ? 'Dry run…' : 'Dry run'}
        </button>
      </div>
      <FeedBanner error={error} />
      {report !== null && <RestoreReportView report={report} />}
      {armable ? (
        <div className="restore-arm">
          <label>
            Type the snapshot&apos;s date (YYYY-MM-DD) to confirm
            <input
              className="field-input"
              type="text"
              aria-label="Type the snapshot's date (YYYY-MM-DD) to confirm"
              value={armText}
              placeholder={snapshotDate ?? undefined}
              disabled={busy !== null}
              onChange={(e) => setArmText(e.target.value)}
            />
          </label>
          <button type="button" className="button danger-button" disabled={!canRestore} onClick={restore}>
            {busy === 'apply' ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      ) : (
        // Always present, so the state is legible: a disabled Restore says "dry-run first".
        <div className="restore-arm">
          <button type="button" className="button danger-button" disabled>
            Restore
          </button>
        </div>
      )}
    </section>
  )
}
```

where `armable` is computed beside `canRestore`:

```ts
  // The arm input appears only after a CLEAN dry run of the current selection.
  const armable =
    report !== null &&
    report.dry_run &&
    report.errors.length === 0 &&
    report.schema.compatible &&
    snapshotDate !== null
```

(`.danger-button` is the wizard's class in `MonthlyUpdatePage.css`; add the same rule to `settings.css` so the card is self-sufficient:

```css
.settings-page .danger-button:not(:disabled) {
  border-color: var(--negative);
  color: var(--negative);
}
```
)

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/settings/RestoreCard.test.tsx`
Expected: PASS (7 tests). If `useArrivalValue`'s pre-select test times out, confirm the callback returns `false` while `stored === null` and `true` otherwise — the hook re-runs when the callback identity changes with `stored`.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/RestoreCard.tsx src/components/settings/RestoreCard.test.tsx src/components/settings/settings.css
git commit -m "feat(settings): Restore card — file or stored snapshot, dry run, typed-date arm, confirm, verbatim errors"
```

---

### Task 4: Overview nag — "and last night's was not verified"

**Files:**
- Modify: `src/components/overview/attention.ts`, `src/components/overview/attention.test.ts`

- [ ] **Step 1: Update and extend the tests**

In `src/components/overview/attention.test.ts`, inside `describe('attentionItems — the nightly backup (prod only)')`: change `expect(item.to).toBe('/settings')` to `expect(item.to).toBe('/settings#backups')` and append:

```ts
  // The verify phase (2026-09-03 data-lifecycle spec §8): a dump that uploaded but did not
  // restore is worth a line even when it is fresh.
  it('appends the verify verdict to a stale nag, and nags alone when fresh but unverified', () => {
    const stale = { ...backupOut('2026-08-15T23:00:00Z'), verified: false, verify_error: 'createdb failed' }
    const [item] = attentionItems(prod(stale), TODAY)
    expect(item.key).toBe('backup-stale')
    expect(item.text).toBe("Nightly backup hasn't run recently and last night's was not verified")
    const fresh = { ...backupOut('2026-08-17T09:00:00Z'), verified: false, verify_error: 'createdb failed' }
    const [only] = attentionItems(prod(fresh), TODAY)
    expect(only.key).toBe('backup-unverified')
    expect(only.text).toBe("Last night's backup was not verified")
    expect(only.to).toBe('/settings#backups')
    // Verified, fresh: nothing. Unknown (an older marker): nothing either — absence is not failure.
    expect(keys(prod({ ...backupOut('2026-08-17T09:00:00Z'), verified: true }))).toEqual([])
    expect(keys(prod(backupOut('2026-08-17T09:00:00Z')))).toEqual([])
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/overview/attention.test.ts`
Expected: FAIL — `to` is `/settings`, no `backup-unverified` item.

- [ ] **Step 3: Implement**

Replace the backup block in `src/components/overview/attention.ts`:

```ts
  // Nightly backup — PROD only (spec §3): dev boxes never back up and must not nag.
  // "Missing or older than 48h" shares backupAge with the Settings card's amber tone,
  // evaluated at today's midnight UTC exactly as prices-stale above. The verify phase
  // (2026-09-03 data-lifecycle spec §8) adds its verdict: a stale nag says both; a fresh
  // dump that did not restore gets its own line. `verified` absent = an older marker, silent.
  if (data.system.environment === 'prod') {
    const { backup } = data.system
    const stale =
      backup === null ||
      backupAge(backup.last_success_at, new Date(`${todayIso}T00:00:00Z`)) !== 'fresh'
    const unverified = backup !== null && backup.verified === false
    if (stale) {
      items.push({
        key: 'backup-stale',
        text: `Nightly backup hasn't run recently${unverified ? " and last night's was not verified" : ''}`,
        to: '/settings#backups',
      })
    } else if (unverified) {
      items.push({
        key: 'backup-unverified',
        text: "Last night's backup was not verified",
        to: '/settings#backups',
      })
    }
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/overview src/pages/OverviewPage.test.tsx`
Expected: PASS (if an Overview page test pinned `to: '/settings'` for the nag, update it to `/settings#backups`).

- [ ] **Step 5: Commit**

```bash
git add src/components/overview/attention.ts src/components/overview/attention.test.ts
git commit -m "feat(overview): backup nag carries the verify verdict and points at #backups"
```

---

### Task 5: Palette sections and the Settings page mounts

**Files:**
- Modify: `src/components/paletteRegistry.ts`, `src/components/paletteRegistry.test.ts`, `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append inside `describe('paletteRegistry')` in `src/components/paletteRegistry.test.ts`:

```ts
  it('anchors the four data-lifecycle cards (2026-09-03 spec §3)', () => {
    for (const [query, id] of [
      ['snapshot now', 'backups'],
      ['roll back', 'restore'],
      ['undo', 'activity'],
      ['stale quotes', 'health'],
    ] as const) {
      expect(matchEntries(query, entries).some((e) => e.to === `/settings#${id}`), query).toBe(true)
    }
  })
```

Append to `src/pages/SettingsPage.test.tsx`: a mock for the lifecycle fetchers beside the other `vi.mock` blocks —

```ts
// The Backups and Restore cards (2026-09-03 data-lifecycle spec §7–§8) each own a fetch of
// the stored snapshots; unmocked they would hit the network from every test in this file.
vi.mock('../api/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/lifecycle')>()),
  fetchSnapshots: vi.fn(),
  createSnapshot: vi.fn(),
  restoreUpload: vi.fn(),
  restoreStored: vi.fn(),
}))
import { fetchSnapshots } from '../api/lifecycle'
```

with `vi.mocked(fetchSnapshots).mockResolvedValue([])` in `beforeEach`, and a new describe:

```ts
describe('SettingsPage — backups and restore cards', () => {
  it('mounts Backups & snapshots then Restore directly after the System card', async () => {
    render(<SettingsPage />)  // or the file's router-wrapped render helper
    const backups = await screen.findByRole('region', { name: 'Backups & snapshots' })
    const restore = screen.getByRole('region', { name: 'Restore' })
    const system = screen.getByRole('heading', { name: /^System/ }).closest('section')
    expect(system?.nextElementSibling).toBe(backups)
    expect(backups.nextElementSibling).toBe(restore)
    await waitFor(() => expect(vi.mocked(fetchSnapshots)).toHaveBeenCalledTimes(2))
  })

  it('offers neither card when the settings load failed', async () => {
    vi.mocked(fetchAppSettings).mockRejectedValue(new ApiError('settings unavailable', 503))
    render(<SettingsPage />)
    expect(await screen.findByText('settings unavailable')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Restore' })).toBeNull()
    expect(vi.mocked(fetchSnapshots)).not.toHaveBeenCalled()
  })
})
```

(Use whatever render helper the file already uses for the router-wrapped page — the hash-highlight tests render inside a `MemoryRouter`; follow them.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/paletteRegistry.test.ts src/pages/SettingsPage.test.tsx`
Expected: FAIL — no `#backups` entry; no region named "Backups & snapshots".

- [ ] **Step 3: Implement**

In `src/components/paletteRegistry.ts`, append to `SETTINGS_SECTIONS` after the `appearance` entry (and update the doc comment above the array to drop the sentence about `appearance` not being in this branch — it is):

```ts
  // Data lifecycle (2026-09-03 spec §3): the four cards land as anchored sections too.
  {
    id: 'backups',
    label: 'Backups & snapshots',
    keywords: ['snapshot now', 'nightly', 'download', 'verified', 'dump', 'volume'],
  },
  {
    id: 'restore',
    label: 'Restore a snapshot',
    keywords: ['dry run', 'roll back', 'undo everything', 'zip', 'restore point'],
  },
  {
    id: 'activity',
    label: 'Activity',
    keywords: ['undo', 'change log', 'history', 'who changed', 'report', 'runs'],
  },
  {
    id: 'health',
    label: 'Data health',
    keywords: ['checks', 'zero month', 'stale quotes', 'coverage', 'repair', 'phantom'],
  },
```

In `src/pages/SettingsPage.tsx`: add `import BackupsCard from '../components/settings/BackupsCard'` and `import RestoreCard from '../components/settings/RestoreCard'` (alphabetical among the card imports), and directly after `<SystemCard />` add:

```tsx
          {/* Backups & snapshots, then Restore (2026-09-03 data-lifecycle spec §7–§8): the
              stored nightly files beside the marker that describes the host's dump, and the
              way back from either. Own fetches, the page's loadedOnce gate. */}
          <BackupsCard />
          <RestoreCard />
```

- [ ] **Step 4: Run the tests, type-check, lint**

Run: `npx vitest run src/components/paletteRegistry.test.ts src/components/CommandPalette.test.tsx src/pages/SettingsPage.test.tsx && npx tsc -b && npx eslint src/components/settings src/components/overview src/components/paletteRegistry.ts src/pages/SettingsPage.tsx`
Expected: all green, clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/paletteRegistry.ts src/components/paletteRegistry.test.ts src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "feat(settings): mount Backups and Restore cards; palette anchors for the four lifecycle sections"
```

---

### Task 6: Whole frontend suite

- [ ] **Step 1:** `npx tsc -b && npx eslint . && npx vitest run` → clean, all green.

---

## Merge notes for the coordinator

- `src/pages/SettingsPage.tsx` / `.test.tsx`: F2 inserts `<HealthCard />` and `<ActivityCard />` immediately BEFORE the `id="app-settings"` section; this lane inserts its two immediately AFTER `<SystemCard />`. The lines are adjacent, so expect a conflict; the intended final order is System → Backups → Restore → Health → Activity → App settings. Both lanes add a `vi.mock('../api/lifecycle', …)` block to the test — keep ONE block with the union of the mocked names (`fetchSnapshots, createSnapshot, restoreUpload, restoreStored, fetchActivity, fetchActivityRun, undoBatch, fetchHealth`). If shell Plan 3 has migrated the page to `PageFrame` by then, mount the cards inside its children the same way.
- `src/components/paletteRegistry.ts`: only this lane edits it (all four sections). F2 does not.
- `src/components/settings/settings.css`: both lanes append rule blocks — keep both.
- `src/api/client.ts`, `src/types/api.ts`: untouched here (Phase 0 owns them).
- Browser smoke for Phase 2: Backups → Snapshot now → the entry appears; Restore… → the select is pre-filled and `?restore=` is gone from the URL; Dry run on the dev database's own snapshot → "35 tables unchanged"; type the date → Restore → toast, restore point named.

## Self-review

**Spec coverage:** §8 UI — System card backup row "· 108 KB · encrypted · verified" / "· not verified — {verify_error}" in the overdue tone, colour never alone → Task 1; Backups & snapshots card (`id="backups"`) with the nightly list (size, age), Restore… pre-selecting the file in the Restore card, Snapshot now, Download snapshot moved here → Task 2; `attention.ts` appends "and last night's was not verified", dev never nags → Task 4. §7 UI — Restore card (`id="restore"`) with picker or stored select fed by `GET /system/snapshots`, Dry run → `RestoreReportView` (differing first, identical folded, warnings, schema line — Phase 0), Restore armed only from a clean dry run of the current selection plus the typed date, confirm sentence about the restore point, success toast "Restored snapshot from Sep 2 — other pages reload on their next visit", errors via `FeedBanner` verbatim → Task 3; palette sections `backups`, `restore`, `activity`, `health` → Task 5; §13 vitest: RestoreCard arm/disarm and report folding (folding is Phase 0's test), BackupsCard list and Snapshot now, SystemCard verified/unverified wording → Tasks 1–3. **Placeholders:** none — the one "follow the file's render helper" note in Task 5 points at code that exists in the test file today. **Type consistency:** `SnapshotEntry`, `RestoreReport` (Phase 0), `fetchSnapshots/createSnapshot/restoreUpload(file, dryRun)/restoreStored(name, dryRun)` (Phase 0's `api/lifecycle.ts`), `downloadSnapshot` (existing `api/system.ts`), `RestoreReportView({ report })`, `FeedBanner({ error, retry, retryLabel })`, `useArrivalValue(key, apply)` returning `false` for "not yet", `formatDate/formatDateTime/formatBytes` — all existing names used as they are defined.
