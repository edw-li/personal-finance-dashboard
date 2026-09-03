# AI Assistant — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `✦` assistant drawer (streaming chat grounded in page context), the Settings "Assistant" card, and their plumbing — everything under `src/`, per spec `docs/superpowers/specs/2026-09-01-ai-assistant-design.md` §9–§10.

**Architecture:** All NVIDIA traffic goes through the backend; this lane only speaks the spec's `/api/v1/assistant/*` contract (pinned below) and can be built and tested entirely against mocks — the backend lane runs in parallel. New code lives in `src/components/assistant/` plus three `src/api/` modules; existing files get only additive edits (Layout mount, palette entry, logout clearing, three page-view publishers, Settings card mount).

**Tech Stack:** React 19 + TypeScript, vitest + @testing-library/react (jsdom), hand-rolled SSE reader and markdown renderer — **zero new npm dependencies** (the CommandPalette culture). Node 18 on this box runs the existing suite; use the same commands it uses.

**Verify commands (run from repo root):** `npx vitest run <file>` per task; lane finale runs `npm test`, `npx tsc -b`, `npm run lint`.

**Commit convention:** small commits per task on the lane branch, message style `feat(assistant): …` / `test(assistant): …`.

---

## Pinned API contract (the backend lane implements the same table — do not drift)

- `GET /api/v1/assistant/settings` → `{key: {configured: boolean, source: 'env'|'override'|null}, default_model: string}`
- `PUT /api/v1/assistant/settings` body `{api_key?: string|null, default_model?: string}` → same shape as GET. Tri-state `api_key`: absent = unchanged, `null` = clear override, string = set.
- `GET /api/v1/assistant/models[?probe=1]` → `{configured: boolean, key_source: 'env'|'override'|null, key_ok: boolean|null, checked_at: string|null, models: [{key, label, available, supports_tools, default, catalog_id: string|null}]}` — `key_ok`: `true` = NVIDIA's models endpoint answered 200, `false` = it rejected the key or was unreachable, `null` = no key configured (never probed).
- `POST /api/v1/assistant/context-preview` body `{context}` → `{sections: [{name: string, rows: number}]}` — **POST-for-read** (what-if precedent), must NOT invalidate snapshots.
- `POST /api/v1/assistant/chat` body `{model: string, context: {route: string, search: Record<string,string>, view: Record<string,string|number|null>}, messages: [{role: 'user'|'assistant', content: string}]}` → `text/event-stream`.
- SSE frames: `event: <name>\ndata: <json>\n\n`; comment keepalives `: ping\n\n`. Events: `status {text}` (progress narration: reading the page, asking/retrying a model, still waiting), `thinking {text}` (reasoning delta, display-only), `notice {kind:'failover', from, to}`, `tool_start {name, summary}`, `tool_result {name, summary, link?: {to, label}}` (the sandbox seam, 2026-09-03 planning-sandboxes spec 12: present only when the tool answered with a sandbox_url; the drawer renders it as an internal link for NAV paths only), `token {text}`, `done {model_used}` (terminal), `error {kind: 'bad_key'|'rate_limited'|'unavailable'|'bad_request'|'internal', message, retry_after?}` (terminal).
- Registry keys (dropdown order): `kimi-k3` (default), `deepseek-v4-pro-0813`, `nemotron-3-ultra-550b`, `nemotron-3.5-lightning`; labels `Kimi K3`, `DeepSeek V4 Pro`, `Nemotron 3 Ultra 550B`, `Nemotron 3.5 Lightning`.

## File structure

```
src/api/assistant.ts              typed fetchers (settings/models/preview)
src/api/assistant.test.ts
src/api/assistantSession.ts       sessionStorage keys + read/write/clear (no React)
src/api/assistantSession.test.ts
src/api/assistantStream.ts        SSE frame parser + streamChat (fetch + ReadableStream)
src/api/assistantStream.test.ts
src/api/client.ts                 MODIFY: export apiReadOnly (POST-for-read, no invalidation)
src/api/client.test.ts            MODIFY: apiReadOnly tests
src/components/assistant/markdown.tsx        sanitizing renderer → React nodes
src/components/assistant/markdown.test.tsx
src/components/assistant/viewState.ts        useAssistantView + open-event bus
src/components/assistant/viewState.test.tsx
src/components/assistant/samples.ts          insight presets + per-route samples
src/components/assistant/samples.test.ts
src/components/assistant/AssistantDrawer.tsx launcher button + drawer (the feature)
src/components/assistant/AssistantDrawer.test.tsx
src/components/assistant/assistant.css
src/components/settings/AssistantCard.tsx    Settings card
src/components/settings/AssistantCard.test.tsx
src/components/Layout.tsx         MODIFY: mount <AssistantDrawer />
src/components/CommandPalette.tsx MODIFY: "Ask assistant" action
src/contexts/AuthContext.tsx      MODIFY: clearAssistantSession() on logout
src/pages/SettingsPage.tsx        MODIFY: mount <AssistantCard />
src/pages/TaxesPage.tsx           MODIFY: one useAssistantView call
src/pages/NetWorthPage.tsx        MODIFY: one useAssistantView call
src/pages/PortfolioPage.tsx       MODIFY: one useAssistantView call
src/types/api.ts                  MODIFY: assistant types
```

---

### Task F1: Types, session store, fetchers, and `apiReadOnly`

**Files:**
- Modify: `src/types/api.ts` (append at end of file)
- Create: `src/api/assistantSession.ts`, `src/api/assistantSession.test.ts`
- Modify: `src/api/client.ts` (one added export), `src/api/client.test.ts`
- Create: `src/api/assistant.ts`, `src/api/assistant.test.ts`

- [ ] **Step 1: Append the assistant types to `src/types/api.ts`**

```ts
// ── Assistant (2026-09-01 spec §3–§5) ────────────────────────────────────────────────

export interface AssistantKeyStatus {
  configured: boolean
  source: 'env' | 'override' | null
}

export interface AssistantSettingsOut {
  key: AssistantKeyStatus
  default_model: string
}

/** Tri-state api_key (the wizard's net-pay rider): absent = unchanged, null = clear
 *  the override, string = set. */
export interface AssistantSettingsUpdate {
  api_key?: string | null
  default_model?: string
}

export interface AssistantModelOut {
  key: string
  label: string
  available: boolean
  supports_tools: boolean
  default: boolean
}

export interface AssistantModelsOut {
  configured: boolean
  key_source: 'env' | 'override' | null
  /** true = the catalog answered; false = key rejected/unreachable; null = no key. */
  key_ok: boolean | null
  checked_at: string | null
  models: AssistantModelOut[]
}

/** What the drawer snapshots at send time: the route, its URL params, and whatever the
 *  page published through useAssistantView. */
export interface AssistantContextIn {
  route: string
  search: Record<string, string>
  view: Record<string, string | number | null>
}

export interface AssistantPreviewSection {
  name: string
  rows: number
}

export interface AssistantPreviewOut {
  sections: AssistantPreviewSection[]
}
```

- [ ] **Step 2: Write the failing tests for the session store** — `src/api/assistantSession.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearAssistantSession,
  readAssistantModel,
  readAssistantTranscript,
  TRANSCRIPT_CAP,
  writeAssistantModel,
  writeAssistantTranscript,
} from './assistantSession'
import type { TranscriptItem } from './assistantSession'

function item(content: string): TranscriptItem {
  return { role: 'user', content }
}

afterEach(() => sessionStorage.clear())

describe('assistantSession', () => {
  it('round-trips the transcript and model', () => {
    writeAssistantTranscript([item('hello')])
    writeAssistantModel('kimi-k3')
    expect(readAssistantTranscript()).toEqual([item('hello')])
    expect(readAssistantModel()).toBe('kimi-k3')
  })

  it('caps the stored transcript, dropping oldest', () => {
    const many = Array.from({ length: TRANSCRIPT_CAP + 5 }, (_, i) => item(String(i)))
    writeAssistantTranscript(many)
    const stored = readAssistantTranscript()
    expect(stored).toHaveLength(TRANSCRIPT_CAP)
    expect(stored[0].content).toBe('5') // the five oldest fell off
  })

  it('reads empty on corrupt JSON instead of throwing', () => {
    sessionStorage.setItem('assistant:transcript', '{nope')
    expect(readAssistantTranscript()).toEqual([])
  })

  it('clearAssistantSession removes both keys', () => {
    writeAssistantTranscript([item('x')])
    writeAssistantModel('kimi-k3')
    clearAssistantSession()
    expect(sessionStorage.getItem('assistant:transcript')).toBeNull()
    expect(sessionStorage.getItem('assistant:model')).toBeNull()
  })
})
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run src/api/assistantSession.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 4: Create `src/api/assistantSession.ts`**

```ts
// Assistant session state (spec §9): sessionStorage like the wizard drafts — "this
// sitting", never localStorage. No React in here: client.ts (the 401 path) and
// AuthContext (logout) both import clearAssistantSession, and neither may pull a
// component tree in.

export interface TranscriptTool {
  name: string
  summary: string
  done: boolean
}

export interface TranscriptError {
  kind: string
  message: string
  retryModel?: string
}

export interface TranscriptItem {
  role: 'user' | 'assistant'
  content: string
  /** Which model actually answered (done.model_used). */
  model?: string
  /** Failover line ("answered by X — Y was unavailable"). */
  notice?: string
  tools?: TranscriptTool[]
  error?: TranscriptError
  stopped?: boolean
  /** "Spending · Dec 2025" — what the question was asked against. */
  contextLabel?: string
}

const TRANSCRIPT_KEY = 'assistant:transcript'
const MODEL_KEY = 'assistant:model'

/** Bounds sessionStorage; the server caps messages per request separately (last 20). */
export const TRANSCRIPT_CAP = 40

export function readAssistantTranscript(): TranscriptItem[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(TRANSCRIPT_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as TranscriptItem[]) : []
  } catch {
    return [] // corrupt entry: drop, never throw (the wizard-draft posture)
  }
}

