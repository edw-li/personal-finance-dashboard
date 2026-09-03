import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchCoverage } from '../../api/coverage'
import { fetchHousehold } from '../../api/household'
import type { OwnerScope } from '../../api/netWorth'
import { getSnapshot, setSnapshot } from '../../api/snapshotCache'
import type { RangePreset } from '../../charts/timeZoom'
import type { CoverageOut, HouseholdOut } from '../../types/api'
import { currentMonthIso } from '../../utils/months'
import MonthRibbon, { type RibbonCoverage } from './MonthRibbon'
import Segmented from './Segmented'
import { useScope } from './useScope'
import './shell.css'

// The one scope row (2026-09-03 shell spec §6): renders ONLY the controls a page declares,
// and owns the two fetches they need — the household for the owner chips, coverage for the
// ribbon — so pages declare rather than wire. Both are snapshot-cached under shell:* keys.
export interface MonthScopeProps {
  mode: 'view' | 'edit'
  /** The current calendar month; defaults to today's. Injectable for tests. */
  anchor?: string
  /** Figures to print in chip labels (Net worth passes that month's total). */
  figures?: Record<string, string>
  /** View pages only: where the ribbon's Edit link goes. */
  editHref?: (monthIso: string) => string
  /** Edit pages only (the wizard): the month being edited, and what a chip click does —
   *  the wizard guards its draft in its own handler, so it must own the click. */
  selected?: string
  onSelect?: (monthIso: string) => void
}

export interface ScopeBarProps {
  /** `{ joint: false }` hides Joint (a paycheck has no joint); `{ all: false }` also hides
   *  All and shows a null scope as the primary person — for pages that are always about
   *  ONE person (Paycheck). */
  owner?: boolean | { joint: boolean; all?: boolean }
  range?: boolean
  month?: MonthScopeProps
}

const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '1y', label: '1Y' },
  { value: 'ytd', label: 'YTD' },
]

export const HOUSEHOLD_SNAPSHOT = 'shell:household'
export const COVERAGE_SNAPSHOT = 'shell:coverage'

function ownerValue(owner: OwnerScope): string {
  return owner === null ? 'all' : String(owner)
}

function ownerFromValue(value: string): OwnerScope {
  if (value === 'all') return null
  if (value === 'joint') return 'joint'
  return Number(value)
}

export default function ScopeBar({ owner, range, month }: ScopeBarProps) {
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
      .catch(() => setHousehold((current) => current))
  }, [wantsOwner])

  const wantsMonth = month !== undefined
  useEffect(() => {
    if (!wantsMonth) return
    fetchCoverage()
      .then((data) => {
        setSnapshot(COVERAGE_SNAPSHOT, data)
        setCoverage(data)
      })
      .catch(() => setCoverage((current) => current))
  }, [wantsMonth])

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
  // Without an All chip a null (household) scope has to land somewhere: the primary — the
  // person the page has always been about when nothing is picked. Joint likewise.
  const ownerChipValue =
    !showAll && (scope.owner === null || scope.owner === 'joint') && people.length > 0
      ? String(people[0].id)
      : ownerValue(scope.owner)

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

  const showOwner = wantsOwner && people.length > 1
  if (!showOwner && !range && month === undefined) return null

  const anchor = month?.anchor ?? currentMonthIso()

  return (
    <div className="scope-bar">
      {showOwner && (
        <div className="scope-bar-group">
          <span className="eyebrow">Whose</span>
          <Segmented
            variant="toggle"
            ariaLabel="Whose"
            options={ownerOptions}
            value={ownerChipValue}
            onChange={(value) => setScope({ owner: ownerFromValue(value) })}
          />
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
        <div className="scope-bar-group">
          <MonthRibbon
            anchor={anchor}
            earliest={earliest}
            coverage={ribbonCoverage}
            selected={month.mode === 'view' ? (scope.month ?? undefined) : month.selected}
            mode={month.mode}
            figures={month.figures}
            editHref={month.editHref}
            onSelect={(m) => {
              if (month.mode === 'view') setScope({ month: m })
              else if (month.onSelect !== undefined) month.onSelect(m)
              else navigate(`/update?month=${m}`)
            }}
          />
          {month.mode === 'view' && scope.month !== null && (
            <button type="button" className="chip" onClick={() => setScope({ month: null })}>
              Back to latest
            </button>
          )}
        </div>
      )}
    </div>
  )
}
