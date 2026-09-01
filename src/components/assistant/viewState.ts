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
  // Frozen because readAssistantView() hands out the live singleton: a caller that mutated
  // it would silently rewrite what the drawer snapshots at send time.
  currentView = Object.freeze(view)
  version += 1
  listeners.forEach((listener) => listener())
}

/** One call per page — last writer wins, and any publisher's unmount blanks the view for
 *  all. Two concurrent publishers are unsupported. Serialized dep: a fresh object literal
 *  each render must not republish (the memo-dep idiom the pages already use for people
 *  lists). */
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
  // CustomEvent rather than Event so a future prefill can ride along in `detail` without
  // changing every listener; there is no payload today.
  window.dispatchEvent(new CustomEvent(ASSISTANT_OPEN_EVENT))
}