export function writeAssistantTranscript(items: TranscriptItem[]): void {
  try {
    sessionStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(items.slice(-TRANSCRIPT_CAP)))
  } catch {
    // Storage full or blocked — losing persistence is acceptable (Layout's scroll map).
  }
}

export function readAssistantModel(): string | null {
  return sessionStorage.getItem(MODEL_KEY)
}

export function writeAssistantModel(key: string): void {
  try {
    sessionStorage.setItem(MODEL_KEY, key)
  } catch {
    // Same posture as the transcript write.
  }
}

export function clearAssistantSession(): void {
  sessionStorage.removeItem(TRANSCRIPT_KEY)
  sessionStorage.removeItem(MODEL_KEY)
}
```

- [ ] **Step 5: Run to verify pass** — `npx vitest run src/api/assistantSession.test.ts` — Expected: PASS.

- [ ] **Step 6: Write the failing test for `apiReadOnly`** — append to `src/api/client.test.ts` (keep existing tests untouched; follow that file's existing fetch-mocking pattern — read the file first and reuse its helpers if it has them):

```ts
import { apiReadOnly } from './client'
import { getSnapshot, setSnapshot } from './snapshotCache'

it('apiReadOnly POSTs without wiping the snapshot cache', async () => {
  setSnapshot('probe', { kept: true })
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const result = await apiReadOnly<{ ok: boolean }>('/assistant/context-preview', { context: {} })
  expect(result.ok).toBe(true)
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/v1/assistant/context-preview',
    expect.objectContaining({ method: 'POST' }),
  )
  // The whole point: a compute-read must not cost every page its instant paint.
  expect(getSnapshot('probe')).toEqual({ kept: true })
  vi.unstubAllGlobals()
})
```

- [ ] **Step 7: Run to verify failure** — `npx vitest run src/api/client.test.ts` — Expected: FAIL (`apiReadOnly` not exported).

- [ ] **Step 8: Add `apiReadOnly` to `src/api/client.ts`** (below `api()`, above `request()`):

```ts
// POST-for-read endpoints (the what-if family: assistant chat context-preview). The
// server computes and never writes, so api()'s coarse non-GET invalidation must not
// fire — the assistant preview runs on every drawer open and would wipe every page's
// instant paint. Anything that CAN write must keep going through api().
export async function apiReadOnly<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
}
```

- [ ] **Step 9: Run to verify pass** — `npx vitest run src/api/client.test.ts` — Expected: PASS (all, including pre-existing).

- [ ] **Step 10: Write the failing fetcher tests** — `src/api/assistant.test.ts` (mirror the house api-module test style — see `src/api/household.test.ts` for the mocking idiom used against `./client`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.fn()
const apiReadOnly = vi.fn()
vi.mock('./client', () => ({
  api: (...args: unknown[]) => api(...args),
  apiReadOnly: (...args: unknown[]) => apiReadOnly(...args),
}))

import {
  fetchAssistantModels,
  fetchAssistantSettings,
  fetchContextPreview,
  putAssistantSettings,
} from './assistant'

beforeEach(() => {
  api.mockReset()
  apiReadOnly.mockReset()
})

describe('assistant api', () => {
  it('fetchAssistantSettings GETs /assistant/settings', async () => {
    api.mockResolvedValue({ key: { configured: false, source: null }, default_model: 'kimi-k3' })
    await fetchAssistantSettings()
    expect(api).toHaveBeenCalledWith('/assistant/settings')
  })

  it('putAssistantSettings serializes the tri-state body verbatim', async () => {
    api.mockResolvedValue({})
    await putAssistantSettings({ api_key: null })
    expect(api).toHaveBeenCalledWith('/assistant/settings', {
      method: 'PUT',
      body: JSON.stringify({ api_key: null }),
    })
  })

  it('fetchAssistantModels adds ?probe=1 only when probing', async () => {
    api.mockResolvedValue({})
    await fetchAssistantModels()
    expect(api).toHaveBeenLastCalledWith('/assistant/models')
    await fetchAssistantModels(true)
    expect(api).toHaveBeenLastCalledWith('/assistant/models?probe=1')
  })

  it('fetchContextPreview rides apiReadOnly', async () => {
    apiReadOnly.mockResolvedValue({ sections: [] })
    const context = { route: '/spending', search: {}, view: {} }
    await fetchContextPreview(context)
    expect(apiReadOnly).toHaveBeenCalledWith('/assistant/context-preview', { context })
  })
})
```

- [ ] **Step 11: Run to verify failure, then create `src/api/assistant.ts`**

```ts
import { api, apiReadOnly } from './client'
import type {
  AssistantContextIn,
  AssistantModelsOut,
  AssistantPreviewOut,
  AssistantSettingsOut,
  AssistantSettingsUpdate,
} from '../types/api'

export function fetchAssistantSettings(): Promise<AssistantSettingsOut> {
  return api<AssistantSettingsOut>('/assistant/settings')
}

export function putAssistantSettings(body: AssistantSettingsUpdate): Promise<AssistantSettingsOut> {
  return api<AssistantSettingsOut>('/assistant/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function fetchAssistantModels(probe = false): Promise<AssistantModelsOut> {
  return api<AssistantModelsOut>(`/assistant/models${probe ? '?probe=1' : ''}`)
}

export function fetchContextPreview(context: AssistantContextIn): Promise<AssistantPreviewOut> {
  return apiReadOnly<AssistantPreviewOut>('/assistant/context-preview', { context })
}
```

- [ ] **Step 12: Run to verify pass** — `npx vitest run src/api/assistant.test.ts src/api/assistantSession.test.ts src/api/client.test.ts` — Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/types/api.ts src/api/assistantSession.ts src/api/assistantSession.test.ts src/api/client.ts src/api/client.test.ts src/api/assistant.ts src/api/assistant.test.ts
git commit -m "feat(assistant): types, session store, fetchers, apiReadOnly"
```

---

### Task F2: Sanitizing markdown renderer

**Files:**
- Create: `src/components/assistant/markdown.tsx`, `src/components/assistant/markdown.test.tsx`

- [ ] **Step 1: Write the failing tests** — `src/components/assistant/markdown.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

function mount(text: string) {
  return render(<div data-testid="md">{renderMarkdown(text)}</div>)
}

