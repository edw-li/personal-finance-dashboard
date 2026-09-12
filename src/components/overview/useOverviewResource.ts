import { useCallback, useEffect, useRef, useState } from 'react'
import { describeError } from '../../api/client'
import { getSnapshot, setSnapshot } from '../../api/snapshotCache'

/** A coherent group has its own cache, retry and failure boundary. A different owner
 * never inherits the previous owner's payload while the new request is pending. */
export default function useOverviewResource<T>(key: string, noun: string, loader: () => Promise<T>) {
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null; busy: boolean; fromCache: boolean }>(() => ({ key, data: getSnapshot<T>(key) ?? null, error: null, busy: true, fromCache: getSnapshot(key) !== undefined }))
  const sequence = useRef(0)
  const load = useCallback(async () => {
    const seq = ++sequence.current
    try {
      const data = await loader()
      if (seq !== sequence.current) return
      setSnapshot(key, data)
      setResult(current => current.key === key && JSON.stringify(current.data) === JSON.stringify(data)
        ? { ...current, error: null, busy: false }
        : { key, data, error: null, busy: false, fromCache: false })
    } catch (err) {
      if (seq !== sequence.current) return
      setResult(current => {
        // During an owner switch the render may already show this key's cache,
        // while result still belongs to the owner being left. Keep the shown cache
        // on failure, without falling back to any other owner's data.
        const data = current.key === key ? current.data : getSnapshot<T>(key) ?? null
        return { key, data, error: describeError(err, noun), busy: false, fromCache: data !== null }
      })
    }
  }, [key, noun, loader])
  useEffect(() => { void load(); return () => { sequence.current += 1 } }, [load])
  const retry = () => { setResult(current => ({ ...current, busy: true })); void load() }
  const current = result.key === key ? result : { key, data: getSnapshot<T>(key) ?? null, error: null, busy: true, fromCache: getSnapshot(key) !== undefined }
  return { ...current, retry, stale: current.error !== null && current.data !== null }
}
