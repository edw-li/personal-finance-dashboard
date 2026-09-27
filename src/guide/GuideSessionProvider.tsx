import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { GuideSessionContext } from './guideSession'
import { rememberSetupTask } from './setupProgress'

function readTask(key: string): string | null {
  try { return sessionStorage.getItem(key) } catch { return null }
}
export default function GuideSessionProvider({ children }: { children: ReactNode }) {
  const { email } = useAuth()
  const storageKey = `finance.guideSession:${email ?? ''}`
  const location = useLocation()
  const navigate = useNavigate()
  const requested = new URLSearchParams(location.search).get('guideTask')
  const [session, setSession] = useState(() => ({ key: location.key, taskId: requested ?? readTask(storageKey) }))
  if (session.key !== location.key) setSession({ key: location.key, taskId: requested ?? session.taskId })
  const taskId = session.key !== location.key ? requested ?? session.taskId : session.taskId
  useEffect(() => {
    try {
      if (taskId) sessionStorage.setItem(storageKey, taskId)
      else sessionStorage.removeItem(storageKey)
    } catch { /* The URL still keeps the active task when browser storage is blocked. */ }
  }, [taskId, storageKey])
  return <GuideSessionContext.Provider value={{ taskId,
    select: (id) => {
      rememberSetupTask(id)
      setSession({ key: location.key, taskId: id })
      const params = new URLSearchParams(location.search)
      params.set('guideTask', id)
      navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true, preventScrollReset: true })
    },
    close: () => {
      setSession({ key: location.key, taskId: null })
      const params = new URLSearchParams(location.search)
      if (params.has('guideTask')) {
        params.delete('guideTask')
        navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true, preventScrollReset: true })
      }
      if (document.activeElement?.closest('.guide-companion')) document.getElementById('main')?.focus({ preventScroll: true })
    },
  }}>{children}</GuideSessionContext.Provider>
}
