import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { OwnerScope } from '../../api/netWorth'
import type { RangePreset } from '../../charts/timeZoom'
import { getLocal, setLocal } from '../../prefs/prefsStore'

// The ONE scope rule (2026-09-03 shell spec §6): the URL is the source of truth, localStorage
// remembers owner and range across pages, defaults fill whatever is left. `month` is never
// remembered — it means something different on every page that has one.
export const SCOPE_KEY = 'finance.scope'
export const DEFAULT_RANGE: RangePreset = '1y'

export interface Scope {
  owner: OwnerScope
  range: RangePreset
  /** First-of-month ISO date, or null for "the latest / none". */
  month: string | null
}

/** Which keys a page uses — only those are normalized INTO the URL on arrival. */
export interface ScopeUses {
  owner?: boolean
  range?: boolean
  month?: boolean
}

interface ScopeMemory {
  owner?: OwnerScope
  range?: RangePreset
}

/** A person owner is a real person row id: whole and positive. `0` is not a person. */
const isPersonId = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0

export function parseOwner(raw: string | null): OwnerScope | undefined {
  if (raw === null) return undefined
  if (raw === 'all') return null
  if (raw === 'joint') return 'joint'
  if (!/^\d{1,10}$/.test(raw)) return undefined
  const id = Number(raw)
  return isPersonId(id) ? id : undefined
}

export function parseRange(raw: string | null): RangePreset | undefined {
  return raw === 'all' || raw === '1y' || raw === 'ytd' ? raw : undefined
}

/** `YYYY-MM` in the URL → the app's `YYYY-MM-01` month currency. A legacy `YYYY-MM-DD` deep
 *  link (Overview → Spending drills, the wizard's own param) is accepted too — its day is
 *  dropped — and the arrival normalization below rewrites it to the short form. */
export function parseMonth(raw: string | null): string | undefined {
  if (raw === null) return undefined
  const match = /^(\d{4}-(?:0[1-9]|1[0-2]))(?:-\d{2})?$/.exec(raw)
  return match ? `${match[1]}-01` : undefined
}

export function ownerToParam(owner: OwnerScope): string {
  return owner === null ? 'all' : String(owner)
}

export function readMemory(): ScopeMemory {
  try {
    const parsed: unknown = getLocal('scope') ?? {}
    if (parsed === null || typeof parsed !== 'object') return {}
    const record = parsed as Record<string, unknown>
    const memory: ScopeMemory = {}
    // Storage is user-writable and survives schema changes — validate it with the same
    // predicates the URL goes through rather than trusting whatever is on disk.
    if (record.owner === null || record.owner === 'joint' || isPersonId(record.owner)) {
      memory.owner = record.owner
    }
    const range = typeof record.range === 'string' ? parseRange(record.range) : undefined
    if (range !== undefined) memory.range = range
    return memory
  } catch {
    return {}
  }
}

function writeMemory(next: ScopeMemory): void {
  // Through the store: it swallows a blocked localStorage (the URL still carries the truth)
  // and mirrors the memory to the account (2026-09-03 data-lifecycle spec §10).
  setLocal('scope', next)
}