describe('renderMarkdown', () => {
  it('renders bold, italic and inline code', () => {
    mount('a **b** *c* `d`')
    expect(screen.getByText('b').tagName).toBe('STRONG')
    expect(screen.getByText('c').tagName).toBe('EM')
    expect(screen.getByText('d').tagName).toBe('CODE')
  })

  it('renders unordered and ordered lists', () => {
    mount('- one\n- two\n\n1. first\n2. second')
    expect(screen.getByText('one').closest('ul')).not.toBeNull()
    expect(screen.getByText('first').closest('ol')).not.toBeNull()
  })

  it('renders pipe tables with header cells', () => {
    mount('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(screen.getByText('a').tagName).toBe('TH')
    expect(screen.getByText('2').tagName).toBe('TD')
  })

  it('renders fenced code blocks verbatim', () => {
    mount('```\nconst x = 1\n```')
    expect(screen.getByText('const x = 1').closest('pre')).not.toBeNull()
  })

  it('renders headings as styled strongs, not h-tags (page owns the outline)', () => {
    mount('## Totals')
    const node = screen.getByText('Totals')
    expect(node.tagName).toBe('STRONG')
    expect(node.className).toBe('md-heading')
  })

  it('never injects HTML — tags arrive as literal text', () => {
    mount('<script>alert(1)</script> and <b>bold?</b>')
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByTestId('md').textContent).toContain('<script>alert(1)</script>')
  })

  it('renders markdown links as plain text (no model-driven navigation)', () => {
    mount('[click me](https://example.com)')
    expect(document.querySelector('a')).toBeNull()
    expect(screen.getByTestId('md').textContent).toContain('click me (https://example.com)')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/assistant/markdown.test.tsx` — Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/components/assistant/markdown.tsx`**

```tsx
// Hand-rolled, sanitizing-by-construction markdown → React nodes (spec §9): every piece
// of text flows through React children (auto-escaped), and no construct ever becomes an
// <a>, <img>, or raw HTML. Supported: paragraphs, #-headings (rendered as styled
// <strong> — the page owns the heading outline), -/* and 1. lists, pipe tables, fenced
// code, and inline `code` / **bold** / *italic*. Links render as "label (url)" text.
import type { ReactNode } from 'react'

const INLINE_TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g

export function renderInline(text: string): ReactNode[] {
  const parts = text.split(INLINE_TOKEN)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    // Plain text on purpose: the model must not mint navigation (spec §13).
    if (link) return <span key={i}>{`${link[1]} (${link[2]})`}</span>
    return <span key={i}>{part}</span>
  })
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')
}

function tableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

export function renderMarkdown(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i += 1
      continue
    }
    // Fenced code: swallow to the closing fence (or EOF — stream-in-progress armor).
    if (line.trimStart().startsWith('```')) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // the closing fence, when present
      out.push(
        <pre key={key++}>
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      out.push(
        <p key={key++} className="md-heading-row">
          <strong className="md-heading">{renderInline(heading[2])}</strong>
        </p>,
      )
      i += 1
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>)
        i += 1
      }
      out.push(<ul key={key++}>{items}</ul>)
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(
          <li key={items.length}>{renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>,
        )
        i += 1
      }
      out.push(<ol key={key++}>{items}</ol>)
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = tableCells(line)
      i += 2 // header + divider
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(tableCells(lines[i]))
        i += 1
      }
      out.push(
        <table key={key++} className="md-table">
          <thead>
            <tr>
              {header.map((cell, c) => (
                <th key={c}>{renderInline(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>{renderInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      )
      continue
    }
    // Paragraph: greedy to the next blank/structural line.
    const para: string[] = [line]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !lines[i].trimStart().startsWith('```') &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1]))
    ) {
      para.push(lines[i])
      i += 1
    }
    out.push(<p key={key++}>{renderInline(para.join(' '))}</p>)
  }
  return out
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/components/assistant/markdown.test.tsx` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/assistant/markdown.tsx src/components/assistant/markdown.test.tsx
git commit -m "feat(assistant): sanitizing markdown renderer"
```

---

### Task F3: SSE parser + `streamChat`

**Files:**
- Create: `src/api/assistantStream.ts`, `src/api/assistantStream.test.ts`

- [ ] **Step 1: Write the failing tests** — `src/api/assistantStream.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractFrames, streamChat } from './assistantStream'
import type { AssistantHandlers } from './assistantStream'

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

function handlers(): AssistantHandlers & { tokens: string[]; errors: unknown[]; dones: unknown[] } {
  const tokens: string[] = []
  const errors: unknown[] = []
  const dones: unknown[] = []
  return {
    tokens,
    errors,
    dones,
    onToken: (text) => tokens.push(text),
    onDone: (d) => dones.push(d),
    onError: (e) => errors.push(e),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('extractFrames', () => {
  it('splits complete frames and keeps the remainder', () => {
    const { frames, rest } = extractFrames(
      'event: token\ndata: {"text":"a"}\n\nevent: tok',
    )
    expect(frames).toEqual([{ event: 'token', data: '{"text":"a"}' }])
    expect(rest).toBe('event: tok')
  })

  it('drops keepalive comments without producing frames', () => {
    const { frames, rest } = extractFrames(': ping\n\n')
    expect(frames).toEqual([])
    expect(rest).toBe('')
  })
})

describe('streamChat', () => {
  const body = { model: 'kimi-k3', context: { route: '/', search: {}, view: {} }, messages: [] }

  it('dispatches tokens then done', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: token\ndata: {"text":"Hel"}\n\n',
          ': ping\n\nevent: token\ndata: {"text":"lo"}\n\n',
          'event: done\ndata: {"model_used":"kimi-k3"}\n\n',
        ]),
      ),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.tokens.join('')).toBe('Hello')
    expect(h.dones).toEqual([{ model_used: 'kimi-k3' }])
    expect(h.errors).toEqual([])
  })

  it('surfaces server error events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(['event: error\ndata: {"kind":"bad_key","message":"nope"}\n\n']),
      ),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.errors).toEqual([{ kind: 'bad_key', message: 'nope' }])
  })

  it('reports an interrupted stream that ended without a terminal event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(['event: token\ndata: {"text":"par"}\n\n'])),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.tokens.join('')).toBe('par')
    expect(h.errors).toEqual([
      { kind: 'interrupted', message: 'The stream ended unexpectedly.' },
    ])
  })

  it('maps a non-OK JSON response to an error handler call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: 'too many' }), { status: 429 })),
    )
    const h = handlers()
    await streamChat(body, h).finished
    expect(h.errors).toEqual([{ kind: 'rate_limited', message: 'too many', retry_after: undefined }])
  })

  it('abort() swallows the AbortError and fires no error handler', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    )
    const h = handlers()
    const handle = streamChat(body, h)
    handle.abort()
    await handle.finished
    expect(h.errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/api/assistantStream.test.ts` — Expected: FAIL.

- [ ] **Step 3: Create `src/api/assistantStream.ts`**

```ts
// The assistant's streaming path (spec §2/§5). fetch + ReadableStream, NOT EventSource:
// EventSource cannot send the Authorization header or a POST body. Deliberately not
// client.ts's api(): that helper is JSON-only with a 15 s timeout — a streamed answer
// legitimately runs longer, and its liveness signal is the keepalive comments.
import { clearSnapshots } from './snapshotCache'
import { clearAssistantSession } from './assistantSession'
import { clearToken, getToken } from './client'
import type { AssistantContextIn } from '../types/api'

export interface ChatMessageIn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  context: AssistantContextIn
  messages: ChatMessageIn[]
}

export interface AssistantErrorEvent {
  kind: string
  message: string
  retry_after?: number
}

export interface AssistantHandlers {
  onNotice?: (notice: { kind: string; from: string; to: string }) => void
  onToolStart?: (tool: { name: string; summary: string }) => void
  onToolResult?: (tool: { name: string; summary: string }) => void
  onToken: (text: string) => void
  onDone: (done: { model_used: string }) => void
  onError: (error: AssistantErrorEvent) => void
}

export interface ChatStreamHandle {
  abort: () => void
  finished: Promise<void>
}

export interface SseFrame {
  event: string
  data: string
}

/** Pure frame splitter: complete `event:`/`data:` blocks out, partial tail back.
 *  Comment lines (keepalives) are dropped; a block with no data yields no frame. */
export function extractFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = []
  let rest = buffer
  for (;;) {
    const cut = rest.indexOf('\n\n')
    if (cut === -1) break
    const block = rest.slice(0, cut)
    rest = rest.slice(cut + 2)
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length > 0) frames.push({ event, data: dataLines.join('\n') })
  }
  return { frames, rest }
}

function statusKind(status: number): string {
  if (status === 401) return 'bad_key' // unreachable in practice — 401 redirects below
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'unavailable'
  return 'bad_request'
}

export function streamChat(body: ChatRequest, handlers: AssistantHandlers): ChatStreamHandle {
  const controller = new AbortController()
  const finished = (async () => {
    const token = getToken()
    let res: Response
    try {
      res = await fetch('/api/v1/assistant/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      handlers.onError({ kind: 'network', message: 'Network error — is the server reachable?' })
      return
    }
    if (res.status === 401) {
      // client.ts's session-expiry contract, replicated for the one path that bypasses it.
      clearToken()
      clearSnapshots()
      clearAssistantSession()
      window.location.assign('/login')
      return
    }
    if (!res.ok || res.body === null) {
      let detail = res.statusText
      let retryAfter: number | undefined
      try {
        const parsed = (await res.json()) as { detail?: unknown; error?: unknown }
        const raw = parsed.detail ?? parsed.error
        if (typeof raw === 'string') detail = raw
      } catch {
        // non-JSON error body
      }
      const header = res.headers.get('Retry-After')
      if (header !== null && Number.isFinite(Number(header))) retryAfter = Number(header)
      handlers.onError({ kind: statusKind(res.status), message: detail, retry_after: retryAfter })
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let sawTerminal = false
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, rest } = extractFrames(buffer)
        buffer = rest
        for (const frame of frames) {
          let payload: unknown
          try {
            payload = JSON.parse(frame.data)
          } catch {
            continue // a malformed frame is dropped, never fatal
          }
          switch (frame.event) {
            case 'notice':
              handlers.onNotice?.(payload as { kind: string; from: string; to: string })
              break
            case 'tool_start':
              handlers.onToolStart?.(payload as { name: string; summary: string })
              break
            case 'tool_result':
              handlers.onToolResult?.(payload as { name: string; summary: string })
              break
            case 'token':
              handlers.onToken((payload as { text: string }).text)
              break
            case 'done':
              sawTerminal = true
              handlers.onDone(payload as { model_used: string })
              break
            case 'error':
              sawTerminal = true
              handlers.onError(payload as AssistantErrorEvent)
              break
          }
        }
      }
      if (!sawTerminal)
        handlers.onError({ kind: 'interrupted', message: 'The stream ended unexpectedly.' })
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        handlers.onError({ kind: 'network', message: 'The stream failed mid-answer.' })
    }
  })()
  return { abort: () => controller.abort(), finished }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/api/assistantStream.test.ts` — Expected: PASS. (If `clearToken` is not currently exported from `client.ts`, it is — see `src/api/client.ts:17`.)

- [ ] **Step 5: Commit**

```bash
git add src/api/assistantStream.ts src/api/assistantStream.test.ts
git commit -m "feat(assistant): SSE frame parser and streamChat client"
```

---

### Task F4: View-state registry (`useAssistantView`) + open-event bus

**Files:**
- Create: `src/components/assistant/viewState.ts`, `src/components/assistant/viewState.test.tsx`

- [ ] **Step 1: Write the failing tests** — `src/components/assistant/viewState.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ASSISTANT_OPEN_EVENT,
  readAssistantView,
  requestAssistantOpen,
  subscribeAssistantView,
  useAssistantView,
} from './viewState'

function Publisher({ year }: { year: number }) {
  useAssistantView({ year })
  return null
}

describe('assistant view state', () => {
  it('publishes on mount, replaces on update, clears on unmount', () => {
    const { rerender, unmount } = render(<Publisher year={2026} />)
    expect(readAssistantView()).toEqual({ year: 2026 })
    rerender(<Publisher year={2024} />)
    expect(readAssistantView()).toEqual({ year: 2024 })
    unmount()
    expect(readAssistantView()).toEqual({})
  })

  it('notifies subscribers on every publish', () => {
    const spy = vi.fn()
    const unsubscribe = subscribeAssistantView(spy)
    const { unmount } = render(<Publisher year={2026} />)
    unmount()
    expect(spy).toHaveBeenCalledTimes(2) // mount + unmount clear
    unsubscribe()
  })

  it('requestAssistantOpen dispatches the window event', () => {
    const spy = vi.fn()
    window.addEventListener(ASSISTANT_OPEN_EVENT, spy)
    requestAssistantOpen()
    expect(spy).toHaveBeenCalledTimes(1)
    window.removeEventListener(ASSISTANT_OPEN_EVENT, spy)
  })
})
```

- [ ] **Step 2: Run to verify failure, then create `src/components/assistant/viewState.ts`**

```ts
// The page → drawer side channel (spec §6): pages whose view state is not in the URL
// (Taxes' selected year, Net worth/Portfolio owner scope) publish it here, and the
// drawer snapshots it at send time so every question is answered against what the user
// is actually looking at. A module singleton, deliberately not React context: client.ts
// has no component tree, and the drawer reads at SEND time, not render time.
import { useEffect, useSyncExternalStore } from 'react'

export type AssistantView = Record<string, string | number | null>

let currentView: AssistantView = {}
let version = 0
const listeners = new Set<() => void>()

export function readAssistantView(): AssistantView {
  return currentView
}

export function subscribeAssistantView(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(view: AssistantView): void {
  currentView = view
  version += 1
  listeners.forEach((listener) => listener())
}

/** One call per page. Serialized dep: a fresh object literal each render must not
 *  republish (the memo-dep idiom the pages already use for people lists). */
export function useAssistantView(view: AssistantView): void {
  const serialized = JSON.stringify(view)
  useEffect(() => {
    publish(JSON.parse(serialized) as AssistantView)
    return () => publish({})
  }, [serialized])
}

/** The drawer's live subscription — version number as the snapshot (cheap equality). */
export function useAssistantViewVersion(): number {
  return useSyncExternalStore(subscribeAssistantView, () => version)
}

// Open-the-drawer bus: the palette (and anything else) asks; the mounted drawer answers.
export const ASSISTANT_OPEN_EVENT = 'assistant:open'

export function requestAssistantOpen(): void {
  window.dispatchEvent(new Event(ASSISTANT_OPEN_EVENT))
}
```

- [ ] **Step 3: Run to verify pass** — `npx vitest run src/components/assistant/viewState.test.tsx` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/assistant/viewState.ts src/components/assistant/viewState.test.tsx
git commit -m "feat(assistant): page view-state registry and open-event bus"
```

---

### Task F5: Sample queries + insight presets

**Files:**
- Create: `src/components/assistant/samples.ts`, `src/components/assistant/samples.test.ts`

- [ ] **Step 1: Write the failing test** — `src/components/assistant/samples.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { INSIGHT_PRESETS, samplesFor } from './samples'

describe('assistant samples', () => {
  it('ships the three insight presets in order', () => {
    expect(INSIGHT_PRESETS.map((p) => p.label)).toEqual([
      'Month in review',
      'What changed in my spending?',
      'Contribution-limit pace',
    ])
  })

  it('returns route samples for a known route and [] for unknown', () => {
    expect(samplesFor('/spending').length).toBeGreaterThan(0)
    expect(samplesFor('/nonexistent')).toEqual([])
  })

  it('every sample and preset carries a non-empty prompt', () => {
    const all = [...INSIGHT_PRESETS, ...samplesFor('/spending'), ...samplesFor('/taxes')]
    for (const item of all) expect(item.prompt.trim().length).toBeGreaterThan(10)
  })
})
```

- [ ] **Step 2: Run to verify failure, then create `src/components/assistant/samples.ts`**

```ts
// Curated prompts (spec §1 "insight quick-actions" + §9 sample chips). Presets show on
// every route; route samples add page-specific starters. All of them run through the
// normal chat pipeline — nothing here is a second code path.

export interface SamplePrompt {
  label: string
  prompt: string
}

export const INSIGHT_PRESETS: SamplePrompt[] = [
  {
    label: 'Month in review',
    prompt:
      'Give me a month-in-review of my latest fully entered month: total spend vs my 12-month average, the biggest category movers, savings rate, net-worth change, and anything unusual worth a look. Cite the figures you used.',
  },
  {
    label: 'What changed in my spending?',
    prompt:
      'Compare my latest entered month of spending to the month before and to my 12-month averages. Which categories moved the most, and how do they sit against their budgets where budgets exist?',
  },
  {
    label: 'Contribution-limit pace',
    prompt:
      'Am I on pace to hit, exceed, or undershoot my 401(k), HSA, and ESPP contribution limits this year? Use my paycheck contribution pace and the limits I have entered, and flag any limit I have not entered.',
  },
]

const ROUTE_SAMPLES: Record<string, SamplePrompt[]> = {
  '/': [
    {
      label: 'Summarize my finances',
      prompt:
        'Summarize my current financial position: net worth and its trend, portfolio value, latest spending month, and effective tax rate. Keep it to a short paragraph plus a few bullets.',
    },
  ],
  '/net-worth': [
    {
      label: 'What drove last month?',
      prompt:
        'What drove my latest month-over-month net-worth change? Break it down by account group and call out the accounts that moved most.',
    },
  ],
  '/portfolio': [
    {
      label: 'Concentration check',
      prompt:
        'What are my most concentrated positions by weight, and how much of the portfolio do the top five holdings represent?',
    },
    {
      label: 'Income from holdings',
      prompt:
        'How much annual dividend income is my portfolio expected to produce at current rates, and which holdings contribute most?',
    },
  ],
  '/spending': [
    {
      label: 'Explain this month',
      prompt:
        'Explain the spending month I am looking at: total, biggest categories, movers vs the prior month, and how it compares to my typical month.',
    },
    {
      label: 'Budget check',
      prompt: 'Which categories are over or under their budgets this month, and by how much?',
    },
  ],
  '/taxes': [
    {
      label: 'Explain my marginal rate',
      prompt:
        'Explain my current marginal rates: what the next $1,000 of ordinary income costs federally and in state, and which brackets I am sitting in.',
    },
    {
      label: 'Model a sale',
      prompt:
        'If I sold 100 shares of my largest holding this year, what would happen to my total tax and take-home? Use the what-if tool and cite the deltas.',
    },
  ],
  '/projection': [
    {
      label: 'Why do my FI dates differ?',
      prompt:
        'The projection shows a deterministic FI date and Monte Carlo percentiles. Explain what each means, why they differ, and which assumptions move them most.',
    },
  ],
  '/credit-cards': [
    {
      label: 'Card lineup check',
      prompt:
        'Given my rewards matrix and spending weights, which cards earn their keep and which look droppable? Cite the estimated yearly values.',
    },
  ],
  '/espp': [
    {
      label: 'ESPP position',
      prompt:
        'Summarize my ESPP position: lots held, gains, the $25k-limit usage, and anything approaching its qualifying date.',
    },
  ],
  '/paycheck': [
    {
      label: 'Where does my check go?',
      prompt:
        'Walk through where each paycheck goes — gross to net — and how my contribution percentages translate to full-year totals.',
    },
  ],
  '/comp': [
    {
      label: 'Comp trajectory',
      prompt: 'Summarize my compensation trajectory across focal years: base, equity, and total.',
    },
  ],
}

export function samplesFor(route: string): SamplePrompt[] {
  return ROUTE_SAMPLES[route] ?? []
}
```

- [ ] **Step 3: Run to verify pass** — `npx vitest run src/components/assistant/samples.test.ts` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/assistant/samples.ts src/components/assistant/samples.test.ts
git commit -m "feat(assistant): insight presets and per-route sample prompts"
```

---

### Task F6: The drawer + launcher (shell, streaming wiring, chips, errors)

**Files:**
- Create: `src/components/assistant/AssistantDrawer.tsx`, `src/components/assistant/assistant.css`, `src/components/assistant/AssistantDrawer.test.tsx`

This is the feature's biggest file (~430 lines). Build it in the three checkpoints below, running the named tests after each.

- [ ] **Step 1: Write the failing tests** — `src/components/assistant/AssistantDrawer.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchAssistantSettings = vi.fn()
const fetchAssistantModels = vi.fn()
const fetchContextPreview = vi.fn()
vi.mock('../../api/assistant', () => ({
  fetchAssistantSettings: (...a: unknown[]) => fetchAssistantSettings(...a),
  fetchAssistantModels: (...a: unknown[]) => fetchAssistantModels(...a),
  fetchContextPreview: (...a: unknown[]) => fetchContextPreview(...a),
}))

const streamChat = vi.fn()
vi.mock('../../api/assistantStream', async () => {
  const actual = await vi.importActual<typeof import('../../api/assistantStream')>(
    '../../api/assistantStream',
  )
  return { ...actual, streamChat: (...a: unknown[]) => streamChat(...a) }
})

import { requestAssistantOpen } from './viewState'
import AssistantDrawer from './AssistantDrawer'

const MODELS = {
  configured: true,
  key_source: 'env' as const,
  key_ok: true,
  checked_at: '2026-09-01T00:00:00Z',
  models: [
    { key: 'kimi-k3', label: 'Kimi K3', available: true, supports_tools: true, default: true },
    {
      key: 'nemotron-3.5-lightning',
      label: 'Nemotron 3.5 Lightning',
      available: true,
      supports_tools: true,
      default: false,
    },
  ],
}

function mount(route = '/spending') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AssistantDrawer />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  fetchAssistantSettings.mockResolvedValue({
    key: { configured: true, source: 'env' },
    default_model: 'kimi-k3',
  })
  fetchAssistantModels.mockResolvedValue(MODELS)
  fetchContextPreview.mockResolvedValue({ sections: [{ name: 'household', rows: 1 }] })
  streamChat.mockReset()
})

afterEach(() => sessionStorage.clear())

async function openDrawer() {
  fireEvent.click(screen.getByRole('button', { name: /open assistant/i }))
  await waitFor(() => expect(screen.getByRole('complementary', { name: 'Assistant' })).toBeTruthy())
}

describe('AssistantDrawer', () => {
  it('opens from the launcher, focuses the input, Esc closes and restores focus', async () => {
    mount()
    const launcher = screen.getByRole('button', { name: /open assistant/i })
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
    await waitFor(() => expect(document.activeElement).toBe(input))
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull()
    expect(document.activeElement).toBe(launcher)
  })

  it('opens on the palette bus event', async () => {
    mount()
    requestAssistantOpen()
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Assistant' })).toBeTruthy(),
    )
  })

  it('shows the not-configured setup note instead of the composer', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: false, source: null },
      default_model: 'kimi-k3',
    })
    mount()
    await openDrawer()
    expect(screen.getByText(/no nvidia api key configured/i)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /ask the assistant/i })).toBeNull()
  })

  it('streams an answer: tokens accumulate, tool chip renders, done stamps the model', async () => {
    streamChat.mockImplementation((_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
      h.onToolStart?.({ name: 'get_month_detail', summary: 'Dec 2025' })
      h.onToolResult?.({ name: 'get_month_detail', summary: 'ok' })
      h.onToken('Housing was ')
      h.onToken('$2,030.00.')
      h.onDone({ model_used: 'kimi-k3' })
      return { abort: vi.fn(), finished: Promise.resolve() }
    })
    mount()
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
    fireEvent.change(input, { target: { value: 'why did housing spike?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/Housing was \$2,030\.00\./)).toBeTruthy())
    expect(screen.getByText(/get_month_detail/)).toBeTruthy()
    // The request carried route context and the chosen model.
    const body = streamChat.mock.calls[0][0] as { model: string; context: { route: string } }
    expect(body.model).toBe('kimi-k3')
    expect(body.context.route).toBe('/spending')
  })

  it('a pre-token failure restores the question to the input and renders the error', async () => {
    streamChat.mockImplementation((_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
      h.onError({ kind: 'unavailable', message: 'every model failed' })
      return { abort: vi.fn(), finished: Promise.resolve() }
    })
    mount()
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
    fireEvent.change(input, { target: { value: 'hello?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/every model failed/)).toBeTruthy())
    expect((input as HTMLTextAreaElement).value).toBe('hello?')
  })

  it('Stop aborts and marks the partial answer stopped', async () => {
    const abort = vi.fn()
    let capture: import('../../api/assistantStream').AssistantHandlers | null = null
    streamChat.mockImplementation((_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
      capture = h
      h.onToken('partial')
      return { abort, finished: new Promise(() => {}) }
    })
    mount()
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
    fireEvent.change(input, { target: { value: 'long one' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('partial')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(abort).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText(/stopped/i)).toBeTruthy())
    expect(capture).not.toBeNull()
  })

  it('persists the transcript across a remount (sessionStorage)', async () => {
    streamChat.mockImplementation((_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
      h.onToken('answer')
      h.onDone({ model_used: 'kimi-k3' })
      return { abort: vi.fn(), finished: Promise.resolve() }
    })
    const first = mount()
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
    fireEvent.change(input, { target: { value: 'persist me' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('answer')).toBeTruthy())
    first.unmount()
    mount()
    await openDrawer()
    expect(screen.getByText('persist me')).toBeTruthy()
    expect(screen.getByText('answer')).toBeTruthy()
  })

  it('renders sample chips on an empty transcript and sends the preset on click', async () => {
    streamChat.mockImplementation((_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
      h.onDone({ model_used: 'kimi-k3' })
      return { abort: vi.fn(), finished: Promise.resolve() }
    })
    mount()
    await openDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Month in review' }))
    await waitFor(() => expect(streamChat).toHaveBeenCalled())
    const body = streamChat.mock.calls[0][0] as { messages: { content: string }[] }
    expect(body.messages.at(-1)?.content).toMatch(/month-in-review/i)
  })

  it('failover notice renders above the answer', async () => {
    streamChat.mockImplementation((_body: unknown, h: import('../../api/assistantStream').AssistantHandlers) => {
      h.onNotice?.({ kind: 'failover', from: 'kimi-k3', to: 'nemotron-3.5-lightning' })
      h.onToken('fallback answer')
      h.onDone({ model_used: 'nemotron-3.5-lightning' })
      return { abort: vi.fn(), finished: Promise.resolve() }
    })
    mount()
    await openDrawer()
    const input = screen.getByRole('textbox', { name: /ask the assistant/i })
    fireEvent.change(input, { target: { value: 'q' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(screen.getByText(/Nemotron 3\.5 Lightning — Kimi K3 was unavailable/)).toBeTruthy(),
    )
  })

  it('context expander fetches and lists the preview sections', async () => {
    mount()
    await openDrawer()
    fireEvent.click(screen.getByRole('button', { name: /what the assistant can see/i }))
    await waitFor(() => expect(screen.getByText(/household/)).toBeTruthy())
    expect(fetchContextPreview).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/spending' }),
    )
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/assistant/AssistantDrawer.test.tsx` — Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/components/assistant/assistant.css`**

```css
/* Assistant drawer (2026-09-01 spec §9). Z-map: bubble layer 2 < drawer 15 < palette 20
   < toasts 30 — Ctrl+K must open ABOVE the drawer, and an Undo outlives both. */

.assistant-launcher {
  position: fixed;
  right: 1.25rem;
  bottom: 1.25rem;
  z-index: 15;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--accent);
  font-size: 1.1rem;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.assistant-launcher:hover {
  border-color: var(--accent);
}

.assistant-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 15;
  display: flex;
  flex-direction: column;
  width: min(400px, 100vw);
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -12px 0 40px rgba(0, 0, 0, 0.45);
}

.assistant-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.85rem;
  border-bottom: 1px solid var(--border);
}

