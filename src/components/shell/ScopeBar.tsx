import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchCoverage } from '../../api/coverage'
import { fetchHousehold } from '../../api/household'
import type { OwnerScope } from '../../api/netWorth'
import { getSnapshot, setSnapshot } from '../../api/snapshotCache'
import type { RangePreset } from '../../charts/timeZoom'
import type { CoverageOut, HouseholdOut } from '../../types/api'
import { currentMonthIso } from '../../utils/months'
import InfoHint from '../InfoHint'
import MonthRibbon, { type RibbonCoverage } from './MonthRibbon'
import Segmented from './Segmented'
import { ownerToParam, useScope } from './useScope'
import '../panels.css'
import './shell.css'

// The one scope row (2026-09-03 shell spec §6): renders ONLY the controls a page declares,
// and owns the two fetches they need — the household for the owner chips, coverage for the
// ribbon — so pages declare rather than wire. Both are snapshot-cached under shell:* keys.

interface MonthScopeBase {
  /** The ribbon's right edge (a page may anchor ahead of today, e.g. the wizard's next entry
   *  month); defaults to the current month. */
  anchor?: string
}

/** The two modes take different props, so this is a union rather than one bag of optionals: a
 *  view page cannot hand over an edit handler, nor the wizard an Edit link, instead of each
 *  silently ignoring the other's fields. */
export type MonthScopeProps =
  | (MonthScopeBase & {
      mode: 'view'
      /** Figures to print in chip labels (Net worth passes that month's total). */
      figures?: Record<string, string>
      /** Where the ribbon's Edit link goes. */
      editHref?: (monthIso: string) => string
    })
  | (MonthScopeBase & {
      mode: 'edit'
      /** The month being edited. */
      selected?: string
      /** What a chip click does — the wizard guards its draft in its own handler, so it must
       *  own the click. */
      onSelect?: (monthIso: string) => void
    })

export interface ScopeBarProps {
  /** `{ joint: false }` hides Joint (a paycheck has no joint); `{ all: false }` also hides
   *  All and shows a null scope as the primary person — for pages that are always about
   *  ONE person (Paycheck). */
  owner?: boolean | { joint: boolean; all?: boolean }
  /** Overrides the shell's own explanation (below) for a page that has something MORE to say
   *  about whose view this is — Portfolio adds that performance always covers the household.
   *  Left undefined, the usual case, the bar prints its default, so every owner page answers
   *  "Whose" with the same words. Rendered as an InfoHint right after the owner control, and
   *  only when that control renders: a one-person household is asked no whose-view question,
   *  so it is offered no answer either. */
  ownerHint?: string
  range?: boolean
  month?: MonthScopeProps
  /** Any value; when it changes the household and coverage fetches re-run. The wizard bumps it
   *  after a save so the just-saved month's chip fills without leaving the page. */
  revalidate?: unknown
}

const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '1y', label: '1Y' },
  { value: 'ytd', label: 'YTD' },
]

// The shell's own answer to "Whose", so the question is explained once and identically
// everywhere instead of each page wording it afresh. Which sentence applies follows the chips
// actually offered: a Joint chip means there are shared accounts to explain.
const OWNER_HINT_JOINT =
  "A person's view is their own accounts plus the joint ones — that is what a joint account is. Joint shows only the shared accounts."
const OWNER_HINT_SOLO = 'Each person has their own view; nothing here is shared.'

export const HOUSEHOLD_SNAPSHOT = 'shell:household'
export const COVERAGE_SNAPSHOT = 'shell:coverage'

function ownerFromValue(value: string): OwnerScope {
  if (value === 'all') return null
  if (value === 'joint') return 'joint'
  return Number(value)
}

