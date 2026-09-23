import { useEffect, useRef, useState } from 'react'
import { describeError } from '../../api/client'
import { fetchSpendingEvidence } from '../../api/monthReview'
import type { SpendingEvidence } from '../../api/monthReview'
import { getSnapshot, setSnapshot } from '../../api/snapshotCache'

/** The API's month currency, YYYY-MM-01: '2026-08', '2026-08-01' and an ISO timestamp all
 *  name August, so month identity never hangs on how a caller spelled it (2026-09-23 spec §P3). */
function evidenceMonth(month: string): string {
  return `${month.slice(0, 7)}-01`
}

function evidenceKey(month: string | undefined): string {
  return `spending:evidence:${month === undefined ? 'default' : evidenceMonth(month)}`
}

interface DefaultRequest {
  promise: Promise<SpendingEvidence>
  /** The page revision this answer belongs to; null/undefined = not yet claimed (see below). */
  revision: unknown
}

/** A page's spending-evidence receipts, in ONE request per view (2026-09-23 spec §P3).
 *
 *  The default request (no month) fires at once, in parallel with the page's matrix. When the
 *  matrix lands the page names a concrete month — nearly always the very month the default
 *  answer is for — so a concrete month first waits for the default request of the same revision
 *  and uses its answer when `response.month` is that month. Only another month (a drill), a
 *  failed default request or a new revision asks `?month=`.
 *
 *  `revision` is the page's data generation (its matrix object). A default request issued before
 *  the page had one is CLAIMED by the first revision that arrives — that arrival is the data the
 *  request was racing, not a change — and any later revision change refetches. */
export default function useSpendingEvidence(month?: string, revision?: unknown) {
  const wanted = month ? evidenceMonth(month) : undefined
  const key = evidenceKey(wanted)
  const [result, setResult] = useState<{ key: string; data: SpendingEvidence | null; error: string | null }>(() => ({ key, data: getSnapshot(key) ?? null, error: null }))
  const defaultRequest = useRef<DefaultRequest | null>(null)
  useEffect(() => {
    let cancelled = false
    const shared = defaultRequest.current
    const reusable = shared !== null && (shared.revision == null || shared.revision === revision)
    if (reusable) shared.revision = revision
    let answer: Promise<SpendingEvidence>
    if (wanted === undefined) {
      if (reusable) answer = shared.promise
      else {
        answer = fetchSpendingEvidence()
        defaultRequest.current = { promise: answer, revision }
      }
    } else if (reusable) {
      const explicit = () => fetchSpendingEvidence(wanted)
      answer = shared.promise.then(
        (data) => (data.month !== null && evidenceMonth(data.month) === wanted ? data : explicit()),
        explicit, // a failed default request falls back to the month's own request
      )
    } else {
      answer = fetchSpendingEvidence(wanted)
    }
    answer.then((data) => {
      if (cancelled) return
      setSnapshot(key, data)
      // The default answer IS its month's evidence: file it there too, so the render that
      // switches to that month's key paints it at once instead of flashing empty receipts.
      if (wanted === undefined && data.month !== null) setSnapshot(evidenceKey(data.month), data)
      setResult({ key, data, error: null })
    }).catch((err: unknown) => {
      if (!cancelled) setResult({ key, data: null, error: describeError(err, 'metric receipts') })
    })
    return () => { cancelled = true }
  }, [key, wanted, revision])
  // While a new key's answer is pending, paint that key's snapshot (the house SWR idiom).
  const current = result.key === key ? result : { data: getSnapshot<SpendingEvidence>(key) ?? null, error: null }
  return { ...current, metric: (id: string) => current.data?.metrics.find(item => item.id === id) }
}