.assistant-title {
  font-weight: 600;
  font-size: 0.95rem;
  margin-right: auto;
}

.assistant-model-select {
  max-width: 170px;
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.25rem 0.4rem;
  font-size: 0.78rem;
}

.assistant-icon-button {
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--muted);
  padding: 0.25rem 0.5rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.assistant-icon-button:hover {
  color: var(--text);
}

.assistant-context {
  padding: 0.45rem 0.85rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.75rem;
  color: var(--muted);
}

.assistant-context-toggle {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  font-size: 0.75rem;
  cursor: pointer;
}

.assistant-context-sections {
  margin: 0.35rem 0 0;
  padding-left: 1.1rem;
}

.assistant-messages {
  flex: 1;
  overflow-y: auto;
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.assistant-msg {
  font-size: 0.85rem;
  line-height: 1.45;
  max-width: 100%;
  overflow-wrap: break-word;
}

.assistant-msg-user {
  align-self: flex-end;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px 10px 2px 10px;
  padding: 0.5rem 0.7rem;
  max-width: 88%;
  white-space: pre-wrap;
}

.assistant-msg-assistant p,
.assistant-msg-assistant ul,
.assistant-msg-assistant ol,
.assistant-msg-assistant pre {
  margin: 0 0 0.55rem;
}

.assistant-msg-assistant pre {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.5rem;
  overflow-x: auto;
  font-size: 0.78rem;
}

.md-table {
  border-collapse: collapse;
  margin: 0 0 0.55rem;
  font-size: 0.8rem;
}

.md-table th,
.md-table td {
  border: 1px solid var(--border);
  padding: 0.25rem 0.5rem;
  text-align: left;
}

.md-heading {
  font-size: 0.9rem;
}

.assistant-meta {
  color: var(--muted);
  font-size: 0.72rem;
}

.assistant-notice {
  color: var(--warn);
  font-size: 0.75rem;
  margin: 0 0 0.25rem;
}

.assistant-tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.1rem 0.55rem;
  font-size: 0.72rem;
  color: var(--muted);
  margin: 0 0.3rem 0.35rem 0;
}

