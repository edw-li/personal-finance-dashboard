import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useToast } from '../components/ToastProvider'
import { PIN_LIMIT, newPin, readPins, writePins, type Pin, type SandboxPage } from './pins'
import { readEntries, withEntries } from './scenarioUrl'

// The sandbox hook (2026-09-03 planning-sandboxes spec §7). THE URL IS THE STATE: `scenario`
// derives from the `whatif` params through the page's `decode`; `set` encodes and writes ONE
// `replace` at the trailing edge of a debounce, so the address bar always names the request
// in flight and the back button leaves the page rather than replaying slider positions. No
// second copy of the knobs lives in React state (the useScope rule). Requests ride the
// page's `preview` — pure endpoints through apiReadOnly — under a sequence guard; a failure
// keeps the last result, marked `stale`, with the server's sentence. `busy`, `stale` and
// `pinResults` are DERIVED from run keys rather than set from effect bodies (react-hooks 7's
// set-state-in-effect rule): a run is in flight exactly when the current key has neither a
// result nor a recorded failure.

export interface SandboxSpec<S extends object, R> {
  page: SandboxPage
  /** Total: bad entries are dropped, never thrown. Define at MODULE scope — a stable identity
   *  keeps `scenario` referentially stable across renders. */
  decode: (entries: string[]) => S
  encode: (scenario: S) => string[]
  isEmpty: (scenario: S) => boolean
  /** The pure request; the hook never inspects R. May close over props. */
  preview: (scenario: S) => Promise<R>
  /** Two-sided payloads carry their own baseline; absent → the hook runs the empty scenario. */
  baselineOf?: (result: R) => R
  /** Pins (and the baseline) re-run when this changes: Taxes' year, Paycheck's profile/owner. */
  dataKey: string
  debounceMs?: number
  /** false while a panel is closed: no request leaves, pins wait. Default true. */
  enabled?: boolean
  /** One-sided pages only: an empty run the page already holds (Projection's
   *  `projection:default` snapshot) seeds `baseline` — and `result`, when the arrival scenario
   *  is empty — for an instant first paint; the mount run still revalidates. */
  initialBaseline?: R | null
  /** One-sided pages only: fires when a fresh empty run lands (Projection re-caches it). */
  onBaseline?: (baseline: R) => void
  /** The default pin label — the first two changed knobs ("401(k) 15% · HSA $250"). */
  labelFor?: (scenario: S) => string
}

export type PinResult<R> = R | 'pending' | { error: string }

export interface Sandbox<S extends object, R> {
  scenario: S
  /** The canonical entries of the live scenario (what a pin stores). */
  entries: string[]
  empty: boolean
  set: (patch: Partial<S> | ((current: S) => S), opts?: { immediate?: boolean; drop?: string[] }) => void
  reset: () => void
  baseline: R | null
  result: R | null
  busy: boolean
  error: string | null
  errorStatus: number | null
  /** `result` is older than `scenario`, and nothing is on the way to replace it. */
  stale: boolean
  pins: Pin[]
  pin: (label?: string) => void
  unpin: (id: string) => void
  pinResults: Record<string, PinResult<R>>
  /** The live scenario's shareable URL (path + search) — "Copy link". */
  link: string
}

export const DEFAULT_DEBOUNCE_MS = 250
// The key separator has to be a character no entry can contain, or joining is lossy:
// `['a:1', '', 'b:2']` and `['a:1', 'b:2']` share the empty join, so `?whatif=&whatif=a:5`
// would compare EQUAL to its own canonical form and the arrival rewrite would never drop the
// empty entry. US (unit separator) cannot appear in a decoded query value that survived the
// grammar's parsers, so it is the fence. EXPORTED because a panel that keys its own
// state on the entries is asking the same question this file's run key asks, and two
// spellings of the separator would eventually be two different answers.
export const SEP = '\u001f'

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'The scenario could not be computed'
}

interface RunState<R> {
  result: R | null
  resultKey: string | null
  baseline: R | null
  baselineKey: string | null
  error: string | null
  errorKey: string | null
  errorStatus: number | null
}

