import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import {
  cloneBrackets,
  deleteTaxYear,
  fetchTaxBrackets,
  fetchTaxInputs,
  fetchTaxSummary,
  fetchTaxYears,
  FILING_STATUS_LABELS,
  FILING_STATUSES,
  patchTaxYear,
  putTaxInputs,
} from '../api/taxes'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import { useAssistantView } from '../components/assistant/viewState'
import InfoHint from '../components/InfoHint'
import Feed, { FeedBanner } from '../components/shell/Feed'
import PageFrame from '../components/shell/PageFrame'
import BracketsEditor from '../components/taxes/BracketsEditor'
import CompositionPanel from '../components/taxes/CompositionPanel'
import InputsForm from '../components/taxes/InputsForm'
import MarginalPanel from '../components/taxes/MarginalPanel'
import SummaryPanel from '../components/taxes/SummaryPanel'
import WhatIfPanel from '../components/taxes/WhatIfPanel'
// TYPE-only, and deliberately its own statement: the page test mocks this module's RUNTIME
// with a default-only factory, so a value import of anything else would crash there. An
// `import type` is erased before the mock ever sees it.
import type { OverrideDefinition } from '../components/taxes/WhatIfPanel'
import WithholdingPanel from '../components/taxes/WithholdingPanel'
import type {
  ChangedInput,
  FilingStatus,
  TaxBracketsOut,
  TaxInputsOut,
  TaxSummaryOut,
  TaxYearOut,
} from '../types/api'
import { formatCurrency } from '../utils/format'
import '../components/panels.css'
import './TaxesPage.css'

// The router's own century guard (app/api/taxes.py YEAR_MIN/YEAR_MAX) — refuse a typo
// here rather than spending a request on a 422.
const YEAR_MIN = 1900
const YEAR_MAX = 2100

// The three payloads of ONE year, replaced together: a half-updated page would show one
// year's brackets under another year's totals.
interface YearDetail {
  inputs: TaxInputsOut
  brackets: TaxBracketsOut
  summary: TaxSummaryOut
}

/**
 * The identity that must REMOUNT the two editors, taken from the PAYLOADS rather than from
 * the page's idea of the year's status.
 *
 * Their state is keyed by cell id — (key, person) in the inputs form, (jurisdiction, status)
 * in the brackets editor — and seeds from a useState INITIALIZER, so a namespace change that
 * does not remount them leaves every new box reading blank. The page's own `filingStatus`
 * cannot be that key: a status flip replaces the year ROW (and the selector) one render
 * BEFORE the new payloads land, so keying on it would remount the editors against the OLD
 * payloads and then leave them mounted when the real ones arrive. The payload's own status
 * and column list move exactly when its cell ids do.
 */
function inputsKey(inputs: TaxInputsOut): string {
  const columns = inputs.people.map((person) => person.id).join('.')
  return `inputs-${inputs.year}-${inputs.filing_status}-${columns}`
}

function bracketsKey(brackets: TaxBracketsOut): string {
  return `brackets-${brackets.year}-${brackets.filing_status}`
}

// D1: the override select's option list — every definition ONCE, payload order, label from
// the definition table. Per-person keys repeat once per column in the payload; overrides
// address the HOUSEHOLD key map, so the dedupe is the semantics, not a display nicety.
/** The keys the definition table stores once per PERSON (`is_per_person`), mapped to the
 *  label the form shows for them. The what-if overrides the SUMMED household figure, so on a
 *  multi-column year these are the keys Apply cannot write. */
function perPersonLabels(inputs: TaxInputsOut): Map<string, string> {
  const labels = new Map<string, string>()
  for (const section of inputs.sections)
    for (const item of section.items)
      if (item.is_per_person && !labels.has(item.key)) labels.set(item.key, item.label)
  return labels
}

function overrideDefinitions(inputs: TaxInputsOut): OverrideDefinition[] {
  const seen = new Set<string>()
  const definitions: OverrideDefinition[] = []
  for (const section of inputs.sections)
    for (const item of section.items) {
      if (seen.has(item.key)) continue
      seen.add(item.key)
      definitions.push({ key: item.key, label: item.label })
    }
  return definitions
}

// D4: the PRIMARY person's stored w2_stock_rsus_sold — the payload orders columns primary
// first, and a roster-less year spells the primary as person_id null.
function vestW2Stored(inputs: TaxInputsOut): string | null {
  const primary = inputs.people[0]?.id ?? null
  for (const section of inputs.sections)
    for (const item of section.items)
      if (
        item.key === 'w2_stock_rsus_sold' &&
        (item.person_id === primary || item.person_id === null)
      )
        return item.value
  return null
}

function latestOf(years: TaxYearOut[]): TaxYearOut | undefined {
  // The router already orders by year; reducing makes the page independent of that.
  return years.length === 0 ? undefined : years.reduce((a, b) => (b.year > a.year ? b : a))
}

// One snapshot per (year, filing status): the brackets GET names a status, so the same
// year under a different status is a DIFFERENT payload.
function detailKey(year: number, filingStatus: FilingStatus): string {
  return `taxes:detail:${year}:${filingStatus}`
}