.assistant-error {
  border: 1px solid var(--negative);
  border-radius: 8px;
  padding: 0.5rem 0.7rem;
  font-size: 0.8rem;
  color: var(--text);
}

.assistant-error .button {
  margin-top: 0.4rem;
}

.assistant-samples {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.25rem 0;
}

.assistant-sample-chip {
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  border-radius: 999px;
  padding: 0.3rem 0.7rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.assistant-sample-chip:hover {
  border-color: var(--accent);
}

.assistant-composer {
  display: flex;
  gap: 0.5rem;
  padding: 0.65rem 0.85rem;
  border-top: 1px solid var(--border);
}

.assistant-composer textarea {
  flex: 1;
  resize: none;
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem 0.65rem;
  font: inherit;
  font-size: 0.85rem;
  min-height: 2.6rem;
  max-height: 8rem;
}

.assistant-setup-note {
  padding: 0.85rem;
  font-size: 0.85rem;
  color: var(--muted);
}

@media (prefers-reduced-motion: no-preference) {
  .assistant-drawer {
    animation: assistant-drawer-in 160ms ease-out;
  }

  @keyframes assistant-drawer-in {
    from {
      transform: translateX(24px);
      opacity: 0;
    }
  }
}
```

- [ ] **Step 4: Create `src/components/assistant/AssistantDrawer.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Sparkles, Square, X } from 'lucide-react'
import { fetchAssistantModels, fetchAssistantSettings, fetchContextPreview } from '../../api/assistant'
import {
  readAssistantModel,
  readAssistantTranscript,
  writeAssistantModel,
  writeAssistantTranscript,
} from '../../api/assistantSession'
import type { TranscriptItem } from '../../api/assistantSession'
import { streamChat } from '../../api/assistantStream'
import type { ChatStreamHandle } from '../../api/assistantStream'
import type {
  AssistantContextIn,
  AssistantModelsOut,
  AssistantPreviewSection,
  AssistantSettingsOut,
} from '../../types/api'
import { NAV_ITEMS } from '../navItems'
import { renderMarkdown } from './markdown'
import { INSIGHT_PRESETS, samplesFor } from './samples'
import { ASSISTANT_OPEN_EVENT, readAssistantView, useAssistantViewVersion } from './viewState'
import '../panels.css'
import './assistant.css'

/** The server caps at 20; sending exactly its cap keeps 422s unreachable from here. */
const SENT_MESSAGES_CAP = 20

const MODEL_LABELS: Record<string, string> = {
  'kimi-k3': 'Kimi K3',
  'deepseek-v4-pro-0813': 'DeepSeek V4 Pro',
  'nemotron-3-ultra-550b': 'Nemotron 3 Ultra 550B',
  'nemotron-3.5-lightning': 'Nemotron 3.5 Lightning',
}

function modelLabel(key: string, models: AssistantModelsOut | null): string {
  return (
    models?.models.find((m) => m.key === key)?.label ?? MODEL_LABELS[key] ?? key
  )
}

function pageLabel(route: string): string {
  return NAV_ITEMS.find((item) => item.to === route)?.label ?? route
}