export function useSandbox<S extends object, R>(spec: SandboxSpec<S, R>): Sandbox<S, R> {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const toast = useToast()
  const { decode, encode, isEmpty, dataKey } = spec
  const enabled = spec.enabled !== false

  const entries = useMemo(() => readEntries(searchParams), [searchParams])
  const entriesKey = entries.join(SEP)
  const scenario = useMemo(() => decode(entries), [decode, entries])
  const canonical = useMemo(() => encode(scenario), [encode, scenario])
  const canonicalKey = canonical.join(SEP)
  const empty = isEmpty(scenario)
  // The RETRY counter (see `flush`): re-committing knobs that already failed writes a URL
  // identical to the one already up — "lot 4 already sold", asked again — which by itself
  // would say nothing. It is bumped ONLY for that; a commit onto a healthy run is a no-op,
  // or a drag would pay twice for the tick and the pointer-up that follows it.
  const [commits, setCommits] = useState(0)
  // A run is identified by WHAT it modelled, WHICH data it modelled against, and which ask.
  const runKey = `${dataKey}${SEP}${commits}${SEP}${canonicalKey}`

  const [run, setRun] = useState<RunState<R>>(() => {
    const seeded = spec.baselineOf === undefined ? (spec.initialBaseline ?? null) : null
    const arrivalEmpty = isEmpty(decode(readEntries(searchParams)))
    return {
      result: seeded !== null && arrivalEmpty ? seeded : null,
      resultKey: seeded !== null && arrivalEmpty ? runKey : null,
      baseline: seeded,
      baselineKey: seeded !== null ? dataKey : null,
      error: null,
      errorKey: null,
      errorStatus: null,
    }
  })

  // The latest spec, params and run verdict, readable from timers and promise callbacks.
  // Synced in an effect, not during render (react-hooks 7's refs rule); declared FIRST so
  // every effect below sees this render's values.
  const specRef = useRef(spec)
  const paramsRef = useRef(searchParams)
  const scenarioRef = useRef(scenario)
  const entriesKeyRef = useRef(entriesKey)
  // Did the run the URL currently names END IN A FAILURE? That is the only thing a commit
  // onto an unchanged URL can be asking for — see `flush`.
  const failedRef = useRef(false)
  useEffect(() => {
    specRef.current = spec
    paramsRef.current = searchParams
    scenarioRef.current = scenario
    entriesKeyRef.current = entriesKey
    failedRef.current = run.errorKey === runKey
  })

  // ── Arrival normalization (useArrivalParam's rule): unknown kinds and unparsable values
  // are dropped and the URL rewritten without them, replace-style; a canonical URL is left
  // alone, so this cannot loop (encode∘decode is identity — the grammar tests pin it).
  useEffect(() => {
    if (canonicalKey === entriesKey) return
    setSearchParams(withEntries(paramsRef.current, canonical), { replace: true })
  }, [canonical, canonicalKey, entriesKey, setSearchParams])

  // ── Debounced writes. `pendingRef` is the scenario the user is heading for; the URL only
  // learns it at the tick (Safari throttles replaceState — one write per gesture, not per
  // pixel). Successive drags compose on the pending value, not on the URL's.
  //
  // It survives the flush, exactly as useScope's does: `setSearchParams` does not update
  // `scenario` until react-router re-renders, so a second `set` in the SAME tick that started
  // from `scenarioRef` would compute its patch against the pre-write knobs and replace the
  // first write instead of adding to it. `base` is the URL the pending value was computed
  // from, `next` is what that URL will become.
  const pendingRef = useRef<{ base: string; next: string[] } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  // Landed (the entries are what we wrote) or superseded (they moved elsewhere): either way
  // the ref is no longer ahead of the URL. Only "still at the base" means in flight — which
  // includes the debounce window, where nothing has been written yet.
  useEffect(() => {
    const pending = pendingRef.current
    if (pending !== null && entriesKey !== pending.base) pendingRef.current = null
  }, [entriesKey])

  const flush = useCallback(
    (drop: string[] = []) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = null
      const pending = pendingRef.current
      if (pending === null) return
      const params = withEntries(paramsRef.current, pending.next, drop)
      if (params.toString() !== paramsRef.current.toString()) {
        // The URL says the scenario changed; the pending value stays parked until it lands.
        setSearchParams(params, { replace: true })
        return
      }
      // The address bar ALREADY reads this way, so the write would say nothing. Nothing is
      // ahead of the URL now — park nothing, or the landing effect above (keyed on
      // `entriesKey`) would never see it change and would hold a stale value for the page's
      // life. Then ask again only if there is something to retry: a run that FAILED, which is
      // what re-committing after "lot 4 already sold" means. Bumping unconditionally would
      // make every drag → tick → release spend a second identical request (spec §17).
      pendingRef.current = null
      if (failedRef.current) setCommits((n) => n + 1)
    },
    [setSearchParams],
  )

  /**
   * Patch the live scenario. ONE URL writer per tick: several `set` calls in the same tick
   * compose (each sees the previous one's pending entries), but a page that also writes the
   * search string itself — `setScope`, a drill param — must not do so in the same tick, since
   * whichever `setSearchParams` runs last wins outright. Sequence those through a handler.
   */
  const set = useCallback<Sandbox<S, R>['set']>(
    (patch, opts) => {
      const s = specRef.current
      const pending = pendingRef.current
      const base = pending !== null ? s.decode(pending.next) : scenarioRef.current
      const next = typeof patch === 'function' ? patch(base) : { ...base, ...patch }
      pendingRef.current = { base: pending?.base ?? entriesKeyRef.current, next: s.encode(next) }
      if (opts?.immediate) {
        flush(opts.drop)
        return
      }
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => flush(opts?.drop), s.debounceMs ?? DEFAULT_DEBOUNCE_MS)
    },
    [flush],
  )

  const reset = useCallback(() => {
    set(() => specRef.current.decode([]), { immediate: true })
  }, [set])

  // ── The one flight. Keyed on the run, not the scenario object: a sequence ref drops every
  // non-current answer (WhatIfPanel's and ProjectionPage's guard; no AbortController). The
  // deps are the run KEY alone — the arrival rewrite hands back an identical-but-new
  // `canonical` array, and re-requesting the same scenario for it would double every deep
  // link's first paint. `scenarioRef` (synced by the effect above, which runs first in this
  // same commit) is decode(entries) = decode(canonical), so it is what the key describes.
  const seqRef = useRef(0)
  useEffect(() => {
    if (!enabled) return
    const s = specRef.current
    const seq = ++seqRef.current
    const mine = runKey
    const modelled = scenarioRef.current
    const modelledEmpty = s.isEmpty(modelled)
    s.preview(modelled)
      .then((r) => {
        if (seq !== seqRef.current) return
        setRun((prev) => {
          const twoSided = s.baselineOf !== undefined
          const baseline = twoSided
            ? (s.baselineOf as (result: R) => R)(r)
            : modelledEmpty
              ? r
              : prev.baseline
          return {
            // A two-sided payload's empty run IS its own baseline: showing `r`'s scenario
            // side would print the server's "no changes asked for" nulls in the Scenario
            // column where the actual figures belong.
            result: twoSided && modelledEmpty ? (baseline as R) : r,
            resultKey: mine,
            baseline,
            baselineKey: twoSided || modelledEmpty ? s.dataKey : prev.baselineKey,
            error: null,
            errorKey: null,
            errorStatus: null,
          }
        })
        if (s.baselineOf === undefined && modelledEmpty) s.onBaseline?.(r)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setRun((prev) => ({
          ...prev,
          error: messageOf(err),
          errorKey: mine,
          errorStatus: err instanceof ApiError ? err.status : null,
        }))
      })
  }, [enabled, runKey])

  // ── One-sided pages: a non-empty arrival still needs the empty run once per dataKey.
  const needsBaseline = enabled && spec.baselineOf === undefined && !empty && run.baselineKey !== dataKey
  useEffect(() => {
    if (!needsBaseline) return
    const s = specRef.current
    const key = s.dataKey
    let alive = true
    s.preview(s.decode([]))
      .then((r) => {
        if (!alive) return
        setRun((prev) => ({ ...prev, baseline: r, baselineKey: key }))
        s.onBaseline?.(r)
      })
      .catch(() => {
        // The live run's failure speaks for both; a baseline that would not compute is
        // simply absent, and CompareTable prints the em dash.
      })
    return () => {
      alive = false
    }
  }, [needsBaseline, dataKey])

  // ── Pins: read once per page, validated with the page's decoder; every pin re-runs on
  // mount and on each dataKey change. `pinRuns` remembers the key each answer was for, so
  // "pending" is derived — a pin whose stored key is not the current one is still running.
  const [pins, setPins] = useState<Pin[]>(() => readPins(spec.page, (stored) => !isEmpty(decode(stored))))
  const [pinRuns, setPinRuns] = useState<Record<string, { key: string; value: R | { error: string } }>>({})
  const pinStarted = useRef<Record<string, string>>({})
  const pinSeq = useRef<Record<string, number>>({})
  useEffect(() => {
    if (!enabled) return
    const s = specRef.current
    const key = s.dataKey
    for (const p of pins) {
      if (pinStarted.current[p.id] === key) continue
      pinStarted.current[p.id] = key
      const gen = (pinSeq.current[p.id] = (pinSeq.current[p.id] ?? 0) + 1)
      s.preview(s.decode(p.entries))
        .then((r) => {
          if (pinSeq.current[p.id] !== gen) return
          setPinRuns((cur) => ({ ...cur, [p.id]: { key, value: r } }))
        })
        .catch((err: unknown) => {
          if (pinSeq.current[p.id] !== gen) return
          setPinRuns((cur) => ({ ...cur, [p.id]: { key, value: { error: messageOf(err) } } }))
        })
    }
  }, [enabled, dataKey, pins])

  const pinResults = useMemo<Record<string, PinResult<R>>>(() => {
    const out: Record<string, PinResult<R>> = {}
    for (const p of pins) {
      const stored = pinRuns[p.id]
      out[p.id] = stored !== undefined && stored.key === dataKey ? stored.value : 'pending'
    }
    return out
  }, [pins, pinRuns, dataKey])

  // The list is rebuilt from THIS render's `pins` rather than inside a setState updater:
  // an updater must be pure, and both of these write storage and (at the limit) a toast.
  const pin = useCallback(
    (label?: string) => {
      const s = specRef.current
      const live = pendingRef.current?.next ?? s.encode(scenarioRef.current)
      if (s.isEmpty(s.decode(live))) return
      if (pins.length >= PIN_LIMIT) {
        toast.info('Unpin one first')
        return
      }
      const text = label?.trim() || s.labelFor?.(s.decode(live)) || `Scenario ${pins.length + 1}`
      const next = [...pins, newPin(text, live)]
      writePins(s.page, next)
      setPins(next)
    },
    [pins, toast],
  )

  const unpin = useCallback(
    (id: string) => {
      const next = pins.filter((p) => p.id !== id)
      writePins(specRef.current.page, next)
      setPins(next)
    },
    [pins],
  )

  const busy = enabled && run.resultKey !== runKey && run.errorKey !== runKey
  // Stale is what the banner says while nothing is on the way: a result older than the
  // scenario WITH a request in flight is just the dimmed body Feed already draws.
  const stale = !busy && run.result !== null && run.resultKey !== runKey
  const error = run.errorKey === runKey ? run.error : null
  const search = searchParams.toString()

  return {
    scenario,
    entries: canonical,
    empty,
    set,
    reset,
    baseline: run.baseline,
    result: run.result,
    busy,
    error,
    errorStatus: run.errorKey === runKey ? run.errorStatus : null,
    stale,
    pins,
    pin,
    unpin,
    pinResults,
    link: `${location.pathname}${search === '' ? '' : `?${search}`}`,
  }
}
