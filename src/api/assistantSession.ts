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
    return [] // a corrupt entry is discarded, never thrown (the wizard-draft posture)
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