export default function AssistantDrawer() {
  const location = useLocation()
  const viewVersion = useAssistantViewVersion()
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<AssistantSettingsOut | null>(null)
  const [settingsFailed, setSettingsFailed] = useState(false)
  const [models, setModels] = useState<AssistantModelsOut | null>(null)
  const [model, setModel] = useState<string>(() => readAssistantModel() ?? 'kimi-k3')
  const [transcript, setTranscript] = useState<TranscriptItem[]>(() => readAssistantTranscript())
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [previewSections, setPreviewSections] = useState<AssistantPreviewSection[] | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<ChatStreamHandle | null>(null)
  // Guards a late stream event after New chat wiped the transcript: each send bumps it,
  // and handlers compare before touching state (the pages' seqRef idiom).
  const sendSeq = useRef(0)

  // Transcript mirrors to sessionStorage on every change — storage always holds "what
  // would be lost" (the wizard-draft posture).
  useEffect(() => {
    writeAssistantTranscript(transcript)
  }, [transcript])

  useEffect(() => {
    writeAssistantModel(model)
  }, [model])

  // Open-bus subscription (palette's "Ask assistant"). Unkeyed: always current setters.
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen)
  })

  // First open: load settings + models once. Promise continuations only (house law).
  useEffect(() => {
    if (!open || settings !== null) return
    fetchAssistantSettings()
      .then((s) => {
        setSettings(s)
        setSettingsFailed(false)
        setModel((current) => readAssistantModel() ?? s.default_model ?? current)
      })
      .catch(() => setSettingsFailed(true))
    fetchAssistantModels()
      .then(setModels)
      .catch(() => setModels(null))
  }, [open, settings])

  // Focus hand-off: into the input on open; back to the launcher on close.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open, settings])

  // Keep the newest message in view as tokens land.
  useEffect(() => {
    const el = messagesRef.current
    if (el) el.scrollTop = el.scrollHeight
  })

  const close = () => {
    setOpen(false)
    setPreviewOpen(false)
    launcherRef.current?.focus()
  }

  const buildContext = (): AssistantContextIn => ({
    route: location.pathname,
    search: Object.fromEntries(new URLSearchParams(location.search).entries()),
    view: readAssistantView(),
  })

  const contextLabel = useMemo(() => {
    void viewVersion // re-derive when a page republishes its view
    const view = readAssistantView()
    const extras = Object.entries(view)
      .filter(([, value]) => value !== null && value !== '')
      .map(([k, value]) => `${k}: ${String(value)}`)
    return [pageLabel(location.pathname), ...extras].join(' · ')
  }, [location.pathname, location.search, viewVersion])

  const togglePreview = () => {
    const next = !previewOpen
    setPreviewOpen(next)
    if (next) {
      setPreviewSections(null)
      fetchContextPreview(buildContext())
        .then((p) => setPreviewSections(p.sections))
        .catch(() => setPreviewSections([]))
    }
  }

  const send = (text: string, withModel?: string) => {
    const chosenModel = withModel ?? model
    if (withModel !== undefined) setModel(withModel)
    const content = text.trim()
    if (content === '' || streaming || settings === null || !settings.key.configured) return
    const seq = ++sendSeq.current
    const asked = buildContext()
    const userItem: TranscriptItem = { role: 'user', content, contextLabel }
    const pendingAnswer: TranscriptItem = { role: 'assistant', content: '', tools: [] }
    const history = [...transcript, userItem]
    setTranscript([...history, pendingAnswer])
    setInput('')
    setStreaming(true)
    let receivedTokens = false

    // All handlers funnel through this: replace the LAST item (the pending answer).
    const patchAnswer = (patch: (current: TranscriptItem) => TranscriptItem) => {
      if (seq !== sendSeq.current) return
      setTranscript((current) => {
        if (current.length === 0) return current
        const next = [...current]
        next[next.length - 1] = patch(next[next.length - 1])
        return next
      })
    }

    handleRef.current = streamChat(
      {
        model: chosenModel,
        context: asked,
        // Empty-content items (error stubs, stopped placeholders) never ride upstream —
        // some completion endpoints reject empty assistant messages outright.
        messages: history
          .filter((item) => item.content.trim() !== '')
          .slice(-SENT_MESSAGES_CAP)
          .map(({ role, content: c }) => ({ role, content: c })),
      },
      {
        onNotice: (notice) =>
          patchAnswer((item) => ({
            ...item,
            notice: `Answered by ${modelLabel(notice.to, models)} — ${modelLabel(notice.from, models)} was unavailable.`,
          })),
        onToolStart: (tool) =>
          patchAnswer((item) => ({
            ...item,
            tools: [...(item.tools ?? []), { ...tool, done: false }],
          })),
        onToolResult: (tool) =>
          patchAnswer((item) => ({
            ...item,
            tools: (item.tools ?? []).map((t) =>
              t.name === tool.name && !t.done ? { ...t, summary: tool.summary, done: true } : t,
            ),
          })),
        onToken: (text2) => {
          receivedTokens = true
          patchAnswer((item) => ({ ...item, content: item.content + text2 }))
        },
        onDone: (done) => {
          if (seq !== sendSeq.current) return
          patchAnswer((item) => ({ ...item, model: done.model_used }))
          setStreaming(false)
        },
        onError: (error) => {
          if (seq !== sendSeq.current) return
          setStreaming(false)
          if (!receivedTokens) {
            // Nothing arrived: drop the pair and give the question back (spec §9).
            setTranscript((current) => current.slice(0, -2))
            setInput(content)
            setTranscript((current) => [
              ...current,
              {
                role: 'assistant',
                content: '',
                error: { ...error, retryModel: nextModelAfter(model) },
              },
            ])
            return
          }
          patchAnswer((item) => ({
            ...item,
            error: { ...error, retryModel: nextModelAfter(model) },
          }))
        },
      },
    )
  }

  const nextModelAfter = (current: string): string | undefined =>
    models?.models.find((m) => m.available && m.key !== current)?.key

  const stop = () => {
    handleRef.current?.abort()
    setStreaming(false)
    setTranscript((current) => {
      if (current.length === 0) return current
      const next = [...current]
      const last = next[next.length - 1]
      if (last.role === 'assistant') next[next.length - 1] = { ...last, stopped: true }
      return next
    })
  }

  const retryWith = (retryModel: string) => {
    // The last USER message is the question the failed answer belonged to.
    const lastUser = [...transcript].reverse().find((item) => item.role === 'user')
    if (lastUser === undefined) return
    setModel(retryModel)
    // Drop the failed error stub so the retry appends cleanly after the question.
    setTranscript((current) =>
      current.length > 0 && current[current.length - 1].error !== undefined
        ? current.slice(0, -1)
        : current,
    )
    send(lastUser.content, retryModel)
  }

  const newChat = () => {
    sendSeq.current += 1
    handleRef.current?.abort()
    setStreaming(false)
    setTranscript([])
  }

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send(input)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  const configured = settings?.key.configured === true

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="assistant-launcher"
        aria-label="Open assistant"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Sparkles size={18} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="assistant-drawer"
          role="complementary"
          aria-label="Assistant"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              close()
            }
          }}
        >
          <div className="assistant-header">
            <span className="assistant-title">✦ Assistant</span>
            <select
              className="assistant-model-select"
              aria-label="Model"
              value={model}
              disabled={streaming}
              onChange={(event) => setModel(event.target.value)}
            >
              {(models?.models ?? [{ key: model, label: modelLabel(model, null), available: true, supports_tools: true, default: true }]).map(
                (m) => (
                  <option key={m.key} value={m.key} disabled={!m.available}>
                    {m.label}
                    {m.available ? '' : ' (unavailable)'}
                  </option>
                ),
              )}
            </select>
            <button type="button" className="assistant-icon-button" onClick={newChat}>
              New chat
            </button>
            <button
              type="button"
              className="assistant-icon-button"
              aria-label="Close assistant"
              onClick={close}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="assistant-context">
            Seeing: {contextLabel} ·{' '}
            <button type="button" className="assistant-context-toggle" onClick={togglePreview}>
              what the assistant can see
            </button>
            {previewOpen && (
              <ul className="assistant-context-sections">
                {previewSections === null ? (
                  <li>Loading…</li>
                ) : previewSections.length === 0 ? (
                  <li>Couldn&apos;t load the preview.</li>
                ) : (
                  previewSections.map((section) => (
                    <li key={section.name}>
                      {section.name} — {section.rows} row{section.rows === 1 ? '' : 's'}
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          <div className="assistant-messages" role="log" aria-label="Conversation" ref={messagesRef}>
            {settingsFailed && (
              <div className="assistant-error" role="alert">
                Couldn&apos;t reach the assistant service.
              </div>
            )}
            {settings !== null && !configured && (
              <p className="assistant-setup-note">
                No NVIDIA API key configured. Set <code>NVIDIA_API_KEY</code> in the server&apos;s{' '}
                <code>.env</code>, or save a key in <Link to="/settings">Settings</Link>, and the
                assistant lights up.
              </p>
            )}
            {configured && transcript.length === 0 && (
              <div className="assistant-samples">
                {[...INSIGHT_PRESETS, ...samplesFor(location.pathname)].map((sample) => (
                  <button
                    key={sample.label}
                    type="button"
                    className="assistant-sample-chip"
                    onClick={() => send(sample.prompt)}
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            )}
            {transcript.map((item, index) =>
              item.role === 'user' ? (
                <div key={index} className="assistant-msg assistant-msg-user">
                  {item.content}
                </div>
              ) : (
                <div key={index} className="assistant-msg assistant-msg-assistant">
                  {item.notice && <p className="assistant-notice">{item.notice}</p>}
                  {(item.tools ?? []).map((tool, t) => (
                    <span key={t} className="assistant-tool-chip">
                      ⚙ {tool.name}
                      {tool.done ? '' : '…'}
                    </span>
                  ))}
                  {item.content !== '' && renderMarkdown(item.content)}
                  {item.stopped && <p className="assistant-meta">Stopped.</p>}
                  {item.model && !item.error && (
                    <p className="assistant-meta">{modelLabel(item.model, models)}</p>
                  )}
                  {item.error && (
                    <div className="assistant-error" role="alert">
                      {item.error.message}
                      {item.error.kind === 'bad_key' && (
                        <p>
                          <Link to="/settings">Fix the key in Settings →</Link>
                        </p>
                      )}
                      {item.error.kind !== 'bad_key' && item.error.retryModel && (
                        <button
                          type="button"
                          className="button"
                          onClick={() => retryWith(item.error?.retryModel ?? model)}
                        >
                          Retry with {modelLabel(item.error.retryModel, models)}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
          {configured && (
            <div className="assistant-composer">
              <textarea
                ref={inputRef}
                aria-label="Ask the assistant"
                placeholder="Ask about what you're looking at…"
                value={input}
                rows={2}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onComposerKeyDown}
              />
              {streaming ? (
                <button type="button" className="button" aria-label="Stop" onClick={stop}>
                  <Square size={13} aria-hidden="true" /> Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={input.trim() === ''}
                  onClick={() => send(input)}
                >
                  Send
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 5: Run the drawer tests** — `npx vitest run src/components/assistant/AssistantDrawer.test.tsx` — Expected: PASS (iterate here until all listed behaviors pass; the test file is the contract).

- [ ] **Step 6: Run the whole existing suite to catch collateral damage** — `npm test` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/assistant/AssistantDrawer.tsx src/components/assistant/assistant.css src/components/assistant/AssistantDrawer.test.tsx
git commit -m "feat(assistant): drawer + launcher with streaming, tools, errors, context chip"
```

---

### Task F7: Mount in Layout, palette action, logout clearing

**Files:**
- Modify: `src/components/Layout.tsx` (import + one JSX line after `<CommandPalette />`)
- Modify: `src/components/CommandPalette.tsx` (one action item)
- Modify: `src/contexts/AuthContext.tsx` (logout clears assistant session)
- Modify: `src/api/client.ts` (401 path clears assistant session)
- Test: extend `src/components/CommandPalette.test.tsx`, `src/contexts/AuthContext.test.tsx` (follow each file's existing structure)

- [ ] **Step 1: Write the failing tests.** In `src/components/CommandPalette.test.tsx`, add (using that file's existing render/open helpers — read it first):

```tsx
it('runs the Ask assistant action through the open-event bus', async () => {
  const spy = vi.fn()
  window.addEventListener('assistant:open', spy)
  // …open the palette the way this file's other tests do, type "assistant",
  // press Enter on the "Ask assistant" option…
  expect(spy).toHaveBeenCalledTimes(1)
  window.removeEventListener('assistant:open', spy)
})
```

In `src/contexts/AuthContext.test.tsx`, add:

```tsx
it('logout clears the assistant session storage', () => {
  sessionStorage.setItem('assistant:transcript', '[]')
  sessionStorage.setItem('assistant:model', 'kimi-k3')
  // …drive logout the way this file's existing logout test does…
  expect(sessionStorage.getItem('assistant:transcript')).toBeNull()
  expect(sessionStorage.getItem('assistant:model')).toBeNull()
})
```

- [ ] **Step 2: Run to verify failures** — `npx vitest run src/components/CommandPalette.test.tsx src/contexts/AuthContext.test.tsx` — Expected: the two new tests FAIL.

- [ ] **Step 3: Implement the four edits.**

`src/components/Layout.tsx` — import `AssistantDrawer` and render it beside the palette:

```tsx
import AssistantDrawer from './assistant/AssistantDrawer'
// …
      <CommandPalette />
      <AssistantDrawer />
```

`src/components/CommandPalette.tsx` — import the bus and append one action to `items` (after the `action:add-custom-event` entry):

```tsx
import { requestAssistantOpen } from './assistant/viewState'
// …
    {
      id: 'action:ask-assistant',
      label: 'Ask assistant',
      kind: 'Action' as const,
      // The palette closes first (execute() contract), then the drawer opens and takes
      // focus itself — the launcher button is not involved, so no focus tug-of-war.
      run: () => requestAssistantOpen(),
    },
```

`src/contexts/AuthContext.tsx` — in `logout`, beside `clearSnapshots()`:

```tsx
import { clearAssistantSession } from '../api/assistantSession'
// …
  const logout = useCallback(() => {
    authApi.logout()
    clearSnapshots() // snapshots are session data — they must not outlive the session
    clearAssistantSession() // and neither may a financial chat transcript
    setEmail(null)
  }, [])
```

`src/api/client.ts` — in the 401 branch of `request()`, beside `clearSnapshots()`:

```ts
import { clearAssistantSession } from './assistantSession'
// …
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    clearToken()
    clearSnapshots() // snapshots are session data — they must not outlive the token
    clearAssistantSession()
    window.location.assign('/login')
    throw new ApiError('Session expired', 401)
  }
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/components/CommandPalette.test.tsx src/contexts/AuthContext.test.tsx src/components/Layout.test.tsx src/api/client.test.ts` — Expected: PASS (Layout's existing tests must not regress; if Layout.test.tsx renders the layout shell, the drawer launcher now appears in it — update any snapshot-ish assertions accordingly, never by weakening them).

- [ ] **Step 5: Commit**

```bash
git add src/components/Layout.tsx src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx src/contexts/AuthContext.tsx src/contexts/AuthContext.test.tsx src/api/client.ts
git commit -m "feat(assistant): mount drawer in Layout, palette action, logout clearing"
```

---

### Task F8: Settings "Assistant" card

**Files:**
- Create: `src/components/settings/AssistantCard.tsx`, `src/components/settings/AssistantCard.test.tsx`
- Modify: `src/pages/SettingsPage.tsx` (import + mount `<AssistantCard />` after `<LimitsCard />`)

- [ ] **Step 1: Write the failing tests** — `src/components/settings/AssistantCard.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchAssistantSettings = vi.fn()
const putAssistantSettings = vi.fn()
const fetchAssistantModels = vi.fn()
vi.mock('../../api/assistant', () => ({
  fetchAssistantSettings: (...a: unknown[]) => fetchAssistantSettings(...a),
  putAssistantSettings: (...a: unknown[]) => putAssistantSettings(...a),
  fetchAssistantModels: (...a: unknown[]) => fetchAssistantModels(...a),
}))

import AssistantCard from './AssistantCard'

const MODELS = {
  configured: true,
  key_source: 'env' as const,
  key_ok: true,
  checked_at: '2026-09-01T00:00:00Z',
  models: [
    { key: 'kimi-k3', label: 'Kimi K3', available: true, supports_tools: true, default: true },
    {
      key: 'nemotron-3.5-lightning',
      label: 'Nemotron 3.5 Lightning',
      available: false,
      supports_tools: true,
      default: false,
    },
  ],
}

beforeEach(() => {
  fetchAssistantSettings.mockReset()
  putAssistantSettings.mockReset()
  fetchAssistantModels.mockReset()
})

describe('AssistantCard', () => {
  it('unconfigured: empty field, no badge, no revert button', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: false, source: null },
      default_model: 'kimi-k3',
    })
    render(<AssistantCard />)
    await waitFor(() => expect(screen.getByLabelText(/nvidia api key/i)).toBeTruthy())
    expect(screen.queryByText(/from \.env/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /remove saved key/i })).toBeNull()
  })

  it('env-configured: masked placeholder + source badge', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'env' },
      default_model: 'kimi-k3',
    })
    render(<AssistantCard />)
    await waitFor(() => expect(screen.getByText(/from \.env/i)).toBeTruthy())
    const input = screen.getByLabelText(/nvidia api key/i) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toContain('••••••••')
  })

  it('override: badge says set here and Remove saved key sends api_key null', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'override' },
      default_model: 'kimi-k3',
    })
    putAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'env' },
      default_model: 'kimi-k3',
    })
    render(<AssistantCard />)
    await waitFor(() => expect(screen.getByText(/set here/i)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /remove saved key/i }))
    await waitFor(() =>
      expect(putAssistantSettings).toHaveBeenCalledWith({ api_key: null }),
    )
    // Echo adopted: the badge now reads from .env.
    await waitFor(() => expect(screen.getByText(/from \.env/i)).toBeTruthy())
  })

  it('saving a typed key sends it and never renders it back', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: false, source: null },
      default_model: 'kimi-k3',
    })
    putAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'override' },
      default_model: 'kimi-k3',
    })
    render(<AssistantCard />)
    await waitFor(() => expect(screen.getByLabelText(/nvidia api key/i)).toBeTruthy())
    const input = screen.getByLabelText(/nvidia api key/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'nvapi-secret' } })
    fireEvent.click(screen.getByRole('button', { name: /save assistant settings/i }))
    await waitFor(() =>
      expect(putAssistantSettings).toHaveBeenCalledWith({ api_key: 'nvapi-secret' }),
    )
    await waitFor(() => expect(input.value).toBe('')) // box empties; masked state takes over
  })

  it('save with only a model change sends default_model alone', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'env' },
      default_model: 'kimi-k3',
    })
    putAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'env' },
      default_model: 'nemotron-3.5-lightning',
    })
    render(<AssistantCard />)
    await waitFor(() => expect(screen.getByLabelText(/default model/i)).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/default model/i), {
      target: { value: 'nemotron-3.5-lightning' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save assistant settings/i }))
    await waitFor(() =>
      expect(putAssistantSettings).toHaveBeenCalledWith({
        default_model: 'nemotron-3.5-lightning',
      }),
    )
  })

  it('Test key probes and lists per-model availability', async () => {
    fetchAssistantSettings.mockResolvedValue({
      key: { configured: true, source: 'env' },
      default_model: 'kimi-k3',
    })
    fetchAssistantModels.mockResolvedValue(MODELS)
    render(<AssistantCard />)
    await waitFor(() => expect(screen.getByRole('button', { name: /test key/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /test key/i }))
    await waitFor(() => expect(fetchAssistantModels).toHaveBeenCalledWith(true))
    await waitFor(() => expect(screen.getByText(/Kimi K3/)).toBeTruthy())
    expect(screen.getByText(/Nemotron 3\.5 Lightning/).closest('li')?.textContent).toMatch(
      /unavailable/i,
    )
  })
})
```

- [ ] **Step 2: Run to verify failure, then create `src/components/settings/AssistantCard.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  fetchAssistantModels,
  fetchAssistantSettings,
  putAssistantSettings,
} from '../../api/assistant'
import type { AssistantModelsOut, AssistantSettingsOut } from '../../types/api'
import InfoHint from '../InfoHint'
import '../panels.css'
import './settings.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