export default function TaxesPage() {
  // The selected tax year lives in the URL (2026-09-03 sandbox lane T). Every card on this
  // page answers for ONE year — the what-if card most of all, whose entries mean nothing
  // against the wrong one — so a shared address has to name it, and the assistant's
  // "Open in what-if" link emits /taxes?whatif=…&year=YYYY.
  //
  // NOT the same key as CompositionPanel's drill, which is ?comp=: that card's resting
  // state is "no drill at all", which a selected year cannot express.
  const [searchParams, setSearchParams] = useSearchParams()
  const yearParam = Number(searchParams.get('year'))
  // A garbled or hand-edited ?year= is nobody's year: null falls back to the latest, the way
  // a bare /taxes does, rather than banner-ing about a URL nobody typed. Number(null) and
  // Number('') are both 0, which the > 0 fence sends the same way as NaN.
  const urlYear = Number.isInteger(yearParam) && yearParam > 0 ? yearParam : null
  // The year the page was ARRIVED at, pinned: `loadYears` runs from a mount effect and must
  // open the year the link named, not whatever the param has since become.
  const [arrivalYear] = useState(urlYear)

  // The seeded selection replicates loadYears' pick (the URL's year, else the latest), and
  // the seeded detail reads that year's key using ITS OWN filing status from the cached row.
  const cachedYears = getSnapshot<TaxYearOut[]>('taxes:years')
  const cachedLatest = cachedYears !== undefined ? latestOf(cachedYears) : undefined
  // Only a year the cached list actually carries can be seeded — the row is where the
  // filing status the detail snapshot is keyed by comes from.
  const cachedPick =
    cachedYears === undefined
      ? undefined
      : (cachedYears.find((y) => y.year === arrivalYear) ?? cachedLatest)
  const [years, setYears] = useState<TaxYearOut[]>(cachedYears ?? [])
  // An OBJECT, not a bare number: a fresh identity re-runs the load effect, so selecting
  // the year that is already selected (right after cloning into it) still refetches.
  const [selection, setSelection] = useState<{ year: number } | null>(
    cachedPick ? { year: cachedPick.year } : null,
  )
  const [detail, setDetail] = useState<YearDetail | null>(() =>
    cachedPick
      ? (getSnapshot<YearDetail>(detailKey(cachedPick.year, cachedPick.filing_status)) ?? null)
      : null,
  )
  const [loading, setLoading] = useState(cachedYears === undefined) // the year list
  // A FIRST list load that failed must not also claim the database is empty: the empty
  // state belongs to a load that actually came back (PortfolioPage's null-holdings rule).
  const [loadedOnce, setLoadedOnce] = useState(cachedYears !== undefined)
  const [busy, setBusy] = useState(true) // the selected year's three payloads
  // Two buckets, because they mean two different things on screen: `error` is about the
  // year LIST (the page's own lifecycle — a first-load failure IS the page, a later one
  // rides the frame's "showing earlier data" line), while `yearError` is about the selected
  // year and the actions taken on it — a detail load, a filing-status PATCH, a totals
  // refresh, a delete. Those are not staleness; they are refusals, and they keep the
  // assertive banner beside the year they belong to.
  const [error, setError] = useState<string | null>(null)
  const [yearError, setYearError] = useState<string | null>(null)
  const [newYear, setNewYear] = useState(() =>
    cachedYears !== undefined
      ? String(cachedLatest ? cachedLatest.year + 1 : new Date().getFullYear())
      : '',
  )
  const [creating, setCreating] = useState(false)
  // The status PATCH is single-flight of its own: it is not a "load", so it must not ride the
  // detail `busy` flag, and a second press mid-flight would race two reloads of one year.
  const [statusSaving, setStatusSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // What the two editors report about their own unsaved work — a reload destroys it, so
  // every path that reloads asks first.
  const [inputsDirty, setInputsDirty] = useState(false)
  const [bracketsDirty, setBracketsDirty] = useState(false)
  // A save (or a filing-status flip) moves the engine's answer for one year, which moves
  // that year's column in the panel's ALL-years trend too. The panel owns that feed, so
  // the page just counts the changes and lets the panel refetch on the new value —
  // cheaper than hoisting a second load chain into this component's eleven setters.
  const [trendRefresh, setTrendRefresh] = useState(0)
  // D4: bumped when an inputs write lands from OUTSIDE the form (the withholding card's
  // Apply). The form deliberately ignores prop replacement to protect typed work, so an
  // external echo must REMOUNT it — this rides its key. The chip confirmed any discard
  // before PUTting, so the remount never eats work silently.
  const [inputsEpoch, setInputsEpoch] = useState(0)
  // Year chips can be clicked faster than three requests come back — a slow earlier year
  // must never overwrite a later one (PortfolioPage's guard).
  const seqRef = useRef(0)
  // The totals refetch runs its own race: two saves in a row are two summaries in flight,
  // and only the newest may land (or raise a banner). loadYear bumps it too, so a refresh
  // started under the previous year cannot report anything at all.
  const summarySeqRef = useRef(0)
  // The year the page belongs to RIGHT NOW, readable from a callback that a since-unmounted
  // editor is still holding (its closure remembers the year it was rendered for).
  const currentYearRef = useRef<number | null>(null)

  // Everything entering a year does EXCEPT the URL write. Two callers: `loadYear` below
  // (which writes ?year= too) and the in-page navigate above, which arrives with the URL
  // already moved and must not write it back. Setters and a pure snapshot read only — no ref
  // writes, because the render-adjust path calls it during render.
  const enterYear = (year: number) => {
    setBusy(true)
    setError(null)
    setYearError(null)
    // A create error is about the form above, and the form's own state moved on the moment
    // the user navigated — leaving the sentence there would answer a question nobody asked.
    setCreateError(null)
    // Already-seen year: paint its detail instantly and revalidate underneath.
    const status = years.find((y) => y.year === year)?.filing_status ?? 'single'
    const peeked = getSnapshot<YearDetail>(detailKey(year, status))
    if (peeked !== undefined) setDetail(peeked)
    setSelection({ year })
  }

  // Guarded adjust-during-render, never a setState in an effect body (react-hooks 7): the
  // URL moved to a year this page is not showing — an in-page navigate from the assistant's
  // what-if link, or the palette, while /taxes is already mounted — so the page follows in
  // the SAME commit rather than painting the old year first. Only a CHANGE in the param
  // does this: the doors below write it themselves, and re-running every render would fight
  // the chips. A year the list does not carry is left alone, exactly as on arrival.
  //
  // Deliberately no discard confirm: `window.confirm` is a side effect, and render is not
  // where one may be asked. A navigate is not a chip click — the address bar has already
  // moved on, and refusing it would leave the URL lying about what is on screen.
  const [seenYearParam, setSeenYearParam] = useState(urlYear)
  if (urlYear !== seenYearParam) {
    setSeenYearParam(urlYear)
    if (urlYear !== null && urlYear !== selection?.year && years.some((y) => y.year === urlYear)) {
      // The SAME bookkeeping the chips get — this is a year switch, and half of one would
      // leave a create sentence and a stale snapshot behind it. `enterYear` is loadYear
      // minus the URL write, which this path must not do: the address bar already moved.
      enterYear(urlYear)
    }
  }

  const selectedYear = selection?.year ?? null
  // The selected year's ROW, so the selector reads the same list the chips do — one source
  // for "how is this year filed". A year the list has not caught up with (the optimistic
  // chip a create just pushed) reads as 'single', which is the column's own default.
  const filingStatus: FilingStatus =
    years.find((y) => y.year === selectedYear)?.filing_status ?? 'single'
  // Only while the editors are mounted: a failed load unmounts them, and their last
  // reported flag must not outlive them into a spurious confirm.
  const dirty = detail !== null && (inputsDirty || bracketsDirty)

  // The assistant answers against the year on screen (2026-09-01 spec §6).
  useAssistantView({ year: selectedYear, filingStatus })

  // The year list alone: no selection change, no busy flip, nothing that blinks. It is the
  // reconciler behind an optimistic create and behind the chip counts a save moves, and
  // each caller decides for itself what a rejection means.
  const reconcileYears = () => fetchTaxYears().then((list) => setYears(list))

  // Counts on the chips are decoration. A save that SUCCEEDED must not end at an error
  // banner because the refresh of its side effects did not, so this one swallows.
  const refreshYearCounts = () => {
    reconcileYears().catch(() => undefined)
  }

  // Promise callbacks only: no setState in an effect's synchronous body (react-hooks 7).
  // The mount fetch is covered by the initial loading/busy values; the retry button flips
  // them itself. Re-created per render but reading no reactive value beyond the setters,
  // so exhaustive-deps has nothing to report (PortfolioPage's `load`) — which is why the
  // year to open is a PARAMETER rather than a closed-over one.
  const loadYears = (prefer: number | null) => {
    fetchTaxYears()
      .then((list) => {
        const previous = getSnapshot<TaxYearOut[]>('taxes:years')
        setSnapshot('taxes:years', list)
        setLoadedOnce(true)
        setError(null)
        // Identical list: everything on screen already came from the same seed (spec §1).
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(list)) {
          if (!latestOf(list)) setBusy(false) // seeded-empty case: nothing to load
          return
        }
        setYears(list)
        const latest = latestOf(list)
        setNewYear(String(latest ? latest.year + 1 : new Date().getFullYear()))
        // The preferred year wins when the list carries it; anything else — absent, garbled,
        // a year that is gone — falls back to the latest and is LEFT in the URL rather than
        // corrected here. This page writes the param from its own doors only: a write from
        // a load continuation could land in the same tick as the what-if card's own URL
        // write, and whichever setSearchParams ran last would silently drop the other
        // (useSandbox's "one URL writer per tick").
        const picked = list.find((y) => y.year === prefer) ?? latest
        if (picked) {
          setSelection({ year: picked.year })
        } else {
          // Fresh database: there is nothing to load, so release the detail flag here —
          // the new-year form IS the page.
          setBusy(false)
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load tax years')
        setBusy(false)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    // `arrivalYear` is pinned at mount, so this still runs exactly once.
    loadYears(arrivalYear)
  }, [arrivalYear])

  // The chain lives inline rather than in a useCallback: this component owns eleven
  // setters, and manual memoization React Compiler cannot preserve drops the whole
  // component out of compilation (MonthlyUpdatePage's note).
  // `filingStatus` is a second reload key, not just a read: the brackets GET names a status
  // (its server-side default is 'single', NOT the year's own), so the tables on screen would
  // otherwise be single's under a married year. Both it and `selection` move in ONE batched
  // render on a status flip, so the pair re-runs this effect exactly once.
  useEffect(() => {
    if (selection === null) return
    const year = selection.year
    currentYearRef.current = year
    // Any totals refresh still in flight belongs to the year being LEFT. Here rather than in
    // the handlers, so every door into a year gets it — including the render adjust above,
    // where a ref write would be illegal — and so a filing-status flip drops one too.
    summarySeqRef.current += 1
    const seq = ++seqRef.current
    Promise.all([
      fetchTaxInputs(year),
      fetchTaxBrackets(year, filingStatus),
      fetchTaxSummary(year),
    ])
      .then(([inputs, brackets, summary]) => {
        if (seq !== seqRef.current) return
        const payload: YearDetail = { inputs, brackets, summary }
        const key = detailKey(year, filingStatus)
        const previous = getSnapshot<YearDetail>(key)
        setSnapshot(key, payload)
        // Identical payload: nothing re-renders (spec §1).
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(payload))
          return
        setDetail(payload)
        // No setError(null) here: every path that selects a year already cleared the
        // banner, and clearing it again would wipe a message raised meanwhile by the
        // list reconcile that runs ALONGSIDE this load (the create flow's).
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        // Drop the previous year's data: left on screen it would read as this year's.
        setDetail(null)
        setYearError(err instanceof ApiError ? err.message : `Failed to load tax year ${year}`)
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }, [selection, filingStatus])

  // The selected year is mirrored into the URL from this page's own doors only — a chip, a
  // create, a status flip, a retry, a delete — and never from an effect or an arrival. The
  // what-if card writes the SAME search string for its entries, and whichever
  // setSearchParams runs last in a tick wins outright (useSandbox's note), so keeping these
  // writes in handlers and promise continuations is what keeps the two from clobbering.
  //
  // `pendingRef` carries the uncommitted params until the URL catches up: react-router's
  // setter — functional form included — hands back the RENDER's params, so two writes in
  // one tick would each start from the same snapshot and the second would drop the first
  // (useScope's coalescer, same shape). `base` is the URL the write was computed from.
  const yearWriteRef = useRef<{ base: string; next: URLSearchParams } | null>(null)
  useEffect(() => {
    // Landed (the URL is what we wrote) or superseded (it moved elsewhere): either way the
    // ref is no longer ahead of the URL. Only "still at the base" means in flight.
    const pending = yearWriteRef.current
    if (pending && searchParams.toString() !== pending.base) yearWriteRef.current = null
  }, [searchParams])

  const writeYearParam = (year: number | null) => {
    const seed = yearWriteRef.current?.next ?? searchParams
    const next = new URLSearchParams(seed)
    if (year === null) next.delete('year')
    else next.set('year', String(year))
    // Nothing to write: no location.key churn, and no phantom pending entry whose base
    // equals the URL — that one would never clear (useScope's note).
    if (next.toString() === seed.toString()) return
    yearWriteRef.current =
      next.toString() === searchParams.toString() ? null : { base: searchParams.toString(), next }
    // Replace, never push (the drill-param convention): Back leaves the page rather than
    // walking every year the user looked at.
    setSearchParams(next, { replace: true })
  }

  // The "we are fetching" flip lives in the handlers that cause a fetch, never in the
  // effect above.
  const loadYear = (year: number) => {
    // The one door onto a year, so the one place the URL learns which year that is.
    writeYearParam(year)
    enterYear(year)
  }

  // The house confirm (TransactionsPanel's delete): a reload replaces both editors'
  // payloads, so unsaved work is gone the moment one starts.
  const confirmDiscard = () =>
    !dirty || window.confirm(`Discard unsaved changes for ${selectedYear}?`)

  const selectYear = (year: number) => {
    // Re-clicking the selected chip must not refetch (MonthlyUpdatePage's same-month
    // lesson: the identity would change and the whole page would blink).
    if (year === selection?.year) return
    if (!confirmDiscard()) return
    loadYear(year)
  }

  // The FIFTH reload door (chips, Retry, create, delete, status). Everything the engine
  // reads moves with the status — bracket tables are stored per (jurisdiction, status), the
  // per-person inputs split into two columns, and the summary is computed against the
  // status-selected tables — so it goes through the SAME discard gate and the same
  // loadYear(), whose fresh `{year}` object (together with the row this replaces) is what
  // re-runs the load effect for the year already on screen.
  const changeFilingStatus = (next: FilingStatus) => {
    if (selectedYear === null || next === filingStatus || statusSaving) return
    if (!confirmDiscard()) return
    const year = selectedYear
    setStatusSaving(true)
    setError(null)
    setYearError(null)
    patchTaxYear(year, { filing_status: next })
      .then((row) => {
        // The echo is authoritative, and replacing the row HERE means the selector follows
        // even if no list reload ever happens.
        setYears((current) => current.map((y) => (y.year === row.year ? row : y)))
        loadYear(year)
        // The flip moves the engine's answer for this year (possibly to a refusal), which
        // moves the year's column in the all-years trend — a status change is a save as far
        // as CompositionPanel's feed is concerned (2026-08-31 review round).
        setTrendRefresh((n) => n + 1)
      })
      .catch((err: unknown) => {
        // A 422 (an unknown status) or a 404 (the year went away) lands here verbatim. The
        // selection is untouched, so the control still reads the row the server has.
        setYearError(
          err instanceof ApiError ? err.message : `Failed to set the filing status for ${year}`,
        )
      })
      .finally(() => setStatusSaving(false))
  }

  // Saving inputs or brackets moves the engine's answer, so the totals line is refetched.
  // Guarded twice: by SEQUENCE, so two saves in a row cannot let the slower one's totals
  // land last (or its failure raise a banner over the newer one's success), and by YEAR,
  // so an echo that outlives a year switch cannot be read as the new year's.
  const refreshSummary = (year: number) => {
    const seq = ++summarySeqRef.current
    fetchTaxSummary(year)
      .then((summary) => {
        if (seq !== summarySeqRef.current) return
        setDetail((current) =>
          current !== null && current.summary.year === summary.year
            ? { ...current, summary }
            : current,
        )
        // Only here: a refresh that the guards above dropped changed nothing on screen,
        // and refetching the trend for it would be a request with nothing to show.
        setTrendRefresh((n) => n + 1)
      })
      .catch((err: unknown) => {
        if (seq !== summarySeqRef.current) return
        setYearError(err instanceof ApiError ? err.message : 'Failed to refresh the totals')
      })
  }

  // A save that outlived a year switch echoes for a year nobody is looking at: the updaters
  // below drop it, and so must its side effects — refetching that year's totals would spend
  // a request whose only possible outcomes are "ignored" and "a banner about a dead year".
  const isStaleEcho = (year: number) => year !== currentYearRef.current

  const onInputsSaved = (echo: TaxInputsOut) => {
    setDetail((current) =>
      current !== null && current.inputs.year === echo.year ? { ...current, inputs: echo } : current,
    )
    if (isStaleEcho(echo.year)) return
    refreshSummary(echo.year)
    // The chips carry input/bracket counts, and this save just moved one of them.
    refreshYearCounts()
  }

  // The withholding card wrote the year's inputs from outside the form: the same landing
  // chain a save takes, plus the remount the form's protect-typed-work rule makes necessary.
  const onVestApplied = (echo: TaxInputsOut) => {
    setInputsEpoch((n) => n + 1)
    onInputsSaved(echo) // adopts the echo, refreshes the totals and the chip counts
  }

  // The what-if's Apply (2026-09-03 planning-sandboxes spec §8.6, §10): OVERRIDES only —
  // sale and ESPP legs are hypothetical and have nowhere to be written. One house-register
  // confirmation lists before → after from the scenario's own `changed_inputs` (the server's
  // numbers, not the panel's), then the EXISTING inputs PUT and the same landing chain the
  // withholding card's Apply uses: adopt the echo, remount the form, refresh the totals and
  // the chip counts. Never a new write path, and the unsaved-edits warning rides the same
  // sentence rather than asking twice.
  const applyOverrides = (overrides: Record<string, string | null>, changed: ChangedInput[]) => {
    if (selectedYear === null || detail === null) return
    const year = selectedYear
    const inputs = detail.inputs
    const keys = Object.keys(overrides)
    // The engine reads ONE household figure per key, so the what-if applies an override to
    // the SUM (services/tax_whatif.apply_scenario) — but a per-person key is stored once per
    // person, and this PUT's `values` shorthand writes the PRIMARY's row alone. On a
    // two-column year `annual_salary: 210000` previews a 210k household while the write
    // would leave the partner's 150k standing: 360k stored under a 210k answer, silently.
    // Every preset key (salary, 401(k), HSA) is per-person, so this is the common case, not
    // the exotic one. There is no split this page could invent — a 210k household could be
    // any pair — so it refuses and names the form that CAN say which person.
    const perPerson = perPersonLabels(inputs)
    const split = keys.filter((key) => perPerson.has(key))
    if (inputs.people.length > 1 && split.length > 0) {
      const named = split.map((key) => perPerson.get(key) ?? key).join(', ')
      setYearError(
        `${named} ${split.length === 1 ? 'is' : 'are'} stored per person, and ${year} is filed with ` +
          `${inputs.people.length} columns — the scenario ran against their total. Edit ` +
          `${split.length === 1 ? 'it' : 'them'} in Tax inputs — ${year}, which says which person.`,
      )
      return
    }
    // Only the keys being written: the endpoint reports every input its run moved, including
    // the engine's own derived rows, and listing those would promise writes nobody asked for.
    const lines = changed
      .filter((row) => keys.includes(row.key))
      .map((row) => `${row.label}: ${formatCurrency(row.before)} → ${formatCurrency(row.after)}`)
    const sentence = `This writes ${keys.length} input${keys.length === 1 ? '' : 's'} to ${year}'s stored return and reloads the form below${
      inputsDirty ? ', discarding its unsaved edits' : ''
    }. Continue?`
    if (!window.confirm([sentence, ...lines].join('\n'))) return
    setYearError(null)
    putTaxInputs(year, { values: overrides })
      .then((echo) => onVestApplied(echo))
      .catch((err: unknown) => {
        setYearError(
          err instanceof ApiError ? err.message : `Failed to apply the overrides to ${year}`,
        )
      })
  }

  const onBracketsSaved = (echo: TaxBracketsOut) => {
    setDetail((current) =>
      current !== null &&
      current.brackets.year === echo.year &&
      // `detail.brackets` is the tables the ENGINE reads — the year's own status'. The editor
      // has status TABS, so a save (or a clone) can legitimately answer for another status:
      // adopting that here would put tables the engine never walks under the year's heading
      // AND change bracketsKey mid-edit, remounting the editor over its own work.
      current.brackets.filing_status === echo.filing_status
        ? { ...current, brackets: echo }
        : current,
    )
    if (isStaleEcho(echo.year)) return
    refreshSummary(echo.year)
    refreshYearCounts()
  }

  const createYear = () => {
    const year = Number(newYear.trim())
    if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) {
      setCreateError(`Enter a year between ${YEAR_MIN} and ${YEAR_MAX}`)
      return
    }
    // Third of the three reload doors (chips, Retry, create): creating a year jumps to
    // it and remounts the editors, so it needs the same discard gate — and it must sit
    // before the request so a declined confirm can't orphan a created year.
    if (!confirmDiscard()) return
    // Seed from the newest year that actually HAS brackets. With none — a fresh database,
    // or a year list imported inputs-first — an empty inputs PUT is what creates the
    // tax_years row (both PUTs auto-create it; that IS the "new year" affordance).
    const source = latestOf(years.filter((y) => y.bracket_count > 0))
    setCreating(true)
    setCreateError(null)
    const request = source
      ? cloneBrackets(year, source.year)
      : putTaxInputs(year, { values: {} })
    request
      .then(() => {
        // The year EXISTS from here on, so nothing past this point may be reported as a
        // create failure: under the form the only affordance left is Create, and a second
        // Create against a year that now has brackets answers 409 forever.
        setNewYear(String(year + 1))
        // Show it immediately, with placeholder counts the reconcile below overwrites — a
        // failed list reload otherwise leaves the page sitting on the OLD year with no
        // trace of the one that was just made.
        setYears((current) =>
          current.some((y) => y.year === year)
            ? current
            : [
                ...current,
                // 'single' is the column's own default, so the placeholder cannot claim a
                // status the row does not have; the reconcile below replaces it either way.
                // `satisfies`, not a bare literal: inside the array the status would widen
                // to plain `string` and stop being a FilingStatus.
                {
                  year,
                  notes: null,
                  input_count: 0,
                  bracket_count: 0,
                  filing_status: 'single',
                } satisfies TaxYearOut,
              ].sort((a, b) => a.year - b.year),
        )
        loadYear(year)
        // The main banner owns this one, because the main banner is the thing with Retry.
        return reconcileYears().catch((err: unknown) => {
          setError(err instanceof ApiError ? err.message : 'Failed to load tax years')
        })
      })
      .catch((err: unknown) => {
        // 409 (the target already has brackets) and 404 (the source has none) both land
        // here verbatim — the year list is untouched, so nothing jumps.
        setCreateError(err instanceof ApiError ? err.message : 'Could not create the tax year')
      })
      .finally(() => setCreating(false))
  }

  // The FOURTH reload door (chips, Retry, create, delete), and the only one that asks its
  // own question instead of confirmDiscard()'s: deleting the year throws away the SAVED
  // inputs and brackets as well as the typed ones, so "discard unsaved changes?" is a
  // weaker question with nothing left to add. One confirm, never two.
  const deleteYear = () => {
    if (selectedYear === null) return
    const year = selectedYear
    const ok = window.confirm(
      `Delete tax year ${year} and all of its inputs and brackets? This cannot be undone.`,
    )
    if (!ok) return
    // Everything still in flight belongs to a year that is going away: the detail seq (a
    // load that would repopulate the editors from a 404) and the totals seq (a refresh
    // whose only possible outcome is a banner about a year nobody can look at).
    const seq = ++seqRef.current
    summarySeqRef.current += 1
    // Nulled HERE, with the seq bumps, and not in the .then: the switch door (loadYear) does
    // its ref work synchronously at click time, and two tests pin that a save echoing after
    // a switch never banners. The delete door upholds the same invariant — a save echoing
    // back MID-delete must not spend a summary refresh or a list GET on the dying year.
    currentYearRef.current = null
    setBusy(true)
    setError(null)
    setYearError(null)
    // An editor save that is still in flight and COMMITS after this request recreates the
    // year server-side (both PUTs `_ensure_year`; a deletion is not a tombstone). Accepted
    // single-user TOCTOU class: the next list load shows the year again, and the user
    // deletes it again.
    deleteTaxYear(year)
      .then(() => {
        // Gone on the server whoever is looking at the page by now, so the chip goes
        // unguarded — the create path's optimistic list edit, inverted.
        setYears((current) => current.filter((y) => y.year !== year))
        if (seq !== seqRef.current) return
        // No year is selected any more — the ref that says which year the page belongs to
        // was nulled at click time, above — so the URL must stop naming one too.
        writeYearParam(null)
        setSelection(null)
        setDetail(null)
        setInputsDirty(false)
        setBracketsDirty(false)
        // The panel unmounts with the selection and refetches when a year is next selected,
        // so this is the counter staying honest rather than the thing that redraws it.
        setTrendRefresh((n) => n + 1)
        // The year EXISTS no more from here on, so nothing past this point may be reported
        // as a delete failure: the main banner owns it, because the main banner has Retry.
        return reconcileYears().catch((err: unknown) => {
          setError(err instanceof ApiError ? err.message : 'Failed to load tax years')
        })
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        // The delete failed, so the year is still the page's: put the ref back, or every
        // later save echo would read as stale. INSIDE the seq guard — outside it, a newer
        // load's year would be clobbered by this dead one.
        currentYearRef.current = year
        // A 404 (someone deleted it first) lands here verbatim. The selection is untouched,
        // so Retry still means "reload the year I am looking at".
        setYearError(err instanceof ApiError ? err.message : `Failed to delete tax year ${year}`)
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }

  const retry = () => {
    if (!confirmDiscard()) return
    setError(null)
    setYearError(null)
    if (selectedYear === null) {
      setLoading(true)
      setBusy(true)
      // Still the year the link named: nothing has been selected for the user to have
      // moved off, so a retry means "try that one again".
      loadYears(arrivalYear)
      return
    }
    loadYear(selectedYear)
    // The banner may have come from the LIST (a create whose reload failed leaves an
    // un-reconciled placeholder chip), so retry that too rather than only the detail.
    reconcileYears().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Failed to load tax years')
    })
  }

  return (
    <div className="page taxes-page">
      <PageFrame
        title="Taxes"
        resource={{
          // The years LIST is this page's lifecycle; a year's detail is the feed below it.
          // A first-load failure leaves no year selected and nothing to look at, so it is
          // the frame's own error state — with the Retry that reloads the list itself, or
          // the page dead-ends at the banner. With years already on screen the same message
          // rides the frame's stale line instead, over a body that still works.
          status: loading ? 'loading' : error !== null && years.length === 0 ? 'error' : 'ready',
          error,
          // Deliberately NO frame-level `busy`: the year detail is the only thing a load
          // moves, and this page's own `.taxes-page .loading-dim.is-loading` sets
          // pointer-events: none — a page-wide dim would take the year chips and the
          // new-year box out of reach for the length of every year load. The Feed below
          // owns the dim, over exactly the editors that rule was written for.
          retry,
        }}
        // No KPI row on this page, so the ghost must not draw one: the two cards are the
        // totals strip and the panel under it.
        skeleton={{
          tiles: 0,
          cards: [
            { span: 12, height: 90 },
            { span: 12, height: 320 },
          ],
        }}
      >
        <section className="card">
          <h2 className="eyebrow">
            Tax year
            <InfoHint text="One column of inputs and bracket tables per year. Creating a year copies the newest year&apos;s brackets." />
          </h2>
          {years.length > 0 && (
            <div className="chip-row">
              {years.map((y) => (
                <button
                  key={y.year}
                  type="button"
                  className={y.year === selectedYear ? 'chip active' : 'chip'}
                  aria-pressed={y.year === selectedYear}
                  title={`${y.input_count} inputs · ${y.bracket_count} brackets`}
                  onClick={() => selectYear(y.year)}
                >
                  {y.year}
                </button>
              ))}
            </div>
          )}
          {/* The status of the SELECTED year, not another year to pick: its own row under the
              chips, in the app-wide segmented treatment (.segmented, declared once
              in panels.css). */}
          {selectedYear !== null && (
            <div className="filing-status-row">
              <span className="filing-status-label">Filing status</span>
              <InfoHint text="Which bracket tables the engine walks for this year, and whether the per-person inputs below split into two columns. Every year starts as Single." />
              <div className="segmented" role="group" aria-label="Filing status">
                {FILING_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={status === filingStatus ? 'active' : ''}
                    aria-pressed={status === filingStatus}
                    disabled={statusSaving || busy}
                    onClick={() => changeFilingStatus(status)}
                  >
                    {FILING_STATUS_LABELS[status]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Standing, never dismissible: MFS brackets without Form-8958 community-income
              splitting are wrong in California, and the sentence has to sit wherever the
              number does (audit §3.2, design decision log "MFS"). */}
          {selectedYear !== null && filingStatus === 'married_separate' && (
            <p className="filing-status-caveat" role="note">
              California is a community-property state; true MFS requires 50/50
              community-income splitting (Form 8958), which this calculator does not model.
            </p>
          )}
          {/* loadedOnce, not !loading: a FIRST load that failed knows nothing about whether
              there are years, and "No tax years yet" under an error banner reads as an
              answer. */}
          {loadedOnce && years.length === 0 && (
            <p className="empty-note">No tax years yet — create one to start.</p>
          )}
          <form
            className="new-year-form"
            // The bounds are enforced (and worded) by createYear. Left to the browser, the
            // message is a native bubble that differs per engine and blocks submit before
            // this page ever sees it.
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              createYear()
            }}
          >
            <label htmlFor="new-tax-year">New year</label>
            <input
              id="new-tax-year"
              className="field-input"
              type="number"
              inputMode="numeric"
              min={YEAR_MIN}
              max={YEAR_MAX}
              value={newYear}
              onChange={(e) => {
                setNewYear(e.target.value)
                // The sentence below describes the year that WAS in the box.
                setCreateError(null)
              }}
            />
            <button type="submit" className="button" disabled={creating || loading}>
              {creating ? 'Creating…' : 'Create year'}
            </button>
            {/* The other end of this row's job — Create makes the year in the box, Delete
                throws away the SELECTED one — and the one control row that renders even with
                no years, so its shut state is visible rather than absent. type="button", so
                the form's submit stays the create path's alone. */}
            <button
              type="button"
              className="button"
              disabled={selectedYear === null || busy || creating}
              onClick={deleteYear}
            >
              Delete year…
            </button>
            <span className="drill-hint">
              Copies the newest year&apos;s bracket tables; the values are then edited below.
            </span>
          </form>
          <FeedBanner error={createError} />
        </section>

        {/* The selected year's own failures — a load, a status flip, a totals refresh, a
            delete — stay an assertive banner beside the year they are about, never the
            frame's "showing earlier data" line, which is the year LIST's grammar. */}
        <FeedBanner error={yearError} retry={retry} />
        <Feed
          data={detail}
          // A seeded-empty revisit has no year to ghost for: the list answers instantly
          // from the snapshot and there is nothing under the new-year form.
          busy={busy && years.length > 0}
          staleNoun="the year"
          skeleton={{ height: 320, label: 'Loading the year…' }}
          // Only a delete gets here: every other path either selects a year or has no years
          // to select. Without it the page ends at the form with nothing saying the chips
          // above are waiting for a click.
          empty={
            selection === null && years.length > 0 ? (
              <p className="empty-note">Select a tax year above.</p>
            ) : undefined
          }
        >
          {(d) => (
            <>
              {/* Year-scoped answers read contiguously (2026-08-31 audit): totals, then the
                  withholding outlook, the marginal ladder and the sandbox; the all-years
                  composition trend closes the answers half below, and entry comes last. */}
              <SummaryPanel summary={d.summary} filingStatus={filingStatus} />
              {/* The CURRENT year only, mirroring the endpoint's own 422 (a settled year may well
                  be stored and summarizable, and this card still cannot be drawn for it) — asked
                  here rather than spending a request on the refusal. Keyed by year like the
                  what-if card, so a switch INTO this year mounts it fresh rather than leaving
                  another year's estimate under this heading. */}
              {d.summary.year === new Date().getFullYear() && (
                <WithholdingPanel
                  key={`withholding-${d.summary.year}`}
                  year={d.summary.year}
                  storedVestW2={vestW2Stored(d.inputs)}
                  inputsDirty={inputsDirty}
                  onVestApplied={onVestApplied}
                />
              )}
              {/* D3 (2026-08-31): client-side ladder over the SAME two payloads the panels
                  around it read — the summary and the year's own status' tables. Not keyed:
                  both props are per-year payloads the load effect already replaces whole. */}
              <MarginalPanel summary={d.summary} brackets={d.brackets} />
              {/* Keyed by year for the editors' own reason: a real switch remounts it, so the
                  typed legs and any scenario on screen go with the year they were run against
                  (a stale scenario under a new year's heading would lie), while a same-year
                  reload leaves half-typed legs alone. It owns its two feeds and loads them
                  lazily on first open, so the remount costs nothing until the card is used.
                  The panel reads the URL's `whatif` family itself — entries and the legacy
                  ticker/lot aliases alike — and re-runs it against the year now on screen: a
                  scenario is a property of the URL, not of the year. The three year payloads
                  ride down for the presets, which are sized from data already on this page. */}
              <WhatIfPanel
                key={`whatif-${d.summary.year}`}
                year={d.summary.year}
                definitions={overrideDefinitions(d.inputs)}
                inputs={d.inputs}
                brackets={d.brackets}
                summary={d.summary}
                onApplyOverrides={applyOverrides}
              />
              {/* Deliberately NOT keyed: this panel's feed is the all-years trend, which a
                  year switch does not move — remounting it would spend a request to redraw
                  the same chart. It closes the answers half; entry follows. */}
              <CompositionPanel refreshKey={trendRefresh} />
              {/* Keyed by the payloads' own identity (see inputsKey/bracketsKey), not by load:
                  a real year or status switch remounts the editors — 2023's typed rows must not
                  carry into 2024, and a one-column year's cell ids are not a two-column year's —
                  while a same-year same-status reload (Retry, or the refresh after a save) leaves
                  them mounted. Their state seeds from useState initializers, so the replaced
                  props cannot clobber typed work either.
                  :epoch — remounts on an EXTERNAL inputs write (D4 Apply), never on the form's
                  own save. */}
              <InputsForm
                key={`${inputsKey(d.inputs)}:${inputsEpoch}`}
                inputs={d.inputs}
                onSaved={onInputsSaved}
                onDirtyChange={setInputsDirty}
              />
              <BracketsEditor
                key={bracketsKey(d.brackets)}
                brackets={d.brackets}
                yearStatus={filingStatus}
                onSaved={onBracketsSaved}
                onDirtyChange={setBracketsDirty}
              />
            </>
          )}
        </Feed>
      </PageFrame>
    </div>
  )
}
