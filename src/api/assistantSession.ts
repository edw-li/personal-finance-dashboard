// Assistant session state (2026-09-01 spec §9): sessionStorage like the update wizard's
// drafts — "this sitting", never localStorage, so a closed tab forgets the conversation.
// Deliberately React-free: the SSE client's 401 path and AuthContext's logout both clear
// it, and the former has no component tree to hang a hook on.

export interface TranscriptTool {
  name: string
  summary: string
  done: boolean
}

export interface TranscriptError {
  kind: string
  message: string
  /** The server's rate-limit hint, in seconds, carried through from the error event so the
   *  bubble can count down to a live Retry (spec §9). Absent when it gave none. */
  retry_after?: number
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
  /** The server's one-line progress report while the answer is still empty ("Reading your
   *  spending…"). UI chrome only: cleared by the first token and never sent upstream. */
  status?: string
  /** The model's reasoning stream, accumulated (see appendThinking). Shown in a collapsible
   *  block; never replayed upstream — some completion endpoints reject a reasoning trace
   *  replayed as assistant content, and it is not conversation in any case. */
  thinking?: string
}

const TRANSCRIPT_KEY = 'assistant:transcript'
const MODEL_KEY = 'assistant:model'

/** Reasoning streams are unbounded, and every chunk mirrors to sessionStorage. 4000 chars
 *  is a few screens of scrollback — enough to see what the model was weighing, small enough
 *  that a runaway trace cannot blow the storage quota out from under the transcript. */
export const THINKING_CAP = 4000

/** Appends a reasoning chunk, keeping the NEWEST characters. The opposite end from the
 *  message-content cap, deliberately: history is truncated at the head because the model has
 *  already been shown it, whereas the reasoning tail is the part a reader is watching. */
export function appendThinking(current: string | undefined, chunk: string): string {
  return `${current ?? ''}${chunk}`.slice(-THINKING_CAP)
}

// Latched by clearAssistantSession(), and the reason both writers below check it: on the
// 401 path the wipe is followed by window.location.assign('/login'), and that navigation
// takes MILLISECONDS to commit. The document keeps running meanwhile, so an SSE token
// already in flight can still reach setTranscript, whose mirror effect would re-persist
// the very transcript we just deleted — a resurrection the redirect then leaves behind for
// the next person through this tab. The latch closes that window for good.
let sessionEnded = false

/** Bounds sessionStorage; the server caps messages per request separately (last 20). */
export const TRANSCRIPT_CAP = 40

// A shape check, not a validator (readDraft's posture): anything the drawer will later
// dereference — role and content — must be there, because a hand-edited or half-written
// entry would otherwise crash the render rather than the read.
function isTranscriptItem(value: unknown): value is TranscriptItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as TranscriptItem
  return (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string'
}

export function readAssistantTranscript(): TranscriptItem[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(TRANSCRIPT_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isTranscriptItem) : []
  } catch {
    return [] // a corrupt entry is discarded, never thrown (the wizard-draft posture)
  }
}

export function writeAssistantTranscript(items: TranscriptItem[]): void {
  if (sessionEnded) return
  try {
    sessionStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(items.slice(-TRANSCRIPT_CAP)))
  } catch {
    // Storage full or blocked — losing persistence is acceptable (Layout's scroll map).
  }
}

export function readAssistantModel(): string | null {
  try {
    return sessionStorage.getItem(MODEL_KEY)
  } catch {
    return null // storage blocked entirely — fall back to the server's default model
  }
}

export function writeAssistantModel(key: string): void {
  if (sessionEnded) return
  try {
    sessionStorage.setItem(MODEL_KEY, key)
  } catch {
    // Same posture as the transcript write.
  }
}

/** Re-arms the writers after a session end that did NOT tear the document down. Called on
 *  a successful login: logout and the login that follows it are both client-side route
 *  changes (AuthContext's setEmail → ProtectedRoute → LoginPage → navigate('/')), so this
 *  module outlives them, and without this the latch would silently disable assistant
 *  persistence for the rest of the tab's life. The 401 path needs no such call — that one
 *  really does replace the document. */
export function beginAssistantSession(): void {
  sessionEnded = false
}

export function clearAssistantSession(): void {
  sessionEnded = true
  try {
    sessionStorage.removeItem(TRANSCRIPT_KEY)
    sessionStorage.removeItem(MODEL_KEY)
  } catch {
    // This runs on the 401 and logout paths: a blocked-storage throw here would abort the
    // redirect that actually protects the session. A stale transcript is the lesser evil.
  }
}
