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

/** The kinds this client and the server emit today. The trailing `string & {}` arm keeps
 *  the literals in autocomplete without closing the set: a new server-side kind must
 *  render as an unknown error, never fail to type-check. */
export type AssistantErrorKind =
  | 'bad_key'
  | 'rate_limited'
  | 'unavailable'
  | 'bad_request'
  | 'network'
  | 'interrupted'
  | (string & {})

export interface AssistantErrorEvent {
  kind: AssistantErrorKind
  /** Absent — not `undefined` — when the server gave no hint: `'retry_after' in error` is
   *  how a countdown decides whether it has anything to count. */
  retry_after?: number
  message: string
}

/** How the stream ended, for whoever awaits `finished`. 'aborted' covers the user's Stop
 *  button and the 401 redirect alike: no answer, and nothing reported to the handlers.
 *  Every other outcome has already been reported through them. */
export type ChatOutcome = 'done' | 'error' | 'interrupted' | 'aborted'

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
  finished: Promise<ChatOutcome>
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

function statusKind(status: number): AssistantErrorKind {
  if (status === 401) return 'bad_key' // unreachable in practice — 401 redirects below
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'unavailable'
  return 'bad_request'
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/** Fans one frame out to its handler. Returns the terminal kind when the frame ends the
 *  stream, otherwise null; an unparseable payload is dropped, never fatal. */
function dispatchFrame(frame: SseFrame, handlers: AssistantHandlers): 'done' | 'error' | null {
  let payload: unknown
  try {
    payload = JSON.parse(frame.data)
  } catch {
    return null // a malformed frame is dropped, never fatal
  }
  switch (frame.event) {
    case 'notice':
      handlers.onNotice?.(payload as { kind: string; from: string; to: string })
      return null
    case 'tool_start':
      handlers.onToolStart?.(payload as { name: string; summary: string })
      return null
    case 'tool_result':
      handlers.onToolResult?.(payload as { name: string; summary: string })
      return null
    case 'token': {
      // The server owns this shape, but a missing/null text would throw INSIDE this
      // module, where no caller can catch it — one frame must not cost the whole answer.
      const text = (payload as { text?: unknown }).text
      if (typeof text === 'string') handlers.onToken(text)
      return null
    }
    case 'done':
      handlers.onDone(payload as { model_used: string })
      return 'done'
    case 'error':
      handlers.onError(payload as AssistantErrorEvent)
      return 'error'
    default:
      return null
  }
}

export function streamChat(body: ChatRequest, handlers: AssistantHandlers): ChatStreamHandle {
  const controller = new AbortController()
  const finished = (async (): Promise<ChatOutcome> => {
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
      if (isAbortError(err)) return 'aborted'
      handlers.onError({ kind: 'network', message: 'Network error — is the server reachable?' })
      return 'error'
    }
    if (res.status === 401) {
      // client.ts's session-expiry contract, replicated for the one path that bypasses it.
      clearToken()
      clearSnapshots()
      clearAssistantSession()
      window.location.assign('/login')
      return 'aborted' // nothing was reported, and the page is already leaving
    }
    if (!res.ok || res.body === null) {
      let detail = res.statusText
      try {
        const parsed = (await res.json()) as { detail?: unknown; error?: unknown }
        const raw = parsed.detail ?? parsed.error
        if (typeof raw === 'string') detail = raw
      } catch {
        // non-JSON error body
      }
      const header = res.headers.get('Retry-After')
      // Only a positive, finite count of seconds is a usable hint: an HTTP-date Retry-After
      // parses to NaN, and 0 or a negative says nothing a countdown could show.
      const seconds = header === null ? Number.NaN : Number(header)
      const retryAfter = Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
      handlers.onError({
        kind: statusKind(res.status),
        message: detail,
        ...(retryAfter === undefined ? {} : { retry_after: retryAfter }),
      })
      return 'error'
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let terminal: 'done' | 'error' | null = null
    let caught: ChatOutcome | null = null
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, rest } = extractFrames(buffer)
        buffer = rest
        for (const frame of frames) {
          terminal = dispatchFrame(frame, handlers)
          if (terminal !== null) break // anything after a terminal event is not ours to read
        }
        if (terminal !== null) {
          // The answer is complete: hand the connection back instead of waiting on a server
          // that may hold it open, which would leave `finished` pending forever.
          await reader.cancel().catch(() => {})
          break
        }
      }
      if (terminal === null) {
        // A truncating proxy can eat the final blank line. Re-terminate the tail once so a
        // complete answer is not reported as 'interrupted'; a genuinely partial frame still
        // fails to parse and is dropped.
        for (const frame of extractFrames(`${buffer}\n\n`).frames) {
          terminal = dispatchFrame(frame, handlers)
          if (terminal !== null) break
        }
      }
    } catch (err) {
      if (isAbortError(err)) caught = 'aborted'
      else {
        // The reader OR a handler threw. Log the real cause first: without it, a UI bug
        // inside onToken masquerades as a network fault forever.
        console.error(err)
        handlers.onError({ kind: 'network', message: 'The stream failed mid-answer.' })
        caught = 'error'
      }
    } finally {
      // Every other exit — abort, a throwing handler, a stream that ended on its own —
      // releases the request too. A second cancel() after the terminal one is a no-op.
      void reader.cancel().catch(() => {})
    }
    if (caught !== null) return caught
    if (terminal !== null) return terminal
    // OUTSIDE the try on purpose: if this handler throws, the catch above must not run and
    // report a second, wrong 'network' error on top of it.
    handlers.onError({ kind: 'interrupted', message: 'The stream ended unexpectedly.' })
    return 'interrupted'
  })().catch((err: unknown): ChatOutcome => {
    // Last resort: `finished` must resolve even when a handler throws, because the drawer
    // awaits it to clear its streaming state — an unhandled rejection would strand the UI.
    console.error(err)
    return 'error'
  })
  return { abort: () => controller.abort(), finished }
}
