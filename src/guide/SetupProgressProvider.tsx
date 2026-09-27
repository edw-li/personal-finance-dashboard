import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { describeError, getToken } from '../api/client'
import { fetchSetupStatus } from '../api/guide'
import type { SetupStatus } from '../api/guide'
import { EMPTY_GUIDE_PROGRESS } from '../prefs/guideProgress'
import { getLocal, setLocal, subscribe } from '../prefs/prefsStore'
import { SetupProgressContext } from './setupProgress'

export default function SetupProgressProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [progress, setProgress] = useState(() => getLocal('guide_progress') ?? EMPTY_GUIDE_PROGRESS)
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [busy, setBusy] = useState(() => enabled && getToken() !== null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => subscribe('guide_progress', setProgress), [])
  useEffect(() => {
    if (!enabled || !getToken()) return
    let live = true
    let sequence = 0
    const refresh = () => {
      const request = ++sequence
      setBusy(true)
      void fetchSetupStatus().then((data) => {
        if (live && request === sequence) { setStatus(data); setError(null) }
      }).catch((err: unknown) => {
        if (live && request === sequence) setError(describeError(err, 'setup status'))
      }).finally(() => { if (live && request === sequence) setBusy(false) })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { live = false; window.removeEventListener('focus', refresh) }
  }, [attempt, enabled])
  return (
    <SetupProgressContext.Provider value={{ progress, status, busy, error,
      refresh: () => setAttempt((n) => n + 1),
      mark: (id, value) => {
        const current = getLocal('guide_progress') ?? EMPTY_GUIDE_PROGRESS
        const tasks = { ...current.tasks }
        if (value === null) delete tasks[id]
        else tasks[id] = value
        const next = { tasks, lastTask: id }
        setProgress(next)
        setLocal('guide_progress', next)
      },
    }}>{children}</SetupProgressContext.Provider>
  )
}