export default function ScopeBar({ owner, ownerHint, range, month, revalidate }: ScopeBarProps) {
  const navigate = useNavigate()
  const { scope, setScope } = useScope({
    owner: owner !== undefined && owner !== false,
    range: range === true,
    month: month !== undefined && month.mode === 'view',
  })

  const [household, setHousehold] = useState<HouseholdOut | null>(
    () => getSnapshot<HouseholdOut>(HOUSEHOLD_SNAPSHOT) ?? null,
  )
  const [coverage, setCoverage] = useState<CoverageOut | null>(
    () => getSnapshot<CoverageOut>(COVERAGE_SNAPSHOT) ?? null,
  )

  const wantsOwner = owner !== undefined && owner !== false
  useEffect(() => {
    if (!wantsOwner) return
    fetchHousehold()
      .then((data) => {
        setSnapshot(HOUSEHOLD_SNAPSHOT, data)
        setHousehold(data)
      })
      .catch(() => {
        /* keep whatever the snapshot had: the URL still carries the truth and the page's own
           resource reports outages */
      })
  }, [wantsOwner, revalidate])

  const wantsMonth = month !== undefined
  useEffect(() => {
    if (!wantsMonth) return
    fetchCoverage()
      .then((data) => {
        setSnapshot(COVERAGE_SNAPSHOT, data)
        setCoverage(data)
      })
      .catch(() => {
        /* keep whatever the snapshot had: the URL still carries the truth and the page's own
           resource reports outages */
      })
  }, [wantsMonth, revalidate])

  const people = useMemo(
    () =>
      [...(household?.people ?? [])].sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id,
      ),
    [household],
  )
  const showJoint = owner === true || (typeof owner === 'object' && owner.joint)
  const showAll = !(typeof owner === 'object' && owner.all === false)
  const ownerOptions = useMemo(
    () => [
      ...(showAll ? [{ value: 'all', label: 'All' }] : []),
      ...people.map((p) => ({ value: String(p.id), label: p.name })),
      ...(showJoint ? [{ value: 'joint', label: 'Joint' }] : []),
    ],
    [people, showAll, showJoint],
  )
  // A scope this page offers no chip for has to land somewhere: the first chip — All when there
  // is one, otherwise the primary, the person the page has always been about when nothing is
  // picked. One rule covers the declared cases (no All chip, joint where there is no Joint chip)
  // and the accidental ones alike (a stale link naming a person who has since been deleted).
  const rawOwnerValue = ownerToParam(scope.owner)
  const ownerChipValue = ownerOptions.some((o) => o.value === rawOwnerValue)
    ? rawOwnerValue
    : (ownerOptions[0]?.value ?? rawOwnerValue)

  const ribbonCoverage = useMemo<RibbonCoverage | null>(
    () =>
      coverage === null
        ? null
        : { balances: new Set(coverage.balances), spending: new Set(coverage.spending) },
    [coverage],
  )
  const earliest = useMemo(() => {
    if (coverage === null) return null
    const all = [...coverage.balances, ...coverage.spending, ...coverage.net_pay].sort()
    return all[0] ?? null
  }, [coverage])
  // "Latest" is the newest month the balances feed has — exactly what a view page shows when no
  // month is selected.
  const latestCovered = useMemo(() => {
    if (coverage === null) return null
    const sorted = [...coverage.balances].sort()
    return sorted[sorted.length - 1] ?? null
  }, [coverage])

  const monthGroupRef = useRef<HTMLDivElement | null>(null)
  const showOwner = wantsOwner && people.length > 1
  if (!showOwner && !range && month === undefined) return null

  // The anchor is where the ribbon ENDS (a page may anchor ahead of today); `today` is what
  // wears the ring. Only the anchor is injectable, so the ring always tracks the real clock.
  const today = currentMonthIso()
  const anchor = month?.anchor ?? today

  return (
    <div className="scope-bar">
      {showOwner && (
        <div className="scope-bar-group">
          {/* The group below already announces itself as "Whose": this word is the sighted
              label for the very same thing, so a reader would otherwise hear it twice. */}
          <span className="eyebrow" aria-hidden="true">
            Whose
          </span>
          <Segmented
            variant="toggle"
            ariaLabel="Whose"
            options={ownerOptions}
            value={ownerChipValue}
            onChange={(value) => setScope({ owner: ownerFromValue(value) })}
          />
          <InfoHint text={ownerHint ?? (showJoint ? OWNER_HINT_JOINT : OWNER_HINT_SOLO)} />
        </div>
      )}
      {range && (
        <Segmented
          variant="toggle"
          ariaLabel="Time range"
          options={RANGE_OPTIONS}
          value={scope.range}
          onChange={(value) => setScope({ range: value })}
        />
      )}
      {month !== undefined && (
        <div className="scope-bar-group" ref={monthGroupRef}>
          <MonthRibbon
            anchor={anchor}
            today={today}
            earliest={earliest}
            coverage={ribbonCoverage}
            selected={month.mode === 'view' ? (scope.month ?? undefined) : month.selected}
            mode={month.mode}
            figures={month.mode === 'view' ? month.figures : undefined}
            editHref={month.mode === 'view' ? month.editHref : undefined}
            onSelect={(m) => {
              if (month.mode === 'view') setScope({ month: m })
              else if (month.onSelect !== undefined) month.onSelect(m)
              else navigate(`/update?month=${m}`)
            }}
          />
          {/* Hidden when the selection already IS the latest covered month: there the button is
              a no-op that churns the URL and implies somewhere else to go. */}
          {month.mode === 'view' && scope.month !== null && scope.month !== latestCovered && (
            <button
              type="button"
              className="chip"
              onClick={() => {
                setScope({ month: null })
                // This button unmounts with the selection, so focus would fall to the body and
                // the next Tab would restart at the top of the page. Hand it to the current
                // month's chip, which is already mounted whenever the cleared selection was in
                // the ribbon's own window (the common case); nothing to do when it is not.
                monthGroupRef.current
                  ?.querySelector<HTMLButtonElement>('.month-chip2.is-today')
                  ?.focus()
              }}
            >
              Back to latest
            </button>
          )}
        </div>
      )}
    </div>
  )
}
