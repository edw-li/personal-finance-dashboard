import { useMemo, useState } from 'react'
import { getSnapshot } from '../../api/snapshotCache'
import type { CoverageOut, FlowsPartOut } from '../../types/api'
import { COVERAGE_SNAPSHOT } from './ScopeBar'

/**
 * The scope row's own `GET /coverage` answer, handed up through `<ScopeBar onCoverage>` — the
 * page's only read of it, never a second request; the row's cached answer seeds the first paint
 * (2026-09-23 spec §T1, §T7, §T12). Pass `onCoverage` to the ScopeBar.
 *
 * `flowsDue` (`time.flows_due`) is keyed by its content: an identical answer landing again keeps
 * its identity, so the chart options and CSVs that read it are not rebuilt. The page itself does
 * re-render with each answer — the state changes — only the list's identity is stable.
 */
export function useScopeCoverage(): {
  coverage: CoverageOut | null
  onCoverage: (coverage: CoverageOut) => void
  flowsDue: FlowsPartOut[]
} {
  const [coverage, setCoverage] = useState<CoverageOut | null>(
    () => getSnapshot<CoverageOut>(COVERAGE_SNAPSHOT) ?? null,
  )
  const flowsKey = JSON.stringify(coverage?.time?.flows_due ?? [])
  const flowsDue = useMemo(() => JSON.parse(flowsKey) as FlowsPartOut[], [flowsKey])
  return { coverage, onCoverage: setCoverage, flowsDue }
}
