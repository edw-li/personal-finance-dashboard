import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { OwnerScope } from '../../api/netWorth'
import type { RangePreset } from '../../charts/timeZoom'

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

export function parseOwner(raw: string | null): OwnerScope | undefined {
  if (raw === null) return undefined
  if (raw === 'all') return null
  if (raw === 'joint') return 'joint'
  return /^\d{1,10}$/.test(raw) ? Number(raw) : undefined
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
    const parsed: unknown = JSON.parse(localStorage.getItem(SCOPE_KEY) ?? '{}')
    if (parsed === null || typeof parsed !== 'object') return {}
    const record = parsed as Record<string, unknown>
    const memory: ScopeMemory = {}
    if (record.owner === null || record.owner === 'joint' || typeof record.owner === 'number') {
      memory.owner = record.owner as OwnerScope
    }
    if (record.range === 'all' || record.range === '1y' || record.range === 'ytd') {
      memory.range = record.range
    }
    return memory
  } catch {
    return {}
  }
}

function writeMemory(next: ScopeMemory): void {
  try {
    localStorage.setItem(SCOPE_KEY, JSON.stringify(next))
  } catch {
    // Memory is a nicety; the URL still carries the truth.
  }
}

export function useScope(uses: ScopeUses = {}): {
  scope: Scope
  setScope: (partial: Partial<Scope>) => void
} {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawOwner = searchParams.get('owner')
  const rawRange = searchParams.get('range')
  const rawMonth = searchParams.get('month')

  const scope = useMemo<Scope>(() => {
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
    if (changed) setSearchParams(next, { replace: true })
  }, [uses.owner, uses.range, uses.month, rawOwner, rawRange, rawMonth, scope, searchParams, setSearchParams])

  const setScope = useCallback(
    (partial: Partial<Scope>) => {
      const next = new URLSearchParams(searchParams)
      const memory = readMemory()
      if (partial.owner !== undefined) {
        next.set('owner', ownerToParam(partial.owner))
        memory.owner = partial.owner
      }
      if (partial.range !== undefined) {
        next.set('range', partial.range)
        memory.range = partial.range
      }
      if ('month' in partial) {
        if (partial.month === null || partial.month === undefined) next.delete('month')
        else next.set('month', partial.month.slice(0, 7))
      }
      if (partial.owner !== undefined || partial.range !== undefined) writeMemory(memory)
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  return { scope, setScope }
}