export function useScope(uses: ScopeUses = {}): {
  scope: Scope
  setScope: (partial: Partial<Scope>) => void
} {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawOwner = searchParams.get('owner')
  const rawRange = searchParams.get('range')
  const rawMonth = searchParams.get('month')

  // react-router's setter — functional form included — hands back the RENDER's params, not the
  // live URL, so two setScope calls in one tick would each start from the same snapshot and the
  // second would drop the first's key. The ref carries the uncommitted params until the URL
  // catches up: `base` is the URL the write was computed from, `next` is what it will become.
  const pendingRef = useRef<{ base: string; next: URLSearchParams } | null>(null)
  useEffect(() => {
    // Landed (the URL is what we wrote) or superseded (the URL moved elsewhere): either way the
    // ref is no longer ahead of the URL. Only "URL still at the base" means in flight — which
    // includes a write a CHILD effect parked earlier in this same commit, since child effects run
    // before ours. An unconditional clear here would erase that write and normalization, building
    // `next` from the stale params, would then replace it away.
    const pending = pendingRef.current
    if (pending && searchParams.toString() !== pending.base) pendingRef.current = null
  }, [searchParams])

  const scope = useMemo<Scope>(() => {
    // Memory is a one-shot fallback for the keys the URL left empty, not a subscription to
    // another tab's edits — hence the raw-value-only dep list below.
    const memory = readMemory()
    const owner = parseOwner(rawOwner)
    const range = parseRange(rawRange)
    return {
      owner: owner !== undefined ? owner : (memory.owner ?? null),
      range: range !== undefined ? range : (memory.range ?? DEFAULT_RANGE),
      month: parseMonth(rawMonth) ?? null,
    }
  }, [rawOwner, rawRange, rawMonth])

  // Arrival normalization: a page that USES a key gets it written into the URL when it is
  // absent or garbage, so every view is shareable. Replace, never push (the drill-param
  // convention) — the back button never sees this. Idempotent: it only fires when the URL
  // actually differs from what the scope resolved to.
  useEffect(() => {
    if (pendingRef.current) return // a write is in flight; this re-runs when it lands
    const next = new URLSearchParams(searchParams)
    let changed = false
    if (uses.owner && rawOwner !== ownerToParam(scope.owner)) {
      next.set('owner', ownerToParam(scope.owner))
      changed = true
    }
    if (uses.range && rawRange !== scope.range) {
      next.set('range', scope.range)
      changed = true
    }
    if (uses.month && rawMonth !== null) {
      const parsed = parseMonth(rawMonth)
      if (parsed === undefined) {
        next.delete('month') // garbage month: drop it rather than invent one
        changed = true
      } else if (rawMonth !== parsed.slice(0, 7)) {
        next.set('month', parsed.slice(0, 7)) // legacy YYYY-MM-DD link → the short grammar
        changed = true
      }
    }
    if (changed) {
      pendingRef.current = { base: searchParams.toString(), next }
      setSearchParams(next, { replace: true })
    }
  }, [uses.owner, uses.range, uses.month, rawOwner, rawRange, rawMonth, scope, searchParams, setSearchParams])

  const setScope = useCallback(
    (partial: Partial<Scope>) => {
      const seed = pendingRef.current?.next ?? searchParams
      const next = new URLSearchParams(seed)
      const memory = readMemory()
      if (partial.owner !== undefined) {
        next.set('owner', ownerToParam(partial.owner))
        memory.owner = partial.owner
      }
      if (partial.range !== undefined) {
        next.set('range', partial.range)
        memory.range = partial.range
      }
      // `month: undefined` means "leave the month alone" (the field is simply absent from a
      // partial); only an explicit null clears it, and a string has to survive parseMonth.
      if (partial.month === null) {
        next.delete('month')
      } else if (partial.month !== undefined) {
        const month = parseMonth(partial.month)
        if (month !== undefined) next.set('month', month.slice(0, 7))
      }
      // Memory records a deliberate pick even when the URL already agrees, so it stays ahead of
      // the no-op check below.
      if (partial.owner !== undefined || partial.range !== undefined) writeMemory(memory)
      // Nothing to write: no location.key churn, and — the load-bearing half — no phantom
      // pending write whose base equals the URL, which would never clear and would wedge
      // normalization for the life of the page.
      if (next.toString() === seed.toString()) return
      // A same-tick revert (pick, then pick back) lands on the string the URL already has. The
      // write still has to go out to override the one in flight, but parking it would leave a
      // pending entry whose base IS the URL: react-router hands back the same params object for
      // an unchanged search string, so the clear effect never re-runs and normalization would
      // stay gated for the life of the page. Nothing is ahead of the URL here — drop it instead.
      pendingRef.current =
        next.toString() === searchParams.toString() ? null : { base: searchParams.toString(), next }
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  return { scope, setScope }
}
