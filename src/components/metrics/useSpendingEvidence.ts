import { useEffect, useState } from 'react'
import { describeError } from '../../api/client'
import { fetchSpendingEvidence } from '../../api/monthReview'
import type { SpendingEvidence } from '../../api/monthReview'
import { getSnapshot, setSnapshot } from '../../api/snapshotCache'

export default function useSpendingEvidence(month?: string, revision?: unknown) {
  const key = `spending:evidence:${month ?? 'default'}`
  const [result, setResult] = useState<{ key: string; data: SpendingEvidence | null; error: string | null }>(() => ({ key, data: getSnapshot(key) ?? null, error: null }))
  useEffect(() => {
    let cancelled = false
    fetchSpendingEvidence(month).then(data => {
      if (cancelled) return
      setSnapshot(key, data)
      setResult({ key, data, error: null })
    }).catch(err => {
      if (!cancelled) setResult({ key, data: null, error: describeError(err, 'metric receipts') })
    })
    return () => { cancelled = true }
  }, [key, month, revision])
  const current = result.key === key ? result : { data: null, error: null }
  return { ...current, metric: (id: string) => current.data?.metrics.find(item => item.id === id) }
}