// Registry keys ship here too so the select works before any models GET succeeds; the
// backend registry stays the source of truth for labels once loaded.
const MODEL_OPTIONS: { key: string; label: string }[] = [
  { key: 'kimi-k3', label: 'Kimi K3' },
  { key: 'deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro' },
  { key: 'nemotron-3-ultra-550b', label: 'Nemotron 3 Ultra 550B' },
  { key: 'nemotron-3.5-lightning', label: 'Nemotron 3.5 Lightning' },
]

/**
 * The Settings Assistant card (2026-09-01 spec §10): the key's two sources with the
 * override→env precedence made visible, the default model, and a live key probe. The
 * key VALUE never round-trips — "configured" is a UI state driven by {configured,
 * source}, and the input is write-only.
 */
export default function AssistantCard() {
  const [settings, setSettings] = useState<AssistantSettingsOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [keyBox, setKeyBox] = useState('')
  const [modelBox, setModelBox] = useState('kimi-k3')
  const [busy, setBusy] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const [probe, setProbe] = useState<AssistantModelsOut | null>(null)
  const [probing, setProbing] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)
  const seqRef = useRef(0)

  const adopt = (payload: AssistantSettingsOut) => {
    setSettings(payload)
    setModelBox(payload.default_model)
    setKeyBox('') // the box is write-only; the masked state is the placeholder's job
  }

  const load = () => {
    const seq = ++seqRef.current
    fetchAssistantSettings()
      .then((payload) => {
        if (seq !== seqRef.current) return
        adopt(payload)
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load assistant settings.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  const save = () => {
    if (settings === null) return
    const body: { api_key?: string; default_model?: string } = {}
    if (keyBox.trim() !== '') body.api_key = keyBox.trim()
    if (modelBox !== settings.default_model) body.default_model = modelBox
    if (Object.keys(body).length === 0) return
    setBusy(true)
    setError(null)
    setSavedNote(false)
    putAssistantSettings(body)
      .then((payload) => {
        adopt(payload)
        setSavedNote(true)
        setProbe(null) // a new key invalidates the last probe's verdict
      })
      .catch((err: unknown) => setError(message(err, 'Could not save assistant settings.')))
      .finally(() => setBusy(false))
  }

  const removeOverride = () => {
    setBusy(true)
    setError(null)
    setSavedNote(false)
    putAssistantSettings({ api_key: null })
      .then((payload) => {
        adopt(payload)
        setSavedNote(true)
        setProbe(null)
      })
      .catch((err: unknown) => setError(message(err, 'Could not remove the saved key.')))
      .finally(() => setBusy(false))
  }

  const testKey = () => {
    setProbing(true)
    setProbeError(null)
    fetchAssistantModels(true)
      .then(setProbe)
      .catch((err: unknown) => setProbeError(message(err, 'Probe failed.')))
      .finally(() => setProbing(false))
  }

  const key = settings?.key ?? null

  return (
    <section className="card span-6" role="region" aria-label="Assistant">
      <h2 className="eyebrow">
        Assistant
        <InfoHint text="The ✦ assistant is powered by NVIDIA's API catalog under your key. .env's NVIDIA_API_KEY is the baseline; a key saved here overrides it." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button className="button" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {settings === null && error === null && <p className="empty-note">Loading…</p>}
      {settings !== null && key !== null && (
        <form
          className="settings-card-form"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <label>
            NVIDIA API key
            {key.configured && (
              <span className="badge">{key.source === 'env' ? 'from .env' : 'set here'}</span>
            )}
            <input
              className="field-input"
              type="password"
              autoComplete="off"
              placeholder={key.configured ? '•••••••• (configured — type to replace)' : 'nvapi-…'}
              value={keyBox}
              disabled={busy}
              onChange={(event) => {
                setKeyBox(event.target.value)
                setSavedNote(false)
              }}
            />
          </label>
          {key.source === 'override' && (
            <button type="button" className="button" disabled={busy} onClick={removeOverride}>
              Remove saved key
            </button>
          )}
          {key.source === 'override' && (
            <p className="settings-note">
              Removing the saved key falls back to <code>.env</code>&apos;s NVIDIA_API_KEY if one
              is set on the server.
            </p>
          )}
          <label>
            Default model
            <select
              className="field-input"
              value={modelBox}
              disabled={busy}
              onChange={(event) => {
                setModelBox(event.target.value)
                setSavedNote(false)
              }}
            >
              {MODEL_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="settings-note">
            When you use the assistant, the relevant figures from your dashboard (balances,
            spending, tax numbers) are sent to NVIDIA&apos;s API under this key. The recommended
            home for the key is the server&apos;s <code>.env</code>.
          </p>
          <div className="settings-card-actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save assistant settings'}
            </button>
            <button
              type="button"
              className="button"
              disabled={probing || !key.configured}
              onClick={testKey}
            >
              {probing ? 'Testing…' : 'Test key'}
            </button>
          </div>
          {savedNote && (
            <p className="settings-note" role="status">
              Saved.
            </p>
          )}
          {probeError && (
            <div className="error-banner" role="alert">
              {probeError}
            </div>
          )}
          {probe !== null && (
            <div role="status">
              <p className="settings-note">
                {probe.key_ok === true
                  ? `Key OK (${probe.key_source === 'env' ? '.env' : 'saved here'}).`
                  : probe.key_ok === false
                    ? 'Key rejected or the catalog was unreachable.'
                    : 'No key is configured.'}
              </p>
              <ul className="settings-note">
                {probe.models.map((m) => (
                  <li key={m.key}>
                    {m.available ? '✓' : '✗'} {m.label}
                    {m.available ? '' : ' — unavailable'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Mount it** — in `src/pages/SettingsPage.tsx`, import and render after `<LimitsCard />`:

```tsx
import AssistantCard from '../components/settings/AssistantCard'
// …
          <LimitsCard />
          {/* Assistant key + default model (2026-09-01 spec §10): its own fetch and error
              state, the same loadedOnce gate as the cards above it. */}
          <AssistantCard />
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/components/settings/AssistantCard.test.tsx src/pages/SettingsPage.test.tsx` — Expected: PASS (SettingsPage's own tests must not regress; its card list assertions, if any, gain one region).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/AssistantCard.tsx src/components/settings/AssistantCard.test.tsx src/pages/SettingsPage.tsx
git commit -m "feat(assistant): Settings card — write-only key, source badges, probe"
```

---

### Task F9: Page view publishers + lane finale

**Files:**
- Modify: `src/pages/TaxesPage.tsx`, `src/pages/NetWorthPage.tsx`, `src/pages/PortfolioPage.tsx` (one import + one hook call each)

- [ ] **Step 1: Add the three publishers.** Each is an import plus one call placed with the page's other top-level hooks (after its useState block). The values below reuse each page's existing state variables verbatim:

`src/pages/TaxesPage.tsx`:

```tsx
import { useAssistantView } from '../components/assistant/viewState'
// … inside TaxesPage(), after `filingStatus` is derived:
  // The assistant answers against the year on screen (2026-09-01 spec §6).
  useAssistantView({ year: selectedYear, filingStatus })
```

`src/pages/NetWorthPage.tsx`:

```tsx
import { useAssistantView } from '../components/assistant/viewState'
// … inside NetWorthPage(), after the granularity/owner useState block:
  useAssistantView({ owner: owner === null ? null : String(owner), granularity })
```

`src/pages/PortfolioPage.tsx`:

```tsx
import { useAssistantView } from '../components/assistant/viewState'
// … inside PortfolioPage(), after the owner/detailTicker useState block:
  useAssistantView({
    owner: owner === null ? null : String(owner),
    tab,
    ticker: detailTicker,
  })
```

- [ ] **Step 2: Verify the pages still pass** — `npx vitest run src/pages/TaxesPage.test.tsx src/pages/NetWorthPage.test.tsx src/pages/PortfolioPage.test.tsx` — Expected: PASS unchanged (the hook is inert without a subscriber).

- [ ] **Step 3: Lane finale — full gates**

```
npm test          # expected: all green
npx tsc -b        # expected: exit 0
npm run lint      # expected: exit 0
```

Fix anything these surface (house lint is strict: react-hooks v7 rules — no setState in effect bodies, promise-continuation idiom — are already followed by the code above; keep it that way when fixing).

- [ ] **Step 4: Commit**

```bash
git add src/pages/TaxesPage.tsx src/pages/NetWorthPage.tsx src/pages/PortfolioPage.tsx
git commit -m "feat(assistant): pages publish view state for context faithfulness"
```

---

## Self-review checklist (run before handing the lane back)

1. Spec §9 items each have a task: drawer/launcher (F6), focus contract (F6), context chip + expander (F6), samples/presets (F5/F6), streaming + Stop (F3/F6), errors + failover notice + retry (F6), markdown (F2), sessionStorage + logout clear (F1/F7), palette entry (F7), reduced-motion (F6 CSS), mobile full-width (F6 CSS). Spec §10 → F8. Spec §6 view hook → F4/F9.
2. No placeholder steps; every code step carries the code.
3. Type names match across tasks (`AssistantContextIn`, `TranscriptItem`, `AssistantHandlers`, `ChatStreamHandle` are defined once and imported everywhere else).
